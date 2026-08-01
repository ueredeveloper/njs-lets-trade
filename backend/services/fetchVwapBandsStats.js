const router = require('express').Router();
const analyseVwapBandsStats = require('../utils/analyseVwapBandsStats');
const vwapFavoritesStatsCache = require('../cache/vwapFavoritesStatsCache');
const { intervalMs } = require('../bot/vwap-bands/strategyEngine');
const supabase = require('../supabase/client');

// GET /services/vwap-bands-stats?symbol=BTCUSDT&source=gate
router.get('/vwap-bands-stats', async (req, res) => {
  const { symbol, source } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Parâmetro obrigatório: symbol' });
  }
  const sym = symbol.toUpperCase();

  // Se a moeda for favorita vwap-bands, simula com a trade_config REAL configurada pra ela
  // (pode ter overrides do preset padrão) em vez do preset genérico.
  let tradeConfig = null;
  try {
    const { data } = await supabase
      .from('rsi_multi_bot_state')
      .select('trade_config')
      .eq('symbol', sym)
      .eq('strategy_id', 'vwap-bands')
      .limit(1);
    tradeConfig = data?.[0]?.trade_config ?? null;
  } catch { /* segue com preset padrão */ }

  const options = { source: source ?? null, tradeConfig };
  const cacheKey = `vwap-bands|${sym}|${source ?? 'binance'}`;
  const ttlMs = intervalMs('15m'); // intervalo mais rápido usado pela simulação (poll/emaFilter)

  try {
    const { value, cache } = await vwapFavoritesStatsCache.getOrCompute(
      sym, cacheKey, ttlMs,
      () => analyseVwapBandsStats(sym, options),
    );
    res.json({ ...value, cache });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
