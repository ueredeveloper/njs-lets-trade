'use strict';

const { buildRulesSnapshot } = require('./fiveMSignalRules');

const READY_ENTRY_ACTIONS = new Set(['compraria', 'dca_compraria']);
const READY_EXIT_ACTIONS  = new Set(['venderia']);

const EVENT_LABELS = {
  possible_entry: 'ENTRADA PRONTA',
  entry:          'ENTRADA',
  possible_exit:  'SAÍDA PRONTA',
  exit:           'SAÍDA',
};

const lastSigHash = new Map();

function ma50_1hFromReport(report) {
  const chk = report.maChecks?.find(c => c.period === 50 && c.interval === '1h')
    ?? report.maChecks?.[0];
  return chk?.ma ?? null;
}

function buildSignalRow(state, report, eventType, extra = {}) {
  const ma5m = report.ma5mTrigger?.ma ?? null;
  const ma1h = ma50_1hFromReport(report);
  const rules = buildRulesSnapshot(report);
  if (eventType === 'entry' || eventType === 'possible_entry') {
    rules.order = {
      ok: eventType === 'entry',
      label: eventType === 'entry' ? 'Ordem executada' : 'Ordem não preencheu',
    };
  }
  return {
    state_id:       state.id,
    symbol:         state.symbol,
    exchange:       state.exchange ?? 'binance',
    event_type:     eventType,
    phase:          state.phase,
    event_time:     new Date().toISOString(),
    price:          report.price ?? extra.price ?? null,
    rsi:            report.rsiNow ?? extra.rsi ?? null,
    rsi_buy:        report.rsiBuy ?? state.rsi_buy,
    rsi_sell:       report.rsiSell ?? state.rsi_sell,
    ma50_1h:        ma1h,
    ma50_5m:        ma5m,
    ma1h_ok:        report.maPass ?? null,
    ma5m_triggered: report.ma5mTrigger?.triggered === true,
    entry_path:     extra.entryPath ?? report.pathSignal?.path ?? state.entry_path ?? null,
    exit_reason:    extra.exitReason ?? null,
    allowed:        true,
    action_key:     extra.actionKey ?? report.action ?? null,
    motivation:     extra.motivation ?? report.reason ?? extra.reason ?? null,
    candles_5m:     report.candles5mCount ?? null,
    candles_1h:     report.candles1hCount ?? null,
    details: {
      actionLabel: report.actionLabel,
      detail: report.detail,
      entryPathsLabel: report.entryPathsLabel,
      maChecks: report.maChecks,
      pathSignal: report.pathSignal,
      recoveryEval: report.recoveryEval,
      rsiBuySignal: report.rsiBuySignal,
      rsiSellSignal: report.rsiSellSignal,
      rules,
      ...extra.details,
    },
  };
}

function sigHash(row) {
  return [
    row.event_type, row.action_key,
    row.motivation, row.entry_path, row.exit_reason,
    row.rsi, row.price,
  ].join('|');
}

/** Só sinal com todas as regras OK (allowed + ação de compra/venda). */
function isReadyEntryReport(report) {
  return report?.allowed === true && READY_ENTRY_ACTIONS.has(report.action);
}

function isReadyExitReport(report) {
  return report?.allowed === true && READY_EXIT_ACTIONS.has(report.action);
}

function formatSignalLine(symbol, eventType, row) {
  const lbl = EVENT_LABELS[eventType] ?? eventType;
  const via = row.entry_path === 'ma50_5m' ? 'MA50 5m'
    : row.entry_path === 'rsi' ? 'RSI' : '—';
  const ma1h = row.ma50_1h != null ? row.ma50_1h.toFixed(6) : '—';
  const ma5m = row.ma50_5m != null ? row.ma50_5m.toFixed(6) : '—';
  const rsi = row.rsi != null ? Number(row.rsi).toFixed(2) : '—';
  const price = row.price != null ? Number(row.price).toFixed(6) : '—';
  const candles = `5m:${row.candles_5m ?? '?'} 1h:${row.candles_1h ?? '?'}`;
  const exit = row.exit_reason ? ` saída=${row.exit_reason}` : '';
  const path = row.entry_path ? ` via=${via}` : '';

  return (
    `[${lbl}] ${symbol} preço=${price} RSI=${rsi} (<${row.rsi_buy} >${row.rsi_sell})` +
    ` MA50_1h=${ma1h} MA50_5m=${ma5m} ma_ok=Y ma5m_touch=${row.ma5m_triggered ? 'Y' : 'N'}` +
    `${path}${exit} · ${row.motivation ?? ''} · candles ${candles}`
  );
}

async function saveFiveMinSignal(sbReq, row) {
  try {
    await sbReq('POST', 'five_min_bot_signals', row);
  } catch (err) {
    console.error(`[five_min_bot_signals] ${row.symbol}: ${err.message}`);
  }
}

async function emitSignal(sbReq, state, report, eventType, log, extra = {}) {
  const row = buildSignalRow(state, report ?? {}, eventType, extra);
  const key = `${state.symbol}:${eventType}`;
  const hash = sigHash(row);
  if (lastSigHash.get(key) === hash) return false;

  lastSigHash.set(key, hash);
  log(formatSignalLine(state.symbol, eventType, row));
  await saveFiveMinSignal(sbReq, row);
  return true;
}

function clearSignalDedupe(symbol) {
  for (const k of [...lastSigHash.keys()]) {
    if (k.startsWith(`${symbol}:`)) lastSigHash.delete(k);
  }
}

module.exports = {
  emitSignal,
  buildSignalRow,
  isReadyEntryReport,
  isReadyExitReport,
  formatSignalLine,
  saveFiveMinSignal,
  clearSignalDedupe,
};
