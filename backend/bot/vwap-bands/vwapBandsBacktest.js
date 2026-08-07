'use strict';

/**
 * Backtest do vwap-bands em formato estruturado (priceSeries/entryLog/trades/summary),
 * mesma forma usada pelo Hist. Bot do ma-cross (ver ma-cross/maCrossBacktest.js) — permite
 * que a aba "Bot" do gráfico principal mostre sinais/entradas do vwap-bands em vez de ma-cross.
 * A simulação em si (WATCHING/PENDING/BOUGHT candle a candle) é a mesma do script standalone
 * backtest-vwap-bands.js, só trocando os console.log por linhas estruturadas.
 */

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const {
  evaluateEntrySignal, evaluatePullbackReady, evaluateExit, intervalMs,
} = require('./strategyEngine');

const OUTCOME_LABELS = {
  SIGNAL_ARMED: 'Sinal armado — aguardando retorno',
  SIGNAL_REPLACED: 'Sinal mais recente — trocou pendência',
  PENDING_CANCELLED: 'Pendência cancelada',
  BOUGHT: 'Comprou',
  POSITION_OPEN: 'Posição aberta',
};

async function fetchCandlesForExchange(exchange, symbol, interval, limit) {
  const need = Math.min(limit, 1000);
  if (exchange === 'gate') {
    return fetchGateCandles(toGateSymbol(symbol), need, interval);
  }
  return fetchBinanceCandles(symbol, need, interval);
}

function serializeRow(row) {
  const label = OUTCOME_LABELS[row.outcome] ?? row.outcome;
  return {
    time: row.time,
    timeISO: new Date(row.time).toISOString(),
    price: row.price,
    outcome: row.outcome,
    outcomeLabel: label,
    outcomeShort: row.detail ?? label,
    outcomeDetail: row.detail ?? null,
  };
}

async function runVwapBandsBacktest({ symbol, config, exchange = 'binance', capital = 100, sinceMs = null }) {
  const sym = symbol.toUpperCase();
  const entry = config.entry ?? {};
  const interval = entry.interval ?? '1h';
  const vwapInterval = entry.vwapInterval ?? interval;
  const pollInterval = entry.pullback?.pollInterval ?? interval;

  const testLen = sinceMs
    ? Math.max(10, Math.ceil((Date.now() - sinceMs) / intervalMs(interval)) + 5)
    : 100;

  // Buffer de contexto (3 semanas no intervalo de preço) antes da janela pedida, pra sessão
  // VWAP semanal não começar "no meio do nada" — mesma ideia do backtest-vwap-bands.js.
  const bufferCandles = Math.ceil((7 * 24 * 3_600_000 * 3) / intervalMs(interval));
  const rawPrice = await fetchCandlesForExchange(exchange, sym, interval, Math.min(1000, bufferCandles + testLen));
  if (!rawPrice?.length) {
    return { error: `Sem candles para ${sym} (${interval}).` };
  }

  const vwapSameAsPrice = vwapInterval === interval;
  let rawVwap = rawPrice;
  if (!vwapSameAsPrice) {
    const vwapBufferCandles = Math.ceil((7 * 24 * 3_600_000 * 3) / intervalMs(vwapInterval));
    rawVwap = await fetchCandlesForExchange(exchange, sym, vwapInterval, Math.min(1000, vwapBufferCandles + testLen));
  }

  const startIdx = Math.max(2, rawPrice.length - testLen);
  const testStartTime = sinceMs ?? rawPrice[startIdx].openTime;
  const testEndTime = rawPrice[rawPrice.length - 1].openTime + intervalMs(interval);

  // "Relógio mestre" é o pollInterval (ex.: 15m), não o candle de preço — senão o backtest
  // nunca reproduziria o retorno acontecendo dentro da própria hora (mesmo motivo do bot ao vivo).
  const pollSameAsPrice = pollInterval === interval;
  let rawPoll = rawPrice;
  if (!pollSameAsPrice) {
    const testSpanMs = testEndTime - testStartTime;
    const pollNeeded = Math.ceil(testSpanMs / intervalMs(pollInterval)) + 50;
    rawPoll = await fetchCandlesForExchange(exchange, sym, pollInterval, Math.min(1000, pollNeeded));
  }
  const pollStartIdx = Math.max(0, rawPoll.findIndex(c => Number(c.openTime) >= Number(testStartTime)));

  let phase = 'WATCHING';
  let pending = null;
  let position = null;
  const trades = [];
  const entryLog = [];

  for (let j = pollStartIdx; j < rawPoll.length; j++) {
    const now = rawPoll[j].openTime;
    const priceUpTo = rawPrice.filter(c => Number(c.openTime) <= Number(now));
    if (!priceUpTo.length) continue;

    const cMap = { [interval]: priceUpTo };
    if (!vwapSameAsPrice) cMap[vwapInterval] = rawVwap.filter(c => Number(c.openTime) <= Number(now));
    if (!pollSameAsPrice) cMap[pollInterval] = rawPoll.slice(0, j + 1);

    if (phase === 'WATCHING') {
      const signal = evaluateEntrySignal(config, cMap);
      if (signal.allowed) {
        pending = {
          setupId: signal.setupId, touchLevel: signal.touchLevel, confirmLevel: signal.confirmLevel,
          targetLevel: signal.targetLevel, signalOpenTime: signal.confirmOpenTime, signalClose: signal.close,
        };
        phase = 'PENDING';
        entryLog.push({
          time: signal.confirmOpenTime,
          price: signal.close,
          outcome: 'SIGNAL_ARMED',
          detail: `${signal.entryDesc} (espaço até o alvo: ${signal.bandDistPct.toFixed(2)}%)`,
        });
      }
    } else if (phase === 'PENDING') {
      const freshSignal = evaluateEntrySignal(config, cMap);
      if (freshSignal.allowed && Number(freshSignal.confirmOpenTime) > Number(pending.signalOpenTime)) {
        pending = {
          setupId: freshSignal.setupId, touchLevel: freshSignal.touchLevel, confirmLevel: freshSignal.confirmLevel,
          targetLevel: freshSignal.targetLevel, signalOpenTime: freshSignal.confirmOpenTime, signalClose: freshSignal.close,
        };
        entryLog.push({
          time: freshSignal.confirmOpenTime,
          price: freshSignal.close,
          outcome: 'SIGNAL_REPLACED',
          detail: freshSignal.entryDesc,
        });
      }

      const ready = evaluatePullbackReady(config, cMap, pending);
      if (ready.cancel) {
        entryLog.push({
          time: now,
          price: priceUpTo[priceUpTo.length - 1].close,
          outcome: 'PENDING_CANCELLED',
          detail: ready.reason,
        });
        phase = 'WATCHING';
        pending = null;
      } else if (ready.ready) {
        position = {
          buyPrice: ready.close, buyTime: now,
          touchLevel: pending.touchLevel, targetLevel: pending.targetLevel,
        };
        entryLog.push({ time: now, price: ready.close, outcome: 'BOUGHT', detail: ready.entryDesc });
        trades.push({ type: 'BUY', time: now, price: ready.close });
        phase = 'BOUGHT';
        pending = null;
      }
    } else if (phase === 'BOUGHT') {
      const exitResult = evaluateExit(config, cMap, position.buyPrice, {
        peakPrice: position.buyPrice, targetLevel: position.targetLevel, touchLevel: position.touchLevel,
        buyTime: position.buyTime,
      });
      if (exitResult.exit) {
        const pnlPct = ((exitResult.close - position.buyPrice) / position.buyPrice) * 100;
        trades.push({
          type: 'SELL',
          time: now,
          price: exitResult.close,
          pnlPct,
          exitReason: exitResult.exitDesc ?? exitResult.reason,
        });
        phase = 'WATCHING';
        position = null;
      }
    }
  }

  if (phase === 'BOUGHT' && position) {
    entryLog.push({ time: testEndTime, price: position.buyPrice, outcome: 'POSITION_OPEN', detail: 'Posição ainda aberta ao final do teste' });
  }

  const visibleEntryLog = sinceMs ? entryLog.filter(e => e.time >= sinceMs) : entryLog;
  const visibleTrades = sinceMs ? trades.filter(t => t.time >= sinceMs) : trades;
  const priceSeriesSource = sinceMs ? rawPrice.filter(c => c.openTime >= sinceMs) : rawPrice.slice(-testLen);
  const priceSeries = priceSeriesSource.map(c => ({ time: c.openTime, close: c.close }));

  const sells = visibleTrades.filter(t => t.type === 'SELL');
  const totalPnlPct = sells.reduce((s, t) => s + (t.pnlPct ?? 0), 0);

  return {
    symbol: sym,
    exchange,
    capital,
    label: config.label ?? 'VWAP Bands',
    priceSeries,
    entryLog: visibleEntryLog.map(serializeRow),
    trades: visibleTrades.map(t => ({
      type: t.type,
      time: t.time,
      timeISO: new Date(t.time).toISOString(),
      price: t.price,
      pnlPct: t.pnlPct != null ? parseFloat(t.pnlPct.toFixed(2)) : null,
      exitReason: t.exitReason ?? null,
    })),
    summary: {
      entrySignals: visibleEntryLog.length,
      trades: sells.length,
      totalPnlPct: parseFloat(totalPnlPct.toFixed(2)),
    },
  };
}

module.exports = { runVwapBandsBacktest };
