'use strict';

const router = require('express').Router();
const { BollingerBands } = require('technicalindicators');
const getCandlesForScreening = require('../utils/getCandlesForScreening');
const { getGateCandles } = require('../gate/getGateCandles');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { closedCandlesOnly } = require('../bot/ma-cross/strategyEngine');
const { buildBollingerBandWidthFilterName } = require('../utils/filterNames');
const { bandWidthRobustMean } = require('../utils/removeOutliersIQR');
const { bollingerBandWidthSeries } = require('../utils/indicatorGrowthEngines');
const bbBandWidthCache = require('../cache/bbBandWidthCache');
const { ALL_INTERVALS, BB_PERIODS, BB_STD_DEVS } = require('../bot/bollinger-bands/tradeConfigSchema');

const CONCURRENCY = 25;

// Mesmos intervalos/período/desvio padrão aceitos pelo seletor de entrada do favorito
// Bollinger Bands (ver backend/bot/bollinger-bands/tradeConfigSchema.js) — padroniza o que
// conta como uma banda BB "válida" em todo o painel, não só na estratégia de trade.
const ALLOWED_INTERVALS = new Set(ALL_INTERVALS);
const ALLOWED_PERIODS = new Set(BB_PERIODS);
const ALLOWED_STD_DEVS = new Set(BB_STD_DEVS);
const ALLOWED_LOOKBACKS = new Set([50, 100, 150, 200, 300, 700]);

function parsePctParam(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : null;
}

/**
 * Largura de uma moeda = distância média entre a banda superior e a inferior, (upper−lower)/lower
 * em %, calculada candle a candle na janela de `lookback` candles (ver bollingerBandWidthSeries).
 * A média DESCARTA as altas expressivas que inflam o valor — um pump/crash pontual alarga as
 * bandas por ~`period` candles sem representar a "largura típica" da moeda (ver bandWidthRobustMean:
 * Tukey 1.5×IQR + corta o decil superior + descarta acima de 2.5× a mediana).
 */
function computeBandGrowthRow(symbol, candles, { period, stdDev }) {
  const closes = candles.map(c => parseFloat(c.close));
  const bb = BollingerBands.calculate({ period, values: closes, stdDev });
  if (!bb.length) return null;

  const series = bollingerBandWidthSeries(candles, { period, stdDev });
  if (!series || !series.length) return null;

  const avgWidthPct = bandWidthRobustMean(series);
  const lastBb = bb[bb.length - 1];
  const last = candles[candles.length - 1];
  const close = parseFloat(last.close);
  const bandSpan = lastBb.upper - lastBb.lower;
  const percentB = bandSpan > 0
    ? Math.min(100, Math.max(0, ((close - lastBb.lower) / bandSpan) * 100))
    : null;

  return {
    symbol,
    avgWidthPct: Math.round(avgWidthPct * 100) / 100,
    lastWidthPct: Math.round(series[series.length - 1] * 100) / 100,
    minWidthPct: Math.round(Math.min(...series) * 100) / 100,
    maxWidthPct: Math.round(Math.max(...series) * 100) / 100,
    samples: series.length,
    close,
    upper: lastBb.upper,
    lower: lastBb.lower,
    percentB: percentB != null ? Math.round(percentB * 100) / 100 : null,
  };
}

/** Filtra uma lista já calculada (`{symbol, avgWidthPct, ...}[]`) pela faixa de largura pedida. */
function filterByWidthRange(rows, widthMinPct, widthMaxPct) {
  if (widthMinPct == null && widthMaxPct == null) return rows;
  return rows.filter((r) => {
    if (widthMinPct != null && r.avgWidthPct < widthMinPct) return false;
    if (widthMaxPct != null && r.avgWidthPct > widthMaxPct) return false;
    return true;
  });
}

/** Mesmo filtro, mas sobre um snapshot pronto do cache ({list, details}) — preserva a ordem. */
function filterSnapshotByWidthRange(snap, widthMinPct, widthMaxPct) {
  if (widthMinPct == null && widthMaxPct == null) return snap;
  const list = snap.list.filter((sym) => {
    const meta = snap.details?.[sym];
    if (!meta) return false;
    if (widthMinPct != null && meta.avgWidthPct < widthMinPct) return false;
    if (widthMaxPct != null && meta.avgWidthPct > widthMaxPct) return false;
    return true;
  });
  const details = {};
  for (const sym of list) details[sym] = snap.details[sym];
  return { ...snap, list, details };
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    });
  }
  return results;
}

/**
 * Largura das Bandas de Bollinger: distância média entre a banda superior e a inferior
 * (upper−lower)/lower em %, candle a candle nos últimos `lookback` candles fechados, sem as
 * altas expressivas que inflam a média (ver computeBandGrowthRow / bandWidthRobustMean).
 * Ex.: moeda em squeeze (bandas coladas) vs. moeda em expansão de volatilidade (bandas abertas).
 *
 * GET /services/bollinger-band-width-filter?interval=4h&period=20&stdDev=2&lookback=100&order=far
 *
 * Com `symbols` (csv), pula o scan do mercado inteiro e calcula só pros símbolos pedidos —
 * usado pela coluna "Larg%" dos favoritos BB (poucos símbolos, precisa responder rápido,
 * sem depender do cache pré-aquecido de mercado nem esperar o scan completo terminar).
 */
router.get('/bollinger-band-width-filter', async (req, res) => {
  try {
    const interval = req.query.interval ?? '4h';
    const period = parseInt(req.query.period ?? '20', 10);
    const stdDev = parseFloat(req.query.stdDev ?? '2');
    const lookback = parseInt(req.query.lookback ?? '100', 10);
    const order = req.query.order === 'near' ? 'near' : 'far';
    const widthMinPct = parsePctParam(req.query.widthMinPct);
    const widthMaxPct = parsePctParam(req.query.widthMaxPct);
    const symbolsParam = typeof req.query.symbols === 'string' && req.query.symbols.trim()
      ? req.query.symbols.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const gateSymbols = typeof req.query.gateSymbols === 'string' && req.query.gateSymbols.trim()
      ? new Set(req.query.gateSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))
      : null;

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
      return res.status(400).json({ error: 'lookback suportado: 50, 100, 150, 200, 300 ou 700' });
    }
    if (widthMinPct != null && widthMaxPct != null && widthMinPct > widthMaxPct) {
      return res.status(400).json({ error: 'widthMinPct não pode ser maior que widthMaxPct' });
    }

    const name = buildBollingerBandWidthFilterName(interval, period, stdDev, lookback, { widthMinPct, widthMaxPct });

    if (symbolsParam) {
      const symbols = symbolsParam;
      const minCandles = period + 5;
      const limit = lookback + minCandles;

      const matched = await runWithConcurrency(symbols, async (symbol) => {
        try {
          // Favoritos na Gate.io usam o pipeline de candles da Gate (própria cache
          // `${symbol}_GATE`) — getCandlesForScreening é Binance-only (fora da lista estática
          // GATE_ONLY_SYMBOLS) e falha silenciosamente pra símbolos que só existem na Gate,
          // deixando o favorito sem % de largura (ver conversa sobre o seletor BB "Larg").
          const raw = gateSymbols?.has(symbol.toUpperCase())
            ? await getGateCandles(symbol, interval, limit)
            : (await getCandlesForScreening(symbol, interval, limit)).candles;
          const candles = closedCandlesOnly(raw);
          if (!candles?.length || candles.length < minCandles) return null;

          return computeBandGrowthRow(symbol, candles, { period, stdDev });
        } catch (err) {
          console.warn(`[bollinger-band-width-filter] ${symbol}:`, err.message);
          return null;
        }
      }, CONCURRENCY);

      const withinWidth = filterByWidthRange(matched, widthMinPct, widthMaxPct);
      withinWidth.sort((a, b) => (order === 'far' ? b.avgWidthPct - a.avgWidthPct : a.avgWidthPct - b.avgWidthPct));

      const details = {};
      for (const row of withinWidth) {
        const { symbol, ...meta } = row;
        details[symbol] = meta;
      }

      return res.json({
        name,
        list: withinWidth.map(r => r.symbol),
        details,
        interval,
        period,
        stdDev,
        lookback,
        order,
        scannedAt: Date.now(),
      });
    }

    const { list: symbols } = await getActiveUsdtPairs();
    const force = req.query.force === '1';

    const presetKey = bbBandWidthCache.matchesCachedPreset({ interval, period, stdDev, lookback });
    if (presetKey) {
      const cached = await bbBandWidthCache.getCachedResult(symbols, presetKey, { force, order });
      if (cached) {
        return res.json({ ...filterSnapshotByWidthRange(cached, widthMinPct, widthMaxPct), name });
      }
    }

    const minCandles = period + 5;
    const limit = lookback + minCandles;

    const matched = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const { candles: raw } = await getCandlesForScreening(symbol, interval, limit);
        const candles = closedCandlesOnly(raw);
        if (!candles?.length || candles.length < minCandles) return null;

        return computeBandGrowthRow(symbol, candles, { period, stdDev });
      } catch {
        return null;
      }
    }, CONCURRENCY);

    const withinWidth = filterByWidthRange(matched, widthMinPct, widthMaxPct);
    withinWidth.sort((a, b) => (order === 'far' ? b.avgWidthPct - a.avgWidthPct : a.avgWidthPct - b.avgWidthPct));

    const details = {};
    for (const row of withinWidth) {
      const { symbol, ...meta } = row;
      details[symbol] = meta;
    }

    res.json({
      name,
      list: withinWidth.map(r => r.symbol),
      details,
      interval,
      period,
      stdDev,
      lookback,
      order,
      scannedAt: Date.now(),
    });
  } catch (err) {
    console.error('[bollinger-band-width-filter]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
