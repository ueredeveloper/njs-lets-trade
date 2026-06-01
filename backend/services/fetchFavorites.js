const router = require('express').Router();
const fs     = require('node:fs/promises');
const path   = require('path');

const FILES = {
  gate:    path.join(__dirname, '../data/favorites-gate.json'),
  binance: path.join(__dirname, '../data/favorites-binance.json'),
};

async function readFavorites(type) {
  try {
    return JSON.parse(await fs.readFile(FILES[type], 'utf8'));
  } catch {
    return [];
  }
}

async function writeFavorites(type, list) {
  await fs.mkdir(path.dirname(FILES[type]), { recursive: true });
  await fs.writeFile(FILES[type], JSON.stringify(list, null, 2));
}

// GET /services/favorites?type=gate|binance
router.get('/favorites', async (req, res) => {
  const { type } = req.query;
  if (type !== 'gate' && type !== 'binance')
    return res.status(400).json({ error: 'type deve ser gate ou binance' });
  res.json(await readFavorites(type));
});

// POST /services/favorites  { symbol, type }
router.post('/favorites', async (req, res) => {
  const { symbol, type } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  if (type !== 'gate' && type !== 'binance')
    return res.status(400).json({ error: 'type deve ser gate ou binance' });
  const list = await readFavorites(type);
  const sym = symbol.toUpperCase();
  if (!list.includes(sym)) {
    list.push(sym);
    await writeFavorites(type, list);
  }
  res.json(list);
});

// DELETE /services/favorites/:symbol?type=gate|binance
router.delete('/favorites/:symbol', async (req, res) => {
  const { type } = req.query;
  if (type !== 'gate' && type !== 'binance')
    return res.status(400).json({ error: 'type deve ser gate ou binance' });
  const sym  = req.params.symbol.toUpperCase();
  const list = (await readFavorites(type)).filter(s => s !== sym);
  await writeFavorites(type, list);
  res.json(list);
});

module.exports = router;
