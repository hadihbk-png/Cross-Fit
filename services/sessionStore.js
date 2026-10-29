// express-session store backed by the app's SQLite database (no extra packages)
const session = require('express-session');
const db = require('../data/db');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const sql = {
  get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?'),
  upsert: db.prepare(`
    INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
  `),
  touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
  destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  prune: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
};

const expiryOf = (sess) => {
  const expires = sess?.cookie?.expires;
  return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
};

class SqliteSessionStore extends session.Store {
  constructor({ pruneEveryMs = 15 * 60 * 1000 } = {}) {
    super();
    this.prune();
    setInterval(() => this.prune(), pruneEveryMs).unref();
  }

  get(sid, cb) {
    try {
      const row = sql.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      sql.upsert.run(sid, JSON.stringify(sess), expiryOf(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      sql.touch.run(expiryOf(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      sql.destroy.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  prune() {
    try {
      sql.prune.run(Date.now());
    } catch (err) {
      console.error('Could not prune expired sessions:', err.message);
    }
  }
}

module.exports = { SqliteSessionStore };
