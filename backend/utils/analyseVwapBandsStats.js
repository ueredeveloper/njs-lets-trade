'use strict';

/**
 * Estatísticas do vwap-bands pro StatisticsPanel (aba "VWAP Bands") — mesmo padrão de
 * analyseMaCrossStats.js / analyseRsiOversoldRecovery.js / analyseBollingerBandRecovery.js:
 * SIMULA a regra sobre o histórico de candles da moeda (mesmo motor do bot real —
 * strategyEngine.js, com o filtro EMA e a escada de 3 degraus) e devolve os ciclos
 * completos (compra→venda) encontrados — mesmo que a moeda não seja favorita e o bot real
 * nunca tenha executado esses trades. Não lê rsi_multi_bot_trades.
 */

const { fetchBinanceCandles, fetchGateCandles } = require('../bot/prices');
const { toGateSymbol } = require('./toGateSymbol');
const { normalizeVwapBandsConfig, toEngineConfig } = require('../bot/vwap-bands/tradeConfigSchema');
const {
  evaluateEntrySignal, evaluatePullbackReady, evaluateExit,
} = require('../bot/vwap-bands/strategyEngine');

const CANDLE_LIMIT = 1000; // máx por request nas duas exchanges

async function fetchHistory(symbol, interval, source) {
  if (source === 'gate') {
    return fetchGateCandles(toGateSymbol(symbol), CANDLE_LIMIT, interval);
  }
  try {
    const c = await fetchBinanceCandles(symbol, CANDLE_LIMIT, interval);
    if (c?.length) return c;
  } catch { /* tenta Gate abaixo */ }
  return fetchGateCandles(toGateSymbol(symbol), CANDLE_LIMIT, interval);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function pctChange(entryPrice, exitPrice) {
  if (!entryPrice) return 0;
  return parseFloat((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2));
}

/**
 * @param {string} symbol
 * @param {object} [options]
 * @param {string|null} [options.source] — 'gate' força Gate.io; null tenta Binance e cai pra Gate.
 * @param {object|null} [options.tradeConfig] — trade_config salvo do favorito (se a moeda for
 *   favorita vwap-bands), pra simular com a config REAL configurada pra ela; senão usa o
 *   preset padrão de produção.
 */
async function analyseVwapBandsStats(symbol, options = {}) {
  const source = options.source ?? null;
  const config = toEngineConfig(normalizeVwapBandsConfig(options.tradeConfig ?? {}));
  const entry = config.entry;

  const priceIv = entry.interval;
  const vwapIv = entry.vwapInterval ?? priceIv;
  const pollIv = entry.pullback.pollInterval ?? priceIv;
  const efEnabled = entry.emaFilter?.enabled === true;
  const efIv = efEnabled ? (entry.emaFilter.interval ?? pollIv) : null;

  const ivSet = new Set([priceIv, vwapIv, pollIv, ...(efIv ? [efIv] : [])]);
  const fetched = {};
  await Promise.all([...ivSet].map(async (iv) => {
    fetched[iv] = await fetchHistory(symbol, iv, source);
  }));

  const rawPrice = fetched[priceIv];
  const rawVwap = fetched[vwapIv];
  const rawPoll = fetched[pollIv];
  const rawEma = efIv ? fetched[efIv] : null;
  if (!rawPrice?.length) throw new Error(`sem candles para ${symbol} (${priceIv})`);
  if (!rawVwap?.length) throw new Error(`sem candles para ${symbol} (${vwapIv})`);
  if (!rawPoll?.length) throw new Error(`sem candles para ${symbol} (${pollIv})`);

  let phase = 'WATCHING';
  let pending = null;
  let position = null;
  const occurrences = [];

  for (let j = 0; j < rawPoll.length; j++) {
    const now = rawPoll[j].openTime;
    const priceUpTo = rawPrice.filter(c => Number(c.openTime) <= Number(now));
    if (!priceUpTo.length) continue;

    const cMap = {
      [priceIv]: priceUpTo,
      [vwapIv]: rawVwap.filter(c => Number(c.openTime) <= Number(now)),
      [pollIv]: rawPoll.slice(0, j + 1),
    };
    if (efIv && efIv !== pollIv) cMap[efIv] = rawEma.filter(c => Number(c.openTime) <= Number(now));

    if (phase === 'WATCHING') {
      const signal = evaluateEntrySignal(config, cMap);
      if (signal.allowed) {
        pending = {
          setupId: signal.setupId, touchLevel: signal.touchLevel, confirmLevel: signal.confirmLevel,
          targetLevel: signal.targetLevel, signalOpenTime: signal.confirmOpenTime, signalClose: signal.close,
          entryDesc: signal.entryDesc,
        };
        phase = 'PENDING';
      }
    } else if (phase === 'PENDING') {
      const fresh = evaluateEntrySignal(config, cMap);
      if (fresh.allowed && Number(fresh.confirmOpenTime) > Number(pending.signalOpenTime)) {
        pending = {
          setupId: fresh.setupId, touchLevel: fresh.touchLevel, confirmLevel: fresh.confirmLevel,
          targetLevel: fresh.targetLevel, signalOpenTime: fresh.confirmOpenTime, signalClose: fresh.close,
          entryDesc: fresh.entryDesc,
        };
      }

      const ready = evaluatePullbackReady(config, cMap, pending);
      if (ready.cancel) {
        phase = 'WATCHING';
        pending = null;
      } else if (ready.ready) {
        const decisionTime = ready.decisionTime ?? now;
        position = {
          buyPrice: ready.close, buyTime: decisionTime,
          touchLevel: pending.touchLevel, targetLevel: pending.targetLevel, entryDesc: pending.entryDesc,
        };
        phase = 'BOUGHT';
        pending = null;
      }
    } else if (phase === 'BOUGHT') {
      const exitResult = evaluateExit(config, cMap, position.buyPrice, {
        peakPrice: position.buyPrice, targetLevel: position.targetLevel, touchLevel: position.touchLevel,
      });
      if (exitResult.exit) {
        const sellTime = exitResult.decisionTime ?? now;
        occurrences.push({
          startDate: iso(position.buyTime),
          endDate: iso(sellTime),
          entryPrice: position.buyPrice,
          exitPrice: exitResult.close,
          appreciationPercent: pctChange(position.buyPrice, exitResult.close),
          exitReason: exitResult.reason,
          entryDesc: position.entryDesc,
        });
        phase = 'WATCHING';
        position = null;
      }
    }
  }

  let openOccurrence = null;
  if (phase === 'BOUGHT' && position) {
    const lastClose = parseFloat(rawPrice[rawPrice.length - 1].close);
    openOccurrence = {
      isOpen: true,
      startDate: iso(position.buyTime),
      endDate: null,
      entryPrice: position.buyPrice,
      exitPrice: null,
      appreciationPercent: pctChange(position.buyPrice, lastClose),
      exitReason: null,
      entryDesc: position.entryDesc,
    };
  }

  const total = occurrences.length;
  const avgAppreciationPercent = total > 0
    ? parseFloat((occurrences.reduce((s, o) => s + o.appreciationPercent, 0) / total).toFixed(2))
    : 0;
  const avgCycleDurationMs = total > 0
    ? Math.round(occurrences.reduce((s, o) => s + (new Date(o.endDate).getTime() - new Date(o.startDate).getTime()), 0) / total)
    : 0;

  return {
    symbol,
    entryInterval: priceIv,
    vwapInterval: vwapIv,
    session: entry.session,
    pollInterval: pollIv,
    emaFilter: efEnabled ? { period: entry.emaFilter.period, interval: efIv, tolerancePct: entry.emaFilter.tolerancePct } : null,
    entryLabel: `VWAP(${vwapIv}) reconquista${efEnabled ? ` + EMA${entry.emaFilter.period}(${efIv}) -${entry.emaFilter.tolerancePct}%` : ''}`,
    exitLabel: 'Alvo VWAP / Stop-loss',
    totalCandles: rawPrice.length,
    totalOccurrences: total,
    avgAppreciationPercent,
    avgCycleDurationMs,
    occurrences,
    openOccurrence,
  };
}

module.exports = analyseVwapBandsStats;
