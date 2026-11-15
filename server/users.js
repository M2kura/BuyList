// Account management for the CLI and the password-change endpoint.
import { db } from './db.js';
import { hashPassword, newId, verifyPassword } from './auth.js';
import { HttpError } from './data.js';

export const MIN_PASSWORD_LENGTH = 8;
const USERNAME_RE = /^[\w.\-@]{2,64}$/;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > 200) throw new HttpError(400, 'Password is too long');
}

export const findUserByName = (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username);

export function createUser(username, password) {
  username = String(username ?? '').trim();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username: 2–64 characters, letters, digits and _ . - @');
  validatePassword(password);
  if (findUserByName(username)) throw new HttpError(409, `User "${username}" already exists`);
  const id = newId();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, username, hashPassword(password), Date.now());
  return { id, username };
}

export const listUsers = () => db.prepare('SELECT id, username, created_at FROM users ORDER BY created_at').all();

export function setPassword(userId, password) {
  validatePassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

export function changeOwnPassword(userId, currentPassword, newPassword) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!row || typeof currentPassword !== 'string' || !verifyPassword(currentPassword, row.password_hash)) {
    throw new HttpError(400, 'Current password is wrong');
  }
  setPassword(userId, newPassword);
}
