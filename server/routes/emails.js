const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT id, iv, ciphertext FROM login_emails WHERE user_id = ? ORDER BY id ASC')
    .all(req.userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { iv, ciphertext } = req.body || {};
  if (typeof iv !== 'string' || typeof ciphertext !== 'string' || !iv || !ciphertext) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  const now = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO login_emails (user_id, iv, ciphertext, created_at) VALUES (?, ?, ?, ?)')
    .run(req.userId, iv, ciphertext, now);
  res.status(201).json({ id: info.lastInsertRowid, iv, ciphertext });
});

router.put('/:id', (req, res) => {
  const { iv, ciphertext } = req.body || {};
  if (typeof iv !== 'string' || typeof ciphertext !== 'string' || !iv || !ciphertext) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  const info = db
    .prepare('UPDATE login_emails SET iv = ?, ciphertext = ? WHERE id = ? AND user_id = ?')
    .run(iv, ciphertext, req.params.id, req.userId);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Elemento non trovato' });
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM login_emails WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Elemento non trovato' });
  }
  res.json({ ok: true });
});

module.exports = router;
