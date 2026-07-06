/** Sequência de montagem para isolar travamentos na 1ª renderização. */

export const BOOT_STAGE = {
  HEADER: 1,
  CHART: 2,
  PANEL_BAR: 3,
  FILTER_TABS: 4,
  CURRENCY_TABLE: 5,
  INDICATOR_PANEL: 6,
  STATS_PANEL: 7,
  MACROSS_PANEL: 8,
  MOBILE_BTN: 9,
  FULL: 10,
};

export const MAX_BOOT_STAGE = BOOT_STAGE.FULL;

/** Ordem e rótulos — cada estágio inclui os anteriores. */
export const BOOT_STAGE_SEQUENCE = [
  { stage: BOOT_STAGE.HEADER, key: 'header', label: 'Header' },
  { stage: BOOT_STAGE.CHART, key: 'chart', label: 'CandlestickChart' },
  { stage: BOOT_STAGE.PANEL_BAR, key: 'panelBar', label: 'Barra painéis' },
  { stage: BOOT_STAGE.FILTER_TABS, key: 'filterTabs', label: 'FilterTabs' },
  { stage: BOOT_STAGE.CURRENCY_TABLE, key: 'currencyTable', label: 'CurrencyTable' },
  { stage: BOOT_STAGE.INDICATOR_PANEL, key: 'indicatorPanel', label: 'IndicatorPanel' },
  { stage: BOOT_STAGE.STATS_PANEL, key: 'statsPanel', label: 'StatisticsPanel' },
  { stage: BOOT_STAGE.MACROSS_PANEL, key: 'macrossPanel', label: 'MultitradePanel' },
  { stage: BOOT_STAGE.MOBILE_BTN, key: 'mobileBtn', label: 'Botão Moedas (mobile)' },
  { stage: BOOT_STAGE.FULL, key: 'full', label: 'Completo' },
];

const STORAGE_KEY = 'lets_trade_boot_stage';

export function loadBootStage() {
  try {
    const qs = new URLSearchParams(window.location.search).get('bootStage');
    if (qs != null && qs !== '') {
      const n = Number(qs);
      if (Number.isFinite(n)) return clampStage(n);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return clampStage(n);
    }
  } catch { /* ignore */ }
  return BOOT_STAGE.FULL;
}

export function saveBootStage(stage) {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampStage(stage)));
  } catch { /* ignore */ }
}

export function clampStage(stage) {
  return Math.max(BOOT_STAGE.HEADER, Math.min(MAX_BOOT_STAGE, Math.round(stage)));
}

export function bootStageLabel(stage) {
  const hit = [...BOOT_STAGE_SEQUENCE].reverse().find((s) => stage >= s.stage);
  return hit?.label ?? `stage ${stage}`;
}

export function bootStageAtLeast(current, min) {
  return current >= min;
}
