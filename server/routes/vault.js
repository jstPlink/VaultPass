const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/items', (req, res) => {
  const rows = db
    .prepare('SELECT id, iv, ciphertext, created_at AS createdAt, updated_at AS updatedAt FROM vault_items WHERE user_id = ? ORDER BY id DESC')
    .all(req.userId);
  res.json(rows);
});

router.post('/items', (req, res) => {
  const { iv, ciphertext } = req.body || {};
  if (typeof iv !== 'string' || typeof ciphertext !== 'string' || !iv || !ciphertext) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  const now = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO vault_items (user_id, iv, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, iv, ciphertext, now, now);
  res.status(201).json({ id: info.lastInsertRowid, iv, ciphertext, createdAt: now, updatedAt: now });
});

router.put('/items/:id', (req, res) => {
  const { iv, ciphertext } = req.body || {};
  if (typeof iv !== 'string' || typeof ciphertext !== 'string' || !iv || !ciphertext) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  const now = new Date().toISOString();
  const info = db
    .prepare('UPDATE vault_items SET iv = ?, ciphertext = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(iv, ciphertext, now, req.params.id, req.userId);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Elemento non trovato' });
  }
  res.json({ ok: true, updatedAt: now });
});

router.delete('/items/:id', (req, res) => {
  const info = db.prepare('DELETE FROM vault_items WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Elemento non trovato' });
  }
  res.json({ ok: true });
});

module.exports = router;
