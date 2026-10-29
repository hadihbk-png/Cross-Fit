const express = require('express');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const { syncPayment, releaseIfUnpaid } = require('../lib/payments');

const router = express.Router();

// Stripe → us. Confirms paid bookings even if the athlete closes the tab before the success page.
// The signature is checked against the raw body, and the payment is still re-checked with Stripe
// (syncPayment) before a booking is marked Booked. Safe to receive the same event more than once.
router.post('/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!paymentService.webhooksConfigured()) return res.status(503).send('Webhooks not configured');

  let event;
  try {
    event = paymentService.constructWebhookEvent(req.body, req.get('stripe-signature') || '');
  } catch (err) {
    console.warn('Rejected Stripe webhook:', err.message);
    return res.status(400).send('Invalid signature');
  }

  const session = event.data?.object;
  const b = session?.object === 'checkout.session' ? bookingService.getBookingByStripeSessionId(session.id) : null;

  try {
    if (b && b.status === 'Pending') {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          await syncPayment(b);
          break;
        case 'checkout.session.expired':
        case 'checkout.session.async_payment_failed':
          await releaseIfUnpaid(b);
          break;
        default:
          break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    // A 5xx makes Stripe retry the event later
    console.error(`Stripe webhook ${event.type} for booking ${b?.id} failed:`, err.message);
    res.status(500).send('Temporary failure');
  }
});

module.exports = router;
