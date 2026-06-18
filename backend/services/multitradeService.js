const router   = require('express').Router();
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const DATA_FILE = path.join(__dirname, '../data/multitrade-favorites.json');

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET /services/multitrade-favorites
router.get('/multitrade-favorites', (req, res) => {
  res.json(readData());
});

// POST /services/multitrade-favorites
router.post('/multitrade-favorites', (req, res) => {
  try {
    const data  = readData();
    const entry = { id: crypto.randomUUID(), ...req.body, createdAt: new Date().toISOString() };
    data.push(entry);
    writeData(data);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /services/multitrade-favorites/:id
router.patch('/multitrade-favorites/:id', (req, res) => {
  try {
    const data = readData();
    const idx  = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    data[idx] = { ...data[idx], ...req.body, updatedAt: new Date().toISOString() };
    writeData(data);
    res.json(data[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /services/multitrade-favorites/:id
router.delete('/multitrade-favorites/:id', (req, res) => {
  try {
    const data    = readData();
    const updated = data.filter(e => e.id !== req.params.id);
    if (updated.length === data.length) return res.status(404).json({ error: 'not found' });
    writeData(updated);
    res.json({ deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
