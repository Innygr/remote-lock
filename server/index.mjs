import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const owner = process.env.REMOTE_LOCK_OWNER || 'Innygr';
const password = process.env.REMOTE_LOCK_PASSWORD || '';
const allowedOrigin = (process.env.REMOTE_LOCK_ALLOWED_ORIGIN || '').replace(/\/$/, '');
const host = process.env.REMOTE_LOCK_HOST || '127.0.0.1';
const port = Number(process.env.REMOTE_LOCK_PORT || 8787);
const stateFile = path.resolve(process.env.REMOTE_LOCK_STATE_FILE || path.join(here, 'data/state.json'));
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;

if (password.length < 24 || password.includes('replace-with-')) {
  console.error('Refusing to start: set REMOTE_LOCK_PASSWORD to a unique random secret of at least 24 characters.');
  process.exit(1);
}
if (!allowedOrigin || !/^https:\/\//.test(allowedOrigin)) {
  console.error('Refusing to start: set REMOTE_LOCK_ALLOWED_ORIGIN to the exact HTTPS dashboard origin.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid REMOTE_LOCK_PORT');

const freshState = () => ({
  schemaVersion: 1,
  devices: {
    PC: { desiredState: 'UNLOCKED', reportedState: 'UNKNOWN', connected: false, lastSeen: null },
    Server: { desiredState: 'UNLOCKED', reportedState: 'UNKNOWN', connected: false, lastSeen: null }
  },
  audit: [],
  updatedAt: new Date().toISOString()
});

await fs.mkdir(path.dirname(stateFile), { recursive: true });
let state;
try {
  state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  if (!state.devices?.PC || !state.devices?.Server) throw new Error('State file schema is invalid');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = freshState();
  await persist();
}
if (!Array.isArray(state.audit)) state.audit = [];
function persist() {
  const temp = stateFile + '.' + process.pid + '.tmp';
  return fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    .then(() => fs.rename(temp, stateFile));
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function send(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Vary': 'Origin',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || origin !== allowedOrigin) return null;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function sessionFor(req) {
  const value = req.headers.authorization || '';
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice(7);
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}
function publicState() {
  return {
    schemaVersion: state.schemaVersion,
    devices: Object.fromEntries(Object.entries(state.devices).map(([id, d]) => [id, { ...d }])),
    updatedAt: state.updatedAt,
    audit: state.audit.slice(-100),
    enforcement: 'DISABLED'
  };
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    if (!cors) return send(res, 403, { error: 'Origin not allowed' });
    res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '600' });
    return res.end();
  }
  if (req.headers.origin && !cors) return send(res, 403, { error: 'Origin not allowed' }, { 'Cache-Control': 'no-store' });
  const headers = cors || {};
  const url = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'remote-lock-api', enforcement: 'DISABLED' }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      const record = loginAttempts.get(ip) || { count: 0, until: 0 };
      if (record.until > Date.now() && record.count >= 5) {
        return send(res, 429, { error: 'Too many attempts; wait one minute.' }, headers);
      }
      const body = await readBody(req);
      const valid = safeEqual(body.username || '', owner) && safeEqual(body.password || '', password);
      if (!valid) {
        record.count = record.until > Date.now() ? record.count + 1 : 1;
        record.until = Date.now() + 60_000;
        loginAttempts.set(ip, record);
        return send(res, 401, { error: 'Invalid credentials' }, headers);
      }
      loginAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { username: owner, expiresAt: Date.now() + SESSION_TTL_MS });
      return send(res, 200, { token, username: owner, expiresInSeconds: SESSION_TTL_MS / 1000 }, headers);
    }

    const session = sessionFor(req);
    if (!session) return send(res, 401, { error: 'Authentication required' }, headers);
    if (req.method === 'GET' && url.pathname === '/api/session') {
      return send(res, 200, { username: session.username, expiresAt: new Date(session.expiresAt).toISOString() }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = (req.headers.authorization || '').slice(7);
      sessions.delete(token);
      return send(res, 200, { ok: true }, headers);
    }
    if (req.method === 'GET' && url.pathname === '/api/devices') {
      return send(res, 200, publicState(), headers);
    }
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      return send(res, 200, { entries: state.audit.slice(-100) }, headers);
    }
    const match = url.pathname.match(/^\/api\/devices\/(PC|Server)\/state$/);
    if (req.method === 'POST' && match) {
      const body = await readBody(req);
      if (!['LOCKED', 'UNLOCKED'].includes(body.desiredState)) {
        return send(res, 400, { error: 'desiredState must be LOCKED or UNLOCKED' }, headers);
      }
      const changedAt = new Date().toISOString();
      state.devices[match[1]].desiredState = body.desiredState;
      state.devices[match[1]].requestedAt = changedAt;
      state.devices[match[1]].requestedBy = session.username;
      state.audit.push({ at: changedAt, actor: session.username, action: 'DESIRED_STATE_CHANGED', device: match[1], desiredState: body.desiredState });
      if (state.audit.length > 500) state.audit.splice(0, state.audit.length - 500);
      state.updatedAt = changedAt;
      await persist();
      return send(res, 202, {
        accepted: true,
        enforcement: 'DISABLED',
        device: match[1],
        desiredState: body.desiredState,
        message: 'Desired state saved only. No Windows agent is connected; this does not lock or unlock the device.'
      }, headers);
    }
    return send(res, 404, { error: 'Not found' }, headers);
  } catch (error) {
    console.error('Request failed:', error.message);
    return send(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' }, headers);
  }
});

server.listen(port, host, () => {
  console.log('Remote Lock API listening on http://' + host + ':' + port + '; enforcement is DISABLED.');
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
