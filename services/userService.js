// All user account database access lives here, alongside bookingService.
const bcrypt = require('bcryptjs');
const db = require('../data/db');

const BCRYPT_ROUNDS = 12;
const ROLES = ['athlete', 'coach'];

class UserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UserError';
    this.code = code; // 'EMAIL_TAKEN'
  }
}

const sql = {
  insert: db.prepare('INSERT INTO users (name, email, passwordHash) VALUES (?, ?, ?)'),
  byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertWithRole: db.prepare('INSERT INTO users (name, email, passwordHash, role) VALUES (?, ?, ?, ?)'),
  setRoleAndPassword: db.prepare('UPDATE users SET role = ?, passwordHash = ? WHERE id = ?'),
};

// Compared against when the email is unknown, so login takes the same time either way
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_ROUNDS);

// Never hand the password hash to callers
const publicUser = (row) => row && { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.createdAt };

async function registerUser({ name, email, password }) {
  if (sql.byEmail.get(email)) {
    throw new UserError('EMAIL_TAKEN', 'An account with this email already exists. Try logging in.');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const { lastInsertRowid } = sql.insert.run(name, email, passwordHash);
    return publicUser(sql.byId.get(lastInsertRowid));
  } catch (err) {
    if (/UNIQUE constraint failed/.test(err.message)) {
      throw new UserError('EMAIL_TAKEN', 'An account with this email already exists. Try logging in.');
    }
    throw err;
  }
}

// Returns the user if the email and password match, otherwise null
async function authenticate(email, password) {
  const row = sql.byEmail.get(email);
  const ok = await bcrypt.compare(password, row ? row.passwordHash : DUMMY_HASH);
  return row && ok ? publicUser(row) : null;
}

function getUserById(id) {
  return publicUser(sql.byId.get(id));
}

// Creates the staff account, or brings an existing one in line with the configured password and role.
// The password always comes from the environment, so an account someone else registered first
// with this email is taken over (and its password replaced) rather than trusted.
async function ensureStaffUser({ name, email, password, role }) {
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  const existing = sql.byEmail.get(email);
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    sql.insertWithRole.run(name, email, passwordHash, role);
    return 'created';
  }
  const passwordMatches = await bcrypt.compare(password, existing.passwordHash);
  if (passwordMatches && existing.role === role) return 'unchanged';
  const passwordHash = passwordMatches ? existing.passwordHash : await bcrypt.hash(password, BCRYPT_ROUNDS);
  sql.setRoleAndPassword.run(role, passwordHash, existing.id);
  return 'updated';
}

module.exports = { registerUser, authenticate, getUserById, ensureStaffUser, UserError, ROLES };
