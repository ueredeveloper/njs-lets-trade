const STORAGE_KEY = 'lets_trade_chart_panel_buttons';

export const CHART_PANEL_BUTTON_KEYS = [
  'ma9',
  'ma21',
  'ma50',
  'ma200',
  'ichimoku',
  'rsi',
  'rsi80',
  'rsi50',
  'ma1',
  'ma2',
  'bandsPct',
  'bandsAbove',
  'bandsBelow',
  'stopLoss',
  'bb',
];

export const DEFAULT_CHART_PANEL_BUTTONS = {
  ma9: true,
  ma21: true,
  ma50: true,
  ma200: true,
  ichimoku: true,
  rsi: true,
  rsi80: true,
  rsi50: true,
  ma1: true,
  ma2: false,
  bandsPct: true,
  bandsAbove: true,
  bandsBelow: true,
  stopLoss: true,
  bb: true,
};

export function loadChartPanelButtons() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHART_PANEL_BUTTONS };
    const parsed = JSON.parse(raw);
    const result = { ...DEFAULT_CHART_PANEL_BUTTONS };
    for (const key of CHART_PANEL_BUTTON_KEYS) {
      if (typeof parsed[key] === 'boolean') result[key] = parsed[key];
    }
    if (typeof parsed.bands === 'boolean') {
      result.bandsPct = parsed.bands;
      result.bandsAbove = parsed.bands;
      result.bandsBelow = parsed.bands;
    }
    return result;
  } catch {
    return { ...DEFAULT_CHART_PANEL_BUTTONS };
  }
}

export function saveChartPanelButtons(buttons) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buttons));
}

export function hasAnyChartPanelButton(buttons) {
  return CHART_PANEL_BUTTON_KEYS.some((key) => buttons[key] !== false);
}
