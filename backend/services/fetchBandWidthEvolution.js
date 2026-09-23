'use strict';

const router = require('express').Router();
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getGateCandles } = require('../gate/getGateCandles');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { closedCandlesOnly } = require('../bot/ma-cross/strategyEngine');
const { getCandlesAroundTime } = require('../utils/getCandlesAroundTime');
const { bollingerBandWidthSeriesWithTime, computeBandWidthExpansion } = require('../utils/indicatorGrowthEngines');
const { ALL_INTERVALS, BB_PERIODS, BB_STD_DEVS } = require('../bot/bollinger-bands/tradeConfigSchema');

const CONCURRENCY = 25;
const ALLOWED_INTERVALS = new Set(ALL_INTERVALS);
const ALLOWED_PERIODS = new Set(BB_PERIODS);
const ALLOWED_STD_DEVS = new Set(BB_STD_DEVS);
const ALLOWED_LOOKBACKS = new Set([20, 30, 40, 50, 100, 150, 200, 300, 500, 700]);

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    });
  }
  return results;
}

function summarizeRow(symbol, series, expansion, deltaCandles) {
  const lastIdx = series.length - 1;
  const refIdx = Math.max(0, lastIdx - deltaCandles);
  const currentWidthPct = series[lastIdx].widthPct;
  const widthNCandlesAgo = series[refIdx].widthPct;
  return {
    symbol,
    currentWidthPct: parseFloat(currentWidthPct.toFixed(2)),
    widthNCandlesAgo: parseFloat(widthNCandlesAgo.toFixed(2)),
    deltaPct: parseFloat((currentWidthPct - widthNCandlesAgo).toFixed(2)),
    samples: series.length,
    expansion,
  };
}

/**
 * Evolução da Largura das Bandas de Bollinger (%) candle a candle — "quando a banda estava em 1%,
 * subiu pra 3% etc.", medida como GANHO relativo (razão atual÷fundo da janela) em vez de um
 * cruzamento de patamar fixo (ver computeBandWidthExpansion). Estatística isolada pra estudar o
 * gatilho de "afrouxar a proximidade ao suporte quando a banda abre rápido demais" (ver conversa
 * sobre entry.supportResistance no RSI Momentum) — de propósito FORA do backtest do RSI Momentum
 * pra não misturar com aquela config validada.
 *
 * GET /services/band-width-evolution?symbol=BTCUSDT&interval=5m&period=20&stdDev=2&lookback=200
 *     &deltaCandles=3[&source=gate]
 *
 * Com `fromMs`&`toMs` (ms): ANCORA a busca nesse período específico em vez dos candles mais
 * recentes até agora — usado pelo botão "Evolução BB" do quadrado de trade no gráfico (ver
 * getCandlesAroundTime.js, mesmo mecanismo do `?fromMs=&toMs=&pad=` de /services/candles). Nesse
 * modo `lookback` vira o padding (candles de folga) pra cada lado do período, não uma janela
 * "até agora".
 *
 * Sem `symbol`: varre o mercado USDT da Binance e devolve 1 linha por moeda (sem a série
 * candle-a-candle, só o resumo), ordenado pela expansão mais rápida primeiro (deltaPct desc).
 */
router.get('/band-width-evolution', async (req, res) => {
  try {
    const interval = req.query.interval || '5m';
    const period = parseInt(req.query.period ?? '20', 10);
    const stdDev = parseFloat(req.query.stdDev ?? '2');
    const lookback = parseInt(req.query.lookback ?? '200', 10);
    const deltaCandles = Math.max(1, parseInt(req.query.deltaCandles ?? '3', 10));
    const symbol = req.query.symbol ? String(req.query.symbol).trim().toUpperCase() : null;
    const source = req.query.source === 'gate' ? 'gate' : null;
    const fromMs = req.query.fromMs ? parseInt(req.query.fromMs, 10) : null;
    const toMs = req.query.toMs ? parseInt(req.query.toMs, 10) : null;
    const anchored = symbol && Number.isFinite(fromMs) && Number.isFinite(toMs);

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({ error: `intervalo não suportado: ${interval}` });
    }
    if (!ALLOWED_PERIODS.has(period)) {
      return res.status(400).json({ error: 'período suportado: 10, 20 ou 30' });
    }
    if (!ALLOWED_STD_DEVS.has(stdDev)) {
      return res.status(400).json({ error: 'desvio padrão suportado: 1, 2 ou 3' });
    }
    if (!ALLOWED_LOOKBACKS.has(lookback)) {
      return res.status(400).json({ error: 'lookback inválido' });
    }

    const minCandles = period + 5;
    const limit = lookback + minCandles;

    if (symbol) {
      const raw = anchored
        ? await getCandlesAroundTime(symbol, interval, source, fromMs, toMs, lookback)
        : (source === 'gate'
          ? await getGateCandles(symbol, interval, limit)
          : (await getCandlesForScreening(symbol, interval, limit)).candles);
      const candles = closedCandlesOnly(raw);
      if (!candles?.length || candles.length < minCandles) {
        return res.status(404).json({ error: 'candles insuficientes pra essa janela' });
      }

      const series = bollingerBandWidthSeriesWithTime(candles, { period, stdDev });
      if (!series) return res.status(404).json({ error: 'sem dados de banda suficientes' });
      const expansion = computeBandWidthExpansion(candles, { period, stdDev });
      const row = summarizeRow(symbol, series, expansion, deltaCandles);

      return res.json({
        symbol, interval, period, stdDev, lookback, deltaCandles,
        anchored: !!anchored, fromMs: anchored ? fromMs : null, toMs: anchored ? toMs : null,
        series,
        currentWidthPct: row.currentWidthPct,
        widthNCandlesAgo: row.widthNCandlesAgo,
        deltaPct: row.deltaPct,
        expansion,
        scannedAt: Date.now(),
      });
    }

    // Sem symbol: varredura de mercado (Binance USDT ativos), 1 linha por moeda.
    const { list: symbols } = await getActiveUsdtPairs();

    const matched = await runWithConcurrency(symbols, async (sym) => {
      try {
        const { candles: raw } = await getCandlesForScreening(sym, interval, limit);
        const candles = closedCandlesOnly(raw);
        if (!candles?.length || candles.length < minCandles) return null;

        const series = bollingerBandWidthSeriesWithTime(candles, { period, stdDev });
        if (!series || series.length < 2) return null;
        const expansion = computeBandWidthExpansion(candles, { period, stdDev });
        return summarizeRow(sym, series, expansion, deltaCandles);
      } catch {
        return null;
      }
    }, CONCURRENCY);

    const rows = matched.sort((a, b) => (b.expansion?.gainPct ?? -Infinity) - (a.expansion?.gainPct ?? -Infinity));

    res.json({ interval, period, stdDev, lookback, deltaCandles, rows, scannedAt: Date.now() });
  } catch (err) {
    console.error('[band-width-evolution]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
