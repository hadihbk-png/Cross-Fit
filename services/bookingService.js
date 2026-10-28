// All booking database access lives here, so the storage can be swapped without touching routes.
const db = require('../data/db');
const { booking } = require('../lib/gym');

// 'Pending' = saved, waiting for payment. It holds a spot like 'Booked' does.
// 'Checked in', 'Completed' and 'No-show' are set by coaches on the Coach Desk.
const STATUSES = ['Pending', 'Booked', 'Checked in', 'Completed', 'No-show', 'Cancelled'];

class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BookingError';
    this.code = code; // 'FULL' | 'DUPLICATE' | 'INVALID_STATUS'
  }
}

const sql = {
  insert: db.prepare(`
    INSERT INTO bookings (classType, coach, sessionDateTime, athleteName, athletePhone, athleteEmail, experienceLevel, status)
    VALUES (:classType, :coach, :sessionDateTime, :athleteName, :athletePhone, :athleteEmail, :experienceLevel, :status)
  `),
  byId: db.prepare('SELECT * FROM bookings WHERE id = ?'),
  byStripeSession: db.prepare('SELECT * FROM bookings WHERE stripeSessionId = ?'),
  stalePending: db.prepare("SELECT * FROM bookings WHERE status = 'Pending' AND createdAt < ? ORDER BY createdAt"),
  setStripeSession: db.prepare('UPDATE bookings SET stripeSessionId = ? WHERE id = ?'),
  byEmail: db.prepare('SELECT * FROM bookings WHERE athleteEmail = ? ORDER BY sessionDateTime'),
  // sessionDateTime starts with YYYY-MM-DD, so a string range selects one calendar day
  byDate: db.prepare(`
    SELECT * FROM bookings
    WHERE sessionDateTime >= :day AND sessionDateTime < :nextDay
    ORDER BY sessionDateTime, classType, athleteName
  `),
  countSession: db.prepare(`
    SELECT COUNT(*) AS n FROM bookings
    WHERE sessionDateTime = ? AND classType = ? AND status <> 'Cancelled'
  `),
  activeForAthlete: db.prepare(`
    SELECT id FROM bookings
    WHERE sessionDateTime = ? AND classType = ? AND athleteEmail = ? AND status <> 'Cancelled'
  `),
  updateStatus: db.prepare('UPDATE bookings SET status = ? WHERE id = ?'),
  claimEmail: db.prepare(`
    UPDATE bookings SET confirmationEmailSentAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND confirmationEmailSentAt IS NULL
  `),
  releaseEmail: db.prepare('UPDATE bookings SET confirmationEmailSentAt = NULL WHERE id = ?'),
  byStatus: db.prepare('SELECT * FROM bookings WHERE status = ? ORDER BY sessionDateTime, athleteName'),
  markReminder: db.prepare("UPDATE bookings SET lastReminderSentAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"),
  updateStatusFrom: db.prepare('UPDATE bookings SET status = ? WHERE id = ? AND status = ?'),
};

function countBookingsForSession(sessionDateTime, classType) {
  return Number(sql.countSession.get(sessionDateTime, classType).n);
}

// Saves a booking after checking capacity and duplicates inside one transaction.
// Throws BookingError('FULL' | 'DUPLICATE') when the booking can't be taken.
// b.status defaults to 'Booked'; pass 'Pending' when payment is still to come.
function createBooking(b) {
  const status = b.status || 'Booked';
  if (!STATUSES.includes(status)) throw new BookingError('INVALID_STATUS', `Unknown status: ${status}`);

  db.exec('BEGIN IMMEDIATE');
  try {
    if (countBookingsForSession(b.sessionDateTime, b.classType) >= booking.capacity) {
      throw new BookingError('FULL', 'Sorry, that session has just filled up. Please choose another time.');
    }
    if (sql.activeForAthlete.get(b.sessionDateTime, b.classType, b.athleteEmail)) {
      throw new BookingError('DUPLICATE', 'You have already booked this session with this email.');
    }
    const { lastInsertRowid } = sql.insert.run({
      classType: b.classType,
      coach: b.coach,
      sessionDateTime: b.sessionDateTime,
      athleteName: b.athleteName,
      athletePhone: b.athletePhone,
      athleteEmail: b.athleteEmail,
      experienceLevel: b.experienceLevel,
      status,
    });
    db.exec('COMMIT');
    return sql.byId.get(lastInsertRowid);
  } catch (err) {
    db.exec('ROLLBACK');
    if (/UNIQUE constraint failed/.test(err.message)) {
      throw new BookingError('DUPLICATE', 'You have already booked this session with this email.');
    }
    throw err;
  }
}

function getBookingById(id) {
  return sql.byId.get(id);
}

function getBookingByStripeSessionId(stripeSessionId) {
  return sql.byStripeSession.get(String(stripeSessionId));
}

function setStripeSessionId(id, stripeSessionId) {
  return sql.setStripeSession.run(stripeSessionId, id).changes > 0;
}

// Pending bookings created before the given ISO timestamp
function getPendingBookingsCreatedBefore(isoTimestamp) {
  return sql.stalePending.all(isoTimestamp);
}

// Marks the confirmation email as sent. Returns false if it was already marked,
// so only one caller ever sends it, even if the success page is refreshed.
function claimConfirmationEmail(id) {
  return sql.claimEmail.run(id).changes > 0;
}

// Undo the mark after a failed send, so a later attempt can try again
function releaseConfirmationEmailClaim(id) {
  sql.releaseEmail.run(id);
}

function getBookingsByStatus(status) {
  return sql.byStatus.all(status);
}

function markReminderSent(id) {
  return sql.markReminder.run(id).changes > 0;
}

function getBookingsByEmail(email) {
  return sql.byEmail.all(String(email).trim());
}

// date: 'YYYY-MM-DD' in the gym's time zone
function getBookingsByDate(date) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return sql.byDate.all({ day: date, nextDay: next.toISOString().slice(0, 10) });
}

// Returns true if a booking was updated. With { from }, only updates if the
// current status matches, so two requests can't both move the same booking.
function updateStatus(id, status, { from } = {}) {
  if (!STATUSES.includes(status)) {
    throw new BookingError('INVALID_STATUS', `Status must be one of: ${STATUSES.join(', ')}.`);
  }
  const result = from ? sql.updateStatusFrom.run(status, id, from) : sql.updateStatus.run(status, id);
  return result.changes > 0;
}

module.exports = {
  createBooking,
  getBookingById,
  getBookingByStripeSessionId,
  setStripeSessionId,
  getPendingBookingsCreatedBefore,
  claimConfirmationEmail,
  releaseConfirmationEmailClaim,
  getBookingsByStatus,
  markReminderSent,
  getBookingsByEmail,
  getBookingsByDate,
  countBookingsForSession,
  updateStatus,
  BookingError,
  STATUSES,
};
