const express = require('express');
const { classes, coaches, booking } = require('../lib/gym');
const { formatDate, sessionLabel, fromSessionDateTime, bookingReference } = require('../lib/format');
const { syncPayment, sendConfirmationOnce } = require('../lib/payments');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const emailService = require('../services/emailService');

const router = express.Router();

function bookingView(b) {
  const { date, time } = fromSessionDateTime(b.sessionDateTime);
  const taken = bookingService.countBookingsForSession(b.sessionDateTime, b.classType);
  return {
    values: { name: b.athleteName, phone: b.athletePhone, email: b.athleteEmail, experience: b.experienceLevel },
    summary: {
      className: classes.find((c) => c.key === b.classType)?.name || b.classType,
      coach: coaches.find((c) => c.name === b.coach) || { name: b.coach, cert: 'Coach' },
      dateLabel: formatDate(date),
      timeLabel: sessionLabel(time),
      spotsLeft: Math.max(0, booking.capacity - taken),
      capacity: booking.capacity,
    },
    reference: bookingReference(b.id),
    status: b.status,
    paidLabel: booking.dropIn.label,
  };
}

function renderIncomplete(res, statusCode, message, extra = {}) {
  res.status(statusCode).render('booking', {
    title: 'Payment not completed', step: 'payment-incomplete', message, resumeUrl: null, sessionId: '', ...extra,
  });
}

// Stripe sends the athlete here after checkout. The redirect proves nothing on its own:
// the booking is only marked Booked after we retrieve the Checkout Session from Stripe.
router.get('/booking-success', async (req, res, next) => {
  const sessionId = String(req.query.session_id || '');
  const found = /^cs_(test|live)_\w+$/.test(sessionId) && bookingService.getBookingByStripeSessionId(sessionId);
  if (!found) {
    return renderIncomplete(res, 404, "We couldn't find a booking for this payment. If you were charged, please call us.");
  }

  let b = found;
  let session = null;
  if (b.status === 'Pending') {
    if (!paymentService.isConfigured()) {
      return renderIncomplete(res, 503, "We couldn't check your payment just now. Please refresh this page in a minute.");
    }
    try {
      ({ booking: b, session } = await syncPayment(b));
    } catch (err) {
      console.error(`Could not retrieve Checkout Session ${sessionId}:`, err.message);
      return renderIncomplete(res, 502, "We couldn't check your payment with Stripe just now. Please refresh this page in a minute.");
    }
  }

  const view = bookingView(b);
  if (b.status === 'Booked') {
    if (req.session.pendingBookingId === b.id) delete req.session.pendingBookingId;
    sendConfirmationOnce(b); // no-op if already sent; retries if an earlier send failed
    return res.render('booking', {
      title: 'Booking confirmed', step: 'confirmed', emailReady: emailService.isConfigured(), ...view,
    });
  }

  if (b.status === 'Pending') {
    const resumeUrl = session?.status === 'open' ? session.url : null;
    return renderIncomplete(res, 402, resumeUrl
      ? "Your payment hasn't gone through yet, so your spot isn't confirmed. You can return to the payment page to finish."
      : "Your payment wasn't completed, so your spot isn't confirmed. You haven't been charged.",
    { ...view, resumeUrl, sessionId });
  }

  renderIncomplete(res, 410, `This booking is ${b.status.toLowerCase()}. Payment for it wasn't completed, so please book again.`, view);
});

module.exports = router;
