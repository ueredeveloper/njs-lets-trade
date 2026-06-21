'use strict';

/**
 * Sugere limiar de RSI de entrada (ex.: < 30 vs < 34 vs < 40) a partir do histórico.
 * Compara PnL médio de trades simulados para cada candidato.
 */

const {
  collectEntryPathTrades,
  scoreTrades,
  buildRsiCandidates,
  pickBestSweep,
} = require('./entrySuggestShared');

const DEFAULT_OPTS = {
  minTrades: 3,
  step: 2,
  span: 8,
  minValue: 15,
  maxValue: 45,
};

function suggestEntryRsi(cMap, config, opts = {}) {
  const o     = { ...DEFAULT_OPTS, ...opts };
  const rule  = config.entryRsi ?? {};
  const anchor = Number(rule.value ?? 30);
  const operator = rule.operator ?? '<';

  const candidates = buildRsiCandidates(anchor, operator, o);
  const sweep        = [];

  for (const value of candidates) {
    const cfg = {
      ...config,
      entryRsi: { ...rule, value, operator },
      entryRsiPath: { enabled: true },
      entryMa: { ...config.entryMa, enabled: false },
    };
    const trades = collectEntryPathTrades(cMap, cfg, 'rsi');
    sweep.push({
      value,
      label: `RSI ${operator} ${value}`,
      ...scoreTrades(trades),
    });
  }

  const { best, usedDefault, reason } = pickBestSweep(sweep, 'value', anchor, o);
  const anchorRow = sweep.find(s => s.value === anchor);

  return {
    suggestedEntryRsi: best?.value ?? anchor,
    usedDefault,
    reason,
    anchorValue: anchor,
    operator,
    interval: rule.interval ?? '15m',
    period: rule.period ?? 14,
    sweep,
    anchorStats: anchorRow ?? null,
    bestStats: best,
    recommendation: !usedDefault && best.value !== anchor
      ? (best.value > anchor ? 'mais_flexivel' : 'mais_estrito')
      : 'manter',
    vsAnchor: anchorRow && best && best.value !== anchor
      ? {
        pnlDelta: parseFloat((best.avgPnl - anchorRow.avgPnl).toFixed(2)),
        tradeDelta: best.tradeCount - anchorRow.tradeCount,
      }
      : null,
  };
}

function buildEntryRsiReport(cMap, config, opts) {
  return suggestEntryRsi(cMap, config, opts);
}

module.exports = {
  suggestEntryRsi,
  buildEntryRsiReport,
  DEFAULT_OPTS,
};
