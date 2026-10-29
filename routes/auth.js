const express = require('express');
const userService = require('../services/userService');
const { safeReturnTo } = require('../lib/auth');
const { createLimiter } = require('../lib/rateLimit');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Failed logins: 5 per account per visitor, 20 per visitor, every 15 minutes.
// Keyed by IP as well as email, so nobody can lock a real athlete (or the coach) out from elsewhere.
const failedPerAccount = createLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const failedPerIp = createLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const signupsPerIp = createLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));

// Start a fresh session for the user (prevents session fixation), then redirect
function logIn(req, res, next, user, redirectTo, flashText) {
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.flash = { type: 'success', text: flashText };
    req.session.save((saveErr) => (saveErr ? next(saveErr) : res.redirect(redirectTo)));
  });
}

router.get('/register', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/my-bookings');
  res.render('register', { title: 'Register', values: { name: '', email: '' }, errors: {} });
});

router.post('/register', async (req, res, next) => {
  const values = {
    name: String(req.body.name || '').trim().replace(/\s+/g, ' '),
    email: String(req.body.email || '').trim().toLowerCase(),
  };
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirmPassword || '');
  const errors = {};

  if (values.name.length < 2 || values.name.length > 80) errors.name = 'Enter your full name (2–80 characters).';
  if (values.email.length > 254 || !EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Use at least 8 characters.';
  else if (Buffer.byteLength(password) > 72) errors.password = 'Use 72 characters or fewer.'; // bcrypt limit
  if (!errors.password && password !== confirm) errors.confirmPassword = "Passwords don't match.";

  if (Object.keys(errors).length) {
    return res.status(422).render('register', { title: 'Register', values, errors });
  }

  if (signupsPerIp.hit(req.ip)) {
    return res.status(429).render('register', {
      title: 'Register',
      values,
      errors: { email: `Too many new accounts from this connection. Please try again in ${minutes(signupsPerIp.retryAfter(req.ip))} minutes.` },
    });
  }

  try {
    const user = await userService.registerUser({ ...values, password });
    const returnTo = safeReturnTo(req.session.returnTo);
    logIn(req, res, next, user, returnTo, `Welcome to Iron Dunes, ${user.name.split(' ')[0]}! Your account is ready.`);
  } catch (err) {
    if (err instanceof userService.UserError) {
      return res.status(422).render('register', { title: 'Register', values, errors: { email: err.message } });
    }
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/my-bookings');
  res.render('login', { title: 'Log in', values: { email: '' }, error: '' });
});

router.post('/login', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const accountKey = `${req.ip}|${email}`;
  if (failedPerAccount.isLimited(accountKey) || failedPerIp.isLimited(req.ip)) {
    const wait = Math.max(failedPerAccount.retryAfter(accountKey), failedPerIp.retryAfter(req.ip));
    res.set('Retry-After', String(wait));
    return res.status(429).render('login', {
      title: 'Log in', values: { email },
      error: `Too many failed attempts. Please wait ${minutes(wait)} minutes and try again.`,
    });
  }

  try {
    const user = email && password ? await userService.authenticate(email, password) : null;
    if (!user) {
      failedPerAccount.hit(accountKey);
      failedPerIp.hit(req.ip);
      return res.status(401).render('login', {
        title: 'Log in', values: { email }, error: 'Email or password is incorrect.',
      });
    }
    failedPerAccount.reset(accountKey);
    const returnTo = safeReturnTo(req.session.returnTo);
    logIn(req, res, next, user, returnTo, `Welcome back, ${user.name.split(' ')[0]}!`);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('idc.sid');
    res.redirect('/');
  });
});

module.exports = router;
