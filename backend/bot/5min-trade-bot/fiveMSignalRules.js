'use strict';

/** Snapshot das regras de entrada no momento do sinal (persistido em details.rules). */
function buildRulesSnapshot(report) {
  const recovery = report?.recoveryEval ?? {};
  const patternRequired = recovery.patternRequired === true;
  const patternOk = !patternRequired || recovery.ok === true;

  const pathSig = report?.pathSignal ?? {};
  const paths   = report?.entryPaths ?? {};
  const rsiOn   = paths.rsi?.enabled !== false;
  const maOn    = paths.ma50_5m?.enabled !== false;

  const cell = (ok, label, extra = {}) => ({
    ok: ok === true ? true : (ok === false ? false : null),
    label,
    ...extra,
  });

  return {
    ma1h: cell(report?.maPass === true, 'MA50 1h', {
      detail: report?.maChecks?.find(c => c.interval === '1h')?.detail ?? null,
    }),
    ma5m: cell(report?.ma5mTrigger?.triggered === true, 'MA50 5m', {
      tolerancePct: report?.ma5mTrigger?.tolerancePct ?? paths.ma50_5m?.tolerancePct ?? null,
      trigger: paths.ma50_5m?.trigger ?? null,
    }),
    ma5m1hMin: cell(report?.ma5m1hContext?.ok === true, 'MA50 1h mín. (+X%)', {
      abovePct: report?.ma5m1hContext?.abovePct ?? null,
      aboveLine: report?.ma5m1hContext?.aboveLine ?? null,
      distMaPct: report?.ma5m1hContext?.distMaPct ?? null,
    }),
    pattern: cell(patternOk, 'Padrão 1h', {
      required: patternRequired,
      reason: recovery.reason ?? null,
      zone: recovery.zone ?? null,
    }),
    rsiPath: cell(
      rsiOn ? pathSig.rsiSignal === true : null,
      'Caminho RSI',
      {
        applicable: rsiOn,
        rsi: report?.rsiNow ?? null,
        rsiBuy: report?.rsiBuy ?? null,
      },
    ),
    maPath: cell(
      maOn ? pathSig.maSignal === true : null,
      'Caminho MA50 5m',
      { applicable: maOn },
    ),
    allRules: cell(report?.allowed === true, 'Todas regras'),
  };
}

/** Reconstrói rules a partir de linha do Supabase (registros antigos sem snapshot). */
function rulesFromSignalRow(row) {
  if (row?.details?.rules) return row.details.rules;

  const d = row?.details ?? {};
  const recovery = d.recoveryEval ?? {};
  const patternRequired = recovery.patternRequired === true;
  const patternOk = !patternRequired || recovery.ok === true;
  const pathSig = d.pathSignal ?? {};
  const entryPath = row?.entry_path;

  const cell = (ok, label, extra = {}) => ({
    ok: ok === true ? true : (ok === false ? false : null),
    label,
    ...extra,
  });

  return {
    ma1h: cell(row?.ma1h_ok === true, 'MA50 1h'),
    ma5m: cell(row?.ma5m_triggered === true, 'MA50 5m'),
    pattern: cell(patternOk, 'Padrão 1h', { required: patternRequired, reason: recovery.reason ?? null }),
    rsiPath: cell(
      d.rsiBuySignal != null ? d.rsiBuySignal === true : (entryPath === 'rsi' ? true : null),
      'Caminho RSI',
      { applicable: d.rsiBuySignal != null || entryPath === 'rsi' },
    ),
    maPath: cell(
      pathSig.maSignal === true || row?.ma5m_triggered === true,
      'Caminho MA50 5m',
      { applicable: entryPath === 'ma50_5m' || pathSig.maSignal != null },
    ),
    allRules: cell(row?.allowed === true, 'Todas regras'),
  };
}

module.exports = { buildRulesSnapshot, rulesFromSignalRow };
