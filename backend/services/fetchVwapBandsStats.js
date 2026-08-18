const router = require('express').Router();
const analyseVwapBandsStats = require('../utils/analyseVwapBandsStats');
const vwapFavoritesStatsCache = require('../cache/vwapFavoritesStatsCache');
const { intervalMs } = require('../bot/vwap-bands/strategyEngine');
const supabase = require('../supabase/client');

// GET /services/vwap-bands-stats?symbol=BTCUSDT&source=gate&entryInterval=1h&session=weekly&vwapInterval=4h&pollInterval=15m&emaFilterEnabled=1&emaFilterPeriod=200&emaFilterInterval=15m
router.get('/vwap-bands-stats', async (req, res) => {
  const {
    symbol, source, entryInterval, session, vwapInterval, pollInterval,
    emaFilterEnabled, emaFilterPeriod, emaFilterInterval, candleCount,
  } = req.query;
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

  // Overrides vindos dos seletores do painel de estatísticas (candle principal, semanal/diária,
  // intervalo da VWAP, intervalo do pullback/checagem rápida, uso/período/intervalo da EMA) —
  // aplicados por cima da trade_config real (ou do preset default), sem mexer no restante da
  // configuração. entryInterval é o candle que a escada VWAP usa pra reconquista/pullback/saída
  // (entry.interval) — não confundir com o intervalo do gráfico, que é só exibição.
  const hasEmaOverride = emaFilterEnabled !== undefined || emaFilterPeriod !== undefined || emaFilterInterval;
  if (entryInterval || session || vwapInterval || pollInterval || hasEmaOverride) {
    tradeConfig = { ...(tradeConfig ?? {}) };
    tradeConfig.entry = { ...(tradeConfig.entry ?? {}) };
    if (entryInterval) tradeConfig.entry.interval = entryInterval;
    if (session) tradeConfig.entry.session = session;
    if (vwapInterval) tradeConfig.entry.vwapInterval = vwapInterval;
    if (pollInterval) {
      tradeConfig.entry.pullback = { ...(tradeConfig.entry.pullback ?? {}), pollInterval };
    }
    if (hasEmaOverride) {
      tradeConfig.entry.emaFilter = { ...(tradeConfig.entry.emaFilter ?? {}) };
      if (emaFilterEnabled !== undefined) tradeConfig.entry.emaFilter.enabled = emaFilterEnabled === '1' || emaFilterEnabled === 'true';
      if (emaFilterPeriod !== undefined) tradeConfig.entry.emaFilter.period = Number(emaFilterPeriod);
      if (emaFilterInterval) tradeConfig.entry.emaFilter.interval = emaFilterInterval;
    }
  }

  const options = {
    source: source ?? null,
    tradeConfig,
    candleCount: candleCount ? parseInt(candleCount, 10) : undefined,
  };
  const cacheKey = `vwap-bands|${sym}|${source ?? 'binance'}|${entryInterval ?? ''}|${session ?? ''}|${vwapInterval ?? ''}|${pollInterval ?? ''}|${emaFilterEnabled ?? ''}|${emaFilterPeriod ?? ''}|${emaFilterInterval ?? ''}|${options.candleCount ?? 'default'}`;
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
