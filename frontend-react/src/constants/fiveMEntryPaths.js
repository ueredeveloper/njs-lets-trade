/** Caminhos de entrada acima MA50 1h — espelha backend/entryPathsConfig.js */

export const DEFAULT_ENTRY_PATHS = {
  rsi:     { enabled: true },
  ma50_5m: { enabled: true, trigger: 'touch' },
  combine: 'any',
  pathCooldownHours: 2,
  pathCooldownSource: 'ma',
};

export function clampPathCooldownHours(raw) {
  const h = Number(raw);
  if (!Number.isFinite(h) || h <= 0) return DEFAULT_ENTRY_PATHS.pathCooldownHours;
  return Math.max(0.5, Math.min(48, parseFloat(h.toFixed(1))));
}

export function normalizeEntryPathsForm(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      rsi:     { ...DEFAULT_ENTRY_PATHS.rsi },
      ma50_5m: { ...DEFAULT_ENTRY_PATHS.ma50_5m },
      combine: DEFAULT_ENTRY_PATHS.combine,
      pathCooldownHours: DEFAULT_ENTRY_PATHS.pathCooldownHours,
      pathCooldownSource: DEFAULT_ENTRY_PATHS.pathCooldownSource,
    };
  }
  const trigger = raw.ma50_5m?.trigger === 'cross_up' ? 'cross_up' : 'touch';
  return {
    rsi:     { enabled: raw.rsi?.enabled !== false },
    ma50_5m: {
      enabled: raw.ma50_5m?.enabled !== false,
      trigger,
    },
    combine: raw.combine === 'all' ? 'all' : 'any',
    pathCooldownHours: clampPathCooldownHours(raw.pathCooldownHours ?? DEFAULT_ENTRY_PATHS.pathCooldownHours),
    pathCooldownSource: raw.pathCooldownSource === 'rsi' ? 'rsi' : 'ma',
  };
}

export function initialEntryPaths(entry) {
  return normalizeEntryPathsForm(entry?.entryPaths);
}

export function pathCooldownHoursForSource(report, source) {
  if (!report || report.loading || report.error) return null;
  const h = source === 'rsi' ? report.rsiCooldownHours : report.maCooldownHours;
  return h != null ? clampPathCooldownHours(h) : null;
}

export function entryPathsLabel(cfg) {
  const n = normalizeEntryPathsForm(cfg);
  const parts = [];
  if (n.rsi.enabled) parts.push('RSI');
  if (n.ma50_5m.enabled) parts.push(`MA50 5m (${n.ma50_5m.trigger})`);
  if (!parts.length) return 'nenhum';
  if (parts.length === 2) {
    const src = n.pathCooldownSource === 'rsi' ? 'RSI' : 'MA';
    return `${parts.join(n.combine === 'all' ? ' + ' : ' ou ')} · ${n.pathCooldownHours}h (${src})`;
  }
  return parts[0];
}

export function hasEntryPath(cfg) {
  const n = normalizeEntryPathsForm(cfg);
  return n.rsi.enabled || n.ma50_5m.enabled;
}

export const MA5M_TRIGGER_OPTIONS = [
  {
    id: 'touch',
    label: 'Toque na MA50 5m',
    summary: 'Low ou close próximo da MA50 no candle 5m (contexto acima MA50 1h).',
  },
  {
    id: 'cross_up',
    label: 'Cruzamento para cima',
    summary: 'Close cruza de baixo para cima a MA50 5m.',
  },
];

export const COMBINE_OPTIONS = [
  { id: 'any', label: 'Um ou outro (OR)' },
  { id: 'all', label: 'Os dois (AND)' },
];

export const PATH_COOLDOWN_SOURCE_OPTIONS = [
  { id: 'rsi', label: 'Período RSI' },
  { id: 'ma',  label: 'Período MA50 5m' },
];
