import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '../i18n';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud, fetchGateTrades, fetchBinanceTrades, fetchChartAdaptiveBands, DEFAULT_CANDLE_LIMIT } from '../services/api';
import { buildMarkersFromExchangeTrades, attachPnlToExchangeTrades } from '../utils/multitradeChart';
import { buildTrailingStopSeries, resolveChartStopLoss } from '../utils/trailingStopLoss';
import MaCrossRuleCheckChart from './MaCrossRuleCheckChart';
import convertOpenTime from '../utils/convertOpenTime';
import Tooltip from './Tooltip';
import { hasAnyChartPanelButton } from '../utils/chartPanelButtons';
import { useIsMobile } from '../hooks/useIsMobile';
import { DEFAULT_OVERLAY_SLOTS, DEFAULT_ACTIVE_INDICATORS, BB_PERIOD_OPTIONS, BB_STDDEV_OPTIONS } from '../utils/uiPreferences';
import { CHART_VIEW, INTERVAL_MS, computeZoomWindow, buildFixedDataZoom, buildInsideDataZoom, computeCandleLimitFromTime, isTradePanelChartView } from '../utils/chartView';

const LIMIT = DEFAULT_CANDLE_LIMIT;
const LAST_CANDLE_PRESETS = [20, 50, 100];
const MAX_CANDLES = 1000;
const CANDLE_FETCH_STEPS = [500, 750, 1000];
const OVERLAY_MA_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d'];
const OVERLAY_MA_COLORS = ['#fb923c', '#c084fc', '#34d399', '#60a5fa', '#f472b6', '#facc15', '#a78bfa', '#4ade80'];
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
const DEFAULT_INTERVAL = '15m';

const CHART_PRICE_PAD = 54;        // direita: rótulos do eixo de preço
const CHART_LEFT_MARGIN = 8;       // margem esquerda mínima
const CHART_PANEL_COLLAPSED = 22;  // painel recolhido (só a aba)
/** Espaço livre no rodapé do painel lateral (botão flutuante "Moedas" no mobile). */
const MOBILE_PANEL_BOTTOM_INSET = 56;
const PANEL_MIN_WIDTH = 160;
const PANEL_MAX_WIDTH = 320;
const PANEL_GAP = 2;
const PANEL_TILE_PAD = 2;
const COLLAPSE_TAB_W = 16;
/** Altura mínima (px) de uma "row unit" do painel — abaixo disso, o painel rola em vez de espremer os tiles. */
const MIN_ROW_UNIT_PX = 20;
const C_UP   = '#26a69a';
const C_DOWN = '#ef5350';

const INDICATOR_GROUPS = [
  { id: 'ma9',      label: 'EMA9',   color: '#e879f9', tipKey: 'chart.tip.sma9' },
  { id: 'ma21',     label: 'EMA21',  color: '#fb923c', tipKey: 'chart.tip.sma21' },
  { id: 'ma50',     label: 'EMA50',  color: '#22d3ee', tipKey: 'chart.tip.sma50' },
  { id: 'ma200',    label: 'EMA200', color: '#f59e0b', tipKey: 'chart.tip.sma200' },
  { id: 'ichimoku', label: 'Ichi',  color: '#60a5fa', tipKey: 'chart.tip.ichimoku' },
  { id: 'rsi',      label: 'RSI',   color: '#a78bfa', tipKey: 'chart.tip.rsi' },
];

const RSI_EXTRA_INDICATORS = [
  { id: 'rsi80', label: 'R80', color: '#fb923c', tipKey: 'chart.tip.rsi80' },
  { id: 'rsi50', label: 'R50', color: '#facc15', tipKey: 'chart.tip.rsi50' },
  { id: 'stopLoss', label: 'SL', color: '#f87171', tipKey: 'chart.tip.stopLoss' },
];

/**
 * EMAs rápidas agrupadas por intervalo — usuário adiciona/remove intervalos
 * livremente e liga/desliga períodos (9/21/50/200) dentro de cada intervalo.
 * Banda % (cima/baixo) é UMA só por grupo, ancorada num período escolhido
 * (não em todos os períodos ativos — evita duplicar linha de banda por EMA).
 * Cada lado pode ser fixo (4/3/2/1%) ou "adaptativo": calculado do histórico
 * real da moeda para aquele período@intervalo, igual ao filtro do ma-cross-bot.
 * A EMA no timeframe do próprio gráfico já existe via ma9/ma21/ma50/ma200
 * em INDICATOR_GROUPS.
 */
const QUICK_EMA_PERIODS = ['9', '21', '50', '200'];
const QUICK_EMA_PERIOD_COLORS = { '9': '#34d399', '21': '#60a5fa', '50': '#c084fc', '200': '#f97316' };
const QUICK_EMA_DEFAULT_INTERVAL = '30m';
const QUICK_EMA_BAND_PCT_OPTIONS = [4, 3, 2, 1];
const QUICK_EMA_DEFAULT_ABOVE_PCT = 4;
const QUICK_EMA_DEFAULT_BELOW_PCT = 1;
const QUICK_EMA_BAND_ADAPTIVE = 'adaptive';
const MAX_QUICK_EMA_GROUPS = 4;
const QUICK_EMA_STORAGE_KEY = 'lets_trade_quick_ema_groups_v4';

/** Normaliza pct de banda: null = desligada, 'adaptive' = calculada do histórico, número = fixa. */
function normalizeQuickEmaBandPct(value) {
  if (value === null) return null;
  if (value === QUICK_EMA_BAND_ADAPTIVE) return QUICK_EMA_BAND_ADAPTIVE;
  const n = Number(value);
  return QUICK_EMA_BAND_PCT_OPTIONS.includes(n) ? n : null;
}

function loadQuickEmaGroups() {
  try {
    const raw = localStorage.getItem(QUICK_EMA_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g) => g && OVERLAY_MA_INTERVALS.includes(g.interval))
      .slice(0, MAX_QUICK_EMA_GROUPS)
      .map((g, i) => ({
        id: typeof g.id === 'string' && g.id ? g.id : `qg${i + 1}`,
        interval: g.interval,
        periods: Array.isArray(g.periods) ? g.periods.filter((p) => QUICK_EMA_PERIODS.includes(p)) : [],
        bandPeriod: QUICK_EMA_PERIODS.includes(g.bandPeriod) ? g.bandPeriod : null,
        abovePct: normalizeQuickEmaBandPct(g.abovePct),
        belowPct: normalizeQuickEmaBandPct(g.belowPct),
      }));
  } catch {
    return [];
  }
}

function saveQuickEmaGroups(groups) {
  try {
    localStorage.setItem(QUICK_EMA_STORAGE_KEY, JSON.stringify(groups));
  } catch { /* ignore */ }
}

/** Resolve a banda %(cima/baixo) de um grupo: fixa, adaptativa (histórico real) ou desligada. */
function resolveQuickEmaBands(group, adaptiveBounds) {
  const aboveIsAdaptive = group.abovePct === QUICK_EMA_BAND_ADAPTIVE;
  const belowIsAdaptive = group.belowPct === QUICK_EMA_BAND_ADAPTIVE;
  const bounds = (aboveIsAdaptive || belowIsAdaptive) && group.bandPeriod
    ? adaptiveBounds[`${group.bandPeriod}-${group.interval}`]
    : null;
  return {
    showAbove: aboveIsAdaptive ? (bounds?.stretchPct ?? 0) > 0 : group.abovePct != null,
    showBelow: belowIsAdaptive ? (bounds?.dipPct ?? 0) > 0 : group.belowPct != null,
    abovePct: aboveIsAdaptive ? (bounds?.stretchPct ?? 0) : (group.abovePct ?? 0),
    belowPct: belowIsAdaptive ? (bounds?.dipPct ?? 0) : (group.belowPct ?? 0),
  };
}

const CHART_INDICATOR_IDS = [
  ...INDICATOR_GROUPS.map(g => g.id),
  ...RSI_EXTRA_INDICATORS.map(g => g.id),
];

function overlayPanelKey(slot) {
  const num = parseInt(slot.id.replace('slot', ''), 10);
  return `ma${isNaN(num) ? slot.id : num}`;
}

function enabledOverlaySlots(overlaySlots, panelButtons) {
  return (overlaySlots ?? []).filter(
    (s) => s.enabled && panelButtons[overlayPanelKey(s)] !== false,
  );
}

function filterIndicatorsByPanel(activeIndicators, panelButtons) {
  return activeIndicators.filter((id) => {
    if (!CHART_INDICATOR_IDS.includes(id)) return true;
    return panelButtons[id] !== false;
  });
}

function PanelTip({ text, children, position = 'left' }) {
  return (
    <Tooltip text={text} position={position} maxW={280} portal fill>
      {children}
    </Tooltip>
  );
}

function alignPointsToCandles(candlesticks, points) {
  if (!points?.length || !candlesticks?.length) return [];
  return candlesticks.map(c => {
    const t = Number(c.openTime);
    let lo = 0, hi = points.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].openTime <= t) { best = points[mid].value; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  });
}

/**
 * Quantidade de candles do intervalo da overlay para cobrir o span do gráfico
 * + período da EMA (warmup). Evita MA1/bandas só nos últimos 1–3 candles
 * quando o overlay é um TF maior (ex.: EMA50@1h sobre chart 15m).
 */
function computeOverlayMaFetchLimit(chartInterval, overlayInterval, period, chartCandleCount, baseLimit = DEFAULT_CANDLE_LIMIT) {
  const chartMs = INTERVAL_MS[chartInterval] ?? 900_000;
  const ovMs = INTERVAL_MS[overlayInterval] ?? chartMs;
  const spanCandles = Math.max(Number(chartCandleCount) || 0, DEFAULT_CANDLE_LIMIT);
  const barsForSpan = Math.ceil((spanCandles * chartMs) / ovMs);
  const periodN = Math.max(1, parseInt(period, 10) || 50);
  return Math.min(
    MAX_CANDLES,
    Math.max(baseLimit || 0, barsForSpan + periodN + 30, periodN * 3, 100),
  );
}

/** True se a série MA já tem pontos desde o início da janela visível. */
function overlayPointsCoverWindow(points, candlesticks, displayCount) {
  if (!points?.length || !candlesticks?.length) return false;
  const DL = Math.min(displayCount || candlesticks.length, candlesticks.length);
  const oldestVisible = Number(candlesticks[candlesticks.length - DL].openTime);
  return Number(points[0].openTime) <= oldestVisible;
}

async function fetchOverlayMaPoints(symbol, interval, period, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return [];
  const sma = await fetch(`/services/sma?period=${period}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(sma)) return [];
  const offset = candles.length - sma.length;
  return sma.map((val, i) => ({
    openTime: Number(candles[offset + i].openTime),
    value: val,
  }));
}

async function fetchBollingerOverlayPoints(symbol, interval, period, stdDev, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return [];
  const bb = await fetch(`/services/bollinger-bands?period=${period}&stdDev=${stdDev}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(bb)) return [];
  const offset = candles.length - bb.length;
  return bb.map((val, i) => ({
    openTime: Number(candles[offset + i].openTime),
    upper: val.upper,
    middle: val.middle,
    lower: val.lower,
  }));
}

function buildBollingerSeries(bbConfig, candlesticks, alignSeries) {
  if (!bbConfig?.enabled || !bbConfig.points?.length) return [];
  const color = '#818cf8';
  const label = `BB${bbConfig.period}@${bbConfig.interval}`;
  const toLine = (field) => alignSeries(alignPointsToCandles(
    candlesticks,
    bbConfig.points.map(p => ({ openTime: p.openTime, value: p[field] })),
  ));
  return [
    {
      name: `${label} sup`,
      type: 'line',
      data: toLine('upper'),
      smooth: true,
      showSymbol: false,
      lineStyle: { color, width: 1, type: 'dotted', opacity: 0.65 },
    },
    {
      name: label,
      type: 'line',
      data: toLine('middle'),
      smooth: true,
      showSymbol: false,
      lineStyle: { color, width: 1.5, type: 'dashed' },
      endLabel: {
        show: true,
        formatter: label,
        color,
        fontSize: 9,
        padding: [1, 4],
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 2,
      },
    },
    {
      name: `${label} inf`,
      type: 'line',
      data: toLine('lower'),
      smooth: true,
      showSymbol: false,
      lineStyle: { color, width: 1, type: 'dotted', opacity: 0.65 },
    },
  ];
}

function buildOverlaySeries(overlayConfigs, candlesticks, alignSeries) {
  return (overlayConfigs ?? []).flatMap(cfg => {
    if (!cfg.points?.length) return [];
    const full = alignPointsToCandles(candlesticks, cfg.points);
    const maData = alignSeries(full);
    const bands = cfg.bands ?? {};
    const series = cfg.showMiddle === false ? [] : [{
      name: cfg.label,
      type: 'line',
      data: maData,
      smooth: true,
      showSymbol: false,
      lineStyle: { color: cfg.color, width: 1.5, type: 'dashed' },
      endLabel: {
        show: true,
        formatter: cfg.label,
        color: cfg.color,
        fontSize: 9,
        padding: [1, 4],
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 2,
      },
    }];
    if (bands.showAbove) {
      series.push({
        name: `${cfg.label} +${bands.abovePct}%`,
        type: 'line',
        data: maData.map(v => (v == null ? null : v * (1 + bands.abovePct / 100))),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: cfg.color, width: 1, type: 'dotted', opacity: 0.65 },
      });
    }
    if (bands.showBelow) {
      series.push({
        name: `${cfg.label} -${bands.belowPct}%`,
        type: 'line',
        data: maData.map(v => (v == null ? null : v * (1 - bands.belowPct / 100))),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: cfg.color, width: 1, type: 'dotted', opacity: 0.45 },
      });
    }
    return series;
  });
}

function scaleFontSize(dims, ratio = 0.32, min = 10, max = 18) {
  if (!dims) return min;
  return Math.max(min, Math.min(max, Math.round(Math.min(dims.w, dims.h) * ratio)));
}

const panelBtn = (active, color, darkText = false, dims = null) => ({
  fontSize: scaleFontSize(dims),
  padding: 0,
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'monospace',
  background: active ? color : 'rgba(0,0,0,0.45)',
  color: active ? (darkText ? '#000' : '#fff') : color,
  border: `1px solid ${color}`,
  opacity: active ? 1 : 0.7,
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
  lineHeight: 1,
  boxSizing: 'border-box',
  textAlign: 'center',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const panelSelect = (color, dims = null) => ({
  width: '100%',
  height: '100%',
  minHeight: 0,
  fontSize: scaleFontSize(dims, 0.26, 9, 14),
  padding: 0,
  borderRadius: 3,
  fontFamily: 'monospace',
  boxSizing: 'border-box',
  textAlign: 'center',
  cursor: 'pointer',
  background: '#111',
  color,
  border: `1px solid ${color}66`,
});

const COMPACT_LABELS = {
  ma9: '9', ma21: '21', ma50: '50', ma200: '200', ichimoku: 'Ich', rsi: 'RSI',
  rsi80: 'R80', rsi50: 'R50', stopLoss: 'SL',
};

/** Grid base do painel — cada botão ocupa N×M células. */
const PANEL_GRID_COLS = 4;

/** Altura em linhas de cada tile de indicador. */
const INDICATOR_TILE_ROWS = 2;

const BANDS_COL_SPAN = 4;

const BOLLINGER_ROW_SPAN = 3;

/** Grid interno do bloco de EMAs rápidas: intervalo+remover, 4 botões de período, banda cima/baixo. */
const QUICK_EMA_GRID_COLS = 4;
const QUICK_EMA_GROUP_ROWS = 4;

function quickEmaRowSpan(groups) {
  const addRow = groups.length < MAX_QUICK_EMA_GROUPS ? 1 : 0;
  return Math.max(1, groups.length * QUICK_EMA_GROUP_ROWS + addRow);
}

function renderBollingerTile(dims, t, bollingerBands, setBollingerBands) {
  const innerW = dims.w - PANEL_TILE_PAD * 2;
  const innerH = dims.h - PANEL_TILE_PAD * 2;
  const rowH = (innerH - PANEL_GAP * 2) / 3;
  const halfDims = { w: (innerW - PANEL_GAP) / 2, h: rowH };
  const rowDims = { w: innerW, h: rowH };
  const color = '#818cf8';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: 'repeat(3, 1fr)',
      gap: PANEL_GAP,
      width: innerW,
      height: innerH,
      boxSizing: 'border-box',
    }}>
      <div style={{ gridColumn: '1', gridRow: '1', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.bb_period')}>
          <select
            value={bollingerBands.period}
            onChange={e => setBollingerBands(b => ({ ...b, period: e.target.value }))}
            style={panelSelect(color, halfDims)}
          >
            {BB_PERIOD_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '2', gridRow: '1', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.bb_stddev')}>
          <select
            value={bollingerBands.stdDev}
            onChange={e => setBollingerBands(b => ({ ...b, stdDev: Number(e.target.value) }))}
            style={panelSelect(color, halfDims)}
          >
            {BB_STDDEV_OPTIONS.map(s => <option key={s} value={s}>±{s}σ</option>)}
          </select>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '1 / span 2', gridRow: '2', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.bb_interval')}>
          <select
            value={bollingerBands.interval}
            onChange={e => setBollingerBands(b => ({ ...b, interval: e.target.value }))}
            style={panelSelect(color, rowDims)}
          >
            {OVERLAY_MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '1 / span 2', gridRow: '3', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.bb_on')}>
          <button
            type="button"
            onClick={() => setBollingerBands(b => ({ ...b, enabled: !b.enabled }))}
            style={panelBtn(bollingerBands.enabled, color, false, rowDims)}
          >
            {bollingerBands.enabled ? 'BB ON' : 'BB OFF'}
          </button>
        </PanelTip>
      </div>
    </div>
  );
}

function resolvePanelContentWidth(chartWidth) {
  const target = Math.round(chartWidth * 0.18);
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, target));
}

function computePanelWidth(contentWidth, expanded = true) {
  if (!expanded) return CHART_PANEL_COLLAPSED;
  return contentWidth + COLLAPSE_TAB_W + PANEL_GAP;
}

function scaleSectionTitle(dims) {
  return {
    fontSize: scaleFontSize(dims, 0.24, 8, 12),
    letterSpacing: 0.4,
    color: '#64748b',
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: 1.1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
  };
}

/**
 * Expande tiles para baixo se houver espaço vazio abaixo deles.
 * Garante que nenhuma linha do grid fique vazia quando há tiles vizinhos
 * com alturas diferentes (ex.: subset de indicadores visíveis).
 */
function fillGapsDown(placements, gridCols, maxRow) {
  if (!placements.length || maxRow <= 0) return placements;

  const occupied = new Set();
  placements.forEach((p) => {
    for (let r = p.startRow; r < p.startRow + p.rowSpan; r++) {
      for (let c = p.startCol; c < p.startCol + p.colSpan; c++) {
        occupied.add(`${r},${c}`);
      }
    }
  });

  return placements.map((tile) => {
    let ext = 0;
    while (tile.startRow + tile.rowSpan + ext < maxRow) {
      const nextRow = tile.startRow + tile.rowSpan + ext;
      let free = true;
      for (let c = tile.startCol; c < tile.startCol + tile.colSpan && free; c++) {
        if (occupied.has(`${nextRow},${c}`)) free = false;
      }
      if (!free) break;
      for (let c = tile.startCol; c < tile.startCol + tile.colSpan; c++) {
        occupied.add(`${nextRow},${c}`);
      }
      ext++;
    }
    if (!ext) return tile;
    const newRowSpan = tile.rowSpan + ext;
    return { ...tile, rowSpan: newRowSpan, gridRow: `${tile.startRow + 1} / span ${newRowSpan}` };
  });
}

function tilePixelDims(colSpan, rowSpan, rowUnits, width, height, gap, gridCols) {
  const cellW = (width - (gridCols - 1) * gap) / gridCols;
  const cellH = (height - (rowUnits - 1) * gap) / rowUnits;
  return {
    w: colSpan * cellW + (colSpan - 1) * gap,
    h: rowSpan * cellH + (rowSpan - 1) * gap,
  };
}

/**
 * Distribui N tiles de indicadores preenchendo o grid (4 cols) sem lacunas.
 * Cada tile tem rowSpan = INDICATOR_TILE_ROWS. As colunas variam por contagem:
 *   1 tile  → [4]         preenche toda a largura
 *   2 tiles → [3, 1]      big + small
 *   3 tiles → [2, 1, 1]   big + 2 small
 *   4 tiles → [1,1,1,1]   todos iguais
 *   N>4: "banda de resto" no topo (cria variedade) + bandas de 4 iguais abaixo
 */
function _getBandCols(bandSize) {
  if (bandSize === 1) return [4];
  if (bandSize === 2) return [3, 1];
  if (bandSize === 3) return [2, 1, 1];
  return [1, 1, 1, 1];
}

function packIndicatorsFill(tiles) {
  if (!tiles.length) return { placements: [], rowUnits: 0 };

  const N = tiles.length;
  const COLS = PANEL_GRID_COLS;
  const ROW_H = INDICATOR_TILE_ROWS;

  const firstBandSize = N % COLS || COLS;
  const placements = [];
  let tileIdx = 0;
  let row = 0;

  const placeBand = (bandCols) => {
    let col = 0;
    for (const colSpan of bandCols) {
      if (tileIdx >= tiles.length) break;
      placements.push({
        ...tiles[tileIdx],
        colSpan,
        rowSpan: ROW_H,
        gridColumn: `${col + 1} / span ${colSpan}`,
        gridRow:    `${row + 1} / span ${ROW_H}`,
        startRow: row,
        startCol: col,
      });
      col += colSpan;
      tileIdx++;
    }
    row += ROW_H;
  };

  placeBand(_getBandCols(firstBandSize));
  while (tileIdx < tiles.length) placeBand([1, 1, 1, 1]);

  return { placements, rowUnits: row };
}

function computeMasonryLayout(tileDefs, width, height, gap) {
  if (!tileDefs.length || width <= 0 || height <= 0) {
    return {
      cols: PANEL_GRID_COLS,
      indicatorRowUnits: 1,
      indicatorPlacements: [],
      blockPlacements: [],
      indicatorHeight: height,
    };
  }

  // --- Indicator buttons (spans dinâmicos por contagem) ---
  const indTiles = tileDefs.filter((t) => t.kind === 'indicator');

  // --- Bollinger / Quick-EMA sections (separate flex blocks) ---
  const blocks = tileDefs
    .filter((t) => t.kind === 'bb' || t.kind === 'quickEma')
    .map((t) => ({
      ...t,
      colSpan: BANDS_COL_SPAN,
      rowSpan: t.kind === 'bb' ? BOLLINGER_ROW_SPAN : quickEmaRowSpan(t.data.groups),
    }));

  // Pack indicator buttons — spans calculados dinamicamente pelo número de tiles
  const indPack = packIndicatorsFill(indTiles);
  const indFilledPlacements = indPack.placements;
  const indRowUnits = indTiles.length ? Math.max(1, indPack.rowUnits) : 0;

  // Total rows for the shared CSS grid
  const hasIndSection = indTiles.length > 0;
  const totalIndRowUnits = indRowUnits;

  // Height split between indicator section and bands section
  const blockRowUnits = blocks.reduce((sum, b) => sum + b.rowSpan, 0);
  const totalUnits    = (hasIndSection ? totalIndRowUnits : 0) + blockRowUnits;
  const sectionCount  = (hasIndSection ? 1 : 0) + blocks.length;
  const gapTotal      = sectionCount > 1 ? (sectionCount - 1) * gap : 0;
  const availableH    = height - gapTotal;

  const indicatorHeightRaw = hasIndSection && totalUnits > 0
    ? (availableH * totalIndRowUnits) / totalUnits
    : 0;
  // Piso mínimo: evita que o painel force tiles a alturas ilegíveis quando há muitos manipuladores.
  const indicatorHeight = hasIndSection
    ? Math.max(indicatorHeightRaw, totalIndRowUnits * MIN_ROW_UNIT_PX)
    : 0;

  const blockTotalHeight = Math.max(0, availableH - indicatorHeight);
  const indH = indicatorHeight || height;

  // Compute pixel dims now that totalIndRowUnits is known
  const dimsFor = (colSpan, rowSpan) =>
    tilePixelDims(colSpan, rowSpan, totalIndRowUnits, width, indH, gap, PANEL_GRID_COLS);

  const indicatorPlacements = [
    ...indFilledPlacements.map((t) => ({ ...t, dims: dimsFor(t.colSpan, t.rowSpan) })),
  ];

  const blockPlacements = blocks.map((tile) => {
    const blockW = tilePixelDims(tile.colSpan, 1, 1, width, 0, gap, PANEL_GRID_COLS).w;
    const rawH = blockRowUnits > 0
      ? (blockTotalHeight * tile.rowSpan) / blockRowUnits
      : blockTotalHeight;
    return {
      ...tile,
      dims: {
        w: blockW,
        h: Math.max(rawH, tile.rowSpan * MIN_ROW_UNIT_PX),
      },
    };
  });

  return {
    cols: PANEL_GRID_COLS,
    indicatorRowUnits: hasIndSection ? totalIndRowUnits : 0,
    indicatorPlacements,
    blockPlacements,
    indicatorHeight,
  };
}

const panelTileShell = {
  boxSizing: 'border-box',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'stretch',
  width: '100%',
  height: '100%',
};

const panelBlockShell = {
  ...panelTileShell,
  background: 'rgba(0,0,0,0.5)',
  borderRadius: 4,
  padding: PANEL_TILE_PAD,
};

const panelBandsShell = {
  ...panelBlockShell,
};

const blockInner = {
  display: 'flex',
  flexDirection: 'column',
  gap: PANEL_GAP,
  height: '100%',
  width: '100%',
  minHeight: 0,
};

const blockRow = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'stretch',
};

const collapseTabBtn = {
  pointerEvents: 'auto',
  fontSize: 11,
  lineHeight: 1,
  width: 16,
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  borderRadius: 4,
  color: '#94a3b8',
  background: 'rgba(0,0,0,0.55)',
  border: '1px solid #334155',
  transition: 'all 0.15s',
};

function renderIndicatorTile({ id, color, tipKey, active, darkText }, dims, t, toggleIndicator) {
  // Texto vertical quando o tile é significativamente mais alto do que largo
  const isVertical = dims.h > dims.w * 1.3;
  return (
    <PanelTip text={t(tipKey)}>
      <button
        type="button"
        onClick={() => toggleIndicator(id)}
        style={{
          ...panelBtn(active, color, darkText, dims),
          writingMode: isVertical ? 'vertical-lr' : undefined,
          letterSpacing: isVertical ? 1 : undefined,
        }}
      >
        {COMPACT_LABELS[id] ?? id}
      </button>
    </PanelTip>
  );
}

function renderQuickEmaGroupsTile(
  { groups },
  dims,
  t,
  addQuickEmaGroup,
  removeQuickEmaGroup,
  updateQuickEmaGroupInterval,
  toggleQuickEmaGroupPeriod,
  updateQuickEmaGroupBandPct,
  updateQuickEmaGroupBandPeriod,
) {
  const innerW = dims.w - PANEL_TILE_PAD * 2;
  const innerH = dims.h - PANEL_TILE_PAD * 2;
  const rows = quickEmaRowSpan(groups);
  const rowH = (innerH - (rows - 1) * PANEL_GAP) / rows;
  const colW = (innerW - (QUICK_EMA_GRID_COLS - 1) * PANEL_GAP) / QUICK_EMA_GRID_COLS;
  const selectDims = { w: colW * 3 + PANEL_GAP * 2, h: rowH };
  const removeDims = { w: colW, h: rowH };
  const periodDims = { w: colW, h: rowH };
  const bandPeriodDims = { w: innerW, h: rowH };
  const bandDims = { w: colW * 2 + PANEL_GAP, h: rowH };
  const addDims = { w: innerW, h: rowH };

  const cells = groups.flatMap((g, i) => {
    const ivRow = i * QUICK_EMA_GROUP_ROWS + 1;
    const pRow = i * QUICK_EMA_GROUP_ROWS + 2;
    const bandSelectRow = i * QUICK_EMA_GROUP_ROWS + 3;
    const pctRow = i * QUICK_EMA_GROUP_ROWS + 4;
    const bandColor = g.bandPeriod ? (QUICK_EMA_PERIOD_COLORS[g.bandPeriod] ?? '#94a3b8') : '#475569';
    return [
      <div key={`${g.id}-iv`} style={{ gridColumn: '1 / span 3', gridRow: `${ivRow}`, display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.quick_ema_interval')}>
          <select
            value={g.interval}
            onChange={(e) => updateQuickEmaGroupInterval(g.id, e.target.value)}
            style={{ ...panelSelect('#94a3b8', selectDims), fontSize: scaleFontSize(selectDims, 0.35, 9, 13) }}
          >
            {OVERLAY_MA_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </PanelTip>
      </div>,
      <div key={`${g.id}-rm`} style={{ gridColumn: '4', gridRow: `${ivRow}`, display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.quick_ema_remove')}>
          <button
            type="button"
            onClick={() => removeQuickEmaGroup(g.id)}
            style={{ ...panelBtn(false, '#f87171', false, removeDims), fontSize: 11 }}
          >
            ×
          </button>
        </PanelTip>
      </div>,
      ...QUICK_EMA_PERIODS.map((p, pi) => {
        const active = g.periods.includes(p);
        const color = QUICK_EMA_PERIOD_COLORS[p];
        return (
          <div key={`${g.id}-${p}`} style={{ gridColumn: `${pi + 1}`, gridRow: `${pRow}`, display: 'flex', alignItems: 'stretch' }}>
            <PanelTip text={t('chart.tip.quick_ema_period', p, g.interval)}>
              <button
                type="button"
                onClick={() => toggleQuickEmaGroupPeriod(g.id, p)}
                style={panelBtn(active, color, false, periodDims)}
              >
                {p}
              </button>
            </PanelTip>
          </div>
        );
      }),
      <div key={`${g.id}-bandperiod`} style={{ gridColumn: `1 / span ${QUICK_EMA_GRID_COLS}`, gridRow: `${bandSelectRow}`, display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.quick_ema_band_period')}>
          <select
            value={g.bandPeriod ?? 'off'}
            onChange={(e) => updateQuickEmaGroupBandPeriod(g.id, e.target.value === 'off' ? null : e.target.value)}
            style={{
              ...panelSelect(bandColor, bandPeriodDims),
              fontSize: scaleFontSize(bandPeriodDims, 0.35, 9, 13),
              opacity: g.bandPeriod ? 1 : 0.6,
            }}
          >
            <option value="off">OFF</option>
            {QUICK_EMA_PERIODS.map((p) => <option key={p} value={p}>{`EMA${p}`}</option>)}
          </select>
        </PanelTip>
      </div>,
      <div key={`${g.id}-above`} style={{ gridColumn: '1 / span 2', gridRow: `${pctRow}`, display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.quick_ema_band_above')}>
          <select
            value={g.abovePct ?? 'off'}
            onChange={(e) => updateQuickEmaGroupBandPct(g.id, 'above', e.target.value === 'off' ? null : (e.target.value === QUICK_EMA_BAND_ADAPTIVE ? QUICK_EMA_BAND_ADAPTIVE : Number(e.target.value)))}
            style={{
              ...panelSelect(g.abovePct === QUICK_EMA_BAND_ADAPTIVE ? '#facc15' : (g.abovePct != null ? '#22c55e' : '#475569'), bandDims),
              fontSize: scaleFontSize(bandDims, 0.35, 9, 13),
              opacity: g.abovePct != null ? 1 : 0.6,
            }}
          >
            <option value="off">OFF</option>
            <option value={QUICK_EMA_BAND_ADAPTIVE}>ADAPT</option>
            {QUICK_EMA_BAND_PCT_OPTIONS.map((pct) => <option key={pct} value={pct}>{`+${pct}%`}</option>)}
          </select>
        </PanelTip>
      </div>,
      <div key={`${g.id}-below`} style={{ gridColumn: '3 / span 2', gridRow: `${pctRow}`, display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.quick_ema_band_below')}>
          <select
            value={g.belowPct ?? 'off'}
            onChange={(e) => updateQuickEmaGroupBandPct(g.id, 'below', e.target.value === 'off' ? null : (e.target.value === QUICK_EMA_BAND_ADAPTIVE ? QUICK_EMA_BAND_ADAPTIVE : Number(e.target.value)))}
            style={{
              ...panelSelect(g.belowPct === QUICK_EMA_BAND_ADAPTIVE ? '#facc15' : (g.belowPct != null ? '#f87171' : '#475569'), bandDims),
              fontSize: scaleFontSize(bandDims, 0.35, 9, 13),
              opacity: g.belowPct != null ? 1 : 0.6,
            }}
          >
            <option value="off">OFF</option>
            <option value={QUICK_EMA_BAND_ADAPTIVE}>ADAPT</option>
            {QUICK_EMA_BAND_PCT_OPTIONS.map((pct) => <option key={pct} value={pct}>{`-${pct}%`}</option>)}
          </select>
        </PanelTip>
      </div>,
    ];
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${QUICK_EMA_GRID_COLS}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, 1fr)`,
      gap: PANEL_GAP,
      width: innerW,
      height: innerH,
      boxSizing: 'border-box',
    }}>
      {cells}
      {groups.length < MAX_QUICK_EMA_GROUPS && (
        <div style={{ gridColumn: `1 / span ${QUICK_EMA_GRID_COLS}`, gridRow: `${rows}`, display: 'flex', alignItems: 'stretch' }}>
          <PanelTip text={t('chart.tip.quick_ema_add')}>
            <button
              type="button"
              onClick={addQuickEmaGroup}
              style={panelBtn(false, '#94a3b8', false, addDims)}
            >
              + Intervalo
            </button>
          </PanelTip>
        </div>
      )}
    </div>
  );
}


function ChartIndicatorPanel({
  activeIndicators,
  toggleIndicator,
  quickEmaGroups,
  addQuickEmaGroup,
  removeQuickEmaGroup,
  updateQuickEmaGroupInterval,
  toggleQuickEmaGroupPeriod,
  updateQuickEmaGroupBandPct,
  updateQuickEmaGroupBandPeriod,
  bollingerBands,
  setBollingerBands,
  overlayMaLoading,
  panelButtons,
  collapsed,
  onToggleCollapse,
  onLayoutChange,
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const outerRef = useRef(null);
  const masonryRef = useRef(null);
  const [panelSize, setPanelSize] = useState({ width: PANEL_MIN_WIDTH, height: 320 });

  const tileDefs = useMemo(() => {
    const showKey = (key) => panelButtons[key] !== false;
    const indicators = [...INDICATOR_GROUPS, ...RSI_EXTRA_INDICATORS].filter(({ id }) => showKey(id));
    const showBb = showKey('bb');

    const list = [];
    for (const ind of indicators) {
      list.push({
        key: `ind-${ind.id}`,
        kind: 'indicator',
        data: {
          ...ind,
          active: activeIndicators.includes(ind.id),
          darkText: ind.id === 'ma200' || ind.id === 'rsi80' || ind.id === 'rsi50',
        },
      });
    }
    if (showBb) {
      list.push({ key: 'bb', kind: 'bb', data: {} });
    }
    list.push({ key: 'quickEma', kind: 'quickEma', data: { groups: quickEmaGroups } });
    return list;
  }, [panelButtons, activeIndicators, quickEmaGroups]);

  const contentWidth = useMemo(
    () => resolvePanelContentWidth(outerRef.current?.parentElement?.clientWidth ?? panelSize.width),
    [panelSize.width],
  );

  const layout = useMemo(
    () => computeMasonryLayout(tileDefs, contentWidth, panelSize.height, PANEL_GAP, overlayMaLoading),
    [tileDefs, contentWidth, panelSize.height, overlayMaLoading],
  );

  useEffect(() => {
    if (collapsed || !tileDefs.length) {
      onLayoutChange?.({ columnCount: 0, width: collapsed ? CHART_PANEL_COLLAPSED : 0 });
      return undefined;
    }
    onLayoutChange?.({ columnCount: layout.cols, width: computePanelWidth(contentWidth, true) });

    const shell = masonryRef.current;
    const chart = outerRef.current?.parentElement;
    if (!shell || !chart) return undefined;

    const measure = () => {
      const w = resolvePanelContentWidth(chart.clientWidth);
      const h = shell.clientHeight;
      if (w > 0 && h > 0) setPanelSize({ width: w, height: h });
      onLayoutChange?.({ columnCount: layout.cols, width: computePanelWidth(w, true) });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(shell);
    ro.observe(chart);
    return () => ro.disconnect();
  }, [collapsed, tileDefs.length, layout.cols, contentWidth, onLayoutChange]);

  if (!tileDefs.length) {
    return null;
  }

  return (
    <div
      ref={outerRef}
      style={{
        position: 'absolute',
        top: 0,
        bottom: isMobile ? MOBILE_PANEL_BOTTOM_INSET : 0,
        right: 0,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        justifyContent: 'flex-end',
        padding: 0,
        pointerEvents: 'none',
      }}
    >
      <PanelTip text={t(collapsed ? 'chart.tip.panel_expand' : 'chart.tip.panel_collapse')} position="left">
        <button
          type="button"
          onClick={onToggleCollapse}
          style={{ ...collapseTabBtn, alignSelf: 'center', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#e2e8f0'; e.currentTarget.style.borderColor = '#64748b'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#334155'; }}
        >
          {collapsed ? '‹' : '›'}
        </button>
      </PanelTip>

      {!collapsed && (
        <div
          ref={masonryRef}
          style={{
            pointerEvents: 'auto',
            height: '100%',
            width: contentWidth,
            minWidth: contentWidth,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            marginLeft: PANEL_GAP,
            display: 'flex',
            flexDirection: 'column',
            gap: PANEL_GAP,
          }}
        >
          {/* Cabeçalho do painel lateral */}
          <div style={{
            textAlign: 'center',
            fontSize: 7,
            fontFamily: 'monospace',
            color: '#475569',
            letterSpacing: 2,
            textTransform: 'uppercase',
            flexShrink: 0,
            userSelect: 'none',
            lineHeight: 1,
            paddingBottom: 1,
          }}>
            {t('chart.panel.overlay_title')}
          </div>

          {layout.indicatorPlacements.length > 0 && (
            <div style={{
              flex: layout.blockPlacements.length > 0 ? layout.indicatorRowUnits : 1,
              minHeight: layout.indicatorRowUnits * MIN_ROW_UNIT_PX,
              display: 'grid',
              gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
              gridTemplateRows: `repeat(${layout.indicatorRowUnits}, 1fr)`,
              gridAutoFlow: 'dense',
              gap: PANEL_GAP,
              width: '100%',
            }}
            >
              {layout.indicatorPlacements.map((tile) => (
                <div
                  key={tile.key}
                  style={{
                    ...(tile.kind === 'indicator' ? panelTileShell : panelBlockShell),
                    gridColumn: tile.gridColumn,
                    gridRow: tile.gridRow,
                  }}
                >
                  {tile.kind === 'indicator' && renderIndicatorTile(tile.data, tile.dims, t, toggleIndicator)}
                </div>
              ))}
            </div>
          )}

          {layout.blockPlacements.map((tile) => (
            <div
              key={tile.key}
              style={{
                ...panelBandsShell,
                flex: tile.rowSpan,
                minHeight: tile.rowSpan * MIN_ROW_UNIT_PX,
                width: `${(tile.colSpan / PANEL_GRID_COLS) * 100}%`,
              }}
            >
              {tile.kind === 'bb' && renderBollingerTile(tile.dims, t, bollingerBands, setBollingerBands)}
              {tile.kind === 'quickEma' && renderQuickEmaGroupsTile(
                tile.data, tile.dims, t,
                addQuickEmaGroup, removeQuickEmaGroup, updateQuickEmaGroupInterval, toggleQuickEmaGroupPeriod,
                updateQuickEmaGroupBandPct, updateQuickEmaGroupBandPeriod,
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue('--color-p1').trim() || '#1a0a25',
    panel: style.getPropertyValue('--color-p2').trim() || '#003f69',
    text: style.getPropertyValue('--color-p5').trim() || '#b3aca4',
    axis: style.getPropertyValue('--color-p4').trim() || '#157a8c',
  };
}


function fmtChartPrice(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p < 0.01 ? p.toFixed(6) : p < 1 ? p.toFixed(4) : p.toFixed(2);
}

/** Preço de compra aberto para o símbolo do gráfico (multitrade, exchange, FIFO). */
function resolveChartBuyPrice(symbol, {
  multitradeFavorites, fiveMTradeFavorites, activeTrades,
  allTrades, tradePurchases, chartTradeMarkers,
}) {
  const sym = symbol?.toUpperCase();
  if (!sym) return null;

  const mtBought = multitradeFavorites?.find(
    e => e.symbol?.toUpperCase() === sym && e.phase === 'BOUGHT' && e.buyPrice != null,
  );
  if (mtBought) {
    return {
      price: Number(mtBought.buyPrice),
      time: mtBought.buyTime ? new Date(mtBought.buyTime).getTime() : null,
    };
  }

  const fmBought = fiveMTradeFavorites?.find(
    e => e.symbol?.toUpperCase() === sym && e.phase === 'BOUGHT' && (e.buy_price != null || e.buyPrice != null),
  );
  if (fmBought) {
    const price = fmBought.buy_price ?? fmBought.buyPrice;
    const buyTime = fmBought.buy_time ?? fmBought.buyTime;
    return {
      price: Number(price),
      time: buyTime ? new Date(buyTime).getTime() : null,
    };
  }

  const at = activeTrades?.get?.(sym);
  if (at?.buyPrice != null) return { price: Number(at.buyPrice), time: null };

  const entryMarker = [...(chartTradeMarkers ?? [])].reverse().find(
    m => (m.side === 'entry' || m.side === 'buy') && m.price != null,
  );
  if (entryMarker) return { price: Number(entryMarker.price), time: entryMarker.time ?? null };

  if (allTrades?.length) {
    const inv = [];
    const sorted = [...allTrades].sort((a, b) => Number(a.time) - Number(b.time));
    for (const t of sorted) {
      const price = Number(t.price);
      const qty = Number(t.qty);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
      if (t.isBuyer) {
        if (qty > 0) inv.push({ qty, price, time: Number(t.time) });
      } else {
        let remain = qty;
        while (remain > 1e-12 && inv.length) {
          const take = Math.min(inv[0].qty, remain);
          inv[0].qty -= take;
          remain -= take;
          if (inv[0].qty <= 1e-12) inv.shift();
        }
      }
    }
    if (inv.length) {
      const totalQty = inv.reduce((s, l) => s + l.qty, 0);
      const avgPrice = inv.reduce((s, l) => s + l.qty * l.price, 0) / totalQty;
      const firstLot = inv[0];
      return { price: avgPrice, time: firstLot?.time ?? null };
    }
  }

  if (tradePurchases?.length) {
    const last = [...tradePurchases].sort((a, b) => Number(a.time) - Number(b.time)).pop();
    if (last?.price != null) return { price: Number(last.price), time: Number(last.time) };
  }

  return null;
}

/** Série line do preço de compra até o fechamento atual (evita markLine coord no eixo categoria). */
function buildBuyPnlSeries(buyInfo, candlesticks, DL, LEFT_PAD, RIGHT_PAD, lastClose) {
  if (!buyInfo?.price || lastClose == null || !candlesticks?.length) return null;
  const buyPrice = buyInfo.price;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(lastClose)) return null;

  const pct = ((lastClose - buyPrice) / buyPrice) * 100;
  const isUp = pct >= 0;
  const color = isUp ? C_UP : C_DOWN;
  const pctLabel = `${isUp ? '+' : ''}${pct.toFixed(2)}%`;

  const offset = candlesticks.length - DL;
  let buyIdx = 0;
  if (buyInfo.time != null) {
    const absIdx = candlesticks.reduce((best, c, i) =>
      Math.abs(Number(c.openTime) - buyInfo.time) < Math.abs(Number(candlesticks[best].openTime) - buyInfo.time)
        ? i : best,
    0);
    buyIdx = Math.max(0, Math.min(DL - 1, absIdx - offset));
  }

  const x1 = buyIdx + LEFT_PAD;
  const x2 = (DL - 1) + LEFT_PAD;
  const totalLen = LEFT_PAD + DL + RIGHT_PAD;
  if (x1 < 0 || x2 < 0 || x1 >= totalLen || x2 >= totalLen) return null;

  const data = new Array(totalLen).fill(null);
  data[x1] = buyPrice;
  data[x2] = lastClose;

  return {
    name: 'PnL',
    type: 'line',
    data,
    connectNulls: true,
    showSymbol: true,
    symbol: 'circle',
    symbolSize: 4,
    lineStyle: { color, width: 1.5, type: 'dotted' },
    itemStyle: { color },
    endLabel: {
      show: true,
      formatter: pctLabel,
      color: '#fff',
      backgroundColor: color,
      padding: [2, 4],
      borderRadius: 2,
      fontSize: 8,
      fontWeight: 'bold',
    },
    z: 10,
    silent: true,
    animation: false,
  };
}

function buildStopLossLineSeries(buyInfo, stopLossConfig, candlesticks, DL, LEFT_PAD, RIGHT_PAD) {
  if (!buyInfo?.price || !stopLossConfig) return null;
  const built = buildTrailingStopSeries(
    candlesticks, buyInfo.price, buyInfo.time ?? null, stopLossConfig, DL, LEFT_PAD, RIGHT_PAD,
  );
  if (!built) return null;
  const lastVal = [...built.data].reverse().find(v => v != null);
  return {
    name: 'Stop Loss',
    type: 'line',
    step: 'end',
    data: built.data,
    showSymbol: false,
    z: 4,
    lineStyle: { color: '#ef4444', width: 1.5, type: 'dashed' },
    ...(lastVal != null ? {
      endLabel: {
        show: true,
        formatter: fmtChartPrice(lastVal),
        color: '#fff',
        fontSize: 9,
        backgroundColor: '#ef4444',
        padding: [2, 4],
        borderRadius: 2,
      },
    } : {}),
  };
}

function buildMultitradeMarkLines(candlesticks, interval, markers, DL, LEFT_PAD) {
  if (!markers?.length || !candlesticks?.length) return [];
  const ms = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000 }[interval] ?? 900_000;
  const offset = candlesticks.length - DL;
  const styles = {
    signal:         { color: '#f59e0b', label: '◆ Sinal' },
    buy:            { color: '#22c55e', label: '▲ Buy' },
    sell:           { color: '#ef4444', label: '▼ Sell' },
    entry:          { color: '#ffffff', label: '▌ Entrada' },
    possible_entry: { color: '#ffffff', label: '◌ Entrada pronta' },
  };
  return markers.flatMap(m => {
    let best = 0;
    let bestDiff = Infinity;
    candlesticks.forEach((c, i) => {
      const d = Math.abs(Number(c.openTime) - m.time);
      if (d < bestDiff) { bestDiff = d; best = i; }
    });
    if (bestDiff > ms * 1.5) return [];
    const localIdx = best - offset;
    if (localIdx < 0 || localIdx >= DL) return [];
    const st = styles[m.side] ?? { color: '#94a3b8', label: m.side };
    const dashed = m.side === 'signal' || m.side === 'possible_entry';
    const label = m.label ?? (m.pnlPct != null
      ? `▼ ${Number(m.pnlPct) >= 0 ? '+' : ''}${Number(m.pnlPct).toFixed(1)}%`
      : st.label);
    return [{
      xAxis: localIdx + LEFT_PAD,
      lineStyle: { color: st.color, width: m.side === 'entry' || m.side === 'possible_entry' ? 2 : 1.5, type: dashed ? 'dashed' : 'solid' },
      label: {
        show: true,
        formatter: label,
        color: m.side === 'sell' && m.pnlPct != null
          ? (Number(m.pnlPct) >= 0 ? '#22c55e' : '#ef4444')
          : st.color,
        fontSize: 9,
        position: m.side === 'sell' ? 'insideEndBottom' : 'insideStartTop',
        padding: [2, 4],
      },
    }];
  });
}

function buildOption({ symbol, interval, candlesticks, ichimokuCloud, movingAverage, ma50, ma9, ma21, rsi }, colors, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = [], overlayConfigs = [], multitradeMarkers = [], chartLeftPad = CHART_LEFT_MARGIN, buyInfo = null, stopLossConfig = null, chartRightPad = CHART_PRICE_PAD + CHART_LEFT_MARGIN, bollingerConfig = null) {
  const showMa9      = activeIndicators.includes('ma9');
  const showMa21     = activeIndicators.includes('ma21');
  const showMa50     = activeIndicators.includes('ma50');
  const showMa200    = activeIndicators.includes('ma200');
  const showIchimoku = activeIndicators.includes('ichimoku');
  const showRsi      = activeIndicators.includes('rsi');
  const showRsi50    = activeIndicators.includes('rsi50');
  const showRsi80    = activeIndicators.includes('rsi80');
  const showStopLoss = activeIndicators.includes('stopLoss');
  const DL = Math.min(displayLimit, candlesticks.length);
  const LEFT_PAD  = 1;
  const RIGHT_PAD = showIchimoku ? 24 : 3;

  const xData = (() => {
    const slicedDates = candlesticks.slice(-DL).map((c) => convertOpenTime(c.openTime, interval));
    return [...new Array(LEFT_PAD).fill(''), ...slicedDates, ...new Array(RIGHT_PAD).fill('')];
  })();

  // Separadores de dia — só faz sentido em intervalos intraday (< 1d)
  const INTRADAY = !['1d', '3d', '1w'].includes(interval);

  const dayBreakData = (() => {
    if (!INTRADAY) return [];
    const visible = candlesticks.slice(-DL);
    const result  = [];
    let prevDay   = null;
    visible.forEach((c, i) => {
      const day = new Date(Number(c.openTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (prevDay !== null && day !== prevDay) {
        result.push({
          xAxis: i + LEFT_PAD,
          lineStyle: { color: 'rgba(255,255,255,0.07)', width: 1, type: 'solid' },
          label: {
            show: true,
            formatter: day.slice(0, 5),     // "07/06"
            color: 'rgba(255,255,255,0.22)',
            fontSize: 9,
            position: 'insideEndTop',
            padding: [2, 3],
          },
        });
      }
      prevDay = day;
    });
    return result;
  })();

  const periodMarkData = (() => {
    if (!zoomPeriod) return [];
    const startMs  = new Date(zoomPeriod.startDate).getTime();
    const endMs    = new Date(zoomPeriod.endDate).getTime();
    const startIdx = candlesticks.findIndex(c => Number(c.openTime) >= startMs);
    const endIdx   = candlesticks.reduce((best, c, i) =>
      Number(c.openTime) <= endMs ? i : best, -1);
    const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).replace(',', '');
    const line = (idx, label) => ({
      xAxis: idx + LEFT_PAD,
      lineStyle: { color: 'rgba(255,255,255,0.45)', width: 1, type: 'dashed' },
      label: { show: true, formatter: label, color: 'rgba(255,255,255,0.75)',
               fontSize: 12, fontWeight: 'bold', position: 'insideEndTop', padding: [2, 4] },
    });
    const data = [];
    if (startIdx !== -1) data.push(line(startIdx, fmt(zoomPeriod.startDate)));
    if (endIdx   !== -1) data.push(line(endIdx,   fmt(zoomPeriod.endDate)));
    return data;
  })();

  const fmtTradeDate = (ms) => {
    const d = new Date(ms);
    const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  };

  const tradeMarkData = (() => {
    if (!tradeTimes.length || multitradeMarkers?.length) return [];
    const offset = candlesticks.length - DL;
    return tradeTimes.flatMap(tradeMs => {
      const idx = candlesticks.reduce((best, c, i) =>
        Math.abs(Number(c.openTime) - tradeMs) < Math.abs(Number(candlesticks[best].openTime) - tradeMs)
          ? i : best
      , 0);
      const localIdx = idx - offset;
      if (localIdx < 0) return [];
      return [{
        xAxis: localIdx + LEFT_PAD,
        lineStyle: { color: '#ffffff', width: 2, type: 'solid' },
        label: {
          show: true,
          formatter: `▌ ${fmtTradeDate(tradeMs)}`,
          color: '#ffffff',
          fontSize: 9,
          position: 'insideStartTop',
          padding: [3, 5],
        },
      }];
    });
  })();

  // Todas as markLines unificadas: separadores de dia + zoom + compras + sinais MT
  const mtMarkData = buildMultitradeMarkLines(candlesticks, interval, multitradeMarkers, DL, LEFT_PAD);
  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData, ...mtMarkData];

  const lastClose = candlesticks.length ? parseFloat(candlesticks[candlesticks.length - 1].close) : null;
  const buyPnlSeries = buildBuyPnlSeries(buyInfo, candlesticks, DL, LEFT_PAD, RIGHT_PAD, lastClose);
  const stopLossSeries = showStopLoss
    ? buildStopLossLineSeries(buyInfo, stopLossConfig, candlesticks, DL, LEFT_PAD, RIGHT_PAD)
    : null;
  const finalMarkLine = {
    silent: true, symbol: 'none',
    data: [
      ...allMarkLineData,
      ...(lastClose != null ? [{
        yAxis: lastClose,
        lineStyle: { color: 'rgba(0,0,0,0)' },
        label: {
          show: true, position: 'end', align: 'right', distance: 2,
          formatter: fmtChartPrice(lastClose),
          color: '#111', fontSize: 10, fontWeight: 'bold',
          backgroundColor: '#facc15', padding: [2, 5], borderRadius: 2,
        }
      }] : [])
    ]
  };

  const axisBase = (gridIndex) => ({
    gridIndex,
    type: 'category',
    data: xData,
    axisLine: { lineStyle: { color: colors.panel } },
    axisLabel: { color: colors.text, fontSize: 10, show: gridIndex === (showRsi ? 1 : 0) },
    splitLine: { show: false },
  });

  // Alinha séries com o eixo X:
  // — left-pad com null quando a série tem menos valores que DL (moedas novas com poucos candles)
  // — right-pad com null quando Ichimoku está ativo (24 posições futuras no xData)
  const futurePad = RIGHT_PAD;
  const alignSeries = (arr) => {
    const raw = arr?.slice(-DL) ?? [];
    return [
      ...new Array(LEFT_PAD + Math.max(0, DL - raw.length)).fill(null),
      ...raw,
      ...new Array(futurePad).fill(null),
    ];
  };

  const overlayLineSeries = buildOverlaySeries(overlayConfigs, candlesticks, alignSeries);
  const bollingerSeries = buildBollingerSeries(bollingerConfig, candlesticks, alignSeries);

  const _fmtV = v => v == null ? '—' : (v < 0.01 ? Number(v).toFixed(6) : v < 1 ? Number(v).toFixed(4) : Number(v).toFixed(2));

  const tooltipFormatter = (params) => {
    const time = params[0]?.axisValue ?? '';
    let html = `<div style="font-family:monospace;font-size:11px;min-width:150px;line-height:1.6">`;
    html += `<div style="margin-bottom:5px;opacity:0.5;font-size:10px">${time}</div>`;
    for (const p of params) {
      if (p.value == null) continue;
      if (p.seriesType === 'candlestick') {
        const [o, c, l, h] = p.value;
        const up = parseFloat(c) >= parseFloat(o);
        const col = up ? '#26a69a' : '#ef5350';
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin-bottom:4px">`;
        html += `<span style="color:#888">O</span><span style="color:${col};font-weight:bold">${_fmtV(o)}</span>`;
        html += `<span style="color:#888">H</span><span style="color:${col}">${_fmtV(h)}</span>`;
        html += `<span style="color:#888">L</span><span style="color:${col}">${_fmtV(l)}</span>`;
        html += `<span style="color:#888">C</span><span style="color:${col};font-weight:bold">${_fmtV(c)}</span>`;
        html += `</div><hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:3px 0"/>`;
      } else {
        if (p.seriesName === 'CL' || p.seriesName === 'BL' || p.seriesName === 'Span A' || p.seriesName === 'Span B' || p.seriesName === 'PnL') continue;
        let col = p.color ?? '#fff';
        if (p.seriesName === 'RSI') {
          const rv = parseFloat(p.value);
          col = rv >= 70 ? '#26a69a' : rv <= 30 ? '#ef5350' : '#a78bfa';
        }
        html += `<div style="display:flex;justify-content:space-between;gap:14px">`;
        html += `<span style="color:${col};opacity:0.85">${p.seriesName}</span>`;
        html += `<span style="color:#fff;font-weight:bold">${_fmtV(p.value)}</span>`;
        html += `</div>`;
      }
    }
    html += `</div>`;
    return html;
  };

  const ma9Data   = alignSeries(ma9);
  const ma21Data  = alignSeries(ma21);
  const ma50Data  = alignSeries(ma50);
  const ma200Data = alignSeries(movingAverage);
  const zoomWindow = zoomPeriod ? computeZoomWindow(candlesticks, zoomPeriod) : null;

  const candleSeries = (idx) => [
    {
      name: 'Candles',
      type: 'candlestick',
      xAxisIndex: idx, yAxisIndex: idx,
      data: [...new Array(LEFT_PAD).fill('-'), ...candlesticks.slice(-DL).map((c) => [c.open, c.close, c.low, c.high])],
      itemStyle: { color: C_UP, color0: C_DOWN, borderColor: C_UP, borderColor0: C_DOWN },
      markLine: finalMarkLine,
    },
    ...(showMa9 && ma9?.length ? [{
      name: 'EMA9',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma9Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#e879f9', width: 1.5 },
    }] : []),
    ...(showMa21 && ma21?.length ? [{
      name: 'EMA21',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma21Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#fb923c', width: 1.5 },
    }] : []),
    ...(showMa50 && ma50?.length ? [{
      name: 'EMA50',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma50Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#22d3ee', width: 1.5 },
    }] : []),
    ...(showMa200 ? [{
      name: 'EMA200',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma200Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#f59e0b', width: 1.5 },
    }] : []),
    ...(showIchimoku ? [
      { name: 'CL', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-DL).map((c) => c.conversion)],
        smooth: true, showSymbol: false, lineStyle: { color: '#60a5fa', width: 1 } },
      { name: 'BL', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-DL).map((c) => c.base)],
        smooth: true, showSymbol: false, lineStyle: { color: '#94a3b8', width: 1 } },
      { name: 'Span A', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-(DL + RIGHT_PAD)).map((c) => c.spanA)],
        showSymbol: false, lineStyle: { color: C_UP, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(38,166,154,0.05)' } },
      { name: 'Span B', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-(DL + RIGHT_PAD)).map((c) => c.spanB)],
        smooth: true, showSymbol: false, lineStyle: { color: C_DOWN, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(239,83,80,0.05)' } },
    ] : []),
    ...overlayLineSeries.map(s => ({ ...s, xAxisIndex: idx, yAxisIndex: idx })),
    ...bollingerSeries.map(s => ({ ...s, xAxisIndex: idx, yAxisIndex: idx })),
    ...(buyPnlSeries ? [{ ...buyPnlSeries, xAxisIndex: idx, yAxisIndex: idx }] : []),
    ...(stopLossSeries ? [{ ...stopLossSeries, xAxisIndex: idx, yAxisIndex: idx }] : []),
  ];

  if (!showRsi) {
    return {
      backgroundColor: colors.bg,
      title: {
        text: symbol, subtext: interval, left: chartLeftPad, top: 8,
        textStyle: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
        subtextStyle: { color: colors.axis, fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis', backgroundColor: '#003f69ee', borderColor: colors.axis,
        textStyle: { color: colors.text, fontSize: 11 },
        formatter: tooltipFormatter,
        axisPointer: { animation: false, type: 'cross', lineStyle: { color: colors.axis, width: 1, opacity: 0.8 } },
      },
      xAxis: { type: 'category', data: xData,
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { show: false } },
      yAxis: { scale: true, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      grid: { top: 40, bottom: 12, left: chartLeftPad, right: chartRightPad },
      dataZoom: zoomWindow
        ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct)
        : buildInsideDataZoom(),
      series: candleSeries(0),
    };
  }

  const rsiData = alignSeries(rsi);

  return {
    backgroundColor: colors.bg,
    title: {
      text: symbol, subtext: interval, left: chartLeftPad, top: 8,
      textStyle: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
      subtextStyle: { color: colors.axis, fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis', backgroundColor: '#003f69ee', borderColor: colors.axis,
      textStyle: { color: colors.text, fontSize: 11 },
      formatter: tooltipFormatter,
      axisPointer: { animation: false, type: 'cross', lineStyle: { color: colors.axis, width: 1, opacity: 0.8 } },
    },
    grid: [
      { top: 40, bottom: '24%', left: chartLeftPad, right: chartRightPad },
      { top: '79%', bottom: 20, left: chartLeftPad, right: chartRightPad },
    ],
    xAxis: [
      { ...axisBase(0), axisLabel: { show: false } },
      { ...axisBase(1) },
    ],
    yAxis: [
      { gridIndex: 0, scale: true, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      { gridIndex: 1, min: 0, max: 100, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 9 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.2 } },
        interval: 30 },
    ],
    dataZoom: zoomWindow
      ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct, [0, 1])
      : buildInsideDataZoom([0, 1]),
    series: [
      ...candleSeries(0),
      {
        name: 'RSI',
        type: 'line',
        xAxisIndex: 1, yAxisIndex: 1,
        data: rsiData,
        showSymbol: false,
        lineStyle: { color: '#a78bfa', width: 1.5 },
        markLine: {
          silent: true, symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef5350', type: 'dashed', width: 1 },
              label: { formatter: '30', color: '#ef5350', fontSize: 9, position: 'end' } },
            ...(showRsi50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.6 },
              label: { formatter: '50', color: '#facc15', fontSize: 9, position: 'end' } }] : []),
            { yAxis: 70, lineStyle: { color: '#26a69a', type: 'dashed', width: 1 },
              label: { formatter: '70', color: '#26a69a', fontSize: 9, position: 'end' } },
            ...(showRsi80 ? [{ yAxis: 80, lineStyle: { color: '#fb923c', type: 'dashed', width: 1 },
              label: { formatter: '80', color: '#fb923c', fontSize: 9, position: 'end' } }] : []),
          ],
        },
      },
    ],
  };
}

// ── Gráfico Matrix: área de preço + RSI, tema terminal verde ─────────────────

function buildMatrixOption({ symbol, interval, candlesticks, rsi }, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = [], chartLeftPad = CHART_LEFT_MARGIN, buyInfo = null, stopLossConfig = null, chartRightPad = CHART_PRICE_PAD + CHART_LEFT_MARGIN) {
  const showRsi   = activeIndicators.includes('rsi');
  const showRsi50 = activeIndicators.includes('rsi50');
  const showRsi80 = activeIndicators.includes('rsi80');
  const showStopLoss = activeIndicators.includes('stopLoss');
  const DL      = Math.min(displayLimit, candlesticks.length);
  const LEFT_PAD  = 1;
  const RIGHT_PAD = 3;
  const INTRADAY = !['1d', '3d', '1w'].includes(interval);

  const G        = '#22c55e';                       // verde Matrix
  const G_DIM    = 'rgba(34,197,94,0.08)';
  const G_LABEL  = 'rgba(34,197,94,0.38)';
  const BG       = '#050d0a';

  const xData = (() => {
    const slicedDates = candlesticks.slice(-DL).map(c => convertOpenTime(c.openTime, interval));
    return [...new Array(LEFT_PAD).fill(''), ...slicedDates, ...new Array(RIGHT_PAD).fill('')];
  })();

  // separadores de dia (em tom verde)
  const dayBreakData = (() => {
    if (!INTRADAY) return [];
    const visible = candlesticks.slice(-DL);
    const result  = [];
    let prevDay   = null;
    visible.forEach((c, i) => {
      const day = new Date(Number(c.openTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (prevDay !== null && day !== prevDay) {
        result.push({
          xAxis: i + LEFT_PAD,
          lineStyle: { color: 'rgba(34,197,94,0.10)', width: 1, type: 'solid' },
          label: { show: true, formatter: day.slice(0, 5), color: 'rgba(34,197,94,0.28)', fontSize: 9, position: 'insideEndTop', padding: [2, 3] },
        });
      }
      prevDay = day;
    });
    return result;
  })();

  // linhas de zoom de período
  const periodMarkData = (() => {
    if (!zoomPeriod) return [];
    const startMs  = new Date(zoomPeriod.startDate).getTime();
    const endMs    = new Date(zoomPeriod.endDate).getTime();
    const startIdx = candlesticks.findIndex(c => Number(c.openTime) >= startMs);
    const endIdx   = candlesticks.reduce((best, c, i) => Number(c.openTime) <= endMs ? i : best, -1);
    const fmt = iso => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    const mk  = (idx, label) => ({ xAxis: idx + LEFT_PAD, lineStyle: { color: 'rgba(255,255,255,0.35)', width: 1, type: 'dashed' }, label: { show: true, formatter: label, color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 'bold', position: 'insideEndTop', padding: [2, 4] } });
    const data = [];
    if (startIdx !== -1) data.push(mk(startIdx, fmt(zoomPeriod.startDate)));
    if (endIdx   !== -1) data.push(mk(endIdx,   fmt(zoomPeriod.endDate)));
    return data;
  })();

  // linhas de compra
  const fmtTradeDate = ms => {
    const d    = new Date(ms);
    const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  };
  const tradeMarkData = (() => {
    if (!tradeTimes.length) return [];
    const offset = candlesticks.length - DL;
    return tradeTimes.flatMap(tradeMs => {
      const idx      = candlesticks.reduce((best, c, i) => Math.abs(Number(c.openTime) - tradeMs) < Math.abs(Number(candlesticks[best].openTime) - tradeMs) ? i : best, 0);
      const localIdx = idx - offset;
      if (localIdx < 0) return [];
      return [{ xAxis: localIdx + LEFT_PAD, lineStyle: { color: '#3b82f6', width: 1.5, type: 'solid' }, label: { show: true, formatter: `compra ${fmtTradeDate(tradeMs)}`, color: '#3b82f6', fontSize: 9, position: 'insideStartTop', padding: [3, 5] } }];
    });
  })();

  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData];
  const zoomWindow = zoomPeriod ? computeZoomWindow(candlesticks, zoomPeriod) : null;

  const closes    = candlesticks.slice(-DL).map(c => c.close);
  const lastClose = candlesticks.length ? parseFloat(candlesticks[candlesticks.length - 1].close) : null;
  const buyPnlSeries = buildBuyPnlSeries(buyInfo, candlesticks, DL, LEFT_PAD, RIGHT_PAD, lastClose);
  const stopLossSeries = showStopLoss
    ? buildStopLossLineSeries(buyInfo, stopLossConfig, candlesticks, DL, LEFT_PAD, RIGHT_PAD)
    : null;
  const finalMarkLine = {
    silent: true, symbol: 'none',
    data: [
      ...allMarkLineData,
      ...(lastClose != null ? [{
        yAxis: lastClose,
        lineStyle: { color: 'rgba(0,0,0,0)' },
        label: {
          show: true, position: 'end', align: 'right', distance: 2,
          formatter: fmtChartPrice(lastClose),
          color: BG, fontSize: 10, fontWeight: 'bold',
          backgroundColor: G, padding: [2, 5], borderRadius: 2, fontFamily: 'monospace',
        }
      }] : [])
    ]
  };
  const rsiData = (() => {
    const raw = rsi?.slice(-DL) ?? [];
    return [...new Array(LEFT_PAD + Math.max(0, DL - raw.length)).fill(null), ...raw, ...new Array(RIGHT_PAD).fill(null)];
  })();

  const axisBase = (gridIndex, showLabel) => ({
    gridIndex,
    type: 'category',
    data: xData,
    boundaryGap: false,
    axisLine:  { lineStyle: { color: G_DIM } },
    axisLabel: { show: showLabel, color: G_LABEL, fontSize: 9 },
    splitLine: { show: false },
    axisTick:  { show: false },
  });

  const yAxisBase = (gridIndex, extra = {}) => ({
    gridIndex,
    scale: true,
    position: 'right',
    axisLine:  { lineStyle: { color: G_DIM } },
    axisLabel: { color: G_LABEL, fontSize: 9 },
    splitLine: { lineStyle: { color: G_DIM, type: 'dashed' } },
    ...extra,
  });

  return {
    backgroundColor: BG,
    title: {
      text: symbol, subtext: interval, left: chartLeftPad, top: 8,
      textStyle:    { color: G,         fontSize: 15, fontWeight: 'bold', fontFamily: 'monospace' },
      subtextStyle: { color: G_LABEL,   fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0d1f14ee',
      borderColor: G_DIM,
      textStyle: { color: G, fontSize: 11 },
      axisPointer: { animation: false, type: 'cross', lineStyle: { color: 'rgba(34,197,94,0.3)', width: 1 } },
    },
    grid: showRsi
      ? [{ top: 40, bottom: '26%', left: chartLeftPad, right: chartRightPad }, { top: '78%', bottom: 20, left: chartLeftPad, right: chartRightPad }]
      : [{ top: 40, bottom: 20,    left: chartLeftPad, right: chartRightPad }],
    xAxis: showRsi
      ? [{ ...axisBase(0, false) }, { ...axisBase(1, true) }]
      : { ...axisBase(0, true) },
    yAxis: showRsi
      ? [yAxisBase(0), yAxisBase(1, { scale: false, min: 0, max: 100, interval: 30 })]
      : yAxisBase(0),
    dataZoom: zoomWindow
      ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct, showRsi ? [0, 1] : [0])
      : buildInsideDataZoom(showRsi ? [0, 1] : [0]),
    series: [
      {
        name: 'Preço',
        type: 'line',
        xAxisIndex: 0, yAxisIndex: 0,
        data: [...new Array(LEFT_PAD).fill(null), ...closes],
        showSymbol: false,
        lineStyle: { color: G, width: 1.5 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(34,197,94,0.28)' }, { offset: 1, color: 'rgba(34,197,94,0.02)' }] },
        },
        markLine: finalMarkLine,
      },
      ...(buyPnlSeries ? [{ ...buyPnlSeries, xAxisIndex: 0, yAxisIndex: 0 }] : []),
      ...(stopLossSeries ? [{ ...stopLossSeries, xAxisIndex: 0, yAxisIndex: 0 }] : []),
      ...(showRsi && rsiData.length ? [{
        name: 'RSI',
        type: 'line',
        xAxisIndex: 1, yAxisIndex: 1,
        data: rsiData,
        showSymbol: false,
        lineStyle: { color: '#4ade80', width: 1.2 },
        markLine: {
          silent: true, symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef5350', type: 'dashed', width: 1 }, label: { formatter: '30', color: '#ef5350', fontSize: 9, position: 'end' } },
            ...(showRsi50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.6 }, label: { formatter: '50', color: '#facc15', fontSize: 9, position: 'end' } }] : []),
            { yAxis: 70, lineStyle: { color: G,         type: 'dashed', width: 1 }, label: { formatter: '70', color: G,         fontSize: 9, position: 'end' } },
            ...(showRsi80 ? [{ yAxis: 80, lineStyle: { color: '#fb923c', type: 'dashed', width: 1 }, label: { formatter: '80', color: '#fb923c', fontSize: 9, position: 'end' } }] : []),
          ],
        },
      }] : []),
    ],
  };
}

// ── Painel de histórico de trades (aba Matrix) ───────────────────────────────

function fmtDate(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return p;
  return n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2);
}

function TradeHistoryPanel({ symbol, gateFavorites }) {
  const {
    allTrades, setAllTrades, setTradePurchases,
    setChartTradeMarkers, chartViewSource, selectedChart,
  } = useCurrency();
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  
  useEffect(() => {
    if (!symbol) return;
    doRefresh();
    const id = setInterval(doRefresh, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  async function doRefresh() {
    if (!symbol || refreshing) return;
    setRefreshing(true);
    try {
      const useGate = gateFavorites.has(symbol) || selectedChart?.source === 'gate';
      const trades  = await (useGate ? fetchGateTrades(symbol) : fetchBinanceTrades(symbol));
      setAllTrades(trades);
      setTradePurchases(trades.filter(t => t.isBuyer));
      if (chartViewSource === CHART_VIEW.TRADES) {
        setChartTradeMarkers(buildMarkersFromExchangeTrades(trades));
      }
      setLastUpdate(new Date());
    } catch (e) {
      console.warn('[TradeHistoryPanel] refresh:', e.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Apenas trades executados (buys + sells), do mais recente ao mais antigo
  const withPnl = attachPnlToExchangeTrades(allTrades);
  const sorted = [...withPnl].sort((a, b) => Number(b.time) - Number(a.time));

  const base = symbol
    ? (symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol)
    : '';

  const buys  = allTrades.filter(t =>  t.isBuyer);
  const sells = allTrades.filter(t => !t.isBuyer);
  const totalBuy  = buys.reduce((s, t)  => s + parseFloat(t.price) * parseFloat(t.qty), 0);
  const totalSell = sells.reduce((s, t) => s + parseFloat(t.price) * parseFloat(t.qty), 0);
  const totalPnl  = withPnl.reduce((s, t) => s + (t.pnlUsdt ?? 0), 0);

  return (
    <div className="flex flex-col h-full bg-[#050d0a] border-l border-[#0a2a1a] font-mono select-none">

      {/* Header — compacto em mobile, completo em sm+ */}
      <div className="flex items-center justify-between px-1.5 sm:px-3 py-1.5 sm:py-2 border-b border-[#0a2a1a] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="hidden sm:inline text-green-400 tracking-widest text-[10px] font-bold uppercase">
            Executados
          </span>
          {base && (
            <span className="hidden sm:inline text-green-700 text-[10px]">/ {base}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {lastUpdate && (
            <span className="hidden sm:inline text-green-900 text-[9px]">
              {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={doRefresh}
            disabled={refreshing}
            title="Atualizar"
            className="text-green-700 hover:text-green-400 transition-colors disabled:opacity-30 text-base leading-none"
          >
            {refreshing ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {!symbol && (
          <p className="text-green-900 text-center mt-8 text-[10px]">—</p>
        )}
        {symbol && sorted.length === 0 && !refreshing && (
          <p className="text-green-900 text-center mt-8 text-[10px]">vazio</p>
        )}

        {sorted.map((tr, i) => {
          const isBuy    = tr.isBuyer;
          const price    = parseFloat(tr.price);
          const qty      = parseFloat(tr.qty);
          const usdt     = (price * qty).toFixed(2);
          const color    = isBuy ? '#22c55e' : '#ef4444';
          const dimColor = isBuy ? '#14532d' : '#450a0a';
          const timeOnly = fmtDate(Number(tr.time)).slice(-5); // "14:32"
          const pnlPct   = tr.pnlPct;
          const pnlColor = pnlPct == null ? color : (pnlPct >= 0 ? '#22c55e' : '#ef4444');

          return (
            <div key={i} className="px-1.5 sm:px-3 py-1 sm:py-2 border-b" style={{ borderColor: '#0a1f14' }}>

              {/* Linha topo: badge + data */}
              <div className="flex items-center justify-between gap-1">
                <span
                  className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0"
                  style={{ color, background: dimColor }}
                >
                  {isBuy ? '▲' : '▼'}
                  <span className="hidden sm:inline"> {isBuy ? 'COMPRA' : 'VENDA'}</span>
                </span>
                {/* Mobile: só hora | sm+: data completa */}
                <span className="text-[9px] sm:text-[10px] truncate" style={{ color: '#1a5c32' }}>
                  <span className="sm:hidden">{timeOnly}</span>
                  <span className="hidden sm:inline">{fmtDate(Number(tr.time))}</span>
                </span>
              </div>

              {/* Preço (sempre visível) */}
              <div className="mt-0.5 text-[10px] sm:text-[12px] font-semibold" style={{ color }}>
                {fmtPrice(tr.price)}
              </div>

              {/* Qty e USDT — só em sm+ */}
              <div className="hidden sm:flex items-baseline gap-1.5 mt-0.5" style={{ color }}>
                <span className="text-[10px] opacity-50">×</span>
                <span className="text-[10px] opacity-80">{qty.toFixed(4)}</span>
              </div>
              <div className="hidden sm:block text-[10px] mt-0.5" style={{ color: '#1a6b38' }}>
                ≈ ${usdt} USDT
              </div>

              {!isBuy && pnlPct != null && (
                <div className="mt-0.5 text-[10px] font-bold" style={{ color: pnlColor }}>
                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                  {tr.pnlUsdt != null && (
                    <span className="opacity-70 font-normal">
                      {' '}({tr.pnlUsdt >= 0 ? '+' : ''}{tr.pnlUsdt.toFixed(2)})
                    </span>
                  )}
                </div>
              )}

            </div>
          );
        })}
      </div>

      {/* Rodapé */}
      {sorted.length > 0 && (
        <div className="border-t px-1.5 sm:px-3 py-1 sm:py-2 shrink-0 space-y-0.5" style={{ borderColor: '#0a2a1a' }}>
          {/* Mobile: contagens compactas */}
          <div className="flex justify-between text-[9px] sm:hidden">
            <span style={{ color: '#1a5c32' }}>▲{buys.length}</span>
            <span style={{ color: '#5c1a1a' }}>▼{sells.length}</span>
          </div>
          {/* sm+: totais completos */}
          <div className="hidden sm:flex justify-between text-[10px]">
            <span style={{ color: '#1a5c32' }}>Compras ({buys.length})</span>
            <span style={{ color: '#22c55e' }}>${totalBuy.toFixed(2)}</span>
          </div>
          <div className="hidden sm:flex justify-between text-[10px]">
            <span style={{ color: '#5c1a1a' }}>Vendas ({sells.length})</span>
            <span style={{ color: '#ef4444' }}>${totalSell.toFixed(2)}</span>
          </div>
          {sells.length > 0 && (
            <div className="hidden sm:flex justify-between text-[10px] font-semibold">
              <span style={{ color: '#1a5c32' }}>PnL</span>
              <span style={{ color: totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CandlestickChart() {
  const { selectedChart, setSelectedChart, chartZoom, setChartZoom, chartTradeMarkers, chartViewSource,
    chartCandleWindowReset,
    multitradeChartFocus, tradePurchases, allTrades, gateFavorites, chartInterval: savedInterval, setChartInterval,
    chartPanelButtons, uiPrefs, setMaBandsDefaults, setBollingerBandsDefaults, setActiveIndicatorsPreference,
    multitradeFavorites, fiveMTradeFavorites, activeTrades } = useCurrency();
  const { t } = useI18n();
  const chartRef = useRef(null);
  const chartWrapRef = useRef(null);
  const [currentInterval, setCurrentInterval] = useState(savedInterval || DEFAULT_INTERVAL);
  const [loadingInterval, setLoadingInterval] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const activeIndicators = uiPrefs.activeIndicators ?? [...DEFAULT_ACTIVE_INDICATORS];
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'matrix'
  const [tradeOverlaySlots, setTradeOverlaySlots] = useState(null);
  const [quickEmaGroups, setQuickEmaGroups] = useState(loadQuickEmaGroups);
  const addQuickEmaGroup = useCallback(() => {
    setQuickEmaGroups((prev) => {
      if (prev.length >= MAX_QUICK_EMA_GROUPS) return prev;
      const next = [...prev, {
        id: `qg${Date.now()}`,
        interval: QUICK_EMA_DEFAULT_INTERVAL,
        periods: [],
        bandPeriod: null,
        abovePct: QUICK_EMA_DEFAULT_ABOVE_PCT,
        belowPct: QUICK_EMA_DEFAULT_BELOW_PCT,
      }];
      saveQuickEmaGroups(next);
      return next;
    });
  }, []);
  const removeQuickEmaGroup = useCallback((id) => {
    setQuickEmaGroups((prev) => {
      const next = prev.filter((g) => g.id !== id);
      saveQuickEmaGroups(next);
      return next;
    });
  }, []);
  const updateQuickEmaGroupInterval = useCallback((id, interval) => {
    setQuickEmaGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, interval } : g));
      saveQuickEmaGroups(next);
      return next;
    });
  }, []);
  const toggleQuickEmaGroupPeriod = useCallback((id, period) => {
    setQuickEmaGroups((prev) => {
      const next = prev.map((g) => {
        if (g.id !== id) return g;
        const has = g.periods.includes(period);
        const periods = has ? g.periods.filter((p) => p !== period) : [...g.periods, period];
        // Deselecionar o período da banda também desliga a banda — senão a EMA
        // continua sendo buscada/desenhada só pra sustentar a banda órfã.
        const bandPeriod = has && g.bandPeriod === period ? null : g.bandPeriod;
        return { ...g, periods, bandPeriod };
      });
      saveQuickEmaGroups(next);
      return next;
    });
  }, []);
  const updateQuickEmaGroupBandPct = useCallback((id, side, pct) => {
    setQuickEmaGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, [side === 'above' ? 'abovePct' : 'belowPct']: pct } : g));
      saveQuickEmaGroups(next);
      return next;
    });
  }, []);
  const updateQuickEmaGroupBandPeriod = useCallback((id, period) => {
    setQuickEmaGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, bandPeriod: period } : g));
      saveQuickEmaGroups(next);
      return next;
    });
  }, []);
  const [quickEmaAdaptiveBounds, setQuickEmaAdaptiveBounds] = useState({});
  const [overlayMaCache, setOverlayMaCache] = useState({});
  const [overlayMaLoading, setOverlayMaLoading] = useState(false);
  const [adaptiveBandOverlay, setAdaptiveBandOverlay] = useState(null);
  const [maBands, setMaBands] = useState(() => ({ ...uiPrefs.maBandsDefaults }));
  const [bollingerBands, setBollingerBands] = useState(() => ({ ...uiPrefs.bollingerBandsDefaults }));
  const [bollingerCache, setBollingerCache] = useState({});
  const [_bollingerLoading, setBollingerLoading] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelMasonryWidth, setPanelMasonryWidth] = useState(() => computePanelWidth(PANEL_MIN_WIDTH, true));
  const handlePanelLayoutChange = useCallback(({ width }) => {
    setPanelMasonryWidth(width);
  }, []);
  const [candleFetchLimit, setCandleFetchLimit] = useState(DEFAULT_CANDLE_LIMIT);
  const [displayCandleCount, setDisplayCandleCount] = useState(LIMIT);
  const [hasExplicitCandleWindow, setHasExplicitCandleWindow] = useState(false);
  const [loadingMoreCandles, setLoadingMoreCandles] = useState(false);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el || !selectedChart) return undefined;
    const resize = () => chartRef.current?.getEchartsInstance()?.resize();
    resize();
    const t1 = requestAnimationFrame(resize);
    const t2 = setTimeout(resize, 120);
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [selectedChart?.symbol, selectedChart?.interval, activeTab]);


  function toggleIndicator(id) {
    const current = uiPrefs.activeIndicators ?? [...DEFAULT_ACTIVE_INDICATORS];
    setActiveIndicatorsPreference(
      current.includes(id) ? current.filter((i) => i !== id) : [...current, id],
    );
  }

  useEffect(() => {
    const handleThemeChange = () => setThemeTick(t => t + 1);
    window.addEventListener('palette-updated', handleThemeChange);
    return () => window.removeEventListener('palette-updated', handleThemeChange);
  }, []);

  // Sincroniza intervalo; não reseta limites quando o zoom veio do Multi-Trade (evita flash de velas vazias)
  useEffect(() => {
    if (selectedChart?.interval) {
      setCurrentInterval(selectedChart.interval);
    }
    if (isTradePanelChartView(chartViewSource) && chartZoom) {
      if (multitradeChartFocus?.candleLimit) {
        setCandleFetchLimit(multitradeChartFocus.candleLimit);
        setDisplayCandleCount(multitradeChartFocus.candleLimit);
        setHasExplicitCandleWindow(true);
      }
      return;
    }
    setCandleFetchLimit(DEFAULT_CANDLE_LIMIT);
    setDisplayCandleCount(LIMIT);
    setHasExplicitCandleWindow(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart?.symbol, selectedChart?.interval, chartViewSource, multitradeChartFocus?.candleLimit, chartCandleWindowReset]);

  // Só entra em modo "overlay forçado" quando o painel de trade realmente impõe
  // slots (ex.: sinal de backtest com regra própria). Selecionar uma moeda que é
  // apenas um favorito MA-Cross (que não força overlaySlots) NUNCA deve tirar os
  // manipuladores (EMA/handlers) do usuário — eles continuam vindo de uiPrefs.
  const hasForcedOverlaySlots = isTradePanelChartView(chartViewSource) && !!multitradeChartFocus?.overlaySlots;

  const overlaySlots = useMemo(() => {
    if (hasForcedOverlaySlots) return tradeOverlaySlots ?? multitradeChartFocus.overlaySlots;
    return uiPrefs.overlaySlots;
  }, [hasForcedOverlaySlots, tradeOverlaySlots, multitradeChartFocus?.overlaySlots, uiPrefs.overlaySlots]);

  // Painel de trade com slots forçados: overlays locais (não persistem) — não altera indicadores do usuário.
  useEffect(() => {
    if (!hasForcedOverlaySlots) {
      setTradeOverlaySlots(null);
      return;
    }
    setTradeOverlaySlots(multitradeChartFocus.overlaySlots);
  }, [hasForcedOverlaySlots, multitradeChartFocus?.overlaySlots]);

  // Persiste preferências das bandas (pct, acima/abaixo, período/intervalo) quando o usuário altera
  useEffect(() => {
    if (maBands.adaptive || isTradePanelChartView(chartViewSource)) return;
    setMaBandsDefaults({
      pct: maBands.pct,
      showAbove: maBands.showAbove,
      showBelow: maBands.showBelow,
      period: maBands.period,
      interval: maBands.interval,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maBands.pct, maBands.showAbove, maBands.showBelow, maBands.period, maBands.interval]);

  // Persiste preferências da Bollinger Bands (ligado, período, desvio, intervalo)
  useEffect(() => {
    if (isTradePanelChartView(chartViewSource)) return;
    setBollingerBandsDefaults({
      enabled: bollingerBands.enabled,
      period: bollingerBands.period,
      stdDev: bollingerBands.stdDev,
      interval: bollingerBands.interval,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bollingerBands.enabled, bollingerBands.period, bollingerBands.stdDev, bollingerBands.interval]);

  const overlayFetchLimit = useMemo(() => {
    if (isTradePanelChartView(chartViewSource) && multitradeChartFocus?.fetchFromMs) {
      return computeCandleLimitFromTime(multitradeChartFocus.fetchFromMs, selectedChart?.interval ?? currentInterval);
    }
    return Math.max(candleFetchLimit, selectedChart?.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT);
  }, [
    chartViewSource, multitradeChartFocus?.fetchFromMs, candleFetchLimit,
    selectedChart?.interval, selectedChart?.candlesticks?.length, currentInterval,
  ]);

  useEffect(() => {
    if (!selectedChart?.symbol) {
      setOverlayMaCache({});
      return undefined;
    }
    const chartIv = selectedChart.interval ?? currentInterval;
    const toFetch = enabledOverlaySlots(overlaySlots, chartPanelButtons);
    for (const group of quickEmaGroups) {
      for (const period of group.periods) {
        if (toFetch.some(s => s.period === period && s.interval === group.interval)) continue;
        toFetch.push({ id: `${group.id}-${period}`, period, interval: group.interval });
      }
      if (group.bandPeriod && !toFetch.some(s => s.period === group.bandPeriod && s.interval === group.interval)) {
        toFetch.push({ id: `${group.id}-band-${group.bandPeriod}`, period: group.bandPeriod, interval: group.interval });
      }
    }
    if (!toFetch.length) {
      setOverlayMaCache({});
      setOverlayMaLoading(false);
      return undefined;
    }

    const chartCandles = selectedChart.candlesticks ?? [];
    const visibleCount = Math.min(
      displayCandleCount > 0 ? displayCandleCount : chartCandles.length,
      chartCandles.length || DEFAULT_CANDLE_LIMIT,
    );

    let cancelled = false;
    setOverlayMaLoading(true);
    (async () => {
      const next = {};
      await Promise.all(toFetch.map(async (slot, idx) => {
        const key = `${slot.period}-${slot.interval}`;
        const sameIv = slot.interval === chartIv;

        const tryReuse = (period, maSeries) => {
          if (!sameIv || slot.period !== period || !maSeries?.length || !chartCandles.length) return null;
          const offset = chartCandles.length - maSeries.length;
          const points = maSeries.map((val, i) => ({
            openTime: Number(chartCandles[offset + i].openTime),
            value: val,
          }));
          return overlayPointsCoverWindow(points, chartCandles, visibleCount) ? points : null;
        };

        const reused =
          tryReuse('50', selectedChart.ma50)
          ?? tryReuse('9', selectedChart.ma9)
          ?? tryReuse('21', selectedChart.ma21)
          ?? tryReuse('200', selectedChart.movingAverage);

        if (reused) {
          next[key] = reused;
          return;
        }

        try {
          const baseLimit = isTradePanelChartView(chartViewSource) && multitradeChartFocus?.fetchFromMs
            ? computeCandleLimitFromTime(multitradeChartFocus.fetchFromMs, slot.interval)
            : overlayFetchLimit;
          const ovLimit = computeOverlayMaFetchLimit(
            chartIv,
            slot.interval,
            slot.period,
            Math.max(visibleCount, chartCandles.length, DEFAULT_CANDLE_LIMIT),
            baseLimit,
          );
          next[key] = await fetchOverlayMaPoints(
            selectedChart.symbol,
            slot.interval,
            slot.period,
            selectedChart.source,
            ovLimit,
          );
        } catch (e) {
          console.warn('[overlayMA]', key, e.message);
        }
        void idx;
      }));
      if (!cancelled) setOverlayMaCache(next);
      if (!cancelled) setOverlayMaLoading(false);
    })();

    return () => { cancelled = true; };
  }, [overlaySlots, quickEmaGroups, selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks, selectedChart?.ma50, selectedChart?.ma9, selectedChart?.ma21, selectedChart?.movingAverage, currentInterval, overlayFetchLimit, chartPanelButtons, chartViewSource, multitradeChartFocus?.fetchFromMs, displayCandleCount, chartCandleWindowReset, adaptiveBandOverlay]);

  // Bandas adaptativas das EMAs rápidas — piso/teto reais do histórico da moeda,
  // um por par período@intervalo usado como 'adaptive' em algum grupo.
  useEffect(() => {
    if (!selectedChart?.symbol) {
      setQuickEmaAdaptiveBounds({});
      return undefined;
    }
    const needed = [];
    for (const group of quickEmaGroups) {
      if (!group.bandPeriod) continue;
      if (group.abovePct !== QUICK_EMA_BAND_ADAPTIVE && group.belowPct !== QUICK_EMA_BAND_ADAPTIVE) continue;
      const key = `${group.bandPeriod}-${group.interval}`;
      if (needed.some((n) => n.key === key)) continue;
      needed.push({ key, period: group.bandPeriod, interval: group.interval });
    }
    if (!needed.length) {
      setQuickEmaAdaptiveBounds({});
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const chartIv = selectedChart.interval ?? currentInterval;
      const chartCandles = selectedChart.candlesticks ?? [];
      const visibleCount = Math.min(
        displayCandleCount > 0 ? displayCandleCount : chartCandles.length,
        chartCandles.length || DEFAULT_CANDLE_LIMIT,
      );
      const next = {};
      await Promise.all(needed.map(async ({ key, period, interval }) => {
        try {
          const limit = computeOverlayMaFetchLimit(
            chartIv,
            interval,
            period,
            Math.max(visibleCount, chartCandles.length, DEFAULT_CANDLE_LIMIT),
            overlayFetchLimit,
          );
          const bounds = await fetchChartAdaptiveBands({
            symbol: selectedChart.symbol,
            exchange: selectedChart.source === 'gate' ? 'gate' : 'binance',
            period,
            interval,
            limit,
          });
          next[key] = { dipPct: bounds.dipPct ?? 0, stretchPct: bounds.stretchPct ?? 0 };
        } catch (e) {
          console.warn('[quickEmaAdaptive]', key, e.message);
        }
      }));
      if (!cancelled) setQuickEmaAdaptiveBounds(next);
    })();

    return () => { cancelled = true; };
  }, [quickEmaGroups, selectedChart?.symbol, selectedChart?.source, selectedChart?.interval, selectedChart?.candlesticks, currentInterval, overlayFetchLimit, displayCandleCount, chartCandleWindowReset]);

  // Busca a série de Bandas de Bollinger (upper/middle/lower) — período/intervalo próprios, como MA1/MA2.
  useEffect(() => {
    const bbEnabled = bollingerBands.enabled && chartPanelButtons.bb !== false;
    if (!selectedChart?.symbol || !bbEnabled) {
      setBollingerLoading(false);
      return undefined;
    }
    const key = `${bollingerBands.period}-${bollingerBands.stdDev}-${bollingerBands.interval}`;
    let cancelled = false;
    setBollingerLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          bollingerBands.interval,
          bollingerBands.period,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const points = await fetchBollingerOverlayPoints(
          selectedChart.symbol,
          bollingerBands.interval,
          bollingerBands.period,
          bollingerBands.stdDev,
          selectedChart.source,
          ovLimit,
        );
        if (!cancelled) setBollingerCache({ [key]: points });
      } catch (e) {
        console.warn('[bollingerBands]', key, e.message);
        if (!cancelled) setBollingerCache({});
      } finally {
        if (!cancelled) setBollingerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, chartPanelButtons.bb,
    bollingerBands.enabled, bollingerBands.period, bollingerBands.stdDev, bollingerBands.interval,
  ]);

  // Bandas adaptativas (piso/teto) — só quando o foco MT pede (ex.: clique em trade no backtest)
  useEffect(() => {
    const cfg = multitradeChartFocus?.adaptiveBands;
    if (!cfg || !selectedChart?.symbol) {
      setAdaptiveBandOverlay(null);
      if (!cfg) {
        setMaBands((prev) => (
          prev.adaptive
            ? { ...uiPrefs.maBandsDefaults, adaptive: false }
            : prev
        ));
      }
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const chartIv = selectedChart.interval ?? '15m';
        const chartLen = selectedChart.candlesticks?.length ?? DEFAULT_CANDLE_LIMIT;
        const visibleCount = Math.min(
          displayCandleCount > 0 ? displayCandleCount : chartLen,
          chartLen || DEFAULT_CANDLE_LIMIT,
        );
        const bandLimit = computeOverlayMaFetchLimit(
          chartIv,
          cfg.interval,
          cfg.period,
          Math.max(visibleCount, chartLen, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const [points, bounds] = await Promise.all([
          fetchOverlayMaPoints(
            selectedChart.symbol,
            cfg.interval,
            cfg.period,
            selectedChart.source,
            bandLimit,
          ),
          fetchChartAdaptiveBands({
            symbol: selectedChart.symbol,
            exchange: selectedChart.source === 'gate' ? 'gate' : 'binance',
            period: cfg.period,
            interval: cfg.interval,
            limit: bandLimit,
            maxDipPct: cfg.maxDipPct,
            maxAbovePct: cfg.maxAbovePct,
            fixedDipPct: cfg.fixedDipPct,
            fixedAbovePct: cfg.fixedAbovePct,
            adaptiveOpts: cfg.adaptiveOpts,
          }),
        ]);
        if (cancelled) return;
        const dipPct = bounds.dipPct ?? cfg.maxDipPct ?? 4;
        const stretchPct = bounds.stretchPct ?? cfg.maxAbovePct ?? 4;
        setAdaptiveBandOverlay({
          period: cfg.period,
          interval: cfg.interval,
          points,
          dipPct,
          stretchPct,
        });
        setMaBands({
          showAbove: stretchPct > 0,
          showBelow: dipPct > 0,
          pct: Math.max(dipPct, stretchPct),
          dipPct,
          stretchPct,
          adaptive: true,
        });
      } catch (e) {
        if (!cancelled) {
          console.warn('[adaptiveBands]', e.message);
          setAdaptiveBandOverlay(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [
    multitradeChartFocus?.adaptiveBands,
    selectedChart?.symbol,
    selectedChart?.source,
    selectedChart?.interval,
    overlayFetchLimit,
    displayCandleCount,
    chartCandleWindowReset,
    selectedChart?.candlesticks?.length,
    uiPrefs.maBandsDefaults,
  ]);

  const colors = useMemo(() => getThemeColors(), [themeTick]);

  async function handleIntervalChange(iv) {
    if (iv === currentInterval) return;
    setCurrentInterval(iv);
    setChartInterval(iv);
    if (!selectedChart?.symbol) return;
    setLoadingInterval(true);
    try {
      const isMt = isTradePanelChartView(chartViewSource) && multitradeChartFocus?.fetchFromMs;
      const limit = isMt
        ? computeCandleLimitFromTime(multitradeChartFocus.fetchFromMs, iv)
        : DEFAULT_CANDLE_LIMIT;
      if (isMt) {
        setCandleFetchLimit(limit);
        setDisplayCandleCount(limit);
        setHasExplicitCandleWindow(true);
      } else {
        setCandleFetchLimit(DEFAULT_CANDLE_LIMIT);
        setDisplayCandleCount(LIMIT);
        setHasExplicitCandleWindow(false);
      }
      const data = await fetchCandlesticksAndCloud(
        selectedChart.symbol, iv, selectedChart.source ?? null, limit,
      );
      setSelectedChart({
        ...data,
        interval: iv,
        symbol: selectedChart.symbol,
        source: selectedChart.source ?? null,
        tradeMarkers: selectedChart.tradeMarkers ?? chartTradeMarkers,
      });
    } finally {
      setLoadingInterval(false);
    }
  }

  async function handleLoadMoreCandles() {
    if (!selectedChart?.symbol) return;
    const currentLen = selectedChart.candlesticks?.length ?? 0;
    const nextLimit = CANDLE_FETCH_STEPS.find(step => step > Math.max(candleFetchLimit, currentLen)) ?? MAX_CANDLES;
    if (nextLimit <= candleFetchLimit && currentLen >= MAX_CANDLES) return;

    setLoadingMoreCandles(true);
    try {
      const data = await fetchCandlesticksAndCloud(
        selectedChart.symbol,
        currentInterval,
        selectedChart.source ?? null,
        nextLimit,
      );
      setSelectedChart(data);
      setCandleFetchLimit(nextLimit);
      setDisplayCandleCount(Math.min(nextLimit, data.candlesticks?.length ?? nextLimit));
      setHasExplicitCandleWindow(true);
    } finally {
      setLoadingMoreCandles(false);
    }
  }

  async function handleLoadLastNCandles(n) {
    if (!selectedChart?.symbol || !selectedChart?.candlesticks?.length) return;
    setChartZoom(null);
    setDisplayCandleCount(n);
    setHasExplicitCandleWindow(true);
    const currentLen = selectedChart.candlesticks.length;
    if (n > currentLen && n > candleFetchLimit) {
      setLoadingMoreCandles(true);
      try {
        const data = await fetchCandlesticksAndCloud(
          selectedChart.symbol, currentInterval, selectedChart.source ?? null, n,
        );
        setSelectedChart(data);
        setCandleFetchLimit(n);
      } finally {
        setLoadingMoreCandles(false);
      }
    }
  }

  useEffect(() => {
    if (!chartZoom || !chartRef.current || !selectedChart?.candlesticks?.length) return;
    // Zoom embutido na option (buildFixedDataZoom); dispatchAction só como fallback legado (tabela/sem source)
    if (isTradePanelChartView(chartZoom.source) || chartZoom.source === CHART_VIEW.STATISTICS) return;
    const win = computeZoomWindow(selectedChart.candlesticks, chartZoom);
    if (!win) return;
    const instance = chartRef.current.getEchartsInstance();
    instance.dispatchAction({ type: 'dataZoom', start: win.startPct, end: win.endPct });
  }, [chartZoom, selectedChart, chartViewSource]);

  // Linhas azuis legadas (últimas 2 compras). Na view TX usamos só chartTradeMarkers (buy/sell + PnL).
  const tradeTimes = chartViewSource === CHART_VIEW.TRADES
    ? []
    : [...tradePurchases]
      .sort((a, b) => Number(a.time) - Number(b.time))
      .slice(-2)
      .map(t => Number(t.time));

  const markerTimesForWindow = chartViewSource === CHART_VIEW.TRADES && chartTradeMarkers?.length
    ? chartTradeMarkers.map(m => Number(m.time)).filter(Number.isFinite)
    : tradeTimes;

  const displayLimit = (() => {
    const candles = selectedChart?.candlesticks;
    if (chartZoom && (isTradePanelChartView(chartViewSource) || chartViewSource === CHART_VIEW.STATISTICS)) {
      return candles?.length ?? displayCandleCount;
    }
    // Botões 20/50/100 / load more — prioridade sobre expansão automática por marcadores
    if (hasExplicitCandleWindow) {
      return Math.min(displayCandleCount, candles?.length ?? displayCandleCount);
    }
    if ((chartTradeMarkers?.length || selectedChart?.tradeMarkers?.length) && candles?.length && candles.length <= 50) {
      return candles.length;
    }
    if (chartZoom) return candles?.length ?? displayCandleCount;
    if (!candles?.length || !markerTimesForWindow.length) return LIMIT;
    const oldest = Math.min(...markerTimesForWindow);
    const idx = candles.findIndex(c => Number(c.openTime) >= oldest);
    if (idx === -1 || idx >= candles.length - LIMIT) return LIMIT;
    return Math.min(candles.length, candles.length - idx + 5);
  })();

  const panelPad = !hasAnyChartPanelButton(chartPanelButtons)
    ? 0
    : (panelCollapsed ? CHART_PANEL_COLLAPSED : panelMasonryWidth);
  const chartLeftPad = CHART_LEFT_MARGIN;
  const chartRightPad = CHART_PRICE_PAD + CHART_LEFT_MARGIN + panelPad;

  const effectiveIndicators = useMemo(
    () => filterIndicatorsByPanel(activeIndicators, chartPanelButtons),
    [activeIndicators, chartPanelButtons],
  );

  const overlayConfigs = useMemo(() => {
    const activeSlots = enabledOverlaySlots(overlaySlots, chartPanelButtons);

    const slotConfigs = activeSlots.map((slot) => {
      const key = `${slot.period}-${slot.interval}`;
      const slotNum = parseInt(slot.id.replace('slot', ''), 10);
      const fallbackColor = OVERLAY_MA_COLORS[(isNaN(slotNum) ? 0 : slotNum - 1) % OVERLAY_MA_COLORS.length];
      const color = slot.color ?? fallbackColor;
      return {
        label: `EMA${slot.period}@${slot.interval}`,
        color,
        points: overlayMaCache[key] ?? [],
        bands: { showAbove: false, showBelow: false, abovePct: 0, belowPct: 0 },
      };
    });

    for (const group of quickEmaGroups) {
      const noBands = { showAbove: false, showBelow: false, abovePct: 0, belowPct: 0 };
      for (const period of group.periods) {
        const key = `${period}-${group.interval}`;
        const isBandPeriod = group.bandPeriod === period;
        slotConfigs.push({
          label: `EMA${period}@${group.interval}`,
          color: QUICK_EMA_PERIOD_COLORS[period] ?? '#94a3b8',
          points: overlayMaCache[key] ?? [],
          bands: isBandPeriod ? resolveQuickEmaBands(group, quickEmaAdaptiveBounds) : noBands,
        });
      }
      // Período da banda pode não estar entre os períodos exibidos como linha —
      // ainda assim busca a EMA (só pra banda, sem desenhar a linha principal).
      if (group.bandPeriod && !group.periods.includes(group.bandPeriod)) {
        const key = `${group.bandPeriod}-${group.interval}`;
        slotConfigs.push({
          label: `EMA${group.bandPeriod}@${group.interval}`,
          color: QUICK_EMA_PERIOD_COLORS[group.bandPeriod] ?? '#94a3b8',
          points: overlayMaCache[key] ?? [],
          showMiddle: false,
          bands: resolveQuickEmaBands(group, quickEmaAdaptiveBounds),
        });
      }
    }

    if (adaptiveBandOverlay?.points?.length) {
      slotConfigs.push({
        label: `EMA${adaptiveBandOverlay.period}@${adaptiveBandOverlay.interval}`,
        color: '#94a3b8',
        points: adaptiveBandOverlay.points,
        showMiddle: maBands.showMiddle === true,
        bands: {
          showAbove: maBands.showAbove && adaptiveBandOverlay.stretchPct > 0,
          showBelow: maBands.showBelow && adaptiveBandOverlay.dipPct > 0,
          abovePct: adaptiveBandOverlay.stretchPct,
          belowPct: adaptiveBandOverlay.dipPct,
        },
      });
    }

    return slotConfigs;
  }, [overlaySlots, overlayMaCache, quickEmaGroups, quickEmaAdaptiveBounds, maBands, chartPanelButtons, adaptiveBandOverlay]);

  const chartBuyInfo = useMemo(() => {
    if (!selectedChart?.symbol) return null;
    return resolveChartBuyPrice(selectedChart.symbol, {
      multitradeFavorites,
      fiveMTradeFavorites,
      activeTrades,
      allTrades,
      tradePurchases,
      chartTradeMarkers: chartTradeMarkers?.length
        ? chartTradeMarkers
        : (selectedChart.tradeMarkers ?? []),
    });
  }, [
    selectedChart?.symbol, selectedChart?.tradeMarkers,
    multitradeFavorites, fiveMTradeFavorites, activeTrades, allTrades, tradePurchases, chartTradeMarkers,
  ]);

  const chartStopLossConfig = useMemo(() => {
    if (!selectedChart?.symbol) return null;
    return resolveChartStopLoss(selectedChart.symbol, multitradeFavorites);
  }, [selectedChart?.symbol, multitradeFavorites]);

  const chartBollingerConfig = useMemo(() => {
    const enabled = bollingerBands.enabled && chartPanelButtons.bb !== false;
    if (!enabled) return null;
    const key = `${bollingerBands.period}-${bollingerBands.stdDev}-${bollingerBands.interval}`;
    return {
      enabled: true,
      period: bollingerBands.period,
      stdDev: bollingerBands.stdDev,
      interval: bollingerBands.interval,
      points: bollingerCache[key] ?? [],
    };
  }, [bollingerBands, bollingerCache, chartPanelButtons.bb]);

  const option = useMemo(() => {
    if (!selectedChart) return null;
    if (activeTab === 'matrix') {
      return buildMatrixOption(
        selectedChart, effectiveIndicators, displayLimit, chartZoom, tradeTimes, chartLeftPad, chartBuyInfo, chartStopLossConfig, chartRightPad,
      );
    }
    return buildOption(
      selectedChart, colors, effectiveIndicators, displayLimit, chartZoom, tradeTimes, overlayConfigs,
      chartTradeMarkers?.length ? chartTradeMarkers : (selectedChart.tradeMarkers ?? []),
      chartLeftPad, chartBuyInfo, chartStopLossConfig, chartRightPad, chartBollingerConfig,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart, colors, effectiveIndicators, chartZoom, tradePurchases, chartTradeMarkers, activeTab, overlayConfigs, displayLimit, chartLeftPad, chartRightPad, chartBuyInfo, chartStopLossConfig, chartBollingerConfig]);

  if (!selectedChart || !option) {
    return (
      <div className="flex flex-1 items-center justify-center h-full text-p5 opacity-30">
        <div className="flex flex-col items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth="1" stroke="currentColor" className="w-16 h-16">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          <span className="text-sm tracking-wider">{t('chart.select')}</span>
        </div>
      </div>
    );
  }

  // ── Chart ECharts (usado em ambas as abas) ───────────────────────────────────
  const chartNode = (
    <ReactECharts
      key={`${selectedChart.symbol}-${activeTab}`}
      ref={chartRef}
      option={option}
      notMerge={true}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
      lazyUpdate
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar — compacta no mobile (intervalos em scroll horizontal) */}
      <div className="flex flex-col px-2 md:px-3 pt-1 md:pt-2 pb-0.5 md:pb-1 shrink-0 gap-0.5 md:gap-1 border-b border-p2/40">
        {/* Linha 0 — abas + botões de janela de candles (separados dos intervalos) */}
        <div className="flex items-center gap-1 border-b border-p2/20 pb-0.5 md:pb-1 mb-0.5">
          {[
            { id: 'chart',  label: 'Chart' },
            { id: 'matrix', label: 'Matrix' },
            { id: 'rules',  label: 'Regras' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-2 md:px-3 py-0.5 text-[10px] md:text-xs rounded font-mono transition-colors ${
                activeTab === id
                  ? 'bg-p4 text-white'
                  : 'text-p5/60 hover:text-p5 hover:bg-p3/20'
              }`}
            >
              {label}
            </button>
          ))}

          {/* Grupo de janela de candles — alinhado à direita, isolado dos intervalos */}
          <div className="ml-auto flex items-center gap-1 pl-2 border-l border-p2/30">
            {LAST_CANDLE_PRESETS.map((n) => {
              const active = hasExplicitCandleWindow && displayCandleCount === n && !chartZoom;
              return (
                <button
                  key={n}
                  onClick={() => handleLoadLastNCandles(n)}
                  disabled={loadingMoreCandles || !selectedChart?.symbol || !selectedChart?.candlesticks?.length}
                  title={t(`chart.load_last_${n}`)}
                  className={`px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs rounded font-mono transition-colors disabled:opacity-40 border shrink-0 ${
                    active
                      ? 'bg-p4 text-white border-p4'
                      : 'text-p5 hover:bg-p3/40 hover:text-white border-p3/40'
                  }`}
                >
                  {t(`chart.last_${n}_btn`)}
                </button>
              );
            })}
            <button
              onClick={handleLoadMoreCandles}
              disabled={loadingMoreCandles || (candleFetchLimit >= MAX_CANDLES && (selectedChart?.candlesticks?.length ?? 0) >= MAX_CANDLES)}
              title={`Carregar mais candles (até ${MAX_CANDLES})`}
              className="px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs rounded font-mono transition-colors disabled:opacity-40 text-p5 hover:bg-p3/40 hover:text-white border border-p3/40 shrink-0"
            >
              {loadingMoreCandles ? '…' : `+${selectedChart?.candlesticks?.length ?? candleFetchLimit}/${MAX_CANDLES}`}
            </button>
          </div>
        </div>

        {/* Linha 1 — intervalos (uma linha no mobile) */}
        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto touch-pan-x scrollbar-thin md:flex-wrap md:overflow-visible">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => handleIntervalChange(iv)}
              disabled={loadingInterval}
              className={`px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs rounded font-mono transition-colors disabled:opacity-40 shrink-0 ${
                currentInterval === iv
                  ? 'bg-p4 text-white'
                  : 'text-p5 hover:bg-p3/40 hover:text-white'
              }`}
            >
              {iv}
            </button>
          ))}
          {loadingInterval && (
            <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin ml-1 shrink-0" />
          )}
        </div>


      </div>

      {/* Conteúdo da aba */}
      {activeTab === 'rules' ? (
        <div className="flex-1 min-h-0 flex flex-col px-2 md:px-3 py-2">
          {selectedChart?.symbol ? (
            <MaCrossRuleCheckChart
              symbol={selectedChart.symbol}
              exchange={selectedChart.source === 'gate' ? 'gate' : 'binance'}
              fillHeight
            />
          ) : (
            <div className="text-p5/50 text-xs font-mono">Selecione uma moeda pra conferir as regras.</div>
          )}
        </div>
      ) : activeTab === 'chart' ? (
        <div ref={chartWrapRef} className="flex-1 min-h-0 relative">
          {chartNode}
          <ChartIndicatorPanel
            activeIndicators={activeIndicators}
            toggleIndicator={toggleIndicator}
            quickEmaGroups={quickEmaGroups}
            addQuickEmaGroup={addQuickEmaGroup}
            removeQuickEmaGroup={removeQuickEmaGroup}
            updateQuickEmaGroupInterval={updateQuickEmaGroupInterval}
            toggleQuickEmaGroupPeriod={toggleQuickEmaGroupPeriod}
            updateQuickEmaGroupBandPct={updateQuickEmaGroupBandPct}
            updateQuickEmaGroupBandPeriod={updateQuickEmaGroupBandPeriod}
            bollingerBands={bollingerBands}
            setBollingerBands={setBollingerBands}
            overlayMaLoading={overlayMaLoading}
            panelButtons={chartPanelButtons}
            collapsed={panelCollapsed}
            onToggleCollapse={() => setPanelCollapsed(v => !v)}
            onLayoutChange={handlePanelLayoutChange}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Gráfico (lado esquerdo) */}
          <div ref={chartWrapRef} className="flex-1 min-w-0 min-h-0 relative">
            {chartNode}
            <ChartIndicatorPanel
              activeIndicators={activeIndicators}
              toggleIndicator={toggleIndicator}
              quickEmaGroups={quickEmaGroups}
              addQuickEmaGroup={addQuickEmaGroup}
              removeQuickEmaGroup={removeQuickEmaGroup}
              updateQuickEmaGroupInterval={updateQuickEmaGroupInterval}
              toggleQuickEmaGroupPeriod={toggleQuickEmaGroupPeriod}
              updateQuickEmaGroupBandPct={updateQuickEmaGroupBandPct}
              updateQuickEmaGroupBandPeriod={updateQuickEmaGroupBandPeriod}
              bollingerBands={bollingerBands}
              setBollingerBands={setBollingerBands}
              overlayMaLoading={overlayMaLoading}
              panelButtons={chartPanelButtons}
              collapsed={panelCollapsed}
              onToggleCollapse={() => setPanelCollapsed(v => !v)}
              onLayoutChange={handlePanelLayoutChange}
            />
          </div>
          {/* Painel de histórico (lado direito) */}
          <div className="w-24 sm:w-64 shrink-0 min-h-0 overflow-hidden">
            <TradeHistoryPanel
              symbol={selectedChart?.symbol}
              gateFavorites={gateFavorites}
            />
          </div>
        </div>
      )}
    </div>
  );
}
