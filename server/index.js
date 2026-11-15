import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { db } from './db.js';
import {
  SESSION_COOKIE, authenticate, clearFailures, createSession, deleteExpiredSessions, destroyOtherSessions,
  destroySession, isThrottled, recordFailure, sessionCookieOptions, userFromSession,
} from './auth.js';
import {
  HttpError, createItem, createList, deleteItem, deleteList, loadState, updateItem, updateList,
} from './data.js';
import { changeOwnPassword } from './users.js';

const BASE = config.basePath;

const app = Fastify({
  // Only reached through Caddy on localhost, so forwarded headers can be trusted.
  trustProxy: true,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

await app.register(fastifyCookie);

app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: status >= 500 ? 'Server error' : err.message });
});

const clientIp = (req) => req.headers['cf-connecting-ip'] ?? req.ip;

await app.register(async (api) => {
  api.addHook('onRequest', async (req) => {
    if (req.routeOptions.config?.public) return;
    req.user = userFromSession(req.cookies[SESSION_COOKIE]);
    if (!req.user) throw new HttpError(401, 'Not logged in');
  });
  api.addHook('onSend', async (req, reply) => { reply.header('Cache-Control', 'no-store'); });

  api.get('/health', { config: { public: true } }, async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  api.post('/auth/login', { config: { public: true } }, async (req, reply) => {
    const ip = clientIp(req);
    if (isThrottled(ip)) throw new HttpError(429, 'Too many attempts, try again later');
    const { username, password } = req.body ?? {};
    const user = username && password ? authenticate(username, password) : null;
    if (!user) {
      recordFailure(ip);
      throw new HttpError(401, 'Wrong username or password');
    }
    clearFailures(ip);
    reply.setCookie(SESSION_COOKIE, createSession(user.id), sessionCookieOptions());
    return { user: { id: user.id, username: user.username } };
  });

  api.post('/auth/logout', { config: { public: true } }, async (req, reply) => {
    destroySession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: sessionCookieOptions().path });
    return { ok: true };
  });

  api.post('/account/password', async (req) => {
    const { currentPassword, newPassword } = req.body ?? {};
    changeOwnPassword(req.user.id, currentPassword, newPassword);
    destroyOtherSessions(req.user.id, req.cookies[SESSION_COOKIE]);
    return { ok: true };
  });

  api.get('/state', async (req) => ({ user: req.user, ...loadState(req.user.id) }));

  api.post('/lists', async (req, reply) => { reply.code(201); return createList(req.user.id, req.body); });
  api.patch('/lists/:id', async (req) => updateList(req.user.id, req.params.id, req.body));
  api.delete('/lists/:id', async (req, reply) => { deleteList(req.user.id, req.params.id); return reply.code(204).send(); });

  api.post('/items', async (req, reply) => { reply.code(201); return createItem(req.user.id, req.body); });
  api.patch('/items/:id', async (req) => updateItem(req.user.id, req.params.id, req.body));
  api.delete('/items/:id', async (req, reply) => { deleteItem(req.user.id, req.params.id); return reply.code(204).send(); });
}, { prefix: `${BASE}/api` });

// ---------- frontend ----------

if (fs.existsSync(path.join(config.distDir, 'index.html'))) {
  await app.register(fastifyStatic, {
    root: config.distDir,
    prefix: `${BASE}/`,
    wildcard: false,
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Security-Policy',
          "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      }
    },
  });
  if (BASE) app.get(BASE, (req, reply) => reply.redirect(`${BASE}/`, 301));
} else {
  app.log.warn(`No frontend build in ${config.distDir}; run "npm run build" (API only).`);
}

deleteExpiredSessions();
setInterval(deleteExpiredSessions, 6 * 60 * 60 * 1000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
