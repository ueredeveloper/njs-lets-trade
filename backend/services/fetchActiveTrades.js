const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');

const BOT_DATA_DIR = path.join(__dirname, '../data/bot');

// GET /services/active-trades
// Retorna símbolos onde o bot está com posição aberta (phase BOUGHT ou ABOVE_70).
router.get('/active-trades', (req, res) => {
  try {
    if (!fs.existsSync(BOT_DATA_DIR)) return res.json([]);

    const files = fs.readdirSync(BOT_DATA_DIR)
      .filter(f => f.startsWith('state-') && f.endsWith('.json'));

    const MIN_HOLDING_USDT = 3;
    const result = [];
    for (const file of files) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(BOT_DATA_DIR, file), 'utf8'));
        if (state.phase !== 'BOUGHT' && state.phase !== 'ABOVE_70') continue;
        if ((state.buyUsdt ?? 0) < MIN_HOLDING_USDT) continue;
        const symbol = file.replace('state-', '').replace('.json', '');
        result.push({
          symbol,
          phase:    state.phase,
          buyPrice: state.buyPrice ?? null,
          buyQty:   state.buyQty   ?? null,
          buyUsdt:  state.buyUsdt  ?? null,
          buyTime:  state.buyTime  ?? null,
        });
      } catch {}
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
