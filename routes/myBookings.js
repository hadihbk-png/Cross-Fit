const express = require('express');
const { classes, booking } = require('../lib/gym');
const { formatDate, sessionLabel, fromSessionDateTime, bookingReference } = require('../lib/format');
const { requireLogin } = require('../lib/auth');
const bookingService = require('../services/bookingService');

const router = express.Router();
router.use(requireLogin);

const cutoffMs = booking.cancelCutoffMinutes * 60 * 1000;
const cutoffText = `${booking.cancelCutoffMinutes / 60} hours`;

const ownedBy = (b, user) => b && b.athleteEmail.toLowerCase() === user.email.toLowerCase();
const canCancel = (b, now) => b.status === 'Booked' && Date.parse(b.sessionDateTime) - now >= cutoffMs;

function toView(b, now) {
  const { date, time } = fromSessionDateTime(b.sessionDateTime);
  return {
    id: b.id,
    reference: bookingReference(b.id),
    className: classes.find((c) => c.key === b.classType)?.name || b.classType,
    coach: b.coach,
    dateLabel: formatDate(date),
    timeLabel: sessionLabel(time),
    status: b.status,
    startsAt: Date.parse(b.sessionDateTime),
    canCancel: canCancel(b, now),
  };
}

router.get('/', (req, res) => {
  const now = Date.now();
  const all = bookingService.getBookingsByEmail(res.locals.currentUser.email).map((b) => toView(b, now));
  const upcoming = all.filter((b) => b.startsAt > now).sort((a, b) => a.startsAt - b.startsAt);
  const past = all.filter((b) => b.startsAt <= now).sort((a, b) => b.startsAt - a.startsAt);
  res.render('my-bookings', { title: 'My Bookings', upcoming, past, cutoffText });
});

router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const b = Number.isInteger(id) ? bookingService.getBookingById(id) : null;
  const user = res.locals.currentUser;

  // Someone else's booking looks the same as a missing one
  if (!ownedBy(b, user)) {
    req.session.flash = { type: 'danger', text: 'Booking not found.' };
  } else if (b.status !== 'Booked') {
    req.session.flash = { type: 'info', text: `${bookingReference(b.id)} is already ${b.status.toLowerCase()}.` };
  } else if (!canCancel(b, Date.now())) {
    req.session.flash = {
      type: 'danger',
      text: `Bookings can only be cancelled online up to ${cutoffText} before class. Please call us instead.`,
    };
  } else {
    bookingService.updateStatus(b.id, 'Cancelled');
    req.session.flash = { type: 'success', text: `${bookingReference(b.id)} has been cancelled. Your spot is free for someone else.` };
  }
  res.redirect('/my-bookings');
});

module.exports = router;
