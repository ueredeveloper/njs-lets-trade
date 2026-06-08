const router = require('express').Router();
const fs     = require('node:fs/promises');
const path   = require('path');

const FILES = {
  gate:    path.join(__dirname, '../data/favorites-gate.json'),
  binance: path.join(__dirname, '../data/favorites-binance.json'),
  trade:   path.join(__dirname, '../data/favorites-trade.json'),
};

async function readFavorites(type) {
  try {
    const data = JSON.parse(await fs.readFile(FILES[type], 'utf8'));
    if (type === 'trade') {
      // Migração: converte formato antigo (strings) para objetos com config
      return data.map(item =>
        typeof item === 'string'
          ? { symbol: item, exchange: 'gate', interval: '30m', rsiBuy: 30, rsiSell: 70 }
          : { exchange: 'gate', ...item }   // garante exchange com default para entradas antigas
      );
    }
    return data;
  } catch {
    return [];
  }
}

async function writeFavorites(type, list) {
  await fs.mkdir(path.dirname(FILES[type]), { recursive: true });
  await fs.writeFile(FILES[type], JSON.stringify(list, null, 2));
}

// GET /services/favorites?type=gate|binance|trade
router.get('/favorites', async (req, res) => {
  const { type } = req.query;
  if (!FILES[type]) return res.status(400).json({ error: 'type deve ser gate, binance ou trade' });
  res.json(await readFavorites(type));
});

// POST /services/favorites  { symbol, type, [exchange, interval, rsiBuy, rsiSell] }
router.post('/favorites', async (req, res) => {
  const { symbol, type, exchange = 'gate', interval = '30m', rsiBuy = 30, rsiSell = 70 } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  if (!FILES[type]) return res.status(400).json({ error: 'type deve ser gate, binance ou trade' });

  const list = await readFavorites(type);
  const sym  = symbol.toUpperCase();

  if (type === 'trade') {
    const entry = { symbol: sym, exchange, interval, rsiBuy: Number(rsiBuy), rsiSell: Number(rsiSell) };
    const idx   = list.findIndex(item => item.symbol === sym);
    if (idx !== -1) list[idx] = entry; else list.push(entry);
  } else {
    if (!list.includes(sym)) list.push(sym);
  }

  await writeFavorites(type, list);
  res.json(list);
});

// DELETE /services/favorites/:symbol?type=gate|binance|trade
router.delete('/favorites/:symbol', async (req, res) => {
  const { type } = req.query;
  if (!FILES[type]) return res.status(400).json({ error: 'type deve ser gate, binance ou trade' });

  const sym      = req.params.symbol.toUpperCase();
  const list     = await readFavorites(type);
  const filtered = type === 'trade'
    ? list.filter(item => item.symbol !== sym)
    : list.filter(s => s !== sym);

  await writeFavorites(type, filtered);
  res.json(filtered);
});

module.exports = router;
