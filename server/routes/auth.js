const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';

const MAX_USERNAME_LENGTH = 64;
const MAX_FIELD_LENGTH = 512;

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { login: 8, register: 8, salt: 60 };

function isRateLimited(bucket, key) {
  const now = Date.now();
  const id = `${bucket}:${key}`;
  const entry = attempts.get(id);
  if (!entry || now - entry.start > WINDOW_MS) {
    attempts.set(id, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMITS[bucket];
}

// Evita che la mappa dei tentativi cresca all'infinito.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of attempts) {
    if (now - entry.start > WINDOW_MS) attempts.delete(id);
  }
}, WINDOW_MS).unref();

function isShortString(value, max = MAX_FIELD_LENGTH) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Sale deterministico per gli utenti che non esistono: cosi' /salt risponde
// nello stesso modo e non si puo' scoprire quali nomi utente sono registrati.
function fakeSalt(username) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`salt:${username}`).digest().subarray(0, 16).toString('base64');
}

function setSessionCookie(res, user) {
  const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${SESSION_HOURS}h`,
  });
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  });
}

router.post('/register', (req, res) => {
  if (!ALLOW_REGISTRATION) {
    return res.status(403).json({ error: 'Le nuove registrazioni sono disabilitate' });
  }
  if (isRateLimited('register', req.ip)) {
    return res.status(429).json({ error: 'Troppi tentativi, riprova piu\' tardi' });
  }
  const { username, salt, authHash } = req.body || {};
  if (!isShortString(username, MAX_USERNAME_LENGTH) || !isShortString(salt) || !isShortString(authHash)) {
    return res.status(400).json({ error: 'Dati mancanti o non validi' });
  }
  const cleanUsername = username.trim();
  if (cleanUsername.length < 3) {
    return res.status(400).json({ error: 'Il nome utente deve avere almeno 3 caratteri' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'Questo nome utente e\' gia\' in uso' });
  }
  const now = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO users (username, salt, auth_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(cleanUsername, salt, authHash, now);
  const user = { id: info.lastInsertRowid, username: cleanUsername };
  setSessionCookie(res, user);
  res.status(201).json({ ok: true });
});

router.get('/salt', (req, res) => {
  if (isRateLimited('salt', req.ip)) {
    return res.status(429).json({ error: 'Troppi tentativi, riprova piu\' tardi' });
  }
  const username = String(req.query.username || '').trim();
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    return res.status(400).json({ error: 'Nome utente mancante' });
  }
  const user = db.prepare('SELECT salt FROM users WHERE username = ?').get(username);
  res.json({ salt: user ? user.salt : fakeSalt(username) });
});

router.post('/login', (req, res) => {
  const { username, authHash } = req.body || {};
  const cleanUsername = typeof username === 'string' ? username.trim() : '';
  if (isRateLimited('login', `${req.ip}:${cleanUsername}`)) {
    return res.status(429).json({ error: 'Troppi tentativi, riprova piu\' tardi' });
  }
  const user = cleanUsername ? db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername) : null;
  if (!user || typeof authHash !== 'string' || !safeEqual(authHash, user.auth_hash)) {
    return res.status(401).json({ error: 'Nome utente o password non corretti' });
  }
  setSessionCookie(res, user);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

module.exports = router;
