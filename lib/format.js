// Date, time and reference helpers shared by the booking routes
const { booking } = require('./gym');

// Today's date (YYYY-MM-DD) and minutes past midnight in the gym's time zone
function gymNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: booking.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

// '6:00 pm' -> 1080
function toMinutes(label) {
  const [, h, m, ampm] = /^(\d{1,2}):(\d{2}) (am|pm)$/.exec(label);
  return (Number(h) % 12 + (ampm === 'pm' ? 12 : 0)) * 60 + Number(m);
}

// 1080 -> '6:00 pm'
function fromMinutes(total) {
  const h = Math.floor(total / 60) % 24;
  const m = String(total % 60).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

// '6:00 pm' -> '6:00 pm – 7:00 pm'
function sessionLabel(time) {
  return `${time} – ${fromMinutes(toMinutes(time) + booking.sessionMinutes)}`;
}

// '2026-11-02', '6:00 pm' -> '2026-11-02T18:00:00+04:00'
function toSessionDateTime(date, time) {
  const min = toMinutes(time);
  const hh = String(Math.floor(min / 60)).padStart(2, '0');
  const mm = String(min % 60).padStart(2, '0');
  return `${date}T${hh}:${mm}:00${booking.utcOffset}`;
}

// '2026-11-02T18:00:00+04:00' -> { date: '2026-11-02', time: '6:00 pm' }
function fromSessionDateTime(sessionDateTime) {
  const [, date, hh, mm] = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(sessionDateTime);
  return { date, time: fromMinutes(Number(hh) * 60 + Number(mm)) };
}

const bookingReference = (id) => `IDC-${String(id).padStart(5, '0')}`;

module.exports = {
  gymNow, isValidDate, addDays, formatDate, toMinutes, fromMinutes,
  sessionLabel, toSessionDateTime, fromSessionDateTime, bookingReference,
};
