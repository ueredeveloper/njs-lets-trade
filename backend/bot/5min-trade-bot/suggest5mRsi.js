'use strict';

/**
 * Sugere RSI de entrada e saída para o bot 5m a partir do histórico 5m.
 * Simula a estratégia real: compra RSI < X, DCA com cooldown 2h, venda RSI > Y.
 */

const ti = require('technicalindicators');
const { pickBestSweep, scoreTrades, percentile } = require('../amap/entrySuggestShared');
const {
  normalizeMaFilters, buildMaLookupMap, passesMaFilters, describeMaFilters,
} = require('./maFilter');

const INTERVAL           = '5m';
const RSI_PERIOD         = 14;
const COOLDOWN_CANDLES   = 24; // 2h em candles de 5m
const DEFAULT_ENTRY      = 30;
const DEFAULT_EXIT       = 70;
const MIN_TRADES         = 3;
const RECOVER_ABOVE      = 5; // RSI precisa subir X pontos para encerrar episódio de sobrevenda

const DEFAULT_OPTS = {
  anchorEntry: DEFAULT_ENTRY,
  anchorExit:  DEFAULT_EXIT,
  minTrades:   MIN_TRADES,
  entryStep:   2,
  entrySpan:   10,
  minEntry:    20,
  maxEntry:    40,
  minExit:     65,
  maxExit:     85,
  exitStep:    2,
  candleLimit: 2500,
};

function computeRsiSeries(candles, period = RSI_PERIOD) {
  const closes = candles.map(c => c.close);
  const rsiArr = ti.RSI.calculate({ values: closes, period });
  return rsiArr.map((rsi, i) => ({
    openTime: candles[period + i].openTime,
    close:    candles[period + i].close,
    rsi,
  }));
}

/** Episódios distintos em que RSI cai abaixo do limiar (recupera acima limiar+5). */
function countEpisodesBelow(series, threshold) {
  let episodes = 0;
  let inEpisode = false;
  const recover = threshold + RECOVER_ABOVE;

  for (const pt of series) {
    if (pt.rsi == null) continue;
    if (!inEpisode && pt.rsi < threshold) {
      episodes++;
      inEpisode = true;
    } else if (inEpisode && pt.rsi > recover) {
      inEpisode = false;
    }
  }
  return episodes;
}

/** Episódios de sobrevenda que gerariam entrada com os filtros MA ativos. */
function countEpisodesBelowWithMa(series, threshold, simCtx) {
  if (!simCtx?.maFilters?.enabled) return countEpisodesBelow(series, threshold);

  const { maLookup, maFilters } = simCtx;
  let episodes = 0;
  let inEpisode = false;
  const recover = threshold + RECOVER_ABOVE;

  for (const pt of series) {
    if (pt.rsi == null) continue;
    if (!inEpisode && pt.rsi < threshold) {
      const maPass = passesMaFilters(pt.close, pt.openTime, maLookup, maFilters);
      if (maPass.ok) {
        episodes++;
        inEpisode = true;
      }
    } else if (inEpisode && pt.rsi > recover) {
      inEpisode = false;
    }
  }
  return episodes;
}

function countMaQualifiedBuySignals(series, threshold, simCtx) {
  if (!simCtx?.maFilters?.enabled) return null;
  const { maLookup, maFilters } = simCtx;
  let count = 0;
  for (const pt of series) {
    if (pt.rsi == null || pt.rsi >= threshold) continue;
    if (passesMaFilters(pt.close, pt.openTime, maLookup, maFilters).ok) count++;
  }
  return count;
}

function effectiveMinTrades(opts, simCtx) {
  const maOn = simCtx?.maFilters?.enabled &&
    simCtx.maFilters.filters.some(f => f.enabled);
  return maOn ? Math.min(opts.minTrades, 2) : opts.minTrades;
}

function pickBestSweepFor5m(sweep, anchorKey, anchorValue, opts, simCtx) {
  const minTrades = effectiveMinTrades(opts, simCtx);
  const result = pickBestSweep(sweep, anchorKey, anchorValue, { ...opts, minTrades });
  if (!result.usedDefault || !simCtx?.maFilters?.enabled) return result;

  const partial = sweep
    .filter(s => s.tradeCount >= 1 && s.avgPnl != null)
    .sort((a, b) => {
      if (b.avgPnl !== a.avgPnl) return b.avgPnl - a.avgPnl;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.tradeCount - a.tradeCount;
    });
  if (!partial.length) return result;

  return {
    best: partial[0],
    usedDefault: false,
    reason: 'poucos_trades_ma',
    lowSample: true,
  };
}

function buildEntryCandidates(anchor, opts) {
  const values = new Set([anchor]);
  for (let d = -opts.entrySpan; d <= opts.entrySpan; d += opts.entryStep) {
    values.add(anchor + d);
  }
  return [...values]
    .filter(v => v >= opts.minEntry && v <= opts.maxEntry)
    .sort((a, b) => a - b);
}

function buildExitCandidates(anchor, opts) {
  const values = new Set([anchor]);
  for (let d = -8; d <= 12; d += opts.exitStep) {
    values.add(anchor + d);
  }
  return [...values]
    .filter(v => v >= opts.minExit && v <= opts.maxExit)
    .sort((a, b) => a - b);
}

/**
 * Simula round-trips com DCA (cooldown em candles) + filtros MA opcionais.
 */
function simulate5mTrades(series, entryRsi, exitRsi, cooldownCandles = COOLDOWN_CANDLES, simCtx = null) {
  const trades = [];
  let inPosition   = false;
  let lastBuyIdx   = -Infinity;
  let avgBuyPrice  = 0;
  let buyCount     = 0;
  let peakRsi      = 0;
  let minRsiInTrade = 100;
  let rsiBuySignals = 0;
  let blockedByMa   = 0;

  const maLookup  = simCtx?.maLookup ?? {};
  const maFilters = simCtx?.maFilters ?? { enabled: false, filters: [] };

  for (let i = 0; i < series.length; i++) {
    const { rsi, close, openTime } = series[i];
    if (rsi == null) continue;

    if (inPosition) {
      peakRsi = Math.max(peakRsi, rsi);
      minRsiInTrade = Math.min(minRsiInTrade, rsi);
    }

    if (inPosition && rsi > exitRsi) {
      const pnlPct = ((close - avgBuyPrice) / avgBuyPrice) * 100;
      trades.push({
        pnlPct:      parseFloat(pnlPct.toFixed(2)),
        buyCount,
        peakExitRsi: parseFloat(peakRsi.toFixed(2)),
        minEntryRsi: parseFloat(minRsiInTrade.toFixed(2)),
        entryRsi,
        exitRsi,
      });
      inPosition = false;
      buyCount = 0;
      peakRsi = 0;
      minRsiInTrade = 100;
      continue;
    }

    if (rsi < entryRsi) {
      rsiBuySignals++;
      const maPass = passesMaFilters(close, openTime, maLookup, maFilters);
      if (!maPass.ok) {
        blockedByMa++;
        continue;
      }
      const canBuy = !inPosition || (i - lastBuyIdx >= cooldownCandles);
      if (canBuy) {
        if (!inPosition) {
          avgBuyPrice = close;
          buyCount = 1;
          inPosition = true;
          peakRsi = rsi;
          minRsiInTrade = rsi;
        } else {
          avgBuyPrice = (avgBuyPrice * buyCount + close) / (buyCount + 1);
          buyCount++;
          minRsiInTrade = Math.min(minRsiInTrade, rsi);
        }
        lastBuyIdx = i;
      }
    }
  }

  return { trades, rsiBuySignals, blockedByMa };
}

function hitRate(peaks, threshold) {
  if (!peaks.length) return 0;
  return peaks.filter(p => p >= threshold).length / peaks.length;
}

/** Movimentos simples: RSI cruza abaixo de entrada até cruzar acima de saída (% de alta no preço). */
function collectSwingMoves(series, entryRsi, exitRsi, simCtx = null) {
  const moves = [];
  let armed = false;
  let entryPrice = 0;
  let entryIdx = 0;
  let minRsi = 100;
  let rsiBuySignals = 0;
  let blockedByMa   = 0;

  const maLookup  = simCtx?.maLookup ?? {};
  const maFilters = simCtx?.maFilters ?? { enabled: false, filters: [] };

  for (let i = 0; i < series.length; i++) {
    const { rsi, close, openTime } = series[i];
    if (rsi == null) continue;

    if (!armed && rsi < entryRsi) {
      rsiBuySignals++;
      const maPass = passesMaFilters(close, openTime, maLookup, maFilters);
      if (!maPass.ok) {
        blockedByMa++;
        continue;
      }
      armed = true;
      entryPrice = close;
      entryIdx = i;
      minRsi = rsi;
    } else if (armed) {
      minRsi = Math.min(minRsi, rsi);
      if (rsi > exitRsi) {
        const candles = i - entryIdx;
        const risePct = ((close - entryPrice) / entryPrice) * 100;
        moves.push({
          risePct:   parseFloat(risePct.toFixed(2)),
          candles,
          hours:     parseFloat((candles * 5 / 60).toFixed(1)),
          minRsi:    parseFloat(minRsi.toFixed(2)),
          exitRsi:   parseFloat(rsi.toFixed(2)),
        });
        armed = false;
      }
    }
  }

  return { moves, openArmed: armed, rsiBuySignals, blockedByMa };
}

function pctStats(values) {
  if (!values.length) {
    return { count: 0, avgPct: null, medianPct: null, minPct: null, maxPct: null, winRate: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const wins   = values.filter(v => v > 0).length;
  return {
    count:     values.length,
    avgPct:    parseFloat((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)),
    medianPct: percentile(sorted, 0.5),
    p25Pct:    percentile(sorted, 0.25),
    p75Pct:    percentile(sorted, 0.75),
    minPct:    parseFloat(sorted[0].toFixed(2)),
    maxPct:    parseFloat(sorted[sorted.length - 1].toFixed(2)),
    winRate:   parseFloat(((wins / values.length) * 100).toFixed(1)),
  };
}

function bucketRiseDistribution(pnls) {
  const buckets = [
    { label: 'perda',   min: -Infinity, max: 0 },
    { label: '0–1%',    min: 0, max: 1 },
    { label: '1–2%',    min: 1, max: 2 },
    { label: '2–4%',    min: 2, max: 4 },
    { label: '4–8%',    min: 4, max: 8 },
    { label: '>8%',     min: 8, max: Infinity },
  ];
  return buckets.map(b => {
    const count = pnls.filter(p => p >= b.min && p < b.max).length;
    return {
      label: b.label,
      count,
      sharePct: pnls.length ? parseFloat(((count / pnls.length) * 100).toFixed(1)) : 0,
    };
  }).filter(b => b.count > 0);
}

function maStatsExtras(rsiBuySignals, blockedByMa, maFilters) {
  if (!maFilters?.enabled) return {};
  return {
    rsiBuySignals,
    blockedByMa,
    maPassRate: rsiBuySignals
      ? parseFloat((((rsiBuySignals - blockedByMa) / rsiBuySignals) * 100).toFixed(1))
      : null,
  };
}

/** Padrão de alta % para o par RSI entrada/saída escolhido pelo usuário. */
function analyzeSwingPattern(series, entryRsi, exitRsi, simCtx = null) {
  const { moves, openArmed, rsiBuySignals, blockedByMa } = collectSwingMoves(series, entryRsi, exitRsi, simCtx);
  const rises = moves.map(m => m.risePct);
  const stats = pctStats(rises);
  const hours = moves.map(m => m.hours).sort((a, b) => a - b);

  return {
    entryRsi,
    exitRsi,
    label: `RSI < ${entryRsi} → > ${exitRsi}`,
    ...stats,
    avgHours: hours.length
      ? parseFloat((hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(1))
      : null,
    medianHours: hours.length ? percentile(hours, 0.5) : null,
    distribution: bucketRiseDistribution(rises),
    incompleteOpen: openArmed,
    recentMoves: moves.slice(-6).reverse(),
    ...maStatsExtras(rsiBuySignals, blockedByMa, simCtx?.maFilters),
  };
}

/** Simulação completa do bot (com DCA 2h) para o par escolhido. */
function analyzeBotSimulation(series, entryRsi, exitRsi, simCtx = null) {
  const { trades, rsiBuySignals, blockedByMa } = simulate5mTrades(series, entryRsi, exitRsi, COOLDOWN_CANDLES, simCtx);
  const pnls   = trades.map(t => t.pnlPct);
  const stats  = pctStats(pnls);
  const peaks  = trades.map(t => t.peakExitRsi).sort((a, b) => a - b);

  return {
    entryRsi,
    exitRsi,
    label: `Bot RSI < ${entryRsi} → > ${exitRsi} (DCA 2h)`,
    ...stats,
    avgPeakRsi: peaks.length
      ? parseFloat((peaks.reduce((s, p) => s + p, 0) / peaks.length).toFixed(1))
      : null,
    medianPeakRsi: percentile(peaks, 0.5),
    distribution: bucketRiseDistribution(pnls),
    dcaAvgBuys: trades.length
      ? parseFloat((trades.reduce((s, t) => s + t.buyCount, 0) / trades.length).toFixed(1))
      : null,
    recentTrades: trades.slice(-6).reverse().map(t => ({
      pnlPct: t.pnlPct,
      buyCount: t.buyCount,
      peakExitRsi: t.peakExitRsi,
      minEntryRsi: t.minEntryRsi,
    })),
    ...maStatsExtras(rsiBuySignals, blockedByMa, simCtx?.maFilters),
  };
}

function makeSimContext(cMap, maFilters) {
  const cfg = normalizeMaFilters(maFilters);
  return { maFilters: cfg, maLookup: buildMaLookupMap(cMap, cfg) };
}

function sweepEntry(series, exitRsi, opts, simCtx) {
  const candidates = buildEntryCandidates(opts.anchorEntry, opts);
  const sweep = [];
  const maOn = simCtx?.maFilters?.enabled &&
    simCtx.maFilters.filters.some(f => f.enabled);
  const countEpisodes = maOn
    ? (v) => countEpisodesBelowWithMa(series, v, simCtx)
    : (v) => countEpisodesBelow(series, v);

  for (const value of candidates) {
    const { trades, rsiBuySignals, blockedByMa } = simulate5mTrades(
      series, value, exitRsi, COOLDOWN_CANDLES, simCtx,
    );
    sweep.push({
      value,
      label: `RSI < ${value}`,
      episodes: countEpisodes(value),
      rsiBuySignals,
      blockedByMa,
      maPassRate: maOn && rsiBuySignals
        ? parseFloat((((rsiBuySignals - blockedByMa) / rsiBuySignals) * 100).toFixed(1))
        : null,
      ...scoreTrades(trades),
    });
  }

  const { best, usedDefault, reason, lowSample } = pickBestSweepFor5m(
    sweep, 'value', opts.anchorEntry, opts, simCtx,
  );
  const anchorRow = sweep.find(s => s.value === opts.anchorEntry);

  let recommendation = 'manter';
  if (!usedDefault && best?.value !== opts.anchorEntry) {
    recommendation = best.value > opts.anchorEntry ? 'mais_flexivel' : 'mais_estrito';
  }

  const frequency = candidates.map(value => {
    const maSignals = countMaQualifiedBuySignals(series, value, simCtx);
    const denom = maOn && maSignals != null ? maSignals : series.length;
    const below = maOn && maSignals != null
      ? maSignals
      : series.filter(p => p.rsi != null && p.rsi < value).length;
    return {
      value,
      episodes: countEpisodes(value),
      maQualifiedSignals: maSignals,
      pctCandles: denom
        ? parseFloat(((below / denom) * 100).toFixed(1))
        : 0,
    };
  });
  const mostFrequent = [...frequency].sort((a, b) => b.episodes - a.episodes)[0];

  return {
    suggestedEntryRsi: best?.value ?? opts.anchorEntry,
    anchorValue: opts.anchorEntry,
    usedDefault,
    reason,
    lowSample: lowSample === true,
    recommendation,
    sweep,
    anchorStats: anchorRow ?? null,
    bestStats: best,
    frequency,
    mostFrequentEpisode: mostFrequent,
    maFiltered: maOn,
    vsAnchor: anchorRow && best && best.value !== opts.anchorEntry
      ? {
        pnlDelta:    parseFloat((best.avgPnl - anchorRow.avgPnl).toFixed(2)),
        tradeDelta:  best.tradeCount - anchorRow.tradeCount,
        episodeDelta: best.episodes - anchorRow.episodes,
      }
      : null,
  };
}

function sweepExit(series, entryRsi, opts, simCtx) {
  const candidates = buildExitCandidates(opts.anchorExit, opts);
  const { trades: baseTrades } = simulate5mTrades(
    series, entryRsi, opts.anchorExit, COOLDOWN_CANDLES, simCtx,
  );
  const peaks = baseTrades.map(t => t.peakExitRsi).sort((a, b) => a - b);
  const maOn = simCtx?.maFilters?.enabled &&
    simCtx.maFilters.filters.some(f => f.enabled);

  const sweep = [];
  for (const value of candidates) {
    const { trades, rsiBuySignals, blockedByMa } = simulate5mTrades(
      series, entryRsi, value, COOLDOWN_CANDLES, simCtx,
    );
    const reached = trades.length;
    const rate = reached ? trades.filter(t => t.peakExitRsi >= value).length / reached : 0;
    sweep.push({
      value,
      label: `RSI > ${value}`,
      hitRatePct: parseFloat((rate * 100).toFixed(1)),
      rsiBuySignals,
      blockedByMa,
      ...scoreTrades(trades),
    });
  }

  const minTrades = effectiveMinTrades(opts, simCtx);
  const viable = sweep.filter(s => s.tradeCount >= minTrades && s.avgPnl != null);
  let best = viable.sort((a, b) => {
    if (b.avgPnl !== a.avgPnl) return b.avgPnl - a.avgPnl;
    return b.hitRatePct - a.hitRatePct;
  })[0];

  if (!best && maOn) {
    best = sweep
      .filter(s => s.tradeCount >= 1 && s.avgPnl != null)
      .sort((a, b) => {
        if (b.avgPnl !== a.avgPnl) return b.avgPnl - a.avgPnl;
        return b.hitRatePct - a.hitRatePct;
      })[0];
  }

  const medianPeak = percentile(peaks, 0.5);
  const avgPeak    = peaks.length
    ? parseFloat((peaks.reduce((s, p) => s + p, 0) / peaks.length).toFixed(1))
    : null;
  const p75Peak    = percentile(peaks, 0.75);

  let fromMedian = medianPeak != null ? Math.round(medianPeak - 1) : opts.anchorExit;
  const rate75 = hitRate(peaks, 75);
  const rate70 = hitRate(peaks, 70);

  if (rate75 < 0.35) fromMedian = Math.min(fromMedian, 72);
  if (rate70 > 0.8 && medianPeak != null && medianPeak < 73) {
    fromMedian = Math.max(opts.minExit, Math.round(medianPeak - 2));
  }

  let suggested = best?.avgPnl != null && best.avgPnl > -Infinity
    ? Math.round((best.value + fromMedian) / 2)
    : fromMedian;
  suggested = Math.max(opts.minExit, Math.min(opts.maxExit, suggested));

  const usedDefault = !best;
  const anchorRow   = sweep.find(s => s.value === opts.anchorExit);
  const lowSample   = maOn && best && baseTrades.length < opts.minTrades;

  let recommendation = 'moderado';
  if (rate75 >= 0.5) recommendation = 'chega_alto';
  else if (rate70 >= 0.6) recommendation = 'garantir_cedo';

  return {
    suggestedExitRsi: usedDefault ? opts.anchorExit : suggested,
    anchorValue: opts.anchorExit,
    usedDefault,
    reason: usedDefault ? (baseTrades.length ? 'poucos_trades' : 'sem_trades') : (lowSample ? 'poucos_trades_ma' : null),
    lowSample: lowSample === true,
    recommendation,
    tradeCount: baseTrades.length,
    maFiltered: maOn,
    medianPeakRsi: medianPeak,
    avgPeakRsi: avgPeak,
    p75PeakRsi: p75Peak,
    hitRate70: parseFloat((hitRate(peaks, 70) * 100).toFixed(1)),
    hitRate75: parseFloat((hitRate(peaks, 75) * 100).toFixed(1)),
    hitRate80: parseFloat((hitRate(peaks, 80) * 100).toFixed(1)),
    sweep,
    anchorStats: anchorRow ?? null,
    bestStats: best ?? anchorRow,
    entryRsiUsed: entryRsi,
  };
}

function build5mRsiReport(candles, opts = {}, cMap = null) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const fullMap = cMap ?? { '5m': candles };
  if (!fullMap['5m']) fullMap['5m'] = candles;
  const simCtx = makeSimContext(fullMap, o.maFilters);
  const maDesc   = describeMaFilters(simCtx.maFilters);
  const { buildMaAdaptationReport } = require('./suggestMaAdaptation');
  const maAdaptReport = buildMaAdaptationReport(fullMap, {
    maFilters: simCtx.maFilters,
    rsiBuy: o.anchorEntry,
    rsiSell: o.anchorExit,
  });
  const maToleranceSuggestions = maAdaptReport.filters;
  const maAdaptSummary         = maAdaptReport.summary;

  const series = computeRsiSeries(candles, RSI_PERIOD);
  if (series.length < 50) {
    return {
      interval: INTERVAL,
      period: RSI_PERIOD,
      candleCount: series.length,
      error: 'candles_insuficientes',
      maFilters: simCtx.maFilters,
      maDescription: maDesc,
      maToleranceSuggestions,
      maAdaptSummary,
      customEntry: o.anchorEntry,
      customExit: o.anchorExit,
      swingPattern:  { entryRsi: o.anchorEntry, exitRsi: o.anchorExit, count: 0 },
      botSimulation: { entryRsi: o.anchorEntry, exitRsi: o.anchorExit, count: 0 },
      entry: { suggestedEntryRsi: o.anchorEntry, usedDefault: true, reason: 'candles_insuficientes' },
      exit:  { suggestedExitRsi: o.anchorExit, usedDefault: true, reason: 'candles_insuficientes' },
    };
  }

  const rsiNow = series[series.length - 1].rsi;

  const swingPattern  = analyzeSwingPattern(series, o.anchorEntry, o.anchorExit, simCtx);
  const botSimulation = analyzeBotSimulation(series, o.anchorEntry, o.anchorExit, simCtx);
  const entryReport   = sweepEntry(series, o.anchorExit, o, simCtx);
  const exitReport    = sweepExit(series, entryReport.suggestedEntryRsi, o, simCtx);

  return {
    interval: INTERVAL,
    period: RSI_PERIOD,
    candleCount: series.length,
    cooldownHours: 2,
    rsiNow: rsiNow != null ? parseFloat(rsiNow.toFixed(2)) : null,
    customEntry: o.anchorEntry,
    customExit:  o.anchorExit,
    maFilters:   simCtx.maFilters,
    maDescription: maDesc,
    maToleranceSuggestions,
    maAdaptSummary,
    swingPattern,
    botSimulation,
    entry: entryReport,
    exit: exitReport,
    summary: buildSummary(entryReport, exitReport, swingPattern, botSimulation, o, maDesc),
  };
}

function buildSummary(entry, exit, swing, bot, opts, maDesc) {
  const parts = [];

  if (maDesc) parts.push(maDesc);

  if (swing.count > 0) {
    parts.push(
      `${swing.label}: ${swing.count} movimentos · alta média ${swing.avgPct >= 0 ? '+' : ''}${swing.avgPct}% · mediana ${swing.medianPct >= 0 ? '+' : ''}${swing.medianPct}% · win ${swing.winRate}%`,
    );
  } else {
    parts.push(`${swing.label}: nenhum movimento completo no histórico`);
  }

  if (bot.count > 0) {
    parts.push(
      `Bot simulado: ${bot.count} trades · PnL méd. ${bot.avgPct >= 0 ? '+' : ''}${bot.avgPct}% · win ${bot.winRate}%`,
    );
  } else if (bot.blockedByMa > 0) {
    parts.push(`Bot: ${bot.blockedByMa} sinais RSI bloqueados por MA`);
  }

  if (entry.mostFrequentEpisode && entry.mostFrequentEpisode.episodes > 0) {
    const mf = entry.mostFrequentEpisode;
    if (mf.value !== opts.anchorEntry) {
      parts.push(`Sobrevenda mais frequente: RSI < ${mf.value} (${mf.episodes} episódios)`);
    }
  }

  if (!entry.usedDefault && entry.suggestedEntryRsi !== opts.anchorEntry) {
    const maNote = entry.maFiltered ? ' (só entradas com MA OK)' : '';
    parts.push(
      entry.recommendation === 'mais_flexivel'
        ? `Entrada: RSI < ${entry.suggestedEntryRsi} captura mais sinais que < ${opts.anchorEntry}${maNote}`
        : `Entrada: RSI < ${entry.suggestedEntryRsi} filtra ruído vs < ${opts.anchorEntry}${maNote}`,
    );
  } else if (entry.usedDefault) {
    const maNote = entry.maFiltered ? ' com filtro MA' : '';
    parts.push(`Entrada: manter RSI < ${opts.anchorEntry} (poucos trades${maNote} no histórico)`);
  } else {
    const maNote = entry.maFiltered ? ' com filtro MA' : '';
    parts.push(`Entrada: RSI < ${opts.anchorEntry} é o melhor no histórico${maNote}`);
  }

  if (!exit.usedDefault && exit.suggestedExitRsi !== opts.anchorExit) {
    const maNote = exit.maFiltered ? ' (trades que entraram com MA OK)' : '';
    parts.push(
      exit.recommendation === 'chega_alto'
        ? `Saída: RSI > ${exit.suggestedExitRsi} — picos mediano ${exit.medianPeakRsi}, costuma passar de 75${maNote}`
        : `Saída: RSI > ${exit.suggestedExitRsi} — picos baixos, garantir antes de ${opts.anchorExit}${maNote}`,
    );
  } else if (exit.medianPeakRsi != null) {
    parts.push(`Saída: pico mediano ${exit.medianPeakRsi} (atinge 70: ${exit.hitRate70}%, 75: ${exit.hitRate75}%)`);
  }

  return parts.join(' · ');
}

module.exports = {
  build5mRsiReport,
  simulate5mTrades,
  collectSwingMoves,
  analyzeSwingPattern,
  analyzeBotSimulation,
  makeSimContext,
  countEpisodesBelow,
  countEpisodesBelowWithMa,
  countMaQualifiedBuySignals,
  effectiveMinTrades,
  pickBestSweepFor5m,
  computeRsiSeries,
  DEFAULT_OPTS,
  INTERVAL,
  RSI_PERIOD,
  COOLDOWN_CANDLES,
};
