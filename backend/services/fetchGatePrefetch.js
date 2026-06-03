const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const { getGateCandles } = require('../gate/getGateCandles');

const INTERVALS       = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const GATE_ADDED_FILE = path.join(__dirname, '../data/gate-added.json');

function persistGateSymbol(symbol) {
  try {
    const existing = JSON.parse(fs.readFileSync(GATE_ADDED_FILE, 'utf8'));
    if (!existing.includes(symbol)) {
      existing.push(symbol);
      fs.writeFileSync(GATE_ADDED_FILE, JSON.stringify(existing, null, 2));
    }
  } catch {
    fs.writeFileSync(GATE_ADDED_FILE, JSON.stringify([symbol], null, 2));
  }
}

router.get('/gate-prefetch', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const sym = symbol.toUpperCase();
  res.json({ status: 'iniciado', symbol: sym, intervals: INTERVALS });

  // Salva o símbolo imediatamente (antes dos candles terminarem)
  persistGateSymbol(sym);

  Promise.allSettled(
    INTERVALS.map(iv => getGateCandles(sym, iv, 1000))
  ).then(results => {
    const ok = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[gate-prefetch] ${sym}: ${ok}/${INTERVALS.length} intervalos salvos`);
  });
});

module.exports = router;
