// Settles Pending bookings by asking Stripe what actually happened. The browser redirect is never trusted.
const { booking } = require('./gym');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const emailService = require('../services/emailService');

// Sends the "You're booked in!" email for a paid, Booked booking, at most once.
// Runs in the background: a failed send is logged and never blocks the confirmation page.
function sendConfirmationOnce(b) {
  if (!b || b.status !== 'Booked' || !b.stripeSessionId || b.confirmationEmailSentAt) return;
  if (!bookingService.claimConfirmationEmail(b.id)) return; // another request already sent it

  emailService.sendBookingConfirmation(b)
    .then(() => console.log(`Confirmation email sent for booking ${b.id}`))
    .catch((err) => {
      bookingService.releaseConfirmationEmailClaim(b.id); // allow a retry on the next visit
      console.error(`Confirmation email for booking ${b.id} failed:`, err.message);
    });
}

// Retrieves the booking's Checkout Session and marks the booking Booked if it is paid.
// Returns { session, paid, booking } with the booking as now stored.
async function syncPayment(b) {
  const session = await paymentService.retrieveCheckoutSession(b.stripeSessionId);
  const paid = session.payment_status === 'paid' && session.metadata?.bookingId === String(b.id);
  if (paid) bookingService.updateStatus(b.id, 'Booked', { from: 'Pending' });
  const current = bookingService.getBookingById(b.id);
  if (paid) sendConfirmationOnce(current);
  return { session, paid, booking: current };
}

// Gives up on an unpaid Pending booking: closes its Checkout Session and frees the spot.
// If it turns out to be paid after all, it is marked Booked instead. Returns true if paid.
async function releaseIfUnpaid(b) {
  if (!b.stripeSessionId) {
    bookingService.updateStatus(b.id, 'Cancelled', { from: 'Pending' });
    return false;
  }
  let { session, paid } = await syncPayment(b);
  if (paid) return true;

  if (session.status === 'open') {
    try {
      await paymentService.expireCheckoutSession(session.id);
    } catch {
      // Completed between our two calls: check again rather than cancel a paid booking
      ({ paid } = await syncPayment(b));
      if (paid) return true;
    }
  }
  bookingService.updateStatus(b.id, 'Cancelled', { from: 'Pending' });
  return false;
}

// Releases spots held by checkouts that were abandoned (browser closed, never came back)
async function releaseAbandonedCheckouts() {
  const cutoff = new Date(Date.now() - (booking.checkoutMinutes + 5) * 60 * 1000).toISOString();
  for (const b of bookingService.getPendingBookingsCreatedBefore(cutoff)) {
    try {
      await releaseIfUnpaid(b);
    } catch (err) {
      console.error(`Could not settle pending booking ${b.id}:`, err.message);
    }
  }
}

function startPendingSweep() {
  if (!paymentService.isConfigured()) return;
  const run = () => releaseAbandonedCheckouts().catch((err) => console.error(err));
  run();
  setInterval(run, 5 * 60 * 1000).unref();
}

module.exports = { syncPayment, releaseIfUnpaid, startPendingSweep, sendConfirmationOnce };
