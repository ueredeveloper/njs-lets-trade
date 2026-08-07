'use strict';

/**
 * Backtest rápido do vwap-bands sobre candles reais — reaproveita as mesmas funções do
 * motor (strategyEngine.js) usadas pelo bot ao vivo, simulando WATCHING/PENDING/BOUGHT.
 * Busca um histórico maior que a janela pedida pra dar contexto real de sessão à VWAP
 * (semanal por padrão) antes do início da janela reportada.
 *
 * A VWAP+bandas pode ser calculada num intervalo diferente do candle de preço (padrão:
 * VWAP 4h semanal, candle de preço 1h — mesma configuração usada no painel do app), e a
 * checagem de retorno durante o PENDING roda no intervalo rápido `pullback.pollInterval`
 * (padrão 15m) — por isso o "relógio mestre" da simulação é esse intervalo rápido, não o
 * candle de preço: sem isso, o backtest nunca veria o retorno acontecer dentro da hora.
 *
 * Uso:
 *   node backend/bot/vwap-bands/backtest-vwap-bands.js [symbol] [nCandles] [interval] [vwapInterval]
 *   node backend/bot/vwap-bands/backtest-vwap-bands.js SKYAIUSDT 100 1h 4h
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { fetchBinanceCandles, fetchGateCandles } = require('../prices');
const { toGateSymbol } = require('../../utils/toGateSymbol');
const { normalizeVwapBandsConfig, toEngineConfig } = require('./tradeConfigSchema');
const {
  evaluateEntrySignal, evaluatePullbackReady, evaluateExit, intervalMs,
} = require('./strategyEngine');

const symbol       = (process.argv[2] || 'SKYAIUSDT').toUpperCase();
const testLen      = Number(process.argv[3] || 100);
const interval     = process.argv[4] || '1h';
const vwapInterval = process.argv[5] || '4h';

function fmtBRT(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function fetchHistory(sym, iv, limit) {
  try {
    const c = await fetchBinanceCandles(sym, limit, iv);
    if (c?.length) return { candles: c, source: 'Binance' };
  } catch { /* tenta Gate abaixo */ }
  const pair = toGateSymbol(sym);
  const c = await fetchGateCandles(pair, limit, iv);
  return { candles: c, source: 'Gate.io' };
}

async function main() {
  const config = toEngineConfig(normalizeVwapBandsConfig({ entry: { interval, vwapInterval } }));
  const pollInterval = config.entry.pullback.pollInterval;

  // Buffer de contexto (3 semanas no intervalo de preço) antes da janela de teste, pra
  // sessão VWAP semanal não começar "no meio do nada" logo no 1º candle reportado.
  const bufferCandles = Math.ceil((7 * 24 * 3_600_000 * 3) / intervalMs(interval));
  const { candles: rawPrice, source } = await fetchHistory(symbol, interval, Math.min(1000, bufferCandles + testLen));
  if (!rawPrice?.length) {
    console.error(`Sem candles pra ${symbol} (${interval}).`);
    process.exit(1);
  }

  const vwapSameAsPrice = vwapInterval === interval;
  let rawVwap = rawPrice;
  if (!vwapSameAsPrice) {
    const vwapBufferCandles = Math.ceil((7 * 24 * 3_600_000 * 3) / intervalMs(vwapInterval));
    const vwapFetch = await fetchHistory(symbol, vwapInterval, Math.min(1000, vwapBufferCandles + testLen));
    rawVwap = vwapFetch.candles;
  }

  const startIdx = Math.max(2, rawPrice.length - testLen);
  const testStartTime = rawPrice[startIdx].openTime;
  const testEndTime = rawPrice[rawPrice.length - 1].openTime + intervalMs(interval);

  // O "relógio mestre" da simulação é o pollInterval (ex.: 15m), não o candle de preço —
  // senão o backtest nunca reproduziria o retorno acontecendo dentro da própria hora
  // (mesmo motivo do fastCheck/pollInterval do ma-cross). Só busca o suficiente pra cobrir
  // a janela de teste, não a sessão inteira da VWAP (isso já vem do rawVwap).
  const pollSameAsPrice = pollInterval === interval;
  let rawPoll = rawPrice;
  if (!pollSameAsPrice) {
    const testSpanMs = testEndTime - testStartTime;
    const pollNeeded = Math.ceil(testSpanMs / intervalMs(pollInterval)) + 50;
    const pollFetch = await fetchHistory(symbol, pollInterval, Math.min(1000, pollNeeded));
    rawPoll = pollFetch.candles;
  }
  const pollStartIdx = Math.max(0, rawPoll.findIndex(c => Number(c.openTime) >= Number(testStartTime)));

  // Filtro de entrada emaFilter (ex.: EMA200 15m) — busca o próprio intervalo se não
  // coincidir com nenhum já buscado acima, com folga de 3x o período pra EMA estabilizar.
  const efConfig = config.entry.emaFilter;
  const efInterval = efConfig?.enabled ? (efConfig.interval ?? pollInterval) : null;
  const efAlreadyCovered = efInterval === interval || efInterval === vwapInterval || efInterval === pollInterval;
  let rawEma = null;
  if (efInterval && !efAlreadyCovered) {
    const efPeriod = Math.max(2, Math.round(Number(efConfig.period ?? 200)));
    const testSpanMs = testEndTime - testStartTime;
    const efNeeded = Math.ceil(testSpanMs / intervalMs(efInterval)) + efPeriod * 3 + 50;
    const efFetch = await fetchHistory(symbol, efInterval, Math.min(1000, efNeeded));
    rawEma = efFetch.candles;
  }

  console.log(
    `${symbol} — ${rawPrice.length} candles de preço (${source}, ${interval})`
    + (vwapSameAsPrice ? '' : ` + ${rawVwap.length} candles de VWAP (${vwapInterval})`)
    + (pollSameAsPrice ? '' : ` + ${rawPoll.length} candles de checagem rápida (${pollInterval})`)
    + (efInterval && !efAlreadyCovered ? ` + ${rawEma.length} candles do filtro EMA (${efInterval})` : '')
    + `. Horários em BRT.\n`,
  );
  console.log(`Período testado: ${fmtBRT(testStartTime)} → ${fmtBRT(rawPrice[rawPrice.length - 1].openTime)}\n`);

  let phase = 'WATCHING';
  let pending = null;
  let position = null;
  const trades = [];
  const events = [];

  for (let j = pollStartIdx; j < rawPoll.length; j++) {
    const now = rawPoll[j].openTime;
    const priceUpTo = rawPrice.filter(c => Number(c.openTime) <= Number(now));
    if (!priceUpTo.length) continue;
    const lastClosedTime = priceUpTo.length >= 2 ? priceUpTo[priceUpTo.length - 2].openTime : priceUpTo[0].openTime;

    const cMap = { [interval]: priceUpTo };
    if (!vwapSameAsPrice) {
      cMap[vwapInterval] = rawVwap.filter(c => Number(c.openTime) <= Number(now));
    }
    if (!pollSameAsPrice) {
      cMap[pollInterval] = rawPoll.slice(0, j + 1);
    }
    if (efInterval && !efAlreadyCovered) {
      cMap[efInterval] = rawEma.filter(c => Number(c.openTime) <= Number(now));
    }

    if (phase === 'WATCHING') {
      const signal = evaluateEntrySignal(config, cMap);
      if (signal.allowed) {
        pending = {
          setupId: signal.setupId, touchLevel: signal.touchLevel, confirmLevel: signal.confirmLevel,
          targetLevel: signal.targetLevel, signalOpenTime: signal.confirmOpenTime, signalClose: signal.close,
        };
        phase = 'PENDING';
        events.push(
          `[${fmtBRT(signal.confirmOpenTime)}] SINAL — ${signal.entryDesc} `
          + `@ ${signal.close.toFixed(6)} (espaço até o alvo: ${signal.bandDistPct.toFixed(2)}%)`,
        );
      }
    } else if (phase === 'PENDING') {
      // Preempção: mesmo em PENDING, confere se surgiu uma reconquista mais recente (ex.:
      // um degrau acima) — senão um pending antigo bloqueia pra sempre a detecção de um
      // sinal mais novo e mais relevante.
      const freshSignal = evaluateEntrySignal(config, cMap);
      if (freshSignal.allowed && Number(freshSignal.confirmOpenTime) > Number(pending.signalOpenTime)) {
        pending = {
          setupId: freshSignal.setupId, touchLevel: freshSignal.touchLevel, confirmLevel: freshSignal.confirmLevel,
          targetLevel: freshSignal.targetLevel, signalOpenTime: freshSignal.confirmOpenTime, signalClose: freshSignal.close,
        };
        events.push(
          `[${fmtBRT(freshSignal.confirmOpenTime)}] SINAL mais recente — ${freshSignal.entryDesc} `
          + `@ ${freshSignal.close.toFixed(6)} (trocando pendência)`,
        );
      }

      const ready = evaluatePullbackReady(config, cMap, pending);
      if (ready.cancel) {
        events.push(`[${fmtBRT(lastClosedTime)}] PENDING cancelado — ${ready.reason}`);
        phase = 'WATCHING';
        pending = null;
      } else if (ready.ready) {
        const decisionTime = ready.decisionTime ?? now;
        position = {
          buyPrice: ready.close, buyTime: decisionTime,
          touchLevel: pending.touchLevel, targetLevel: pending.targetLevel,
        };
        events.push(`[${fmtBRT(decisionTime)}] COMPRA @ ${ready.close.toFixed(6)} (${ready.entryDesc})`);
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
        const pnlPct = ((exitResult.close - position.buyPrice) / position.buyPrice) * 100;
        events.push(
          `[${fmtBRT(sellTime)}] VENDA @ ${exitResult.close.toFixed(6)} `
          + `— ${exitResult.exitDesc ?? exitResult.reason} (PnL ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`,
        );
        trades.push({
          buyTime: position.buyTime, buyPrice: position.buyPrice,
          sellTime, sellPrice: exitResult.close,
          pnlPct, reason: exitResult.reason,
        });
        phase = 'WATCHING';
        position = null;
      }
    }
  }

  console.log('=== Eventos ===');
  if (!events.length) console.log('Nenhum sinal, compra ou venda no período.');
  events.forEach(e => console.log(e));

  console.log('\n=== Trades fechados ===');
  if (!trades.length) {
    console.log('Nenhum trade fechado no período.');
  } else {
    trades.forEach((t, idx) => {
      console.log(
        `${idx + 1}. ${fmtBRT(t.buyTime)} @ ${t.buyPrice.toFixed(6)}  →  `
        + `${fmtBRT(t.sellTime)} @ ${t.sellPrice.toFixed(6)}  |  ${t.reason}  |  `
        + `PnL ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%`,
      );
    });
    const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
    const wins = trades.filter(t => t.pnlPct > 0).length;
    console.log(
      `\nResumo: ${trades.length} trade(s) — ${wins} vencedor(es) / ${trades.length - wins} perdedor(es) `
      + `— PnL acumulado (soma simples, sem taxas) ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`,
    );
  }

  if (phase === 'PENDING') {
    console.log(`\n(Sinal pendente ao final do teste — aguardando retorno; ainda não comprou)`);
  }
  if (phase === 'BOUGHT') {
    console.log(`\n(Posição ainda aberta ao final do teste — comprou @ ${position.buyPrice.toFixed(6)} em ${fmtBRT(position.buyTime)})`);
  }
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
