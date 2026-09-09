/**
 * Registro dos manipuladores de indicador do gráfico no padrão "caixa de grupos" (Bollinger/EMA).
 *
 * Cada descriptor é DADO puro (sem React) que dirige:
 *   - groupStore.js  → makeGroup / sanitize / load / save (persistência localStorage)
 *   - GroupBox.jsx   → caixa (título + grade de controles + × + "+ nome")
 *   - CandlestickChart.jsx → buildConfigs (toDrawConfig por grupo) + layout + fetch
 *
 * Shape de um descriptor: ver README no fim do arquivo.
 */
import { makeGroupStore } from './groupStore';
import {
  normalizeChopInterval, normalizeMacdInterval,
  normalizeBarsSinceCrossInterval, normalizeTdSequentialInterval,
  normalizePphlInterval, normalizeWfractalsInterval, normalizeZigzagInterval,
  normalizePphlCandleCount, normalizeWfractalsCandleCount, normalizeZigzagCandleCount,
  normalizeRsiCrossInterval, normalizeRsiCrossValue,
  RSI_CROSS_INTERVAL_OPTIONS, RSI_CROSS_VALUE_OPTIONS,
  DEFAULT_RSI_CROSS_INTERVAL, DEFAULT_RSI_CROSS_VALUE,
  normalizePrevDayCloudInterval, normalizePrevDayCloudCandleCount,
  PREV_DAY_CLOUD_INTERVAL_OPTIONS, PREV_DAY_CLOUD_CANDLE_COUNT_OPTIONS,
  DEFAULT_PREV_DAY_CLOUD_INTERVAL, DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT,
  normalizeSrInterval, normalizeSrCandleCount, normalizeSrStyle,
  SR_STYLE_OPTIONS, DEFAULT_SR_INTERVAL, DEFAULT_SR_CANDLE_COUNT, DEFAULT_SR_STYLE,
  normalizeEmaPersistCloudInterval, normalizeEmaPersistCloudLayers,
  DEFAULT_EMA_PERSIST_CLOUD_INTERVAL, DEFAULT_EMA_PERSIST_CLOUD_LAYERS,
  DEFAULT_CHOP_INTERVAL, DEFAULT_MACD_INTERVAL,
  DEFAULT_BARS_SINCE_CROSS_INTERVAL, DEFAULT_TD_SEQUENTIAL_INTERVAL,
  DEFAULT_PPHL_INTERVAL, DEFAULT_WFRACTALS_INTERVAL, DEFAULT_ZIGZAG_INTERVAL,
  INDICATOR_CANDLE_COUNT_OPTIONS, DEFAULT_INDICATOR_CANDLE_COUNT,
  loadUiPreferences,
} from '../uiPreferences';
import { DEFAULT_PERM_CLOUD_TONES, normalizeEmaPersistCloudTones } from '../emaCrossPersistenceCloud';

/** Intervalos oferecidos nos pickers do painel (= OVERLAY_MA_INTERVALS de CandlestickChart.jsx). */
const PICKER_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d'];

export const HANDLERS_MIGRATED_KEY = 'lets_trade_handlers_migrated_v1';

/**
 * Semeia o 1º grupo a partir das prefs escalares antigas (uiPreferences.js) quando o store ainda
 * não tem nada salvo. `legacyRead(prefs)` devolve os campos; `enabled` vem de o indicador estar
 * no `activeIndicators` persistido. Chamado por groupStore.load() quando storageKey ausente.
 */
function makeLegacyMigrator(legacyIndicatorIds, legacyRead) {
  return () => {
    try {
      const prefs = loadUiPreferences();
      const wasActive = (prefs.activeIndicators ?? []).some((id) => legacyIndicatorIds.includes(id));
      const fields = legacyRead(prefs) ?? {};
      return [{ ...fields, enabled: wasActive }];
    } catch {
      return null;
    }
  };
}

// ─── Etapa 1: CHOP, MACD, Bars×, TD Seq — max:1 (sub-painel/escala própria no LW) ───

const chop = {
  id: 'chop',
  title: 'CHOP',
  addLabel: '+ CHOP',
  color: '#f59e0b',
  palette: ['#f59e0b'],
  max: 1,
  storageKey: 'lets_trade_chop_groups_v1',
  autoGroupIds: [],
  keepOnIntervalChange: true,
  panelButtonKey: 'chopZone',
  legacyIndicatorIds: ['chopZone'],
  fields: [
    { key: 'interval', kind: 'select', options: PICKER_INTERVALS, default: DEFAULT_CHOP_INTERVAL, fmt: (v) => `CHOP ${v}` },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [[{ ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 3 }]],
  toDrawConfig(g, i, ctx) {
    if (!g.enabled) return null;
    return { id: g.id, interval: g.interval, points: ctx.caches.chop?.[g.interval] ?? [] };
  },
  migrateFromLegacy: makeLegacyMigrator(['chopZone'], (p) => ({ interval: normalizeChopInterval(p.chopIntervalDefault) })),
};

const macd = {
  id: 'macd',
  title: 'MACD',
  addLabel: '+ MACD',
  color: '#38bdf8',
  palette: ['#38bdf8'],
  max: 1,
  storageKey: 'lets_trade_macd_groups_v1',
  autoGroupIds: [],
  keepOnIntervalChange: true,
  panelButtonKey: 'macd',
  legacyIndicatorIds: ['macd'],
  fields: [
    { key: 'interval', kind: 'select', options: PICKER_INTERVALS, default: DEFAULT_MACD_INTERVAL, fmt: (v) => `MACD ${v}` },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [[{ ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 3 }]],
  toDrawConfig(g, i, ctx) {
    if (!g.enabled) return null;
    const d = ctx.caches.macd?.[g.interval] ?? { macd: [], signal: [], histogram: [] };
    return { id: g.id, interval: g.interval, macd: d.macd ?? [], signal: d.signal ?? [], histogram: d.histogram ?? [] };
  },
  migrateFromLegacy: makeLegacyMigrator(['macd'], (p) => ({ interval: normalizeMacdInterval(p.macdIntervalDefault) })),
};

const barsSinceCross = {
  id: 'barsSinceCross',
  title: 'BARS×',
  addLabel: '+ BARS×',
  color: '#38bdf8',
  palette: ['#38bdf8'],
  max: 1,
  storageKey: 'lets_trade_barssince_groups_v1',
  autoGroupIds: [],
  keepOnIntervalChange: false,
  panelButtonKey: 'barsSinceCross',
  legacyIndicatorIds: ['barsSinceCross'],
  fields: [
    { key: 'interval', kind: 'select', options: PICKER_INTERVALS, default: DEFAULT_BARS_SINCE_CROSS_INTERVAL, fmt: (v) => `BARS ${v}` },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [[{ ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 3 }]],
  toDrawConfig(g, i, ctx) {
    if (!g.enabled) return null;
    const d = ctx.caches.barsSinceCross?.[g.interval];
    return d ? { id: g.id, interval: g.interval, ...d } : null;
  },
  migrateFromLegacy: makeLegacyMigrator(['barsSinceCross'], (p) => ({ interval: normalizeBarsSinceCrossInterval(p.barsSinceCrossIntervalDefault) })),
};

const tdSequential = {
  id: 'tdSequential',
  title: 'TD SEQ',
  addLabel: '+ TD SEQ',
  color: '#fb7185',
  palette: ['#fb7185'],
  max: 1,
  storageKey: 'lets_trade_tdseq_groups_v1',
  autoGroupIds: [],
  keepOnIntervalChange: false,
  panelButtonKey: 'tdSequential',
  legacyIndicatorIds: ['tdSequential'],
  fields: [
    { key: 'interval', kind: 'select', options: PICKER_INTERVALS, default: DEFAULT_TD_SEQUENTIAL_INTERVAL, fmt: (v) => `TD ${v}` },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [[{ ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 3 }]],
  toDrawConfig(g, i, ctx) {
    if (!g.enabled) return null;
    const candlesticks = ctx.caches.tdSequential?.[g.interval];
    return candlesticks ? { id: g.id, interval: g.interval, candlesticks } : null;
  },
  migrateFromLegacy: makeLegacyMigrator(['tdSequential'], (p) => ({ interval: normalizeTdSequentialInterval(p.tdSequentialIntervalDefault) })),
};

// ─── Etapa 2: PPHL, Williams Fractals, ZigZag — max:1 (marcadores/linha de pivô no gráfico) ───

const CANDLE_COUNT_FMT = (n) => `x${n}`;

function pivotDescriptor({ id, title, addLabel, color, panelButtonKey, defInterval, legacyIntervalKey, legacyCountKey, normInterval, normCount }) {
  return {
    id, title, addLabel, color,
    palette: [color],
    max: 1,
    storageKey: `lets_trade_${id}_groups_v1`,
    autoGroupIds: [],
    keepOnIntervalChange: false,
    panelButtonKey,
    legacyIndicatorIds: [id],
    fields: [
      { key: 'interval', kind: 'select', options: PICKER_INTERVALS, default: defInterval, fmt: (v) => `${title} ${v}` },
      { key: 'candleCount', kind: 'select', options: INDICATOR_CANDLE_COUNT_OPTIONS, default: DEFAULT_INDICATOR_CANDLE_COUNT, fmt: CANDLE_COUNT_FMT },
    ],
    flags: [{ key: 'enabled', label: 'ON', default: false }],
    cols: 4,
    rows: [[{ ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 2 }, { ref: 'field:candleCount', span: 1 }]],
    toDrawConfig(g) {
      if (!g.enabled) return null;
      return { id: g.id, interval: g.interval, candleCount: g.candleCount };
    },
    migrateFromLegacy: makeLegacyMigrator([id], (p) => ({
      interval: normInterval(p[legacyIntervalKey]),
      candleCount: normCount(p[legacyCountKey]),
    })),
  };
}

const pphl = pivotDescriptor({
  id: 'pphl', title: 'PPHL', addLabel: '+ PPHL', color: '#2dd4bf', panelButtonKey: 'pphl',
  defInterval: DEFAULT_PPHL_INTERVAL, legacyIntervalKey: 'pphlIntervalDefault', legacyCountKey: 'pphlCandleCountDefault',
  normInterval: normalizePphlInterval, normCount: normalizePphlCandleCount,
});
const wfractals = pivotDescriptor({
  id: 'wfractals', title: 'WF', addLabel: '+ WF', color: '#f472b6', panelButtonKey: 'wfractals',
  defInterval: DEFAULT_WFRACTALS_INTERVAL, legacyIntervalKey: 'wfractalsIntervalDefault', legacyCountKey: 'wfractalsCandleCountDefault',
  normInterval: normalizeWfractalsInterval, normCount: normalizeWfractalsCandleCount,
});
const zigzag = pivotDescriptor({
  id: 'zigzag', title: 'ZZ', addLabel: '+ ZZ', color: '#818cf8', panelButtonKey: 'zigzag',
  defInterval: DEFAULT_ZIGZAG_INTERVAL, legacyIntervalKey: 'zigzagIntervalDefault', legacyCountKey: 'zigzagCandleCountDefault',
  normInterval: normalizeZigzagInterval, normCount: normalizeZigzagCandleCount,
});

// ─── Etapa 3: Limiar RSI (cruzamento) — max:1, só aparece com o subpainel RSI ligado ───

const rsiCross = {
  id: 'rsiCross',
  title: 'Limiar RSI',
  addLabel: '+ Limiar RSI',
  color: '#a78bfa',
  palette: ['#a78bfa'],
  max: 1,
  storageKey: 'lets_trade_rsicross_groups_v1',
  autoGroupIds: [],
  keepOnIntervalChange: true,
  panelGate: (ctx) => (ctx.activeIndicators ?? []).includes('rsi'),
  legacyIndicatorIds: [],
  fields: [
    { key: 'interval', kind: 'select', options: RSI_CROSS_INTERVAL_OPTIONS, default: DEFAULT_RSI_CROSS_INTERVAL, fmt: (v) => `RSI ${v}` },
    { key: 'value', kind: 'select', options: RSI_CROSS_VALUE_OPTIONS, default: DEFAULT_RSI_CROSS_VALUE, fmt: (v) => `⤴ ${v}` },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [[{ ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 2 }, { ref: 'field:value', span: 1 }]],
  toDrawConfig(g) {
    if (!g.enabled) return null;
    return { id: g.id, interval: g.interval, threshold: Number(g.value) };
  },
  migrateFromLegacy: () => {
    try {
      const p = loadUiPreferences();
      const on = Number(p.rsiCrossThresholdDefault) > 0;
      return [{
        interval: normalizeRsiCrossInterval(p.rsiCrossIntervalDefault),
        value: normalizeRsiCrossValue(p.rsiCrossValueDefault ?? (on ? p.rsiCrossThresholdDefault : DEFAULT_RSI_CROSS_VALUE)),
        enabled: on,
      }];
    } catch { return null; }
  },
};

// ─── Etapa 4: nuvem D-1 (dia anterior) — max:1 ───

const prevDayCloud = {
  id: 'prevDayCloud',
  title: 'D-1',
  addLabel: '+ D-1',
  color: '#94a3b8',
  palette: ['#94a3b8'],
  max: 1,
  storageKey: 'lets_trade_prevdaycloud_groups_v1',
  autoGroupIds: [],
  keepOnIntervalChange: false,
  panelButtonKey: 'prevDayCloud',
  legacyIndicatorIds: ['prevDayCloud'],
  fields: [
    { key: 'interval', kind: 'select', options: PREV_DAY_CLOUD_INTERVAL_OPTIONS, default: DEFAULT_PREV_DAY_CLOUD_INTERVAL, fmt: (v) => `D ${v}` },
    { key: 'candleCount', kind: 'select', options: PREV_DAY_CLOUD_CANDLE_COUNT_OPTIONS, default: DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT, fmt: (n) => `x${n}` },
    { key: 'source', kind: 'select', options: ['oc', 'hl'], default: 'hl', fmt: (v) => (v === 'hl' ? 'Máx/mín' : 'Abre/fecha') },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [[
    { ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 1 },
    { ref: 'field:candleCount', span: 1 }, { ref: 'field:source', span: 1 },
  ]],
  toDrawConfig(g) {
    if (!g.enabled) return null;
    return { id: g.id, interval: g.interval, candleCount: g.candleCount, useHighLow: g.source === 'hl' };
  },
  migrateFromLegacy: makeLegacyMigrator(['prevDayCloud'], (p) => ({
    interval: normalizePrevDayCloudInterval(p.prevDayCloudIntervalDefault),
    candleCount: normalizePrevDayCloudCandleCount(p.prevDayCloudCandleCountDefault),
    source: p.prevDayCloudUseHighLowDefault === false ? 'oc' : 'hl',
  })),
};

// ─── Etapa 6: S/R (Suporte/Resistência) — MULTI-INSTÂNCIA (max:4) + calcular/mostrar linhas ───

export const SR_STYLE_LABELS = { degrau: 'Degrau', traco: 'Traço', linhas: 'Linhas' };
/** Paleta por posição da instância — cor do chip do painel + rótulo do marcador (as LINHAS de
 *  S/R no gráfico continuam azul=suporte / rosa=resistência por tipo). */
export const SR_PALETTE = ['#facc15', '#f472b6', '#38bdf8', '#a3e635'];

const SR_LINE_COUNT_OPTIONS = [1, 2, 3];
const srSupFmt = (n) => ['S1', 'S1–S2', 'S1–S3 (todas)'][n - 1] ?? `S1–S${n}`;
const srResFmt = (n) => ['R1', 'R1–R2', 'R1–R3 (todas)'][n - 1] ?? `R1–R${n}`;

const sr = {
  id: 'sr',
  title: 'S/R',
  addLabel: '+ S/R',
  color: SR_PALETTE[0],
  palette: SR_PALETTE,
  max: 4,
  storageKey: 'lets_trade_sr_groups_v1',
  autoGroupIds: ['sr-trade-override'],
  keepOnIntervalChange: false,
  panelButtonKey: 'sr',
  legacyIndicatorIds: ['sr'],
  fields: [
    { key: 'interval', kind: 'select', options: PICKER_INTERVALS, default: DEFAULT_SR_INTERVAL, fmt: (v) => `S/R ${v}` },
    { key: 'candleCount', kind: 'select', options: INDICATOR_CANDLE_COUNT_OPTIONS, default: DEFAULT_SR_CANDLE_COUNT, fmt: (n) => `x${n}` },
    { key: 'style', kind: 'select', options: SR_STYLE_OPTIONS, default: DEFAULT_SR_STYLE, fmt: (v) => SR_STYLE_LABELS[v] ?? v },
    { key: 'calcSupport', kind: 'select', options: SR_LINE_COUNT_OPTIONS, default: 1, fmt: srSupFmt },
    { key: 'calcResistance', kind: 'select', options: SR_LINE_COUNT_OPTIONS, default: 3, fmt: srResFmt },
    { key: 'showSupport', kind: 'select', options: SR_LINE_COUNT_OPTIONS, default: 1, fmt: srSupFmt },
    { key: 'showResistance', kind: 'select', options: SR_LINE_COUNT_OPTIONS, default: 3, fmt: srResFmt },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [
    [{ ref: 'field:interval', span: 3 }, { ref: 'remove', span: 1 }],
    [{ ref: 'flag:enabled', span: 1 }, { ref: 'field:candleCount', span: 1 }, { ref: 'field:style', span: 2 }],
    [{ ref: 'field:calcSupport', span: 2 }, { ref: 'field:calcResistance', span: 2 }],
    [{ ref: 'field:showSupport', span: 2 }, { ref: 'field:showResistance', span: 2 }],
  ],
  // O rolling (10×detectSupportResistance por instância) roda no componente — ver chartSrConfigs.
  // Aqui só valida `enabled`; a config real é montada lá com pivotRawCache + âncora do visível.
  toDrawConfig(g) {
    if (!g.enabled) return null;
    return { id: g.id, interval: g.interval, candleCount: g.candleCount, style: g.style,
      calcSupport: g.calcSupport, calcResistance: g.calcResistance,
      showSupport: g.showSupport, showResistance: g.showResistance };
  },
  migrateFromLegacy: makeLegacyMigrator(['sr'], (p) => ({
    interval: normalizeSrInterval(p.srIntervalDefault),
    candleCount: normalizeSrCandleCount(p.srCandleCountDefault),
    style: normalizeSrStyle(p.srStyleDefault),
  })),
};

// ─── Etapa 4b: nuvem PERM (persistência EMA9×EMA21) — max:1, com swatches de tom + camadas ───

const emaPersistCloud = {
  id: 'emaPersistCloud',
  title: 'PERM',
  addLabel: '+ PERM',
  color: '#4ade80',
  palette: ['#4ade80'],
  max: 1,
  storageKey: 'lets_trade_perm_groups_v1',
  autoGroupIds: [],
  keepOnIntervalChange: false,
  panelButtonKey: 'emaPersistCloud',
  legacyIndicatorIds: ['emaPersistCloud'],
  fields: [
    { key: 'interval', kind: 'select', options: PICKER_INTERVALS, default: DEFAULT_EMA_PERSIST_CLOUD_INTERVAL, fmt: (v) => `PERM ${v}` },
    { key: 'tones', kind: 'custom', render: 'permTones', normalize: normalizeEmaPersistCloudTones, default: () => ({ ...DEFAULT_PERM_CLOUD_TONES }) },
    { key: 'layers', kind: 'custom', render: 'permLayers', normalize: normalizeEmaPersistCloudLayers, default: () => ({ ...DEFAULT_EMA_PERSIST_CLOUD_LAYERS }) },
  ],
  flags: [{ key: 'enabled', label: 'ON', default: false }],
  cols: 4,
  rows: [
    [{ ref: 'flag:enabled', span: 1 }, { ref: 'field:interval', span: 2 }, { ref: 'field:tones', span: 1 }],
    [{ ref: 'field:layers', span: 4 }],
  ],
  toDrawConfig(g) {
    if (!g.enabled) return null;
    return { id: g.id, interval: g.interval, tones: g.tones, layers: g.layers };
  },
  migrateFromLegacy: makeLegacyMigrator(['emaPersistCloud'], (p) => ({
    interval: normalizeEmaPersistCloudInterval(p.emaPersistCloudIntervalDefault),
    tones: normalizeEmaPersistCloudTones(p.emaPersistCloudTonesDefault ?? {}),
    layers: normalizeEmaPersistCloudLayers(p.emaPersistCloudLayersDefault ?? {}),
  })),
};

/** @type {Array<object>} */
export const HANDLER_DESCRIPTORS = [sr, pphl, wfractals, zigzag, rsiCross, prevDayCloud, emaPersistCloud, chop, macd, barsSinceCross, tdSequential];

/** Map id → store, construído a partir dos descriptors. Referência estável (módulo). */
export const HANDLER_GROUP_STORES = Object.fromEntries(
  HANDLER_DESCRIPTORS.map((d) => [d.id, makeGroupStore(d)]),
);

/** ids de indicador que saem de INDICATOR_GROUPS conforme cada etapa converte o manipulador. */
export const CONVERTED_INDICATOR_IDS = new Set(
  HANDLER_DESCRIPTORS.flatMap((d) => d.legacyIndicatorIds ?? []),
);

export function getDescriptor(id) {
  return HANDLER_DESCRIPTORS.find((d) => d.id === id) ?? null;
}
