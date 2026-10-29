// All Stripe access lives here. The secret key is read from the server environment only.
const Stripe = require('stripe');
const { booking } = require('../lib/gym');

const secretKey = process.env.STRIPE_SECRET_KEY || '';
const isTestKey = /^(sk|rk)_test_/.test(secretKey);

if (!secretKey) {
  console.warn('STRIPE_SECRET_KEY is not set. Online payment is disabled until it is added to .env.');
} else if (!isTestKey) {
  console.error('STRIPE_SECRET_KEY is not a test-mode key (sk_test_…). Online payment is disabled.');
}

const stripe = isTestKey ? new Stripe(secretKey) : null;

function isConfigured() {
  return Boolean(stripe && process.env.BASE_URL);
}

// One-off drop-in Checkout Session for a saved Pending booking
async function createCheckoutSession({ bookingId, email, className, description }) {
  const baseUrl = process.env.BASE_URL.replace(/\/+$/, '');
  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: booking.dropIn.currency,
          unit_amount: booking.dropIn.amount,
          product_data: { name: `${className} drop-in`, description },
        },
      }],
      customer_email: email,
      client_reference_id: String(bookingId),
      metadata: { bookingId: String(bookingId) },
      success_url: `${baseUrl}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/booking?checkout=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + booking.checkoutMinutes * 60,
    },
    { idempotencyKey: `booking-${bookingId}` }
  );
}

function retrieveCheckoutSession(sessionId) {
  return stripe.checkout.sessions.retrieve(sessionId);
}

// Closes an unpaid Checkout Session so it can't be paid later
function expireCheckoutSession(sessionId) {
  return stripe.checkout.sessions.expire(sessionId);
}

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
if (stripe && !webhookSecret) {
  console.warn('STRIPE_WEBHOOK_SECRET is not set. Stripe webhooks are disabled; paid bookings are still confirmed on the success page and by the 5-minute check.');
}

const webhooksConfigured = () => Boolean(stripe && webhookSecret);

// Verifies the Stripe-Signature header against the raw request body. Throws if it doesn't match.
function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

module.exports = {
  isConfigured, createCheckoutSession, retrieveCheckoutSession, expireCheckoutSession,
  webhooksConfigured, constructWebhookEvent,
};
