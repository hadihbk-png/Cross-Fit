const express = require('express');
const { site, classes, coaches, schedule, booking } = require('../lib/gym');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const { releaseIfUnpaid } = require('../lib/payments');
const {
  gymNow, isValidDate, addDays, formatDate, toMinutes, sessionLabel, toSessionDateTime, fromSessionDateTime,
} = require('../lib/format');

const router = express.Router();

const EXPERIENCE_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const bookableClasses = classes.map((c) => ({ ...c, coach: coaches.find((x) => x.name === c.coach) }));

function bookedCount(classKey, date, time) {
  if (!classKey) return 0;
  return bookingService.countBookingsForSession(toSessionDateTime(date, time), classKey);
}

// Sessions open for booking on a date, or a message explaining why there are none
function sessionsFor(classKey, date) {
  const now = gymNow();
  if (date < now.date) return { sessions: [], message: 'That date has passed. Choose today or a later date.' };
  if (date > addDays(now.date, booking.daysAhead)) {
    return { sessions: [], message: `You can book up to ${booking.daysAhead} days ahead. Choose an earlier date.` };
  }

  const day = schedule.find((d) => d.day === DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]);
  if (!day.times.length) return { sessions: [], message: `We're closed on ${day.day}s. Choose another day.` };

  const sessions = day.times
    .filter((t) => date !== now.date || toMinutes(t) > now.minutes)
    .map((t) => ({
      time: t,
      label: sessionLabel(t),
      capacity: booking.capacity,
      spotsLeft: Math.max(0, booking.capacity - bookedCount(classKey, date, t)),
    }));
  if (!sessions.length) return { sessions, message: "Today's sessions have all started. Choose another day." };
  return { sessions, message: '' };
}

// ownPendingId: this browser's own unpaid booking, which doesn't count as a duplicate (it is replaced on confirm)
function validate(body, { ownPendingId } = {}) {
  const values = {
    classType: String(body.classType || ''),
    date: String(body.date || ''),
    time: String(body.time || ''),
    name: String(body.name || '').trim().replace(/\s+/g, ' '),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    experience: String(body.experience || ''),
    fitConfirm: body.fitConfirm === 'yes',
  };
  const errors = {};

  const cls = bookableClasses.find((c) => c.key === values.classType);
  if (!cls) errors.classType = 'Choose a class type.';

  let session;
  if (!isValidDate(values.date)) {
    errors.date = 'Choose a date.';
  } else {
    const slots = sessionsFor(values.classType, values.date);
    session = slots.sessions.find((s) => s.time === values.time);
    if (slots.message) errors.date = slots.message;
    else if (!session) errors.time = 'Choose one of the available sessions.';
    else if (!session.spotsLeft) errors.time = 'That session is full. Choose another time.';
  }

  if (values.name.length < 2 || values.name.length > 80) errors.name = 'Enter your full name (2–80 characters).';

  const digits = values.phone.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(values.phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = 'Enter a valid phone number, e.g. +971 50 123 4567.';
  }

  if (values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!EXPERIENCE_LEVELS.includes(values.experience)) errors.experience = 'Choose your experience level.';

  if (!values.fitConfirm) errors.fitConfirm = 'Please confirm you are fit to train.';

  if (session && !errors.email) {
    const sessionDateTime = toSessionDateTime(values.date, values.time);
    const alreadyBooked = bookingService.getBookingsByEmail(values.email).some((b) =>
      b.sessionDateTime === sessionDateTime && b.classType === values.classType && b.status !== 'Cancelled'
      && !(b.status === 'Pending' && b.id === ownPendingId));
    if (alreadyBooked) errors.email = 'You have already booked this session with this email.';
  }

  const summary = Object.keys(errors).length ? null : {
    className: cls.name,
    coach: cls.coach,
    dateLabel: formatDate(values.date),
    timeLabel: session.label,
    spotsLeft: session.spotsLeft,
    capacity: session.capacity,
  };
  return { values, errors, summary };
}

const EMPTY_SLOTS = { sessions: [], message: '', date: '', selected: '' };

function renderForm(res, values = {}, errors = {}) {
  const now = gymNow();
  const v = {
    classType: '', date: '', time: '', name: '', phone: '', email: '', experience: '', fitConfirm: false,
    ...values,
  };
  const slots = isValidDate(v.date)
    ? { ...sessionsFor(v.classType, v.date), date: v.date, selected: v.time }
    : EMPTY_SLOTS;

  res.status(Object.keys(errors).length ? 422 : 200).render('booking', {
    title: 'Book a class',
    step: 'form',
    classes: bookableClasses,
    experienceLevels: EXPERIENCE_LEVELS,
    minDate: now.date,
    maxDate: addDays(now.date, booking.daysAhead),
    values: v,
    errors,
    slots,
  });
}

const successUrl = (stripeSessionId) => `/booking-success?session_id=${encodeURIComponent(stripeSessionId)}`;

router.get('/', async (req, res) => {
  const preselected = bookableClasses.some((c) => c.key === req.query.class) ? req.query.class : '';
  const user = res.locals.currentUser;
  let values = { classType: preselected, name: user?.name || '', email: user?.email || '' };

  // Back from Stripe without paying: release the held spot and refill the form
  const pending = req.query.checkout === 'cancelled' && req.session.pendingBookingId
    && bookingService.getBookingById(req.session.pendingBookingId);
  if (pending && pending.status === 'Pending') {
    try {
      if (await releaseIfUnpaid(pending)) return res.redirect(successUrl(pending.stripeSessionId));
      delete req.session.pendingBookingId;
      const { date, time } = fromSessionDateTime(pending.sessionDateTime);
      values = {
        classType: pending.classType, date, time, name: pending.athleteName, phone: pending.athletePhone,
        email: pending.athleteEmail, experience: pending.experienceLevel,
      };
      res.locals.flash = {
        type: 'info',
        text: 'Payment cancelled. You have not been charged and the spot has been released. Your details are below if you want to try again.',
      };
    } catch (err) {
      console.error(`Could not release pending booking ${pending.id}:`, err.message);
    }
  }
  renderForm(res, values);
});

// Session list for the chosen date, fetched by public/js/booking.js
router.get('/sessions', (req, res) => {
  const date = String(req.query.date || '');
  const slots = isValidDate(date)
    ? { ...sessionsFor(String(req.query.class || ''), date), date, selected: '' }
    : { ...EMPTY_SLOTS, date, message: 'Choose a valid date.' };
  res.render('partials/booking-sessions', { slots });
});

// Step 4 submitted: validate everything and show the summary
router.post('/', (req, res) => {
  const { values, errors, summary } = validate(req.body, { ownPendingId: req.session.pendingBookingId });
  if (!summary) return renderForm(res, values, errors);
  res.render('booking', { title: 'Review your booking', step: 'summary', values, summary });
});

// "Change details" from the summary
router.post('/edit', (req, res) => {
  renderForm(res, validate(req.body).values);
});

// "Confirm booking": save as Pending (holds the spot), then send the athlete to Stripe Checkout.
// The booking only becomes Booked on /booking-success, after the server checks the payment with Stripe.
router.post('/confirm', async (req, res, next) => {
  const ownPendingId = req.session.pendingBookingId;
  const { values, errors, summary } = validate(req.body, { ownPendingId });
  if (!summary) return renderForm(res, values, errors);

  if (!paymentService.isConfigured()) {
    return renderForm(res, values, {
      payment: `Online payment isn't available right now. Please call us on ${site.phone} to book.`,
    });
  }

  const sessionDateTime = toSessionDateTime(values.date, values.time);

  // Same browser retrying the same session: drop the earlier unpaid attempt first
  const earlier = ownPendingId && bookingService.getBookingById(ownPendingId);
  if (earlier && earlier.status === 'Pending'
    && earlier.sessionDateTime === sessionDateTime && earlier.classType === values.classType) {
    if (await releaseIfUnpaid(earlier)) return res.redirect(303, successUrl(earlier.stripeSessionId));
  }

  let saved;
  try {
    saved = bookingService.createBooking({
      classType: values.classType,
      coach: summary.coach.name,
      sessionDateTime,
      athleteName: values.name,
      athletePhone: values.phone,
      athleteEmail: values.email,
      experienceLevel: values.experience,
      status: 'Pending',
    });
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      return renderForm(res, values, err.code === 'FULL' ? { time: err.message } : { email: err.message });
    }
    return next(err);
  }

  let checkout;
  try {
    checkout = await paymentService.createCheckoutSession({
      bookingId: saved.id,
      email: values.email,
      className: summary.className,
      description: `${summary.dateLabel} · ${summary.timeLabel} · Coach ${summary.coach.name}`,
    });
    bookingService.setStripeSessionId(saved.id, checkout.id);
  } catch (err) {
    console.error(`Stripe Checkout failed for booking ${saved.id}:`, err.message);
    bookingService.updateStatus(saved.id, 'Cancelled', { from: 'Pending' });
    return renderForm(res, values, {
      payment: "We couldn't start the payment, so nothing was charged and no spot was held. Please try again.",
    });
  }

  req.session.pendingBookingId = saved.id;
  res.redirect(303, checkout.url);
});

module.exports = router;
