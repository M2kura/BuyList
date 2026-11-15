import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'buylist_session';

const DAY = 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const newId = () => crypto.randomUUID();

// ---------- passwords ----------

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  const [algo, N, r, p, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Verified against when the username doesn't exist, so a miss costs the same time as a hit.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export function authenticate(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  const ok = verifyPassword(String(password), user?.password_hash ?? DUMMY_HASH);
  return ok && user ? user : null;
}

// ---------- sessions ----------

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, now + config.sessionDays * DAY, now);
  return token;
}

/** Returns the session's user, sliding the expiry forward once it is past its halfway point. */
export function userFromSession(token) {
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = db.prepare(`
    SELECT s.expires_at, u.id, u.username
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  if (!row) return null;

  const now = Date.now();
  if (row.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  if (row.expires_at - now < (config.sessionDays * DAY) / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(now + config.sessionDays * DAY, tokenHash);
  }
  return { id: row.id, username: row.username };
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

/** Logs a user out everywhere except the session making the request (e.g. after a password change). */
export function destroyOtherSessions(userId, currentToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(currentToken ?? ''));
}

export function deleteExpiredSessions() {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
}

export const sessionCookieOptions = () => ({
  path: `${config.basePath}/`,
  httpOnly: true,
  sameSite: 'lax',
  secure: config.cookieSecure,
  maxAge: config.sessionDays * DAY / 1000,
});

// ---------- login throttling ----------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map(); // ip -> { count, since }

export function isThrottled(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.since > WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() });
  else entry.count += 1;
}

export const clearFailures = (ip) => failures.delete(ip);
