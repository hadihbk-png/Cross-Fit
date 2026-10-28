const fs = require('fs');
const path = require('path');

// Load .env for local development; on a server, real environment variables are used instead
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is not set. Add it to .env or the server environment.');
  process.exit(1);
}

const express = require('express');
const session = require('express-session');
const { site, classes, coaches, schedule, timeSlots, hours, booking, assistant } = require('./lib/gym');
const { loadUser } = require('./lib/auth');
const { startPendingSweep } = require('./lib/payments');
const userService = require('./services/userService');
const bookingRoutes = require('./routes/booking');
const paymentRoutes = require('./routes/payment');
const authRoutes = require('./routes/auth');
const myBookingsRoutes = require('./routes/myBookings');
const deskRoutes = require('./routes/desk');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (isProduction) app.set('trust proxy', 1); // behind a proxy that terminates HTTPS

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(session({
  name: 'idc.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax', // browsers won't send the cookie on cross-site form posts
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(loadUser);

// Site-wide values available in every view (header/footer partials included)
app.locals.site = site;
app.locals.dropIn = booking.dropIn;
app.locals.assistantName = assistant.name;

app.get('/', (req, res) => {
  res.render('index', { title: 'Home', classes, coaches, schedule, timeSlots, hours });
});

app.use('/booking', bookingRoutes);
app.use('/', paymentRoutes);
app.use('/my-bookings', myBookingsRoutes);
app.use('/desk', deskRoutes);
app.use('/api/chat', chatRoutes);
app.use('/', authRoutes);

app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Seed (or update) the Coach Desk account from DESK_EMAIL / DESK_PASSWORD
async function seedCoachAccount() {
  const email = (process.env.DESK_EMAIL || 'coach@irondunes.local').trim().toLowerCase();
  const password = process.env.DESK_PASSWORD || '';
  if (password.length < 12) {
    console.warn('DESK_PASSWORD is missing or shorter than 12 characters. The Coach Desk account was not set up.');
    return;
  }
  const result = await userService.ensureStaffUser({ name: 'Coach Desk', email, password, role: 'coach' });
  console.log(`Coach Desk account ${email}: ${result}`);
}

app.listen(PORT, (err) => {
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other app or run with a different PORT.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
  console.log(`Iron Dunes CrossFit running at http://localhost:${PORT}`);
  seedCoachAccount().catch((seedErr) => console.error('Could not set up the Coach Desk account:', seedErr.message));
  startPendingSweep();
});
