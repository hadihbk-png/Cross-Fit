const express = require('express');
const { classes, schedule, booking } = require('../lib/gym');
const { gymNow, formatDate, sessionLabel, toMinutes, fromSessionDateTime } = require('../lib/format');
const { requireRole } = require('../lib/auth');
const bookingService = require('../services/bookingService');
const emailService = require('../services/emailService');

const router = express.Router();
router.use(requireRole('coach'));

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DESK_ACTIONS = ['Checked in', 'Completed', 'No-show'];
const ATTENDING = ['Booked', 'Checked in', 'Completed', 'No-show']; // paid bookings a coach can act on

const className = (key) => classes.find((c) => c.key === key)?.name || key;
const anchorFor = (time) => `t-${toMinutes(time)}`;

const formatSentAt = (iso) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: booking.timeZone,
}).format(new Date(iso));

// Today's sessions (gym time zone), grouped by start time, then by class type
function todaysSessions(today, nowMs) {
  const bookings = bookingService.getBookingsByDate(today).filter((b) => b.status !== 'Cancelled');
  const dayName = DAY_NAMES[new Date(`${today}T00:00:00Z`).getUTCDay()];
  const slots = new Map();

  const slotFor = (time, sessionDateTime) => {
    if (!slots.has(time)) {
      const startsAt = Date.parse(sessionDateTime);
      const endsAt = startsAt + booking.sessionMinutes * 60 * 1000;
      slots.set(time, {
        time,
        anchor: anchorFor(time),
        label: sessionLabel(time),
        state: nowMs < startsAt ? 'upcoming' : nowMs < endsAt ? 'live' : 'finished',
        classes: new Map(),
      });
    }
    return slots.get(time);
  };

  // Every scheduled time today, even with no bookings yet
  const offset = booking.utcOffset;
  for (const time of schedule.find((d) => d.day === dayName)?.times || []) {
    const min = toMinutes(time);
    const hhmm = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    slotFor(time, `${today}T${hhmm}:00${offset}`);
  }

  for (const b of bookings) {
    const { time } = fromSessionDateTime(b.sessionDateTime);
    const slot = slotFor(time, b.sessionDateTime);
    if (!slot.classes.has(b.classType)) {
      slot.classes.set(b.classType, { className: className(b.classType), coach: b.coach, filled: 0, athletes: [] });
    }
    const group = slot.classes.get(b.classType);
    group.filled += 1; // Pending counts too: it holds a spot
    group.athletes.push({
      id: b.id,
      name: b.athleteName,
      experience: b.experienceLevel,
      status: b.status,
      beginner: b.experienceLevel === 'Beginner',
      canMark: ATTENDING.includes(b.status),
      canRemind: b.status === 'Booked' && slot.state === 'upcoming',
      lastReminder: b.lastReminderSentAt ? formatSentAt(b.lastReminderSentAt) : null,
    });
  }

  return [...slots.values()]
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
    .map((slot) => ({
      ...slot,
      classes: [...slot.classes.values()].map((g) => ({
        ...g,
        capacity: booking.capacity,
        athletes: g.athletes.sort((x, y) => x.name.localeCompare(y.name)),
      })),
    }));
}

router.get('/', (req, res) => {
  const now = gymNow();
  const nowMs = Date.now();
  const sessions = todaysSessions(now.date, nowMs);
  const athletes = sessions.flatMap((s) => s.classes.flatMap((c) => c.athletes));

  const stats = {
    bookings: athletes.filter((a) => ATTENDING.includes(a.status)).length,
    checkIns: athletes.filter((a) => a.status === 'Checked in' || a.status === 'Completed').length,
    noShows: athletes.filter((a) => a.status === 'No-show').length,
    pending: athletes.filter((a) => a.status === 'Pending').length,
  };

  // Booked athletes on later days, for reminders
  const upcoming = bookingService.getBookingsByStatus('Booked')
    .filter((b) => b.sessionDateTime.slice(0, 10) > now.date)
    .map((b) => {
      const { date, time } = fromSessionDateTime(b.sessionDateTime);
      return {
        id: b.id,
        athleteName: b.athleteName,
        dateLabel: formatDate(date),
        timeLabel: sessionLabel(time),
        className: className(b.classType),
        coach: b.coach,
        experienceLevel: b.experienceLevel,
        lastReminder: b.lastReminderSentAt ? formatSentAt(b.lastReminderSentAt) : null,
      };
    });

  res.render('desk', {
    title: 'Coach Desk',
    todayLabel: formatDate(now.date),
    sessions,
    stats,
    upcoming,
    actions: DESK_ACTIONS,
    emailReady: emailService.isConfigured(),
  });
});

// Mark an athlete Checked in / Completed / No-show (today's sessions only)
router.post('/bookings/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '');
  const b = Number.isInteger(id) ? bookingService.getBookingById(id) : null;
  const today = gymNow().date;
  let anchor = '';

  if (!DESK_ACTIONS.includes(status)) {
    req.session.flash = { type: 'danger', text: 'Unknown status.' };
  } else if (!b || !ATTENDING.includes(b.status)) {
    req.session.flash = { type: 'danger', text: 'That booking is not active (it may be unpaid or cancelled).' };
  } else if (b.sessionDateTime.slice(0, 10) !== today) {
    req.session.flash = { type: 'danger', text: "Only today's sessions can be updated here." };
  } else {
    bookingService.updateStatus(b.id, status);
    anchor = `#${anchorFor(fromSessionDateTime(b.sessionDateTime).time)}`;
    req.session.flash = { type: 'success', text: `${b.athleteName}: ${status}.` };
  }
  res.redirect(`/desk${anchor}`);
});

router.post('/:id/remind', async (req, res) => {
  const id = Number(req.params.id);
  const b = Number.isInteger(id) ? bookingService.getBookingById(id) : null;

  if (!b || b.status !== 'Booked') {
    req.session.flash = { type: 'danger', text: 'That booking is no longer active.' };
  } else if (Date.parse(b.sessionDateTime) <= Date.now()) {
    req.session.flash = { type: 'danger', text: `${b.athleteName}'s class has already started.` };
  } else {
    try {
      await emailService.sendReminder(b);
      bookingService.markReminderSent(b.id);
      req.session.flash = { type: 'success', text: `Reminder sent to ${b.athleteName}.` };
    } catch (err) {
      console.error(`Reminder for booking ${b.id} failed:`, err.message);
      req.session.flash = { type: 'danger', text: `Couldn't send the reminder to ${b.athleteName}. Check the email settings and try again.` };
    }
  }
  res.redirect('/desk');
});

module.exports = router;
