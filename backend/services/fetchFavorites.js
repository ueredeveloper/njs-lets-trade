const router = require('express').Router();
const fs     = require('node:fs/promises');
const path   = require('path');

const FILE = path.join(__dirname, '../data/favorites.json');

async function readFavorites() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeFavorites(list) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(list, null, 2));
}

// GET /services/favorites
router.get('/favorites', async (req, res) => {
  res.json(await readFavorites());
});

// POST /services/favorites  { symbol }
router.post('/favorites', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  const list = await readFavorites();
  const sym = symbol.toUpperCase();
  if (!list.includes(sym)) {
    list.push(sym);
    await writeFavorites(list);
  }
  res.json(list);
});

// DELETE /services/favorites/:symbol
router.delete('/favorites/:symbol', async (req, res) => {
  const sym  = req.params.symbol.toUpperCase();
  const list = (await readFavorites()).filter(s => s !== sym);
  await writeFavorites(list);
  res.json(list);
});

module.exports = router;
