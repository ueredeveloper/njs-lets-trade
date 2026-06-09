const router    = require('express').Router();
const supabase  = require('../supabase/client');
const { getGateCandles } = require('../gate/getGateCandles');

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const USER_ID   = process.env.SUPABASE_DEFAULT_USER_ID;

async function persistGateSymbol(symbol) {
  if (!USER_ID) return;
  await supabase
    .from('favorites_gate')
    .upsert({ user_id: USER_ID, symbol, gate_added: true }, { onConflict: 'user_id,symbol' });
}

router.get('/gate-prefetch', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const sym = symbol.toUpperCase();
  res.json({ status: 'iniciado', symbol: sym, intervals: INTERVALS });

  // Salva o símbolo imediatamente (antes dos candles terminarem)
  persistGateSymbol(sym).catch(e => console.warn('[gate-prefetch] supabase:', e.message));

  Promise.allSettled(
    INTERVALS.map(iv => getGateCandles(sym, iv, 1000))
  ).then(results => {
    const ok = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[gate-prefetch] ${sym}: ${ok}/${INTERVALS.length} intervalos salvos`);
  });
});

module.exports = router;
