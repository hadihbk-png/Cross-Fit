// All email code lives here. SMTP settings are read from the server environment only.
const nodemailer = require('nodemailer');
const { site, classes } = require('../lib/gym');
const { formatDate, sessionLabel, fromSessionDateTime } = require('../lib/format');

const smtp = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  // SMTP_FROM may be a bare address or "Name <address>"; the display name is always the box name
  from: (/<([^>]+)>/.exec(process.env.SMTP_FROM || '') || [])[1] || (process.env.SMTP_FROM || '').trim(),
};

const isConfigured = () => Boolean(smtp.host && smtp.from);

if (!isConfigured()) {
  console.warn('SMTP_HOST / SMTP_FROM are not set. Confirmation emails are disabled until they are added to .env.');
}

const transporter = isConfigured()
  ? nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // 465 = TLS from the start; 587/25 upgrade with STARTTLS
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  : null;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const signOff = `${site.name} · built at ${site.brand} · lisrc.ae · by ${site.author}`;
const reminderSignOff = `Powered by ${site.brand} · lisrc.ae · built by ${site.author}`;

// Branded HTML frame shared by every email; content is already-escaped HTML
function layout(content, footer) {
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#0b0b0b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:6px solid #ff5f1f">
        <tr><td style="background:#0b0b0b;color:#ffffff;padding:20px 24px;font-size:20px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">
          ${escapeHtml(site.name)}
        </td></tr>
        <tr><td style="padding:24px">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e5e5;color:#777;font-size:12px;text-align:center">
          ${escapeHtml(footer)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function send({ to, subject, text, html }) {
  if (!transporter) throw new Error('SMTP is not configured (set SMTP_HOST and SMTP_FROM)');
  return transporter.sendMail({ from: { name: site.name, address: smtp.from }, to, subject, text, html });
}

// Builds the "You're booked in!" email for a booking row
function buildBookingConfirmation(b) {
  const { date, time } = fromSessionDateTime(b.sessionDateTime);
  const className = classes.find((c) => c.key === b.classType)?.name || b.classType;
  const firstName = b.athleteName.split(' ')[0];
  const details = [
    ['Class', className],
    ['Coach', b.coach],
    ['Date', formatDate(date)],
    ['Time', sessionLabel(time)],
    ['Where', site.address],
  ];
  const notes = ['Arrive 10 minutes early, bring water and a towel.'];
  if (b.classType === 'foundations') notes.push('No experience needed — your coach will teach every movement.');

  const text = [
    `Hi ${firstName},`,
    '',
    "You're booked in! Here are your class details:",
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    '',
    ...notes,
    '',
    'See you on the floor!',
    '',
    '—',
    signOff,
  ].join('\n');

  const html = layout(`
          <p style="margin:0 0 8px;font-size:16px">Hi ${escapeHtml(firstName)},</p>
          <h1 style="margin:0 0 20px;font-size:26px;text-transform:uppercase">You're booked in!</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #0b0b0b;font-size:15px">
            ${details.map(([k, v]) => `<tr>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e5e5;color:#555;text-transform:uppercase;font-size:12px;width:90px">${escapeHtml(k)}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e5e5;font-weight:bold">${escapeHtml(v)}</td>
            </tr>`).join('')}
          </table>
          ${notes.map((n) => `<p style="margin:16px 0 0;padding:12px 14px;background:#fff3ec;border-left:4px solid #ff5f1f;font-size:15px">${escapeHtml(n)}</p>`).join('')}
          <p style="margin:24px 0 0;font-size:16px;font-weight:bold">See you on the floor!</p>`, signOff);

  return { subject: "You're booked in!", text, html };
}

// Sends the confirmation to the athleteEmail saved on the booking. Throws if sending fails.
async function sendBookingConfirmation(b) {
  return send({ to: b.athleteEmail, ...buildBookingConfirmation(b) });
}

// Builds the staff-triggered "Reminder: your class" email for a booking row
function buildReminder(b) {
  const { date, time } = fromSessionDateTime(b.sessionDateTime);
  const className = classes.find((c) => c.key === b.classType)?.name || b.classType;
  const where = `${site.name}, ${site.locality}`;
  const message = `Hi ${b.athleteName}, a reminder that your ${className} class with ${b.coach} is on ${formatDate(date)} `
    + `at ${time} at ${where}. Fuel up, hydrate, and tell your coach about any niggles before warm-up. Reply to cancel.`;

  const text = [message, '', '—', reminderSignOff].join('\n');
  const html = layout(
    `<p style="margin:0;font-size:16px;line-height:1.6">${escapeHtml(message)}</p>`,
    reminderSignOff
  );
  return { subject: 'Reminder: your class', text, html };
}

// Sends a reminder to the athleteEmail saved on the booking. Throws if sending fails.
async function sendReminder(b) {
  return send({ to: b.athleteEmail, ...buildReminder(b) });
}

module.exports = { isConfigured, buildBookingConfirmation, sendBookingConfirmation, buildReminder, sendReminder };
