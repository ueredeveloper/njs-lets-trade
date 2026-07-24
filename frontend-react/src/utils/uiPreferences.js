const STORAGE_KEY = 'lets_trade_ui_prefs';

export const CHART_INTERVAL_OPTIONS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
];

export const PANEL_KEYS = ['indicators', 'stats'];

export const BAND_PCT_OPTIONS = [2, 3, 4, 5];

export const MAX_OVERLAY_SLOTS = 8;

export const CURRENCY_PANEL_WIDTH_DEFAULT = 512; // px — equivale a w-[32rem]
export const CURRENCY_PANEL_WIDTH_MIN = 320;
export const CURRENCY_PANEL_WIDTH_MAX = 800;

export function normalizeCurrencyPanelWidth(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return CURRENCY_PANEL_WIDTH_DEFAULT;
  return Math.min(CURRENCY_PANEL_WIDTH_MAX, Math.max(CURRENCY_PANEL_WIDTH_MIN, n));
}

const VALID_OVERLAY_PERIODS = ['9', '21', '50', '200'];

/** IDs válidos de indicadores do gráfico. */
export const VALID_ACTIVE_INDICATORS = [
  'ma9', 'ma21', 'ma50', 'ma200', 'ichimoku', 'sr', 'pphl', 'rsi', 'rsi50', 'rsi80', 'stopLoss',
];

/** Cores padrão por período (convenção TradingView / melhores práticas). */
export const PERIOD_DEFAULT_COLORS = {
  '9':   '#22c55e', // verde  — momentum curto
  '21':  '#eab308', // amarelo — tendência curta
  '50':  '#3b82f6', // azul   — tendência média
  '200': '#ef4444', // vermelho — tendência longa
};

function defaultColorForPeriod(period) {
  return PERIOD_DEFAULT_COLORS[String(period)] ?? '#94a3b8';
}

/** Indicadores ativos por padrão: ma50 e stopLoss ligados, restantes desligados. */
export const DEFAULT_ACTIVE_INDICATORS = ['ma50', 'stopLoss'];

/** Estado inicial das bandas % no gráfico. */
export const DEFAULT_MA_BANDS = {
  pct: 4,
  showAbove: true,
  showBelow: true,
  showMiddle: false,
  period: '50',
  interval: '1h',
};

/** Sem overlay por padrão — usuário adiciona via painel do gráfico ou Configurações. */
export const DEFAULT_OVERLAY_SLOTS = [];

export const BB_PERIOD_OPTIONS = ['10', '20', '30'];
export const BB_STDDEV_OPTIONS = [1, 2, 3];

/** Bandas de Bollinger no gráfico: período/intervalo próprios (como MA1/MA2), desligadas por padrão. */
export const DEFAULT_BOLLINGER_BANDS = {
  enabled: false,
  period: '20',
  stdDev: 2,
  interval: '4h',
};

export function normalizeBollingerBandsDefaults(raw) {
  const d = DEFAULT_BOLLINGER_BANDS;
  const stdDev = Number(raw?.stdDev);
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled,
    period: BB_PERIOD_OPTIONS.includes(String(raw?.period)) ? String(raw.period) : d.period,
    stdDev: BB_STDDEV_OPTIONS.includes(stdDev) ? stdDev : d.stdDev,
    interval: CHART_INTERVAL_OPTIONS.includes(raw?.interval) ? raw.interval : d.interval,
  };
}

/** Sessões válidas de reset do VWAP — cripto não tem pregão, então dia/semana UTC faz esse papel. */
export const VWAP_SESSION_OPTIONS = ['daily', 'weekly'];

/**
 * VWAP no gráfico: intervalo próprio (como MA1/MA2/BB) — usuário pode plotar o VWAP de um TF maior
 * num gráfico menor. Sessão controla o reset (diário 00:00 UTC ou semanal segunda 00:00 UTC) —
 * o valor não depende do intervalo escolhido, só a sessão. Bandas = ±1σ/±2σ em torno do VWAP.
 */
export const DEFAULT_VWAP = {
  enabled: false,
  interval: '4h',
  session: 'daily',
  bands: false,
};

export function normalizeVwapDefaults(raw) {
  const d = DEFAULT_VWAP;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled,
    interval: CHART_INTERVAL_OPTIONS.includes(raw?.interval) ? raw.interval : d.interval,
    session: VWAP_SESSION_OPTIONS.includes(raw?.session) ? raw.session : d.session,
    bands: typeof raw?.bands === 'boolean' ? raw.bands : d.bands,
  };
}

/** Intervalo de candles usado pra calcular o S/R (Suporte/Resistência) — independente do intervalo do gráfico, como MA1/MA2/BB. */
export const DEFAULT_SR_INTERVAL = '4h';

export function normalizeSrInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_SR_INTERVAL;
}

/** Intervalo de candles usado pra calcular o Pivot Points High/Low — mesmo padrão do S/R, pra comparação lado a lado. */
export const DEFAULT_PPHL_INTERVAL = '4h';

export function normalizePphlInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_PPHL_INTERVAL;
}

export function normalizeActiveIndicators(arr) {
  if (!Array.isArray(arr)) return [...DEFAULT_ACTIVE_INDICATORS];
  return arr.filter((id) => VALID_ACTIVE_INDICATORS.includes(id));
}

export function normalizeMaBandsDefaults(raw) {
  const d = DEFAULT_MA_BANDS;
  const pct = Number(raw?.pct);
  return {
    pct: BAND_PCT_OPTIONS.includes(pct) ? pct : d.pct,
    showAbove: typeof raw?.showAbove === 'boolean' ? raw.showAbove : d.showAbove,
    showBelow: typeof raw?.showBelow === 'boolean' ? raw.showBelow : d.showBelow,
    showMiddle: typeof raw?.showMiddle === 'boolean' ? raw.showMiddle : d.showMiddle,
    period: VALID_OVERLAY_PERIODS.includes(String(raw?.period)) ? String(raw.period) : d.period,
    interval: CHART_INTERVAL_OPTIONS.includes(raw?.interval) ? raw.interval : d.interval,
  };
}

export function normalizeOverlaySlots(slots) {
  if (!Array.isArray(slots)) {
    return DEFAULT_OVERLAY_SLOTS.map((s) => ({ ...s }));
  }
  if (!slots.length) return [];
  return slots.slice(0, MAX_OVERLAY_SLOTS).map((s, i) => {
    const period = VALID_OVERLAY_PERIODS.includes(String(s.period)) ? String(s.period) : '50';
    const rawColor = typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : null;
    return {
      id: typeof s.id === 'string' && s.id ? s.id : `slot${i + 1}`,
      period,
      interval: CHART_INTERVAL_OPTIONS.includes(s.interval) ? s.interval : '1h',
      enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
      color: rawColor ?? defaultColorForPeriod(period),
    };
  });
}

export const DEFAULT_UI_PREFS = {
  defaultChartInterval: '15m',
  visiblePanels: {
    indicators: true,
    stats: true,
  },
  overlaySlots: normalizeOverlaySlots(DEFAULT_OVERLAY_SLOTS),
  maBandsDefaults: normalizeMaBandsDefaults(DEFAULT_MA_BANDS),
  bollingerBandsDefaults: normalizeBollingerBandsDefaults(DEFAULT_BOLLINGER_BANDS),
  srIntervalDefault: DEFAULT_SR_INTERVAL,
  pphlIntervalDefault: DEFAULT_PPHL_INTERVAL,
  vwapDefaults: normalizeVwapDefaults(DEFAULT_VWAP),
  activeIndicators: [...DEFAULT_ACTIVE_INDICATORS],
  currencyPanelWidth: CURRENCY_PANEL_WIDTH_DEFAULT,
};

function cloneDefaults() {
  return {
    defaultChartInterval: DEFAULT_UI_PREFS.defaultChartInterval,
    visiblePanels: { ...DEFAULT_UI_PREFS.visiblePanels },
    overlaySlots: normalizeOverlaySlots(DEFAULT_OVERLAY_SLOTS),
    maBandsDefaults: normalizeMaBandsDefaults(DEFAULT_MA_BANDS),
    bollingerBandsDefaults: normalizeBollingerBandsDefaults(DEFAULT_BOLLINGER_BANDS),
    srIntervalDefault: DEFAULT_SR_INTERVAL,
    pphlIntervalDefault: DEFAULT_PPHL_INTERVAL,
    vwapDefaults: normalizeVwapDefaults(DEFAULT_VWAP),
    activeIndicators: [...DEFAULT_ACTIVE_INDICATORS],
    currencyPanelWidth: CURRENCY_PANEL_WIDTH_DEFAULT,
  };
}

export function loadUiPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    const result = cloneDefaults();
    if (CHART_INTERVAL_OPTIONS.includes(parsed.defaultChartInterval)) {
      result.defaultChartInterval = parsed.defaultChartInterval;
    }
    if (parsed.visiblePanels && typeof parsed.visiblePanels === 'object') {
      for (const key of PANEL_KEYS) {
        if (typeof parsed.visiblePanels[key] === 'boolean') {
          result.visiblePanels[key] = parsed.visiblePanels[key];
        }
      }
    }
    if (parsed.overlaySlots !== undefined) {
      result.overlaySlots = normalizeOverlaySlots(parsed.overlaySlots);
    }
    if (parsed.maBandsDefaults) {
      result.maBandsDefaults = normalizeMaBandsDefaults(parsed.maBandsDefaults);
    }
    if (parsed.bollingerBandsDefaults) {
      result.bollingerBandsDefaults = normalizeBollingerBandsDefaults(parsed.bollingerBandsDefaults);
    }
    if (parsed.srIntervalDefault !== undefined) {
      result.srIntervalDefault = normalizeSrInterval(parsed.srIntervalDefault);
    }
    if (parsed.pphlIntervalDefault !== undefined) {
      result.pphlIntervalDefault = normalizePphlInterval(parsed.pphlIntervalDefault);
    }
    if (parsed.vwapDefaults) {
      result.vwapDefaults = normalizeVwapDefaults(parsed.vwapDefaults);
    }
    if (Array.isArray(parsed.activeIndicators)) {
      result.activeIndicators = normalizeActiveIndicators(parsed.activeIndicators);
    }
    if (parsed.currencyPanelWidth !== undefined) {
      result.currencyPanelWidth = normalizeCurrencyPanelWidth(parsed.currencyPanelWidth);
    }
    return result;
  } catch {
    return cloneDefaults();
  }
}

export function saveUiPreferences(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function firstVisiblePanel(visiblePanels) {
  return PANEL_KEYS.find((key) => visiblePanels[key] !== false) ?? null;
}
