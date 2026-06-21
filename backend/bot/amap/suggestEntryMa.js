'use strict';

/**
 * Sugere parâmetros de entrada por MA (toque/cruzamento, tolerância %, RSI combinado).
 */

const {
  collectEntryPathTrades,
  scoreTrades,
  buildRsiCandidates,
  buildToleranceCandidates,
  pickBestSweep,
} = require('./entrySuggestShared');

const DEFAULT_OPTS = {
  minTrades: 3,
  triggers: ['touch', 'cross_up'],
};

const TRIGGER_LABELS = {
  touch:    'Toque na MA',
  cross_up: 'Cruzamento ↑',
};

function suggestEntryMa(cMap, config, opts = {}) {
  const o  = { ...DEFAULT_OPTS, ...opts };
  const em = config.entryMa ?? {};
  const anchorTol = Number(em.tolerancePct ?? 0.5);
  const anchorTrigger = em.trigger ?? 'touch';

  const tolCandidates = buildToleranceCandidates(anchorTol);
  const sweepMain = [];

  for (const trigger of o.triggers) {
    for (const tolerancePct of tolCandidates) {
      const cfg = {
        ...config,
        entryRsiPath: { enabled: false },
        entryMa: {
          ...em,
          enabled: true,
          trigger,
          tolerancePct,
        },
      };
      const trades = collectEntryPathTrades(cMap, cfg, 'ma');
      sweepMain.push({
        trigger,
        triggerLabel: TRIGGER_LABELS[trigger] ?? trigger,
        tolerancePct,
        ...scoreTrades(trades),
      });
    }
  }

  const { best: bestMain, usedDefault: usedDefaultMain, reason: reasonMain } =
    pickBestSweep(sweepMain, 'tolerancePct', anchorTol, o);

  const anchorRow = sweepMain.find(s =>
    s.trigger === anchorTrigger && Math.abs(s.tolerancePct - anchorTol) < 0.01);

  let rsiSweep = null;
  let suggestedMaRsi = null;

  if (em.requireRsi && em.entryRsi) {
    const rsiRule = em.entryRsi;
    const anchorRsi = Number(rsiRule.value ?? 40);
    const rsiCandidates = buildRsiCandidates(anchorRsi, rsiRule.operator ?? '<', o);
    rsiSweep = [];

    for (const value of rsiCandidates) {
      const cfg = {
        ...config,
        entryRsiPath: { enabled: false },
        entryMa: {
          ...em,
          enabled: true,
          trigger: bestMain?.trigger ?? anchorTrigger,
          tolerancePct: bestMain?.tolerancePct ?? anchorTol,
          requireRsi: true,
          entryRsi: { ...rsiRule, value },
        },
      };
      const trades = collectEntryPathTrades(cMap, cfg, 'ma');
      rsiSweep.push({
        value,
        label: `RSI ${rsiRule.operator ?? '<'} ${value}`,
        ...scoreTrades(trades),
      });
    }

    const rsiPick = pickBestSweep(rsiSweep, 'value', anchorRsi, o);
    suggestedMaRsi = rsiPick.best?.value ?? anchorRsi;
  }

  return {
    suggestedTrigger: bestMain?.trigger ?? anchorTrigger,
    suggestedTolerancePct: bestMain?.tolerancePct ?? anchorTol,
    suggestedMaRsi,
    usedDefault: usedDefaultMain,
    reason: reasonMain,
    anchorTrigger,
    anchorTolerancePct: anchorTol,
    maPeriod: em.period ?? 50,
    maInterval: em.interval ?? '1h',
    requireRsi: !!em.requireRsi,
    sweep: sweepMain,
    rsiSweep,
    anchorStats: anchorRow ?? null,
    bestStats: bestMain,
    recommendation: !usedDefaultMain && bestMain && (
      bestMain.trigger !== anchorTrigger || Math.abs(bestMain.tolerancePct - anchorTol) > 0.01
    )
      ? (bestMain.trigger === 'cross_up' && anchorTrigger === 'touch'
        ? 'cruzamento_melhor'
        : bestMain.tolerancePct > anchorTol
          ? 'tolerancia_maior'
          : 'tolerancia_menor')
      : 'manter',
    vsAnchor: anchorRow && bestMain
      ? {
        pnlDelta: parseFloat(((bestMain.avgPnl ?? 0) - (anchorRow.avgPnl ?? 0)).toFixed(2)),
        tradeDelta: bestMain.tradeCount - anchorRow.tradeCount,
      }
      : null,
  };
}

function buildEntryMaReport(cMap, config, opts) {
  return suggestEntryMa(cMap, config, opts);
}

module.exports = {
  suggestEntryMa,
  buildEntryMaReport,
  DEFAULT_OPTS,
  TRIGGER_LABELS,
};
