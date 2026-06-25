/** Defaults espelhados de backend/bot/amap/tradeConfigSchema.js */
export const TRADE_CONFIG_DEFAULTS = {
  rule1: {
    enabled: true,
    maFiltersEnabled: false,
    entryRsi:  { interval: '1h', period: 14, operator: '<', value: 30 },
    exitRsi:   { interval: '1h', period: 14, operator: '>', value: 70 },
    maConditions: [],
    extension: {
      enabled: false, maPeriod: 50, maInterval: '1h', abovePct: 5,
      threeInterval: '1h', fourInterval: '1h',
      threeCandles: true, fourCandles: true, confirmLogic: 'any',
    },
    stopLoss: {
      enabled: true, fixedEnabled: false, adaptiveEnabled: false,
      pctCapEnabled: true, maxLossPct: 5,
      fixedAboveMaEnabled: false, fixedAboveMaCandles: 10,
      adaptiveAboveMaEnabled: false, adaptiveAboveMaCandles: 10,
      period: 50, interval: '4h',
      adaptivePeriod: 50, adaptiveInterval: '1h',
    },
    execution: {
      immediateEntry: true, entryDiscount: 0.001,
      pendingTimeoutMs: 30 * 60_000, pendingCancelPct: 0.002,
      pendingCancelOnExitRsi: true,
    },
    adaptiveOpts: { defaultPct: 3, maxPct: 5, minPct: 0.5, minEpisodes: 3 },
  },
  rule2: {
    enabled: false,
    entryMa: {
      period: 50, interval: '1h', trigger: 'cross_up', tolerancePct: 0.5, fixedDipPct: '',
      aboveMaEnabled: true, aboveMaCandles: 10,
    },
    exitRsi: { interval: '1h', period: 14, operator: '>', value: 70 },
    exitRsiConditions: [
      { enabled: true, interval: '1h',  period: 14, operator: '>', value: 70 },
      { enabled: true, interval: '15m', period: 14, operator: '>', value: 80 },
    ],
    exitRsiLogic: 'any',
    stopLoss: { adaptiveEnabled: true, adaptiveAboveMaEnabled: false, adaptiveAboveMaCandles: 10 },
    execution: {
      entryDiscount: 0.02,
      pendingTimeoutMs: 30 * 60_000, pendingCancelPct: 0.002,
      pendingCancelOnExitRsi: true,
    },
    adaptiveOpts: { defaultPct: 3, maxPct: 5, minPct: 0.5, minEpisodes: 3 },
  },
  polling: { pollMs: 60_000, fastPollMs: 30_000, fastRsiThreshold: 65 },
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

function mapExitRsiConditions(list, defaults) {
  const d = defaults ?? TRADE_CONFIG_DEFAULTS.rule2.exitRsiConditions;
  const src = list?.length ? [...list] : [...d];
  while (src.length < d.length) {
    src.push({ ...d[src.length] });
  }
  return src.map((c, i) => ({
    id: i + 1,
    enabled: c.enabled !== false,
    interval: c.interval ?? d[i]?.interval ?? '1h',
    period: Number(c.period ?? d[i]?.period ?? 14),
    operator: c.operator ?? d[i]?.operator ?? '>',
    value: Number(c.value ?? d[i]?.value ?? 70),
  }));
}

function mapMaConditions(list) {
  return (list ?? []).map((m, i) => ({
    id: i + 1,
    period: m.period ?? 50,
    interval: m.interval ?? '1h',
    mode: m.mode ?? (m.adaptive ? 'adaptive' : 'strict_above'),
    fixedDipPct: m.fixedDipPct != null && m.fixedDipPct !== '' ? m.fixedDipPct : '',
    aboveMaEnabled: m.aboveMaEnabled === true,
    aboveMaCandles: Number(m.aboveMaCandles ?? 10),
  }));
}

/** Normaliza execution da regra 2 (campos flat do backend → form.rule2.execution) */
function mapRule2Execution(r2, defaults) {
  const exec = r2?.execution ?? {};
  const d = defaults.execution;
  return {
    ...d,
    ...exec,
    entryDiscount: Number(r2?.entryDiscount ?? exec.entryDiscount ?? d.entryDiscount),
    pendingTimeoutMs: Number(r2?.pendingTimeoutMs ?? exec.pendingTimeoutMs ?? d.pendingTimeoutMs),
    pendingCancelPct: Number(r2?.pendingCancelPct ?? exec.pendingCancelPct ?? d.pendingCancelPct),
    pendingCancelOnExitRsi: r2?.pendingCancelOnExitRsi ?? exec.pendingCancelOnExitRsi ?? d.pendingCancelOnExitRsi,
  };
}

/** Migra payload legado ou novo formato rule1/rule2 → estado do formulário */
export function formStateFromEntry(entry) {
  const d = TRADE_CONFIG_DEFAULTS;
  if (!entry) {
    return {
      rule1: {
        ...d.rule1,
        maConditions: mapMaConditions(d.rule1.maConditions),
      },
      rule2: { ...d.rule2, entryMa: { ...d.rule2.entryMa }, execution: { ...d.rule2.execution },
        exitRsiConditions: mapExitRsiConditions(d.rule2.exitRsiConditions) },
      polling: { ...d.polling },
      volume: { ...d.volume },
    };
  }

  const tc = entry.tradeConfig;
  const src = (entry.rule1 || entry.rule2) ? entry : {
    ...entry,
    rule1: tc?.rule1 ?? entry.rule1,
    rule2: tc?.rule2 ?? entry.rule2,
  };
  const hasRules = src.rule1 || src.rule2;

  if (hasRules) {
    const r1 = src.rule1 ?? {};
    const r2 = src.rule2 ?? {};
    return {
      rule1: {
        enabled: r1.enabled ?? d.rule1.enabled,
        maFiltersEnabled: r1.maFiltersEnabled ?? d.rule1.maFiltersEnabled,
        entryRsi: { ...d.rule1.entryRsi, ...r1.entryRsi },
        exitRsi: { ...d.rule1.exitRsi, ...r1.exitRsi, value: Number(r1.exitRsi?.value ?? d.rule1.exitRsi.value) },
        maConditions: mapMaConditions(r1.maConditions ?? src.maConditions ?? d.rule1.maConditions),
        extension: { ...d.rule1.extension, ...r1.extension, abovePct: Number(r1.extension?.abovePct ?? d.rule1.extension.abovePct) },
        stopLoss: {
          ...d.rule1.stopLoss, ...r1.stopLoss,
          fixedEnabled: r1.stopLoss?.fixedEnabled ?? (r1.stopLoss?.enabled === false ? false : d.rule1.stopLoss.fixedEnabled),
          adaptiveEnabled: r1.stopLoss?.adaptiveEnabled ?? d.rule1.stopLoss.adaptiveEnabled,
          pctCapEnabled: r1.stopLoss?.pctCapEnabled ?? d.rule1.stopLoss.pctCapEnabled,
          maxLossPct: Number(r1.stopLoss?.maxLossPct ?? d.rule1.stopLoss.maxLossPct ?? 5),
          fixedAboveMaEnabled: r1.stopLoss?.fixedAboveMaEnabled ?? d.rule1.stopLoss.fixedAboveMaEnabled,
          fixedAboveMaCandles: Number(r1.stopLoss?.fixedAboveMaCandles ?? d.rule1.stopLoss.fixedAboveMaCandles ?? 10),
          adaptiveAboveMaEnabled: r1.stopLoss?.adaptiveAboveMaEnabled ?? d.rule1.stopLoss.adaptiveAboveMaEnabled,
          adaptiveAboveMaCandles: Number(r1.stopLoss?.adaptiveAboveMaCandles ?? d.rule1.stopLoss.adaptiveAboveMaCandles ?? 10),
          adaptivePeriod: Number(r1.stopLoss?.adaptivePeriod ?? d.rule1.stopLoss.adaptivePeriod),
          adaptiveInterval: r1.stopLoss?.adaptiveInterval ?? d.rule1.stopLoss.adaptiveInterval,
        },
        execution: { ...d.rule1.execution, ...r1.execution },
        adaptiveOpts: { ...d.rule1.adaptiveOpts, ...r1.adaptiveOpts },
      },
      rule2: {
        enabled: r2.enabled ?? d.rule2.enabled,
        entryMa: {
          ...d.rule2.entryMa, ...r2.entryMa,
          fixedDipPct: r2.entryMa?.fixedDipPct ?? '',
          aboveMaEnabled: r2.entryMa?.aboveMaEnabled ?? d.rule2.entryMa.aboveMaEnabled,
          aboveMaCandles: Number(r2.entryMa?.aboveMaCandles ?? d.rule2.entryMa.aboveMaCandles ?? 10),
        },
        exitRsi: { ...d.rule2.exitRsi, ...r2.exitRsi, value: Number(r2.exitRsi?.value ?? d.rule2.exitRsi.value) },
        exitRsiConditions: mapExitRsiConditions(r2.exitRsiConditions ?? (r2.exitRsi ? [r2.exitRsi] : null)),
        exitRsiLogic: r2.exitRsiLogic ?? d.rule2.exitRsiLogic ?? 'any',
        stopLoss: { ...d.rule2.stopLoss, ...r2.stopLoss },
        execution: mapRule2Execution(r2, d.rule2),
        adaptiveOpts: { ...d.rule2.adaptiveOpts, ...r2.adaptiveOpts },
      },
      polling: { ...d.polling, ...src.polling },
      volume: { ...d.volume, ...src.volume },
    };
  }

  // legado
  return {
    rule1: {
      enabled: src.entryRsiPath?.enabled !== false,
      maFiltersEnabled: src.maFiltersEnabled ?? src.rule1?.maFiltersEnabled ?? d.rule1.maFiltersEnabled,
      entryRsi: { ...d.rule1.entryRsi, ...src.entryRsi },
      exitRsi: { ...d.rule1.exitRsi, ...src.exitRsi, value: Number(src.exitRsi?.value ?? d.rule1.exitRsi.value) },
      maConditions: mapMaConditions(src.maConditions ?? d.rule1.maConditions),
      extension: { ...d.rule1.extension, ...src.extension, abovePct: Number(src.extension?.abovePct ?? d.rule1.extension.abovePct) },
      stopLoss: {
        ...d.rule1.stopLoss, ...src.stopLoss,
        fixedEnabled: src.stopLoss?.fixedEnabled ?? d.rule1.stopLoss.fixedEnabled,
        adaptiveEnabled: src.stopLoss?.adaptiveEnabled ?? d.rule1.stopLoss.adaptiveEnabled,
        fixedAboveMaEnabled: src.stopLoss?.fixedAboveMaEnabled ?? d.rule1.stopLoss.fixedAboveMaEnabled,
        fixedAboveMaCandles: Number(src.stopLoss?.fixedAboveMaCandles ?? d.rule1.stopLoss.fixedAboveMaCandles ?? 10),
        adaptiveAboveMaEnabled: src.stopLoss?.adaptiveAboveMaEnabled ?? d.rule1.stopLoss.adaptiveAboveMaEnabled,
        adaptiveAboveMaCandles: Number(src.stopLoss?.adaptiveAboveMaCandles ?? d.rule1.stopLoss.adaptiveAboveMaCandles ?? 10),
        pctCapEnabled: src.stopLoss?.pctCapEnabled ?? d.rule1.stopLoss.pctCapEnabled,
        maxLossPct: Number(src.stopLoss?.maxLossPct ?? d.rule1.stopLoss.maxLossPct ?? 5),
        adaptivePeriod: Number(src.stopLoss?.adaptivePeriod ?? d.rule1.stopLoss.adaptivePeriod),
        adaptiveInterval: src.stopLoss?.adaptiveInterval ?? d.rule1.stopLoss.adaptiveInterval,
      },
      execution: { ...d.rule1.execution, ...src.execution },
      adaptiveOpts: { ...d.rule1.adaptiveOpts, ...src.adaptiveOpts },
    },
    rule2: {
      enabled: src.entryMa?.enabled ?? false,
      entryMa: {
        ...d.rule2.entryMa, ...src.entryMa,
        fixedDipPct: src.entryMa?.fixedDipPct ?? '',
        aboveMaEnabled: src.entryMa?.aboveMaEnabled ?? d.rule2.entryMa.aboveMaEnabled,
        aboveMaCandles: Number(src.entryMa?.aboveMaCandles ?? d.rule2.entryMa.aboveMaCandles ?? 10),
      },
      exitRsi: { ...d.rule2.exitRsi, ...src.exitRsi },
      exitRsiConditions: mapExitRsiConditions(src.exitRsiConditions ?? (src.exitRsi ? [src.exitRsi] : null)),
      exitRsiLogic: src.exitRsiLogic ?? d.rule2.exitRsiLogic ?? 'any',
      stopLoss: { ...d.rule2.stopLoss, ...src.stopLoss },
      execution: mapRule2Execution(
        { ...src, entryMa: src.entryMa, entryDiscount: src.entryMa?.entryDiscount },
        d.rule2,
      ),
      adaptiveOpts: { ...d.rule2.adaptiveOpts },
    },
    polling: { ...d.polling, ...src.polling },
    volume: { ...d.volume, ...src.volume },
  };
}

export function formStateToPayload(form, { symbol, exchange, capital, strategyId, enabled, label } = {}) {
  const r1 = form.rule1;
  const r2 = form.rule2;
  const payload = {
    symbol,
    exchange,
    capital: Number(capital),
    ...(strategyId ? { strategyId } : {}),
    ...(enabled != null ? { enabled } : {}),
    ...(label ? { label } : {}),
    rule1: {
      enabled: r1.enabled,
      maFiltersEnabled: r1.maFiltersEnabled !== false,
      entryRsi: r1.entryRsi,
      exitRsi: r1.exitRsi,
      maConditions: r1.maConditions.map(({ period, interval, mode, fixedDipPct, aboveMaEnabled, aboveMaCandles }) => ({
        period, interval, mode,
        ...(fixedDipPct !== '' && fixedDipPct != null ? { fixedDipPct: Number(fixedDipPct) } : {}),
        aboveMaEnabled: aboveMaEnabled === true,
        aboveMaCandles: Number(aboveMaCandles ?? 10),
      })),
      extension: r1.extension,
      stopLoss: {
        ...r1.stopLoss,
        enabled: !!(r1.stopLoss.fixedEnabled || r1.stopLoss.adaptiveEnabled
          || r1.stopLoss.pctCapEnabled !== false),
        fixedAboveMaEnabled: r1.stopLoss.fixedAboveMaEnabled === true,
        fixedAboveMaCandles: Number(r1.stopLoss.fixedAboveMaCandles ?? 10),
        adaptiveAboveMaEnabled: r1.stopLoss.adaptiveAboveMaEnabled === true,
        adaptiveAboveMaCandles: Number(r1.stopLoss.adaptiveAboveMaCandles ?? 10),
        maxLossPct: Math.min(Number(r1.stopLoss.maxLossPct ?? 5), 5),
        adaptivePeriod: Number(r1.stopLoss.adaptivePeriod ?? 50),
        adaptiveInterval: r1.stopLoss.adaptiveInterval ?? '1h',
      },
      execution: r1.execution,
      adaptiveOpts: r1.adaptiveOpts,
    },
    rule2: {
      enabled: r2.enabled,
      entryMa: {
        ...r2.entryMa,
        ...(r2.entryMa.fixedDipPct !== '' && r2.entryMa.fixedDipPct != null
          ? { fixedDipPct: Number(r2.entryMa.fixedDipPct) } : {}),
      },
      exitRsi: (() => {
        const first = r2.exitRsiConditions?.find(c => c.enabled) ?? r2.exitRsiConditions?.[0];
        if (first) {
          return { interval: first.interval, period: first.period, operator: first.operator, value: first.value };
        }
        return r2.exitRsi;
      })(),
      exitRsiConditions: (r2.exitRsiConditions ?? [])
        .filter(c => c.enabled !== false)
        .map(({ interval, period, operator, value }) => ({ enabled: true, interval, period, operator, value })),
      exitRsiLogic: r2.exitRsiLogic ?? 'any',
      stopLoss: {
        ...r2.stopLoss,
        adaptiveEnabled: r2.stopLoss.adaptiveEnabled !== false,
        adaptiveAboveMaEnabled: r2.stopLoss.adaptiveAboveMaEnabled === true,
        adaptiveAboveMaCandles: Number(r2.stopLoss.adaptiveAboveMaCandles ?? 10),
      },
      entryDiscount: r2.execution.entryDiscount,
      pendingTimeoutMs: r2.execution.pendingTimeoutMs,
      pendingCancelPct: r2.execution.pendingCancelPct,
      pendingCancelOnExitRsi: r2.execution.pendingCancelOnExitRsi,
      adaptiveOpts: r2.adaptiveOpts,
    },
    // legado (painel / APIs antigas)
    entryRsi: r1.entryRsi,
    exitRsi: r1.exitRsi,
    entryRsiPath: { enabled: r1.enabled },
    entryMa: { ...r2.entryMa, enabled: r2.enabled, entryDiscount: r2.execution.entryDiscount },
    maConditions: r1.maConditions.map(({ period, interval, mode, fixedDipPct, aboveMaEnabled, aboveMaCandles }) => ({
      period, interval, mode,
      ...(fixedDipPct !== '' && fixedDipPct != null ? { fixedDipPct: Number(fixedDipPct) } : {}),
      aboveMaEnabled: aboveMaEnabled === true,
      aboveMaCandles: Number(aboveMaCandles ?? 10),
    })),
    extension: r1.extension,
    stopLoss: r1.stopLoss,
    execution: r1.execution,
    polling: form.polling,
    adaptiveOpts: r1.adaptiveOpts,
    volume: { ...form.volume },
  };
  return payload;
}
