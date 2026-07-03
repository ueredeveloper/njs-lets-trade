const STORAGE_KEY = 'lets_trade_ui_prefs';

export const CHART_INTERVAL_OPTIONS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
];

export const PANEL_KEYS = ['indicators', 'stats', 'macross'];

export const DEFAULT_OVERLAY_SLOTS = [
  { id: 'slot1', period: '50', interval: '1h', enabled: true },
  { id: 'slot2', period: '50', interval: '4h', enabled: false },
];

export function normalizeOverlaySlots(slots) {
  if (!Array.isArray(slots) || !slots.length) {
    return DEFAULT_OVERLAY_SLOTS.map((s) => ({ ...s }));
  }
  const defs = DEFAULT_OVERLAY_SLOTS;
  return defs.map((def, i) => {
    const s = slots.find((x) => x.id === def.id) ?? slots[i] ?? def;
    return {
      id: def.id,
      period: String(s.period ?? def.period),
      interval: CHART_INTERVAL_OPTIONS.includes(s.interval) ? s.interval : def.interval,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : def.enabled,
    };
  });
}

export const DEFAULT_UI_PREFS = {
  defaultChartInterval: '15m',
  visiblePanels: {
    indicators: true,
    stats: false,
    macross: true,
  },
  overlaySlots: normalizeOverlaySlots(DEFAULT_OVERLAY_SLOTS),
};

function cloneDefaults() {
  return {
    defaultChartInterval: DEFAULT_UI_PREFS.defaultChartInterval,
    visiblePanels: { ...DEFAULT_UI_PREFS.visiblePanels },
    overlaySlots: normalizeOverlaySlots(DEFAULT_OVERLAY_SLOTS),
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
    if (parsed.overlaySlots) {
      result.overlaySlots = normalizeOverlaySlots(parsed.overlaySlots);
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
