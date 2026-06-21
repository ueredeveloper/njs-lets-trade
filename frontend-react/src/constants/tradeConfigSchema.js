/** Defaults espelhados de backend/bot/amap/tradeConfigSchema.js */
export const TRADE_CONFIG_DEFAULTS = {
  entryRsi:  { interval: '15m', period: 14, operator: '<', value: 30 },
  exitRsi:   { interval: '15m', period: 14, operator: '>', value: 70 },
  entryRsiPath: { enabled: true },
  entryMa: {
    enabled: false,
    period: 50,
    interval: '1h',
    trigger: 'touch',
    tolerancePct: 0.5,
    requireRsi: false,
    entryRsi: { interval: '15m', period: 14, operator: '<', value: 40 },
  },
  maConditions: [
    { period: 50, interval: '4h', mode: 'strict_above' },
    { period: 50, interval: '1h', mode: 'adaptive' },
  ],
  extension: {
    enabled: true, maPeriod: 50, maInterval: '1h', abovePct: 5,
    threeInterval: '1h', fourInterval: '1h',
    threeCandles: true, fourCandles: true, confirmLogic: 'any',
  },
  stopLoss: {
    enabled: true,
    fixedEnabled: true,
    adaptiveEnabled: true,
    period: 50,
    interval: '4h',
  },
  execution: {
    immediateEntry: false, entryDiscount: 0.001,
    pendingTimeoutMs: 30 * 60_000, pendingCancelPct: 0.002,
    pendingCancelOnExitRsi: true,
  },
  polling: { pollMs: 60_000, fastPollMs: 30_000, fastRsiThreshold: 65 },
  adaptiveOpts: { defaultPct: 3, maxPct: 8, minPct: 0.5, minEpisodes: 3 },
  volume: { minVolumeUsdt: 1_000_000, allowLowVolume: false, aggressiveExitOnLowVolume: true },
};

export const RSI_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const MA_INTERVALS  = ['15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const MA_PERIODS    = [20, 50, 100, 200];
export const RSI_PERIODS   = [7, 14, 21];
export const RSI_OPERATORS = [
  { id: '<',  label: '<' },
  { id: '<=', label: '≤' },
  { id: '>',  label: '>' },
  { id: '>=', label: '≥' },
];

export const ENTRY_MA_TRIGGERS = [
  { id: 'touch',    label: 'Toque na MA' },
  { id: 'cross_up', label: 'Cruzamento ↑' },
];

export const MA_MODES = [
  { id: 'strict_above', label: 'fixo (acima MA)' },
  { id: 'adaptive',     label: 'adapt. (dip histórico)' },
];

export const ENTRY_DISCOUNT_OPTIONS = [
  { label: '0,1%', value: 0.001 },
  { label: '0,5%', value: 0.005 },
  { label: '1%',   value: 0.01  },
  { label: '2%',   value: 0.02  },
];

export const VOLUME_OPTIONS = [
  { label: '1M',  value: 1_000_000 },
  { label: '3M',  value: 3_000_000 },
  { label: '5M',  value: 5_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '50M', value: 50_000_000 },
];

export const PENDING_TIMEOUT_OPTIONS = [
  { label: '15 min', value: 15 * 60_000 },
  { label: '30 min', value: 30 * 60_000 },
  { label: '1 h',    value: 60 * 60_000 },
  { label: '2 h',    value: 2 * 60 * 60_000 },
];

export const POLL_OPTIONS = [
  { label: '30s', value: 30_000 },
  { label: '1 min', value: 60_000 },
  { label: '2 min', value: 2 * 60_000 },
  { label: '5 min', value: 5 * 60_000 },
];

export function formStateFromEntry(entry) {
  const d = TRADE_CONFIG_DEFAULTS;
  if (!entry) {
    return {
      ...d,
      entryRsiPath: { ...d.entryRsiPath },
      entryMa: { ...d.entryMa, entryRsi: { ...d.entryMa.entryRsi } },
      maConditions: d.maConditions.map((m, i) => ({ ...m, id: i + 1 })),
    };
  }
  const src = entry;
  return {
    entryRsi:     { ...d.entryRsi,  ...src.entryRsi, operator: src.entryRsi?.operator ?? d.entryRsi.operator },
    exitRsi:      { ...d.exitRsi, ...src.exitRsi, value: Number(src.exitRsi?.value ?? d.exitRsi.value) },
    entryRsiPath: { ...d.entryRsiPath, ...src.entryRsiPath },
    entryMa: {
      ...d.entryMa,
      ...src.entryMa,
      entryRsi: { ...d.entryMa.entryRsi, ...src.entryMa?.entryRsi },
    },
    maConditions: (src.maConditions ?? d.maConditions).map((m, i) => ({
      id: i + 1,
      period: m.period ?? 50,
      interval: m.interval ?? '1h',
      mode: m.mode ?? (m.adaptive ? 'adaptive' : 'strict_above'),
      fixedDipPct: m.fixedDipPct != null && m.fixedDipPct !== '' ? m.fixedDipPct : '',
    })),
    extension:    {
      ...d.extension,
      ...src.extension,
      abovePct: Number(src.extension?.abovePct ?? d.extension.abovePct),
    },
    stopLoss:     {
      ...d.stopLoss,
      ...src.stopLoss,
      fixedEnabled: src.stopLoss?.fixedEnabled
        ?? (src.stopLoss?.enabled === false ? false : true),
      adaptiveEnabled: src.stopLoss?.adaptiveEnabled
        ?? (src.stopLoss?.enabled === false ? false : d.stopLoss.adaptiveEnabled),
    },
    execution:    {
      ...d.execution,
      ...src.execution,
      entryDiscount: Number(src.execution?.entryDiscount ?? d.execution.entryDiscount),
      pendingCancelOnExitRsi: src.execution?.pendingCancelOnExitRsi ?? d.execution.pendingCancelOnExitRsi,
    },
    polling:      { ...d.polling,   ...src.polling },
    adaptiveOpts: { ...d.adaptiveOpts, ...src.adaptiveOpts },
    volume:       { ...d.volume,    ...src.volume },
  };
}

export function formStateToPayload(form, { symbol, exchange, capital }) {
  return {
    symbol,
    exchange,
    capital: Number(capital),
    entryRsi:  form.entryRsi,
    exitRsi:   form.exitRsi,
    entryRsiPath: form.entryRsiPath,
    entryMa: {
      ...form.entryMa,
      entryRsi: { ...form.entryMa.entryRsi, operator: form.entryMa.entryRsi.operator ?? '<' },
    },
    maConditions: form.maConditions.map(({ period, interval, mode, fixedDipPct }) => ({
      period, interval, mode,
      ...(fixedDipPct !== '' && fixedDipPct != null ? { fixedDipPct: Number(fixedDipPct) } : {}),
    })),
    extension:    form.extension,
    stopLoss: {
      ...form.stopLoss,
      enabled: !!(form.stopLoss.fixedEnabled || form.stopLoss.adaptiveEnabled),
    },
    execution:    form.execution,
    polling:      form.polling,
    adaptiveOpts: form.adaptiveOpts,
    volume:       form.volume,
  };
}
