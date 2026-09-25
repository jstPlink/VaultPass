const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';

const MAX_USERNAME_LENGTH = 64;
const MAX_FIELD_LENGTH = 512;

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { login: 8, register: 8, salt: 60, password: 8 };

// Per i test: DISABLE_RATE_LIMIT=true toglie del tutto i limiti (solo per uso locale).
const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === 'true';
if (RATE_LIMIT_DISABLED) console.log('ATTENZIONE: limiti sui tentativi di accesso disattivati (DISABLE_RATE_LIMIT)');

// Sospensione temporanea, richiesta da un utente gia' autenticato, del limite di
// login/salt per il SOLO proprio nome utente. Massimo 30 minuti, solo in memoria
// (un riavvio del server la annulla), cosi' non indebolisce gli altri utenti.
const MAX_SUSPEND_MINUTES = 30;
const suspended = new Map();

function suspendedUntil(username) {
  const until = suspended.get(username);
  if (!until) return null;
  if (until <= Date.now()) {
    suspended.delete(username);
    return null;
  }
  return until;
}

function isRateLimited(bucket, key, username) {
  if (RATE_LIMIT_DISABLED) return false;
  if (username && suspendedUntil(username)) return false;
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
  const username = String(req.query.username || '').trim();
  if (isRateLimited('salt', req.ip, username)) {
    return res.status(429).json({ error: 'Troppi tentativi, riprova piu\' tardi' });
  }
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    return res.status(400).json({ error: 'Nome utente mancante' });
  }
  const user = db.prepare('SELECT salt FROM users WHERE username = ?').get(username);
  res.json({ salt: user ? user.salt : fakeSalt(username) });
});

router.post('/login', (req, res) => {
  const { username, authHash } = req.body || {};
  const cleanUsername = typeof username === 'string' ? username.trim() : '';
  if (isRateLimited('login', `${req.ip}:${cleanUsername}`, cleanUsername)) {
    return res.status(429).json({ error: 'Troppi tentativi, riprova piu\' tardi' });
  }
  const user = cleanUsername ? db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername) : null;
  if (!user || typeof authHash !== 'string' || !safeEqual(authHash, user.auth_hash)) {
    return res.status(401).json({ error: 'Nome utente o password non corretti' });
  }
  setSessionCookie(res, user);
  res.json({ ok: true });
});

// Stato e impostazione della sospensione del limite di accesso (solo per l'utente loggato).
router.get('/rate-limit', requireAuth, (req, res) => {
  const until = suspendedUntil(req.username);
  res.json({ until: until ? new Date(until).toISOString() : null, maxMinutes: MAX_SUSPEND_MINUTES });
});

router.post('/rate-limit', requireAuth, (req, res) => {
  const minutes = Number((req.body || {}).minutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_SUSPEND_MINUTES) {
    return res.status(400).json({ error: `Durata non valida (0-${MAX_SUSPEND_MINUTES} minuti)` });
  }
  if (minutes === 0) {
    suspended.delete(req.username);
    return res.json({ until: null, maxMinutes: MAX_SUSPEND_MINUTES });
  }
  // Riparte da zero: azzera anche i tentativi gia' contati per questo utente.
  for (const id of attempts.keys()) {
    if (id.startsWith('login:') && id.endsWith(`:${req.username}`)) attempts.delete(id);
  }
  const until = Date.now() + Math.round(minutes * 60 * 1000);
  suspended.set(req.username, until);
  res.json({ until: new Date(until).toISOString(), maxMinutes: MAX_SUSPEND_MINUTES });
});

router.post('/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

function isCipherList(list) {
  return (
    Array.isArray(list) &&
    list.every((r) => r && Number.isInteger(r.id) && typeof r.iv === 'string' && r.iv && typeof r.ciphertext === 'string' && r.ciphertext)
  );
}

// Cambio della password principale. La chiave di cifratura deriva dalla password,
// quindi il client ricifra tutti i dati con la nuova chiave e li invia insieme al
// nuovo sale/authHash: tutto viene aggiornato in un'unica transazione, altrimenti
// una modifica a meta' renderebbe i dati illeggibili.
router.post('/change-password', requireAuth, (req, res) => {
  if (isRateLimited('password', `${req.ip}:${req.userId}`)) {
    return res.status(429).json({ error: 'Troppi tentativi, riprova piu\' tardi' });
  }
  const { currentAuthHash, salt, authHash, items, emails } = req.body || {};
  if (!isShortString(currentAuthHash) || !isShortString(salt) || !isShortString(authHash) || !isCipherList(items) || !isCipherList(emails)) {
    return res.status(400).json({ error: 'Dati mancanti o non validi' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user || !safeEqual(currentAuthHash, user.auth_hash)) {
    return res.status(401).json({ error: 'Password attuale non corretta' });
  }

  const tables = [
    ['vault_items', items],
    ['login_emails', emails],
  ];
  const apply = db.transaction(() => {
    for (const [table, rows] of tables) {
      const existing = db.prepare(`SELECT id FROM ${table} WHERE user_id = ?`).all(req.userId).map((r) => r.id);
      const sent = new Set(rows.map((r) => r.id));
      if (sent.size !== rows.length || rows.length !== existing.length || !existing.every((id) => sent.has(id))) {
        const err = new Error('conflict');
        err.conflict = true;
        throw err;
      }
    }
    const now = new Date().toISOString();
    const updItem = db.prepare('UPDATE vault_items SET iv = ?, ciphertext = ?, updated_at = ? WHERE id = ? AND user_id = ?');
    const updEmail = db.prepare('UPDATE login_emails SET iv = ?, ciphertext = ? WHERE id = ? AND user_id = ?');
    for (const r of items) updItem.run(r.iv, r.ciphertext, now, r.id, req.userId);
    for (const r of emails) updEmail.run(r.iv, r.ciphertext, r.id, req.userId);
    db.prepare('UPDATE users SET salt = ?, auth_hash = ? WHERE id = ?').run(salt, authHash, req.userId);
  });

  try {
    apply();
  } catch (err) {
    if (err.conflict) {
      return res.status(409).json({ error: 'I dati sono cambiati da un altro dispositivo: riprova.' });
    }
    throw err;
  }
  res.json({ ok: true });
});

module.exports = router;
