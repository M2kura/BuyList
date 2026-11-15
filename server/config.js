import path from 'node:path';

const bool = (value, fallback) => (value === undefined ? fallback : value === 'true' || value === '1');

// Normalised to "/buylist" (no trailing slash), or "" when served from the domain root.
const basePath = (process.env.BASE_PATH ?? '/buylist').replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT ?? 3005),
  host: process.env.HOST ?? '127.0.0.1',
  basePath,
  dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
  distDir: path.resolve(process.env.DIST_DIR ?? 'dist'),
  // Must be false over plain HTTP (e.g. http://localhost in development), or the browser drops the cookie.
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  sessionDays: Number(process.env.SESSION_DAYS ?? 60),
};
