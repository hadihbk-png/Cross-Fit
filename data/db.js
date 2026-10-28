// Opens the SQLite database and creates the schema. Only services/ should require this file.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, 'box.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    classType       TEXT NOT NULL,
    coach           TEXT NOT NULL,
    sessionDateTime TEXT NOT NULL,                 -- ISO 8601 with offset, e.g. 2026-11-02T18:00:00+04:00
    athleteName     TEXT NOT NULL,
    athletePhone    TEXT NOT NULL,
    athleteEmail    TEXT NOT NULL COLLATE NOCASE,
    experienceLevel TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'Booked',
    createdAt       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings (sessionDateTime, classType);
  CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings (athleteEmail);

  -- Backstop for the duplicate check in bookingService: one active booking per athlete per session
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_unique_athlete
    ON bookings (sessionDateTime, classType, athleteEmail) WHERE status <> 'Cancelled';

  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status, createdAt);

  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passwordHash TEXT NOT NULL,                    -- bcrypt hash; plain passwords are never stored
    createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Migrations: add columns to existing databases without touching their rows
const hasColumn = (table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

if (!hasColumn('bookings', 'stripeSessionId')) {
  db.exec('ALTER TABLE bookings ADD COLUMN stripeSessionId TEXT');
}
if (!hasColumn('bookings', 'confirmationEmailSentAt')) {
  db.exec('ALTER TABLE bookings ADD COLUMN confirmationEmailSentAt TEXT');
}
if (!hasColumn('bookings', 'lastReminderSentAt')) {
  db.exec('ALTER TABLE bookings ADD COLUMN lastReminderSentAt TEXT');
}
if (!hasColumn('users', 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'athlete'");
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_stripe_session
    ON bookings (stripeSessionId) WHERE stripeSessionId IS NOT NULL;
`);

module.exports = db;
