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

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const vaultRoutes = require('./routes/vault');
const emailsRoutes = require('./routes/emails');

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
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/vault', requireAuth, vaultRoutes);
app.use('/api/emails', requireAuth, emailsRoutes);

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
