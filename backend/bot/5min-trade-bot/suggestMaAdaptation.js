'use strict';

/**
 * Sugere calibragem % (tolerância abaixo da MA) por moeda.
 * 1) Episódios de dip abaixo da MA (mesma lógica Multi-Trade adaptativo)
 * 2) Sweep no histórico 5m com simulação do bot (RSI + DCA + MA)
 */

const { scoreTrades, pickBestSweep } = require('../amap/entrySuggestShared');
const { suggestMaTolerance, normalizeMaFilters } = require('./maFilter');
const {
  computeRsiSeries,
  simulate5mTrades,
  makeSimContext,
  COOLDOWN_CANDLES,
  RSI_PERIOD,
} = require('./suggest5mRsi');

const SWEEP_TOLERANCES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
const MIN_TRADES       = 2;

function buildToleranceSweepCandidates(dipPct) {
  const values = new Set(SWEEP_TOLERANCES);
  if (dipPct != null && Number.isFinite(dipPct)) values.add(parseFloat(Number(dipPct).toFixed(1)));
  return [...values].sort((a, b) => a - b);
}

function suggestFilterMaAdaptation(cMap, filter, fullMaCfg, rsiBuy, rsiSell) {
  const candles = cMap[filter.interval];
  const dipAnalysis = suggestMaTolerance(candles, filter.period, filter.interval);
  const dipPct      = dipAnalysis.suggestedTolerancePct;
  const anchorTol   = filter.tolerancePct ?? 0;

  const series = computeRsiSeries(cMap['5m'] ?? [], RSI_PERIOD);
  if (series.length < 50) {
    return {
      filterId: filter.id,
      period: filter.period,
      interval: filter.interval,
      label: `MA${filter.period} ${filter.interval}`,
      mode: filter.mode,
      currentTolerancePct: anchorTol,
      recommendedTolerancePct: dipPct,
      suggestedTolerancePct: dipPct,
      dipSuggestedPct: dipPct,
      recommendation: 'padrao',
      reason: 'candles 5m insuficientes — usando dip padrão',
      usedDefault: true,
      dipAnalysis,
      sweep: [],
      ...dipAnalysis,
    };
  }

  const sweep = [];
  for (const tolerancePct of buildToleranceSweepCandidates(dipPct)) {
    const testCfg = {
      ...fullMaCfg,
      filters: fullMaCfg.filters.map(f =>
        (f.id === filter.id ? { ...f, tolerancePct } : f),
      ),
    };
    const simCtx = makeSimContext(cMap, testCfg);
    const { trades, blockedByMa, rsiBuySignals } = simulate5mTrades(
      series, rsiBuy, rsiSell, COOLDOWN_CANDLES, simCtx,
    );
    sweep.push({
      tolerancePct,
      blockedByMa,
      rsiBuySignals,
      maPassRate: rsiBuySignals
        ? parseFloat((((rsiBuySignals - blockedByMa) / rsiBuySignals) * 100).toFixed(1))
        : null,
      ...scoreTrades(trades),
    });
  }

  const { best: botBest, usedDefault: sweepDefault } = pickBestSweep(
    sweep, 'tolerancePct', anchorTol, { minTrades: MIN_TRADES },
  );

  let recommendedTolerancePct = dipPct;
  let recommendation = 'dip_historico';
  let reason = null;

  if (!dipAnalysis.usedDefault) {
    reason = `${dipAnalysis.episodeCount} dips · média ${dipAnalysis.avgRaw}% abaixo da MA`;
    if (botBest?.avgPnl != null && botBest.tradeCount >= MIN_TRADES && !sweepDefault) {
      if (Math.abs(botBest.tolerancePct - dipPct) <= 1.5) {
        recommendedTolerancePct = parseFloat(((botBest.tolerancePct + dipPct) / 2).toFixed(1));
        recommendation = 'dip_e_bot';
        reason += ` · bot: ${botBest.tradeCount} trades PnL ${botBest.avgPnl}%`;
      } else if (botBest.tradeCount >= 3) {
        recommendedTolerancePct = botBest.tolerancePct;
        recommendation = 'otimizado_bot';
        reason = `Bot simulado: −${botBest.tolerancePct}% → ${botBest.tradeCount} trades · PnL méd. ${botBest.avgPnl}%`;
      }
    }
  } else {
    recommendation = 'padrao';
    reason = dipAnalysis.episodeCount
      ? `Poucos episódios (${dipAnalysis.episodeCount}) — padrão ${dipPct}%`
      : `Histórico curto — padrão ${dipPct}%`;
    if (botBest?.tradeCount >= MIN_TRADES && !sweepDefault) {
      recommendedTolerancePct = botBest.tolerancePct;
      recommendation = 'otimizado_bot';
      reason = `Sem dips suficientes · melhor no bot: −${botBest.tolerancePct}% (${botBest.tradeCount} trades)`;
    }
  }

  recommendedTolerancePct = Math.max(0, Math.min(8, parseFloat(Number(recommendedTolerancePct).toFixed(1))));

  const anchorRow       = sweep.find(s => s.tolerancePct === anchorTol);
  const recommendedRow  = sweep.find(s => s.tolerancePct === recommendedTolerancePct) ?? botBest ?? anchorRow;

  const REC_LABELS = {
    dip_historico:  'baseado nos dips históricos',
    dip_e_bot:        'média dip histórico + simulação bot',
    otimizado_bot:    'melhor PnL na simulação do bot',
    padrao:           'valor padrão (poucos dados)',
  };

  return {
    filterId: filter.id,
    period: filter.period,
    interval: filter.interval,
    mode: filter.mode,
    label: `MA${filter.period} ${filter.interval}`,
    currentTolerancePct: anchorTol,
    recommendedTolerancePct,
    suggestedTolerancePct: recommendedTolerancePct,
    dipSuggestedPct: dipPct,
    botBestTolerancePct: botBest?.tolerancePct ?? null,
    recommendation,
    recommendationLabel: REC_LABELS[recommendation] ?? recommendation,
    reason,
    usedDefault: dipAnalysis.usedDefault && sweepDefault,
    dipAnalysis,
    sweep,
    anchorStats: anchorRow ?? null,
    bestStats: recommendedRow ?? null,
    vsCurrent: anchorRow && recommendedTolerancePct !== anchorTol
      ? {
        toleranceDelta: parseFloat((recommendedTolerancePct - anchorTol).toFixed(1)),
        tradeDelta: (recommendedRow?.tradeCount ?? 0) - (anchorRow?.tradeCount ?? 0),
        pnlDelta: anchorRow?.avgPnl != null && recommendedRow?.avgPnl != null
          ? parseFloat((recommendedRow.avgPnl - anchorRow.avgPnl).toFixed(2))
          : null,
      }
      : null,
    episodeCount: dipAnalysis.episodeCount,
    avgRaw: dipAnalysis.avgRaw,
    entryOk: dipAnalysis.entryOk,
    dipNowPct: dipAnalysis.dipNowPct,
    floor: dipAnalysis.floor,
    currentMa: dipAnalysis.currentMa,
    currentPrice: dipAnalysis.currentPrice,
  };
}

function buildMaAdaptationReport(cMap, params = {}) {
  const maCfg  = normalizeMaFilters(params.maFilters);
  const rsiBuy = Number(params.rsiBuy ?? 30);
  const rsiSell = Number(params.rsiSell ?? 70);

  if (!maCfg.enabled) {
    return {
      enabled: false,
      filters: [],
      maToleranceSuggestions: [],
      summary: 'Filtro MA desligado',
    };
  }

  const active = maCfg.filters.filter(f => f.enabled && f.mode === 'above');
  if (!active.length) {
    return {
      enabled: true,
      filters: [],
      maToleranceSuggestions: [],
      summary: 'Nenhum filtro MA “acima” ativo',
    };
  }

  const filters = active.map(f => suggestFilterMaAdaptation(cMap, f, maCfg, rsiBuy, rsiSell));

  const parts = filters.map(f => {
    const chg = f.recommendedTolerancePct !== f.currentTolerancePct
      ? `sugerido −${f.recommendedTolerancePct}% (atual ${f.currentTolerancePct}%)`
      : `−${f.recommendedTolerancePct}% adequado`;
    return `${f.label}: ${chg}`;
  });

  return {
    enabled: true,
    rsiBuy,
    rsiSell,
    filters,
    maToleranceSuggestions: filters,
    summary: parts.join(' · '),
  };
}

module.exports = {
  buildMaAdaptationReport,
  suggestFilterMaAdaptation,
  SWEEP_TOLERANCES,
};
