'use strict';

/**
 * Backtest das regras de extensão (3/4 candles).
 * Para cada sinal RSI+MA em zona esticada acima da MA, simula o trade contrafactual
 * e classifica entradas confirmadas vs bloqueadas que salvaram/perderam oportunidade.
 */

const ti = require('technicalindicators');
const {
  getRequiredSpecs, computeAdaptiveDips, evaluateEntry, evaluateExit,
  getStopLossMa, checkRsi, analyzeExtension, getExtensionIntervals, maKey,
} = require('./strategyEngine');

function computeRsiSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period });
  return rsiArr.map((rsi, i) => ({
    openTime: candles[period + i].openTime,
    close:    candles[period + i].close,
    rsi,
  }));
}

function exitRsiAt(exitSeries, entryTime) {
  let best = null;
  for (const pt of exitSeries) {
    if (pt.openTime <= entryTime) best = pt.rsi;
    else break;
  }
  return best;
}

function computeMaSeries(candles, period) {
  const closes = candles.map(c => c.close);
  const maArr  = ti.SMA.calculate({ values: closes, period });
  return maArr.map((ma, i) => ({ openTime: candles[period - 1 + i].openTime, ma }));
}

function maAt(maSeries, time) {
  let best = null;
  for (const point of maSeries) {
    if (point.openTime <= time) best = point.ma;
    else break;
  }
  return best;
}

function maSnapAt(cMap, config, openTime) {
  const snap = {};
  const add = (key, period, interval) => {
    const candles = (cMap[interval] ?? []).filter(c => c.openTime <= openTime);
    if (!candles.length) return;
    const series = computeMaSeries(candles, period);
    snap[key] = { ma: maAt(series, openTime), candles, period, interval };
  };
  for (const f of config.maFilters ?? []) {
    add(maKey(f.period, f.interval), f.period, f.interval);
  }
  if (config.extension?.enabled) {
    const iv = config.extension.maInterval;
    const p  = config.extension.maPeriod ?? 50;
    if (!snap[maKey(p, iv)]) add(maKey(p, iv), p, iv);
  }
  const sl = config.stopLoss;
  if (sl?.enabled !== false && sl) {
    add(`sl_${maKey(sl.period, sl.interval)}`, sl.period, sl.interval);
  }
  return snap;
}

/** Simula compra imediata no candle de entrada até saída por RSI ou stop MA */
function simulateForwardTrade(entryIdx, entrySeries, exitSeries, cMap, config, adaptiveDips) {
  const entry = entrySeries[entryIdx];
  const buyPrice = entry.close;

  for (let j = entryIdx + 1; j < entrySeries.length; j++) {
    const { openTime, close } = entrySeries[j];
    const exitRsi    = exitRsiAt(exitSeries, openTime);
    const maSnap     = maSnapAt(cMap, config, openTime);
    const stopLossMa = getStopLossMa(maSnap, config);
    const exitEval   = evaluateExit({ close, exitRsi, stopLossMa, config });

    if (exitEval.exit) {
      const pnlPct = ((close - buyPrice) / buyPrice) * 100;
      return {
        exitTime: openTime,
        exitPrice: close,
        exitRsi,
        exitReason: exitEval.reason,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        barsHeld: j - entryIdx,
        closed: true,
      };
    }
  }

  const last = entrySeries[entrySeries.length - 1];
  const pnlPct = ((last.close - buyPrice) / buyPrice) * 100;
  return {
    exitTime: last.openTime,
    exitPrice: last.close,
    exitRsi: exitRsiAt(exitSeries, last.openTime),
    exitReason: 'OPEN',
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    barsHeld: entrySeries.length - 1 - entryIdx,
    closed: false,
  };
}

/**
 * Analisa sinais em zona de extensão acima da MA.
 * @returns {{ signals, summary }}
 */
function analyzeExtensionHistory(cMap, config) {
  const entryCandles = cMap[config.entryRsi.interval];
  const exitCandles  = cMap[config.exitRsi.interval];
  if (!entryCandles?.length) return { signals: [], summary: null };

  const entrySeries = computeRsiSeries(entryCandles, config.entryRsi.period);
  const exitSeries  = config.entryRsi.interval === config.exitRsi.interval &&
    config.entryRsi.period === config.exitRsi.period
    ? entrySeries
    : computeRsiSeries(exitCandles, config.exitRsi.period);

  const adaptiveDips = computeAdaptiveDips(cMap, config);
  const signals      = [];

  for (let i = 0; i < entrySeries.length; i++) {
    const { openTime, close, rsi: entryRsi } = entrySeries[i];
    if (!checkRsi(entryRsi, config.entryRsi)) continue;

    const maSnap = maSnapAt(cMap, config, openTime);

    // RSI ok — checa MA (sem extensão ainda)
    const withoutExt = { ...config, extension: { ...config.extension, enabled: false } };
    const baseCheck = evaluateEntry({
      entryRsi, close, entryTimeMs: openTime, config: withoutExt, maSnap, adaptiveDips, cMap,
    });
    if (!baseCheck.allowed) continue;

    const extIv  = config.extension?.maInterval ?? '1h';
    const extP   = config.extension?.maPeriod ?? 50;
    const extKey = maKey(extP, extIv);
    const md     = maSnap[extKey];
    if (!md?.ma) continue;

    const { threeInterval, fourInterval } = getExtensionIntervals(config.extension);
    const extAnalysis = analyzeExtension(close, md.ma, {
      three: cMap[threeInterval],
      four:  cMap[fourInterval],
    }, config.extension, openTime);
    if (!extAnalysis.extended) continue;

    const forward = simulateForwardTrade(i, entrySeries, exitSeries, cMap, config, adaptiveDips);

    const confirmed = extAnalysis.allowed;

    signals.push({
      entryTime: openTime,
      entryPrice: close,
      entryRsi,
      aboveMaPct: parseFloat(extAnalysis.aboveMaPct.toFixed(2)),
      threeOk: extAnalysis.threeOk,
      fourOk: extAnalysis.fourOk,
      confirmed,
      blocked: !confirmed,
      ...forward,
      outcome: classifyExtensionOutcome(confirmed, forward.pnlPct),
    });
  }

  const confirmed = signals.filter(s => s.confirmed);
  const blocked   = signals.filter(s => s.blocked);
  const saved     = blocked.filter(s => s.outcome === 'BLOCKED_SAVED');
  const missed    = blocked.filter(s => s.outcome === 'BLOCKED_MISSED');

  const avg = arr => arr.length
    ? parseFloat((arr.reduce((s, x) => s + x.pnlPct, 0) / arr.length).toFixed(2))
    : null;

  const summary = {
    totalExtendedSignals: signals.length,
    confirmed: {
      count: confirmed.length,
      wins:  confirmed.filter(s => s.pnlPct >= 0).length,
      losses: confirmed.filter(s => s.pnlPct < 0).length,
      avgPnlPct: avg(confirmed),
    },
    blocked: {
      count: blocked.length,
      saved: saved.length,
      missed: missed.length,
      avgPnlIfEntered: avg(blocked),
      avgSavedPnl: avg(saved),
      avgMissedPnl: avg(missed),
    },
    netBenefitPct: saved.reduce((s, x) => s + Math.abs(x.pnlPct), 0)
      - missed.reduce((s, x) => s + x.pnlPct, 0),
  };

  return { signals, summary };
}

function classifyExtensionOutcome(confirmed, pnlPct) {
  if (confirmed) return pnlPct >= 0 ? 'CONFIRMED_WIN' : 'CONFIRMED_LOSS';
  return pnlPct < 0 ? 'BLOCKED_SAVED' : 'BLOCKED_MISSED';
}

function formatTs(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function printExtensionReport(symbol, config, { signals, summary }) {
  const ext = config.extension ?? {};
  console.log(`\n${'─'.repeat(68)}`);
  console.log(`🕯️  Teste extensão 3/4 candles: ${symbol}`);
  console.log(`   MA${ext.maPeriod ?? 50}(${ext.maInterval ?? '1h'})  limiar +${ext.abovePct ?? 5}%`);
  const { threeInterval, fourInterval } = getExtensionIntervals(ext);
  console.log(`   Regra 3: ${ext.threeCandles ? 'sim' : 'não'} (${threeInterval})  |  Regra 4: ${ext.fourCandles ? 'sim' : 'não'} (${fourInterval})  |  Lógica: ${ext.confirmLogic ?? 'any'}`);

  if (!summary || !signals.length) {
    console.log('\n   Nenhum sinal RSI+MA na zona de extensão no histórico.');
    return;
  }

  const s = summary;
  console.log(`\n   Sinais esticados acima da MA: ${s.totalExtendedSignals}`);
  console.log(`\n   ✅ Entradas CONFIRMADAS (3/4 OK → teria entrado): ${s.confirmed.count}`);
  console.log(`      Wins: ${s.confirmed.wins}  Losses: ${s.confirmed.losses}  PnL médio: ${s.confirmed.avgPnlPct ?? '—'}%`);

  console.log(`\n   🚫 Entradas BLOQUEADAS (3/4 falhou → entrada NÃO realizada): ${s.blocked.count}`);
  console.log(`      Salvaram o trade (teria perdido): ${s.blocked.saved}  PnL médio evitado: ${s.blocked.avgSavedPnl ?? '—'}%`);
  console.log(`      Oportunidade perdida (teria ganho): ${s.blocked.missed}  PnL médio: ${s.blocked.avgMissedPnl ?? '—'}%`);
  console.log(`      Benefício líquido estimado das regras: ${s.netBenefitPct.toFixed(2)}% (soma dos losses evitados − gains perdidos)`);

  const show = (list, title) => {
    if (!list.length) return;
    console.log(`\n   ${title}`);
    for (const sig of list.slice(-8)) {
      const flags = [sig.threeOk ? '3✓' : '3✗', sig.fourOk ? '4✓' : '4✗'].join(' ');
      const pnl   = `${sig.pnlPct >= 0 ? '+' : ''}${sig.pnlPct}%`;
      console.log(
        `     ${formatTs(sig.entryTime).padEnd(20)}  +${sig.aboveMaPct}% MA  ${flags}  ` +
        `→ ${pnl}  (${sig.exitReason}${sig.closed ? '' : ', aberto'})`,
      );
    }
    if (list.length > 8) console.log(`     … +${list.length - 8} sinais`);
  };

  show(signals.filter(x => x.outcome === 'CONFIRMED_WIN'),  '── Últimas entradas confirmadas vencedoras ──');
  show(signals.filter(x => x.outcome === 'CONFIRMED_LOSS'), '── Últimas entradas confirmadas perdedoras ──');
  show(signals.filter(x => x.outcome === 'BLOCKED_SAVED'),  '── Bloqueios que SALVARAM (entrada não realizada) ──');
  show(signals.filter(x => x.outcome === 'BLOCKED_MISSED'),  '── Bloqueios que PERDERAM oportunidade ──');
  console.log('─'.repeat(68));
}

module.exports = {
  analyzeExtensionHistory,
  printExtensionReport,
  simulateForwardTrade,
  classifyExtensionOutcome,
  computeRsiSeries,
  exitRsiAt,
  maSnapAt,
};
