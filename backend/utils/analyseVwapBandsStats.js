'use strict';

/**
 * Estatísticas do vwap-bands pro StatisticsPanel (aba "VWAP Bands") — mesmo padrão de
 * analyseMaCrossStats.js / analyseRsiOversoldRecovery.js / analyseBollingerBandRecovery.js:
 * SIMULA a regra sobre o histórico de candles da moeda (mesmo motor do bot real —
 * strategyEngine.js, com o filtro EMA e a escada de 3 degraus) e devolve os ciclos
 * completos (compra→venda) encontrados — mesmo que a moeda não seja favorita e o bot real
 * nunca tenha executado esses trades. Não lê rsi_multi_bot_trades.
 */

const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { toGateSymbol } = require('./toGateSymbol');
const { retentionLimitFor } = require('./candleRetentionLimits');
const { normalizeVwapBandsConfig, toEngineConfig } = require('../bot/vwap-bands/tradeConfigSchema');
const {
  evaluateEntrySignal, evaluatePullbackReady, evaluateExit, intervalMs, labelForLevel,
} = require('../bot/vwap-bands/strategyEngine');

const CANDLE_LIMIT = 1000; // limite pros intervalos de preço/poll/EMA — não precisam de sessão inteira
const SESSION_HOURS = { daily: 24, weekly: 24 * 7 };

/** Candles necessários pra a VWAP cobrir a sessão (diária/semanal) de verdade — sem isso, um
 *  intervalo fino (ex.: 1m) com sessão semanal só tinha ~16h de histórico real (1000 candles a
 *  1m), fazendo a "VWAP semanal" ser na prática a média de só algumas horas, super sensível a
 *  qualquer candle de pump/dump recente — bandas instáveis, sinais que uma leitura visual do
 *  gráfico (com mais candles carregados) não reproduz. Ver conversa sobre a KMNOUSDT. Cap por
 *  intervalo (retentionLimitFor) — pedir mais do que o cache em disco retém é inútil, o
 *  próximo request de qualquer outra tela que passe pelo mesmo arquivo já trunca de volta. */
function vwapCandleLimit(vwapIv, session) {
  const cap = retentionLimitFor(vwapIv);
  const hours = SESSION_HOURS[session] ?? SESSION_HOURS.daily;
  const perSession = Math.ceil((hours * 3_600_000) / intervalMs(vwapIv));
  return Math.min(cap, Math.max(CANDLE_LIMIT, perSession + 50));
}

/** Histórico via cache em disco (getCandles/getGateCandles — mesmo usado pelo gráfico e pelo
 *  bot real), que faz merge incremental e pagina automaticamente quando o cache local ainda não
 *  tem `limit` candles (ver fetchKlines) — bem mais rápido e barato de API do que buscar tudo do
 *  zero a cada request, e cresce organicamente com o uso normal do app. */
async function fetchHistory(symbol, interval, source, limit) {
  if (source === 'gate') {
    return getGateCandles(toGateSymbol(symbol), interval, limit);
  }
  try {
    const c = await getCandles(symbol, interval, limit);
    if (c?.length) return c;
  } catch { /* tenta Gate abaixo */ }
  return getGateCandles(toGateSymbol(symbol), interval, limit);
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
 * @param {number} [options.candleCount] — override do histórico dos intervalos de
 *   preço/poll/EMA (padrão CANDLE_LIMIT). NÃO reduz o intervalo da VWAP abaixo do mínimo que
 *   cobre a sessão inteira (vwapCandleLimit) — só pode alargar esse mínimo, nunca encolhê-lo,
 *   senão a "VWAP semanal" vira média de poucas horas (ver comentário de vwapCandleLimin).
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
  const otherLimit = options.candleCount ?? CANDLE_LIMIT;
  const vwapLimit = Math.max(vwapCandleLimit(vwapIv, entry.session), otherLimit);
  const fetched = {};
  await Promise.all([...ivSet].map(async (iv) => {
    const limit = iv === vwapIv ? vwapLimit : otherLimit;
    fetched[iv] = await fetchHistory(symbol, iv, source, limit);
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
          // Candle que armou o sinal (reconquista da linha) — separado do candle de compra
          // (retorno/pullback), pra dar pra marcar os dois pontos no gráfico e na tabela.
          // signalLevel = a linha reconquistada de fato (lw1/vw/up1) — não confundir com
          // targetLevel, que é o degrau seguinte (o alvo de venda).
          signalTime: pending.signalOpenTime, signalPrice: pending.signalClose,
          signalLevel: labelForLevel(pending.confirmLevel),
          touchLevel: pending.touchLevel, targetLevel: pending.targetLevel, entryDesc: pending.entryDesc,
        };
        phase = 'BOUGHT';
        pending = null;
      }
    } else if (phase === 'BOUGHT') {
      const exitResult = evaluateExit(config, cMap, position.buyPrice, {
        peakPrice: position.buyPrice, targetLevel: position.targetLevel, touchLevel: position.touchLevel,
        buyTime: position.buyTime,
      });
      if (exitResult.exit) {
        const sellTime = exitResult.decisionTime ?? now;
        occurrences.push({
          signalDate: iso(position.signalTime),
          signalPrice: position.signalPrice,
          signalLevel: position.signalLevel,
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
      signalDate: iso(position.signalTime),
      signalPrice: position.signalPrice,
      signalLevel: position.signalLevel,
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
