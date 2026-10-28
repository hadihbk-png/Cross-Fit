// Session-based auth helpers
const userService = require('../services/userService');

// Staff are accounts with the "coach" role (seeded on startup from DESK_EMAIL / DESK_PASSWORD)
const isStaff = (user) => Boolean(user && user.role === 'coach');

// Makes the logged-in user (or null) and any one-time flash message available to every view
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.isStaff = false;
  if (req.session.userId) {
    const user = userService.getUserById(req.session.userId);
    if (user) {
      res.locals.currentUser = user;
      res.locals.isStaff = isStaff(user);
    } else {
      delete req.session.userId; // account no longer exists
    }
  }
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

function requireLogin(req, res, next) {
  if (res.locals.currentUser) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.session.flash = { type: 'info', text: 'Please log in to continue.' };
  res.redirect('/login');
}

// Allows only logged-in users with the given role; others get "Staff only" (403)
function requireRole(role) {
  return (req, res, next) => {
    if (!res.locals.currentUser) return requireLogin(req, res, next);
    if (res.locals.currentUser.role === role) return next();
    res.status(403).render('forbidden', { title: 'Staff only' });
  };
}

// Only allow redirects to paths on this site
function safeReturnTo(path) {
  return typeof path === 'string' && /^\/(?!\/)/.test(path) ? path : '/my-bookings';
}

module.exports = { loadUser, requireLogin, requireRole, safeReturnTo };
