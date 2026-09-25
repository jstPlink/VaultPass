require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// Se JWT_SECRET non è impostato, ne genera uno casuale e lo conserva in data/
// così resta lo stesso tra un riavvio e l'altro (le sessioni non scadono al riavvio).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'changeme-generate-a-long-random-string') {
  const dataDir = path.join(__dirname, '..', 'data');
  const secretFile = path.join(dataDir, 'jwt_secret');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(secretFile)) {
    fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('base64'), { mode: 0o600 });
    console.log('JWT_SECRET non impostato: generato un nuovo segreto in data/jwt_secret');
  }
  process.env.JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
}

const { version: APP_VERSION } = require('../package.json');
const APP_COMMIT = (process.env.APP_COMMIT || '').slice(0, 7);

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const vaultRoutes = require('./routes/vault');
const emailsRoutes = require('./routes/emails');
const { getRemoteBase, remoteProxy } = require('./remoteProxy');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://icons.duckduckgo.com'],
        connectSrc: ["'self'"],
      },
    },
  })
);
const REMOTE_BASE = getRemoteBase();

app.use(express.static(path.join(__dirname, '..', 'public')));

// Versione dell'app (e commit da cui e' stata costruita l'immagine Docker).
app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    commit: APP_COMMIT || null,
    remote: REMOTE_BASE ? new URL(REMOTE_BASE).host : null,
  });
});

if (REMOTE_BASE) {
  // Prima dei parser del body: la richiesta va inoltrata cosi' com'e'.
  app.use('/api', remoteProxy(REMOTE_BASE));
  console.log(`ATTENZIONE: le chiamate /api vengono inoltrate a ${REMOTE_BASE} (dati reali)`);
} else {
  // Il cambio password reinvia tutto il vault ricifrato: serve un limite piu' alto.
  app.use('/api/auth/change-password', express.json({ limit: '10mb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/vault', requireAuth, vaultRoutes);
  app.use('/api/emails', requireAuth, emailsRoutes);
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`VaultPass in ascolto sulla porta ${PORT}`);
});

// Chiusura ordinata (docker stop): termina le richieste e chiude il database.
function shutdown() {
  server.close(() => {
    require('./db').db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
