const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  if (!token) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = payload.sub;
    req.username = payload.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessione non valida o scaduta' });
  }
}

module.exports = requireAuth;
