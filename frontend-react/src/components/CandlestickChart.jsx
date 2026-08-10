import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '../i18n';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud, fetchGateTrades, fetchBinanceTrades, fetchChartAdaptiveBands, DEFAULT_CANDLE_LIMIT } from '../services/api';
import { buildMarkersFromExchangeTrades, attachPnlToExchangeTrades, isMaCrossEntry, isVwapBandsEntry, isBollingerBandsEntry } from '../utils/multitradeChart';
import { computeVwapSlopeFlags } from '../utils/vwapSlopeHighlight';
import { buildTrailingStopSeries, resolveChartStopLoss, resolveChartTarget, computeStopLossFloor } from '../utils/trailingStopLoss';
import { getEntriesForSymbol, buildAdHocMaCrossEntry } from '../constants/strategyPresets';
import MaCrossRuleCheckChart from './MaCrossRuleCheckChart';
import CandlestickChartLW from './CandlestickChartLW';
import convertOpenTime from '../utils/convertOpenTime';
import Tooltip from './Tooltip';
import { useIsMobile } from '../hooks/useIsMobile';
import { DEFAULT_OVERLAY_SLOTS, DEFAULT_ACTIVE_INDICATORS, BB_PERIOD_OPTIONS, BB_STDDEV_OPTIONS, DEFAULT_SR_INTERVAL, DEFAULT_PPHL_INTERVAL, DEFAULT_CHOP_INTERVAL, DEFAULT_COMMON_CHART_INTERVALS } from '../utils/uiPreferences';
import { CHART_VIEW, INTERVAL_MS, computeZoomWindow, buildFixedDataZoom, buildInsideDataZoom, computeCandleLimitFromTime, isTradePanelChartView, computeManualWheelZoom } from '../utils/chartView';
import { simulateBbTouchPath, pairBbPathCycles } from '../utils/bollingerTouchPath';

const LIMIT = DEFAULT_CANDLE_LIMIT;
// Filtros e favoritos comuns buscam LIMIT (160) candles mas mostram só os mais recentes por
// padrão — exceto TX e VWAP Bands/MA-Cross, que precisam do histórico cheio pra vendas/sinais
// antigos (ver efeito de sincronização de intervalo mais abaixo).
const DEFAULT_DISPLAY_CANDLE_COUNT = 80;
const LAST_CANDLE_PRESETS = [10, 20, 40, 80, 160, 320];
/** Presets mais usados da janela de candles — os demais ficam escondidos atrás do botão "›"
 *  (mesmo padrão do picker de intervalos logo abaixo, ver COMMON_CHART_INTERVALS). */
const COMMON_CANDLE_PRESETS = [20, 80, 160];
// 10500 (não 1000) — mesmo teto do cache em disco pra 1m (RETENTION_LIMIT_BY_INTERVAL em
// getCandles.js): sem isso, a VWAP semanal desenhada no gráfico (fetchVwapPoints, limitada por
// computeOverlayMaFetchLimit abaixo) ficava presa a só ~1000 candles de histórico, bem menos
// que o motor de verdade usa (agora até ~10130 em 1m) — a linha/bandas no gráfico não batiam
// com o nível que realmente armou o sinal (ver conversa sobre a ACEUSDT/KMNOUSDT).
const MAX_CANDLES = 10500;
const CANDLE_FETCH_STEPS = [500, 1000];
const OVERLAY_MA_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d'];
const OVERLAY_MA_COLORS = ['#fb923c', '#c084fc', '#34d399', '#60a5fa', '#f472b6', '#facc15', '#a78bfa', '#4ade80'];
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
/** Intervalos mais usados no gráfico — os demais ficam escondidos atrás do botão "›" (mesmo padrão do picker de intervalos em Analisar indicadores).
 *  Padrão de fábrica; o usuário pode customizar em Configurações → Intervalos rápidos do gráfico (uiPrefs.commonChartIntervals). */
const COMMON_CHART_INTERVALS = DEFAULT_COMMON_CHART_INTERVALS;
const DEFAULT_INTERVAL = '15m';

const CHART_PRICE_PAD = 54;        // direita: rótulos do eixo de preço
const CHART_LEFT_MARGIN = 8;       // margem esquerda mínima
const PANEL_MIN_WIDTH = 160;
const PANEL_GAP = 2;
const PANEL_TILE_PAD = 2;
const PANEL_CARD_PAD = 6;
/** Painel de indicadores agora abre como dropdown no topo do gráfico (flutuando por cima,
 *  sem empurrar o chart) — largura e altura limitadas, com scroll vertical pro que não couber. */
const PANEL_WIDTH_RATIO = 0.2;      // desktop/notebook: 20% da largura do gráfico
const PANEL_MAX_HEIGHT_RATIO = 0.45; // acima disso, rola em vez de cobrir o gráfico inteiro
const PANEL_MAX_HEIGHT_PX = 320;    // teto absoluto, mesmo em telas bem altas
const PANEL_ROW_PX = 26;            // altura "natural" de uma row unit no dropdown
/** Altura mínima (px) de uma "row unit" do painel — abaixo disso, o painel rola em vez de espremer os tiles. */
const MIN_ROW_UNIT_PX = 20;
const C_UP   = '#26a69a';
const C_DOWN = '#ef5350';
// BB: slate — distinto das EMAs (9 fúcsia, 21 laranja, 50 ciano, 200 âmbar)
const BB_COLOR = '#94a3b8';
const BB_PATH_COLOR = '#64748b';
const MEDIAN_TREND_COLOR = '#38bdf8';

const INDICATOR_GROUPS = [
  { id: 'ma9',      label: 'EMA9',   color: '#e879f9', tipKey: 'chart.tip.sma9' },
  { id: 'ma21',     label: 'EMA21',  color: '#fb923c', tipKey: 'chart.tip.sma21' },
  { id: 'ma50',     label: 'EMA50',  color: '#22d3ee', tipKey: 'chart.tip.sma50' },
  { id: 'ma200',    label: 'EMA200', color: '#f59e0b', tipKey: 'chart.tip.sma200' },
  { id: 'ichimoku', label: 'Ichi',  color: '#60a5fa', tipKey: 'chart.tip.ichimoku' },
  { id: 'sr',       label: 'S/R',   color: '#facc15', tipKey: 'chart.tip.sr' },
  { id: 'pphl',     label: 'PPHL',  color: '#2dd4bf', tipKey: 'chart.tip.pphl' },
  { id: 'rsi',      label: 'RSI',   color: '#a78bfa', tipKey: 'chart.tip.rsi' },
  { id: 'chopZone', label: 'CHOP',  color: '#f59e0b', tipKey: 'chart.tip.chopZone' },
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
const QUICK_EMA_BAND_PCT_OPTIONS = [4, 3, 2, 1, 0.5];
const QUICK_EMA_DEFAULT_ABOVE_PCT = 4;
/** Piso padrão igual ao filtro adaptativo do ma-cross (MA_CROSS_DEFAULTS.maFilters[0].maxDipPct). */
const QUICK_EMA_DEFAULT_BELOW_PCT = 0.5;
const QUICK_EMA_BAND_ADAPTIVE = 'adaptive';
const MAX_QUICK_EMA_GROUPS = 4;
const QUICK_EMA_STORAGE_KEY = 'lets_trade_quick_ema_groups_v4';
/** id fixo do grupo Quick EMA sincronizado automaticamente com o filtro de tendência EMA do
 *  favorito bollinger-bands selecionado (ver multitradeChartFocus?.quickEmaOverride abaixo) —
 *  permite achar/atualizar/remover só esse grupo sem mexer nos que o usuário montou à mão. */
const TRADE_EMA_GROUP_ID = 'trade-ema-filter';

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

/** Nunca persiste o grupo auto-sincronizado do favorito bollinger-bands (TRADE_EMA_GROUP_ID)
 *  — ele é derivado do trade selecionado, não uma escolha manual do usuário; sem esse filtro,
 *  o valor de uma moeda vazava pro localStorage e reaparecia (errado) ao abrir outra moeda. */
function saveQuickEmaGroups(groups) {
  try {
    localStorage.setItem(QUICK_EMA_STORAGE_KEY, JSON.stringify(groups.filter((g) => g.id !== TRADE_EMA_GROUP_ID)));
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
  // high/low/close vêm do candle do intervalo da BB — necessários pra simular toque
  // inferior→superior (path) sem buscar candles de novo.
  return bb.map((val, i) => {
    const c = candles[offset + i];
    return {
      openTime: Number(c.openTime),
      upper: val.upper,
      middle: val.middle,
      lower: val.lower,
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    };
  });
}

const BB_PATH_UP = '#9C27B0';
const BB_PATH_DOWN = '#FFC107';
const BB_PATH_CLOUD_UP = 'rgba(156,39,176,0.22)';
const BB_PATH_CLOUD_DOWN = 'rgba(255,193,7,0.22)';

/**
 * PATH BB: só liga entrada→saída (não liga saída→próxima entrada). Nuvem entre a
 * diagonal do ciclo e a banda inferior — verde na alta, vermelha na baixa.
 */
function buildBbTouchPathSeries(pathNodes, candlesticks, DL, LEFT_PAD, RIGHT_PAD, bollingerConfig) {
  if (!pathNodes?.length || !candlesticks?.length) return [];
  const offset = candlesticks.length - DL;
  const totalLen = LEFT_PAD + DL + RIGHT_PAD;
  const ivMs = candlesticks.length > 1
    ? Math.abs(Number(candlesticks[1].openTime) - Number(candlesticks[0].openTime))
    : Infinity;
  const maxDiffMs = Number.isFinite(ivMs) ? ivMs * 1.5 : Infinity;

  const mapNode = (n) => {
    const absIdx = nearestCandleIdx(candlesticks, n.openTime);
    const diffMs = Math.abs(Number(candlesticks[absIdx].openTime) - n.openTime);
    if (diffMs > maxDiffMs) return null;
    const localIdx = absIdx - offset;
    if (localIdx < 0 || localIdx >= DL) return null;
    return { x: localIdx + LEFT_PAD, price: n.price, node: n };
  };

  const lowerAligned = alignPointsToCandles(
    candlesticks,
    (bollingerConfig?.points ?? []).map((p) => ({ openTime: p.openTime, value: p.lower })),
  );

  const cycles = pairBbPathCycles(pathNodes);
  const series = [];
  const markerData = new Array(totalLen).fill(null);
  const cloudCycles = [];

  cycles.forEach((cycle, ci) => {
    const a = mapNode(cycle.buy);
    const b = mapNode(cycle.exit);
    if (!a || !b || a.x === b.x) return;

    const isUp = b.price >= a.price;
    const color = isUp ? BB_PATH_UP : BB_PATH_DOWN;
    const fill = isUp ? BB_PATH_CLOUD_UP : BB_PATH_CLOUD_DOWN;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const span = x1 - x0;

    const lineData = new Array(totalLen).fill(null);
    lineData[a.x] = a.price;
    lineData[b.x] = b.price;
    series.push({
      name: `BB Path ${ci}`,
      type: 'line',
      data: lineData,
      connectNulls: true,
      showSymbol: false,
      lineStyle: { color, width: 1.5, type: 'solid', opacity: 0.95 },
      itemStyle: { color },
      z: 11,
      silent: true,
      animation: false,
    });

    cloudCycles.push({ a, b, x0, x1, span, fill });

    const pnl = cycle.exit.pnlPct;
    const hasPnl = Number.isFinite(pnl);
    const labelExit = hasPnl ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '';
    markerData[b.x] = {
      value: b.price,
      itemStyle: { color },
      label: {
        show: !!labelExit, formatter: labelExit, color: '#fff', backgroundColor: color,
        padding: [2, 4], borderRadius: 2, fontSize: 8, fontWeight: 'bold', position: 'top',
      },
    };
  });

  if (cloudCycles.length) {
    series.push({
      name: 'BB Path Cloud',
      type: 'custom',
      // Um item por ciclo — renderItem desenha o polígono diagonal↔banda inferior.
      data: cloudCycles.map((_, i) => i),
      renderItem(params, api) {
        const cyc = cloudCycles[params.dataIndex];
        if (!cyc) return null;
        const { a, b, x0, x1, span, fill } = cyc;
        const pathPts = [];
        const lowerPts = [];
        for (let x = x0; x <= x1; x++) {
          const tt = span > 0 ? (x - x0) / span : 0;
          const pathAtStart = a.x <= b.x ? a.price : b.price;
          const pathAtEnd = a.x <= b.x ? b.price : a.price;
          const pathY = pathAtStart + tt * (pathAtEnd - pathAtStart);
          const absIdx = offset + (x - LEFT_PAD);
          const lowerY = Number(lowerAligned[absIdx]);
          if (!Number.isFinite(pathY) || !Number.isFinite(lowerY)) continue;
          const pPath = api.coord([x, pathY]);
          const pLow = api.coord([x, lowerY]);
          if (!pPath || !pLow) continue;
          pathPts.push(pPath);
          lowerPts.push(pLow);
        }
        if (pathPts.length < 2) return null;
        const points = [...pathPts, ...lowerPts.reverse()];
        return {
          type: 'polygon',
          shape: { points },
          style: { fill, stroke: 'none' },
          silent: true,
        };
      },
      z: 9,
      silent: true,
      animation: false,
    });
  }

  if (markerData.some((v) => v != null)) {
    series.push({
      name: 'BB Path Marks',
      type: 'line',
      data: markerData,
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { opacity: 0, width: 0 },
      label: { show: true },
      labelLayout: { hideOverlap: true },
      z: 12,
      silent: true,
      animation: false,
    });
  }

  return series;
}

// Mesmo teto de retenção do cache em disco usado pelo bot real (ver
// backend/utils/candleRetentionLimits.js) — 1m precisa de mais candles pra cobrir uma janela
// semanal de verdade (7 dias = ~10080 candles a 1m).
const VWAP_RETENTION_LIMIT_BY_INTERVAL = { '1m': 10500 };
const VWAP_DEFAULT_RETENTION_LIMIT = 3000;
const VWAP_SESSION_HOURS = { daily: 24, weekly: 24 * 7 };

/**
 * Candles necessários pra uma VWAP diária/semanal REAL no intervalo dado — mesma conta de
 * getRequiredSpecs em backend/bot/vwap-bands/strategyEngine.js (vwapLimit). Sem isso, o
 * overlay de VWAP do gráfico usava só o limite de candles já carregados pro candlestick
 * (ex.: 160), o que faz uma "VWAP semanal" em 1m virar, na prática, a VWAP das últimas
 * poucas horas — bandas bem mais estreitas e deslocadas do que o bot real calcula (ver
 * conversa sobre a BICOUSDT: bot mostrava bandas ~5x mais largas que o gráfico).
 */
function vwapFetchLimit(interval, session) {
  const sessionHours = VWAP_SESSION_HOURS[session] ?? 24;
  const ivMs = INTERVAL_MS[interval] ?? 60_000;
  const perSession = Math.ceil((sessionHours * 3_600_000) / ivMs);
  const retentionLimit = VWAP_RETENTION_LIMIT_BY_INTERVAL[interval] ?? VWAP_DEFAULT_RETENTION_LIMIT;
  return Math.min(retentionLimit, perSession * 3 + 30);
}

/**
 * Busca VWAP (diária/semanal) num intervalo próprio (independente do gráfico) — mesmo
 * padrão da Bollinger. `anchor` = 'session' (reset de calendário, padrão) ou 'rolling'
 * (janela móvel, sem reset). Vem com bandas ±1σ/±2σ prontas.
 */
async function fetchVwapPoints(symbol, interval, session, anchor, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return [];
  const points = await fetch(`/services/vwap?session=${session}&anchor=${anchor}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(points)) return [];

  return points;
}

/** Busca S/R num intervalo próprio (independente do gráfico) — mesmo padrão da Bollinger. */
async function fetchSupportResistancePoints(symbol, interval, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return [];
  const levels = await fetch('/services/support-resistance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  return Array.isArray(levels) ? levels : [];
}

/** Pivot Points High/Low (estilo TradingView) — intervalo próprio, mesmo padrão do S/R, mas sem agrupar pivôs em zonas. */
async function fetchPivotPointsHighLowPoints(symbol, interval, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return [];
  const pivots = await fetch('/services/pivot-points-hl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  return Array.isArray(pivots) ? pivots : [];
}

/** Choppiness Index (14) — intervalo próprio (independente do gráfico), mesmo padrão do S/R/PPHL. */
async function fetchChopOverlayPoints(symbol, interval, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return [];
  const chop = await fetch('/services/choppiness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(chop)) return [];
  const offset = candles.length - chop.length;
  return chop.map((val, i) => ({
    openTime: Number(candles[offset + i].openTime),
    value: val,
  }));
}

function buildBollingerSeries(bbConfig, candlesticks, alignSeries) {
  if (!bbConfig?.enabled || !bbConfig.points?.length) return [];
  const color = BB_COLOR;
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

/** Mesma busca binária de alignPointsToCandles, mas devolve o FLAG (declínio da VWAP) do
 *  ponto vigente em vez do valor — usado pro destaque de queda (Configurações). */
function alignFlagsToCandles(candlesticks, points, flags) {
  if (!points?.length || !candlesticks?.length) return candlesticks?.map(() => false) ?? [];
  return candlesticks.map(c => {
    const t = Number(c.openTime);
    let lo = 0, hi = points.length - 1, best = false;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].openTime <= t) { best = flags[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  });
}

/** Separa um array denso (1 valor por candle, já alinhado por alignPointsToCandles) em dois
 *  — trecho normal e trecho em queda (flags densos, mesmo tamanho) — duplicando o ponto de
 *  fronteira nos dois pra a linha não abrir buraco na transição de cor. */
function splitDenseByFlag(values, flags) {
  const normal = values.map((v, i) => (flags[i] ? null : v));
  const declining = values.map((v, i) => (flags[i] ? v : null));
  for (let i = 1; i < values.length; i++) {
    if (values[i] == null || values[i - 1] == null || flags[i] === flags[i - 1]) continue;
    if (flags[i]) declining[i - 1] = values[i - 1]; else normal[i - 1] = values[i - 1];
    if (flags[i - 1]) declining[i] = values[i]; else normal[i] = values[i];
  }
  return { normal, declining };
}

const VWAP_LINE_COLOR = '#FF4FA3';
const VWAP_BAND_COLOR = 'rgba(255, 79, 163, 0.45)';

function buildVwapSeries(vwapConfig, candlesticks, alignSeries, slopeHighlight) {
  if (!vwapConfig?.enabled || !vwapConfig.points?.length) return [];
  const declineColor = '#ec4899';
  const sessionLabel = `${vwapConfig.session === 'weekly' ? 'W' : 'D'}${vwapConfig.anchor === 'rolling' ? '~' : ''}`;
  const label = `VWAP@${vwapConfig.interval}(${sessionLabel})`;
  const rawLine = (field) => alignPointsToCandles(
    candlesticks,
    vwapConfig.points.map(p => ({ openTime: p.openTime, value: p[field] })),
  );

  const highlightOn = !!slopeHighlight?.enabled;
  const denseFlags = highlightOn
    ? alignFlagsToCandles(candlesticks, vwapConfig.points, computeVwapSlopeFlags(vwapConfig.points, slopeHighlight.lookback, slopeHighlight.minSlopePct))
    : null;

  /** Uma entrada vira duas (normal + rosa) quando o destaque está ligado. */
  function lineDefs(field, name, lineColor, lineStyle, showEndLabel) {
    const raw = rawLine(field);
    const base = { type: 'line', smooth: true, showSymbol: false };
    const endLabel = showEndLabel ? {
      show: true, formatter: name, color: lineColor, fontSize: 9, padding: [1, 4],
      backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 2,
    } : undefined;
    if (!highlightOn) {
      return [{ ...base, name, data: alignSeries(raw), lineStyle: { color: lineColor, ...lineStyle }, ...(endLabel ? { endLabel } : {}) }];
    }
    const { normal, declining } = splitDenseByFlag(raw, denseFlags);
    return [
      { ...base, name, data: alignSeries(normal), lineStyle: { color: lineColor, ...lineStyle }, ...(endLabel ? { endLabel } : {}) },
      { ...base, name: `${name} (queda)`, data: alignSeries(declining), lineStyle: { color: declineColor, ...lineStyle } },
    ];
  }

  const series = [...lineDefs('value', label, VWAP_LINE_COLOR, { width: 1.5, type: 'solid' }, true)];
  if (vwapConfig.bands) {
    series.push(
      ...lineDefs('upper1', `${label} up1`, VWAP_BAND_COLOR, { width: 1, type: 'dashed' }, false),
      ...lineDefs('lower1', `${label} lw1`, VWAP_BAND_COLOR, { width: 1, type: 'dashed' }, false),
      ...lineDefs('upper2', `${label} up2`, VWAP_BAND_COLOR, { width: 1, type: 'dotted' }, false),
      ...lineDefs('lower2', `${label} lw2`, VWAP_BAND_COLOR, { width: 1, type: 'dotted' }, false),
    );
  }
  return series;
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
  ma9: '9', ma21: '21', ma50: '50', ma200: '200', ichimoku: 'Ich', sr: 'S/R', pphl: 'PPHL', rsi: 'RSI',
  rsi80: 'R80', rsi50: 'R50', stopLoss: 'SL', chopZone: 'CHOP',
};

/** Grid base do painel — cada botão ocupa N×M células. */
const PANEL_GRID_COLS = 4;

/** Altura em linhas de cada tile de indicador. */
const INDICATOR_TILE_ROWS = 2;

const BANDS_COL_SPAN = 4;

const BOLLINGER_ROW_SPAN = 4;

const INTERVAL_PICKER_ROW_SPAN = 1;

const VWAP_ROW_SPAN = 5;

/** Grid interno do bloco de EMAs rápidas: intervalo+remover, 4 botões de período, banda cima/baixo. */
const QUICK_EMA_GRID_COLS = 4;
const QUICK_EMA_GROUP_ROWS = 4;

function quickEmaRowSpan(groups) {
  const addRow = groups.length < MAX_QUICK_EMA_GROUPS ? 1 : 0;
  return Math.max(1, groups.length * QUICK_EMA_GROUP_ROWS + addRow);
}

function renderBollingerTile(
  dims, t, bollingerBands, setBollingerBands, bbPathEnabled, setBbPathEnabled,
  medianTrendEnabled, setMedianTrendEnabled,
) {
  const innerW = dims.w - PANEL_TILE_PAD * 2;
  const innerH = dims.h - PANEL_TILE_PAD * 2;
  const rowH = (innerH - PANEL_GAP * 3) / 4;
  const halfDims = { w: (innerW - PANEL_GAP) / 2, h: rowH };
  const rowDims = { w: innerW, h: rowH };
  const color = BB_COLOR;
  const pathColor = BB_PATH_COLOR;
  const trendColor = MEDIAN_TREND_COLOR;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: 'repeat(4, 1fr)',
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
      <div style={{ gridColumn: '1', gridRow: '3', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.bb_on')}>
          <button
            type="button"
            onClick={() => setBollingerBands(b => ({ ...b, enabled: !b.enabled }))}
            style={panelBtn(bollingerBands.enabled, color, false, halfDims)}
          >
            {bollingerBands.enabled ? 'BB ON' : 'BB OFF'}
          </button>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '2', gridRow: '3', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.bb_path')}>
          <button
            type="button"
            onClick={() => {
              setBbPathEnabled((v) => {
                const next = !v;
                // Liga as bandas junto com o path pra o usuário ver a referência lower/upper
                if (next) setBollingerBands((b) => (b.enabled ? b : { ...b, enabled: true }));
                return next;
              });
            }}
            style={panelBtn(bbPathEnabled, pathColor, false, halfDims)}
          >
            {bbPathEnabled ? 'PATH ON' : 'PATH'}
          </button>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '1 / span 2', gridRow: '4', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.bb_median_trend')}>
          <button
            type="button"
            onClick={() => setMedianTrendEnabled(v => !v)}
            style={panelBtn(medianTrendEnabled, trendColor, false, rowDims)}
          >
            {medianTrendEnabled ? 'TENDÊNCIA ON' : 'TENDÊNCIA MEDIANA'}
          </button>
        </PanelTip>
      </div>
    </div>
  );
}

/**
 * VWAP de sessão: intervalo próprio + sessão (diário/semanal) + bandas ±σ + ON/OFF —
 * mesmo padrão da Bollinger, sem período/desvio (é um único acumulado por sessão, não uma média móvel).
 */
function renderVwapTile(dims, t, vwap, setVwap, slopeHighlightOn, setSlopeHighlightOn) {
  const innerW = dims.w - PANEL_TILE_PAD * 2;
  const innerH = dims.h - PANEL_TILE_PAD * 2;
  const rowH = (innerH - PANEL_GAP * 4) / 5;
  const rowDims = { w: innerW, h: rowH };
  const halfDims = { w: (innerW - PANEL_GAP) / 2, h: rowH };
  const color = '#4ade80';
  const declineColor = '#ef4444';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: 'repeat(5, 1fr)',
      gap: PANEL_GAP,
      width: innerW,
      height: innerH,
      boxSizing: 'border-box',
    }}>
      <div style={{ gridColumn: '1 / span 2', gridRow: '1', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.vwap_interval')}>
          <select
            value={vwap.interval}
            onChange={e => setVwap(v => ({ ...v, interval: e.target.value }))}
            style={panelSelect(color, rowDims)}
          >
            {OVERLAY_MA_INTERVALS.map(iv => <option key={iv} value={iv}>{`VWAP ${iv}`}</option>)}
          </select>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '1', gridRow: '2', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.vwap_session')}>
          <button
            type="button"
            onClick={() => setVwap(v => ({ ...v, session: 'daily' }))}
            style={panelBtn(vwap.session === 'daily', color, true, halfDims)}
          >
            Diário
          </button>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '2', gridRow: '2', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.vwap_session')}>
          <button
            type="button"
            onClick={() => setVwap(v => ({ ...v, session: 'weekly' }))}
            style={panelBtn(vwap.session === 'weekly', color, true, halfDims)}
          >
            Semanal
          </button>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '1 / span 2', gridRow: '3', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.vwap_bands')}>
          <button
            type="button"
            onClick={() => setVwap(v => ({ ...v, bands: !v.bands }))}
            style={panelBtn(vwap.bands, color, true, rowDims)}
          >
            {vwap.bands ? 'Bandas ON' : 'Bandas OFF'}
          </button>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '1 / span 2', gridRow: '4', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.vwap_on')}>
          <button
            type="button"
            onClick={() => setVwap(v => ({ ...v, enabled: !v.enabled }))}
            style={panelBtn(vwap.enabled, color, true, rowDims)}
          >
            {vwap.enabled ? 'VWAP ON' : 'VWAP OFF'}
          </button>
        </PanelTip>
      </div>
      <div style={{ gridColumn: '1 / span 2', gridRow: '5', display: 'flex', alignItems: 'stretch' }}>
        <PanelTip text={t('chart.tip.vwap_slope_highlight')}>
          <button
            type="button"
            onClick={() => setSlopeHighlightOn(v => !v)}
            style={panelBtn(slopeHighlightOn, declineColor, false, rowDims)}
          >
            {slopeHighlightOn ? 'Queda VWAP ON' : 'Queda VWAP OFF'}
          </button>
        </PanelTip>
      </div>
    </div>
  );
}

/** Seletor de intervalo compacto (1 linha) pra indicadores com intervalo próprio (S/R, PPHL) — mesmo padrão da Bollinger. */
function renderIntervalPickerTile(dims, t, tipKey, labelPrefix, color, value, onChange) {
  const innerW = dims.w - PANEL_TILE_PAD * 2;
  const innerH = dims.h - PANEL_TILE_PAD * 2;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', width: innerW, height: innerH, boxSizing: 'border-box' }}>
      <PanelTip text={t(tipKey)}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ ...panelSelect(color, { w: innerW, h: innerH }), fontSize: scaleFontSize({ w: innerW, h: innerH }, 0.3, 9, 13) }}
        >
          {OVERLAY_MA_INTERVALS.map(iv => <option key={iv} value={iv}>{`${labelPrefix} ${iv}`}</option>)}
        </select>
      </PanelTip>
    </div>
  );
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

  // --- Bollinger / S/R interval / PPHL interval / Quick-EMA sections (separate flex blocks) ---
  const INTERVAL_PICKER_KINDS = ['srInterval', 'pphlInterval', 'chopInterval'];
  const blocks = tileDefs
    .filter((t) => t.kind === 'bb' || t.kind === 'vwap' || INTERVAL_PICKER_KINDS.includes(t.kind) || t.kind === 'quickEma')
    .map((t) => ({
      ...t,
      colSpan: BANDS_COL_SPAN,
      rowSpan: t.kind === 'bb' ? BOLLINGER_ROW_SPAN : t.kind === 'vwap' ? VWAP_ROW_SPAN : INTERVAL_PICKER_KINDS.includes(t.kind) ? INTERVAL_PICKER_ROW_SPAN : quickEmaRowSpan(t.data.groups),
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

const topToggleBtn = {
  pointerEvents: 'auto',
  fontSize: 11,
  lineHeight: 1,
  minWidth: 32,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  borderRadius: '0 0 4px 4px',
  color: '#94a3b8',
  background: 'rgba(0,0,0,0.55)',
  border: '1px solid #334155',
  borderTop: 'none',
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
  bbPathEnabled,
  setBbPathEnabled,
  medianTrendEnabled,
  setMedianTrendEnabled,
  srInterval,
  setSrInterval,
  pphlInterval,
  setPphlInterval,
  chopInterval,
  setChopInterval,
  vwap,
  setVwap,
  vwapSlopeHighlightOn,
  setVwapSlopeHighlightOn,
  overlayMaLoading,
  panelButtons,
  collapsed,
  onToggleCollapse,
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { selectedChart, gateFavorites } = useCurrency();
  const outerRef = useRef(null);
  const [chartSize, setChartSize] = useState({ w: PANEL_MIN_WIDTH, h: 400 });
  const [panelTab, setPanelTab] = useState('indicators'); // 'indicators' | 'executed'

  const tileDefs = useMemo(() => {
    const showKey = (key) => panelButtons[key] !== false;
    const indicators = [...INDICATOR_GROUPS, ...RSI_EXTRA_INDICATORS].filter(({ id }) => showKey(id));
    const showBb = showKey('bb');
    const showSr = showKey('sr');
    const showPphl = showKey('pphl');
    const showChopInterval = showKey('chopZone');
    const showVwap = showKey('vwap');

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
    if (showSr) {
      list.push({ key: 'srInterval', kind: 'srInterval', data: {} });
    }
    if (showPphl) {
      list.push({ key: 'pphlInterval', kind: 'pphlInterval', data: {} });
    }
    if (showChopInterval) {
      list.push({ key: 'chopInterval', kind: 'chopInterval', data: {} });
    }
    if (showBb) {
      list.push({ key: 'bb', kind: 'bb', data: {} });
    }
    if (showVwap) {
      list.push({ key: 'vwap', kind: 'vwap', data: {} });
    }
    list.push({ key: 'quickEma', kind: 'quickEma', data: { groups: quickEmaGroups } });
    return list;
  }, [panelButtons, activeIndicators, quickEmaGroups]);

  // Painel agora é um dropdown flutuante no topo do gráfico (não empurra mais o chart) —
  // largura limitada (60% no desktop, full width no mobile) e altura travada em % do
  // gráfico, com scroll interno se o conteúdo não couber.
  useEffect(() => {
    const chart = outerRef.current?.parentElement;
    if (!chart) return undefined;
    const measure = () => setChartSize({ w: chart.clientWidth || PANEL_MIN_WIDTH, h: chart.clientHeight || 400 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(chart);
    return () => ro.disconnect();
  }, []);

  const contentWidth = isMobile
    ? chartSize.w
    : Math.max(PANEL_MIN_WIDTH, Math.round(chartSize.w * PANEL_WIDTH_RATIO));
  const maxPanelHeight = Math.min(
    PANEL_MAX_HEIGHT_PX,
    Math.max(160, Math.round(chartSize.h * PANEL_MAX_HEIGHT_RATIO)),
  );

  // 1ª passada: só pra descobrir quantas "row units" o conteúdo precisa (contagem de
  // indicadores/blocos ativos), sem travar altura ainda.
  const probeLayout = useMemo(
    () => computeMasonryLayout(tileDefs, contentWidth, 10000, PANEL_GAP, overlayMaLoading),
    [tileDefs, contentWidth, overlayMaLoading],
  );
  const totalRowUnits = probeLayout.indicatorRowUnits
    + probeLayout.blockPlacements.reduce((sum, b) => sum + b.rowSpan, 0);
  const panelHeight = Math.min(Math.max(MIN_ROW_UNIT_PX, totalRowUnits * PANEL_ROW_PX), maxPanelHeight);

  const layout = useMemo(
    () => computeMasonryLayout(tileDefs, contentWidth, panelHeight, PANEL_GAP, overlayMaLoading),
    [tileDefs, contentWidth, panelHeight, overlayMaLoading],
  );

  if (!tileDefs.length) {
    return null;
  }

  const toggleBtn = (
    <Tooltip text={t(collapsed ? 'chart.tip.panel_expand' : 'chart.tip.panel_collapse')} position="bottom" portal>
      <button
        type="button"
        onClick={onToggleCollapse}
        style={{ ...topToggleBtn, alignSelf: 'center', flexShrink: 0 }}
        onMouseEnter={e => { e.currentTarget.style.color = '#e2e8f0'; e.currentTarget.style.borderColor = '#64748b'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#334155'; }}
      >
        {collapsed ? '▾' : '▴'}
      </button>
    </Tooltip>
  );

  return (
    <div
      ref={outerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {collapsed && toggleBtn}

      {!collapsed && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: 'auto',
            width: contentWidth,
            maxWidth: '100%',
            maxHeight: maxPanelHeight,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            marginTop: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: PANEL_GAP,
            padding: PANEL_CARD_PAD,
            background: 'rgba(8,12,20,0.96)',
            border: '1px solid #334155',
            borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
          }}
        >
          {/* Abas do painel: Indicadores / Executados */}
          <div style={{ display: 'flex', flexShrink: 0, gap: 2 }}>
            {[
              { id: 'indicators', label: t('chart.panel.tab_indicators') },
              { id: 'executed', label: t('chart.panel.tab_executed') },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanelTab(id)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 9,
                  fontFamily: 'monospace',
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  userSelect: 'none',
                  lineHeight: 1,
                  padding: '7px 2px',
                  borderRadius: 3,
                  border: 'none',
                  cursor: 'pointer',
                  color: panelTab === id ? '#e2e8f0' : '#475569',
                  background: panelTab === id ? '#334155' : 'transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {panelTab === 'executed' ? (
            <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
              <TradeHistoryPanel symbol={selectedChart?.symbol} gateFavorites={gateFavorites} />
            </div>
          ) : layout.indicatorPlacements.length > 0 && (
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

          {panelTab !== 'executed' && layout.blockPlacements.map((tile) => (
            <div
              key={tile.key}
              style={{
                ...panelBandsShell,
                flex: tile.rowSpan,
                minHeight: tile.rowSpan * MIN_ROW_UNIT_PX,
                width: `${(tile.colSpan / PANEL_GRID_COLS) * 100}%`,
              }}
            >
              {tile.kind === 'bb' && renderBollingerTile(
                tile.dims, t, bollingerBands, setBollingerBands, bbPathEnabled, setBbPathEnabled,
                medianTrendEnabled, setMedianTrendEnabled,
              )}
              {tile.kind === 'srInterval' && renderIntervalPickerTile(tile.dims, t, 'chart.tip.sr_interval', 'S/R', '#facc15', srInterval, setSrInterval)}
              {tile.kind === 'pphlInterval' && renderIntervalPickerTile(tile.dims, t, 'chart.tip.pphl_interval', 'PPHL', '#2dd4bf', pphlInterval, setPphlInterval)}
              {tile.kind === 'chopInterval' && renderIntervalPickerTile(tile.dims, t, 'chart.tip.chop_interval', 'CHOP', '#f59e0b', chopInterval, setChopInterval)}
              {tile.kind === 'vwap' && renderVwapTile(tile.dims, t, vwap, setVwap, vwapSlopeHighlightOn, setVwapSlopeHighlightOn)}
              {tile.kind === 'quickEma' && renderQuickEmaGroupsTile(
                tile.data, tile.dims, t,
                addQuickEmaGroup, removeQuickEmaGroup, updateQuickEmaGroupInterval, toggleQuickEmaGroupPeriod,
                updateQuickEmaGroupBandPct, updateQuickEmaGroupBandPeriod,
              )}
            </div>
          ))}
        </div>
      )}

      {!collapsed && toggleBtn}
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

/** Rótulos do eixo de preço no celular: tela estreita não tem espaço pra 4-6 casas decimais
 *  (ver fmtChartPrice) — versão compacta, só o necessário pra diferenciar o valor visualmente. */
function fmtAxisPriceMobile(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(2);
  return n.toPrecision(2);
}

/** Tempo decorrido (ms) em texto curto: "45m", "5h", "5h30m", "1d 3h"… */
function fmtElapsedTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) return remMinutes ? `${totalHours}h${remMinutes}m` : `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours
    ? `${totalHours}h (${days}d ${remHours}h)`
    : `${totalHours}h (${days}d)`;
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

  // Só 'entry' (posição realmente aberta — ver buildMarkersFromLiveTrades, side:'entry'
  // só existe quando entry.phase === 'BOUGHT'). 'buy' é a entrada de um trade JÁ
  // FECHADO do histórico (tem um 'sell' correspondente) — tratar como se fosse a
  // posição aberta atual desenhava a linha de PnL/quadrados no lugar errado (bug visto
  // na NEAR: pegava a compra de um trade antigo já vendido).
  const entryMarker = [...(chartTradeMarkers ?? [])].reverse().find(
    m => m.side === 'entry' && m.price != null,
  );
  if (entryMarker) return { price: Number(entryMarker.price), time: entryMarker.time ?? null };

  if (allTrades?.length) {
    const inv = [];
    const sorted = [...allTrades].sort((a, b) => Number(a.time) - Number(b.time));
    let totalBoughtQty = 0;
    for (const t of sorted) {
      const price = Number(t.price);
      const qty = Number(t.qty);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
      if (t.isBuyer) {
        if (qty > 0) { inv.push({ qty, price, time: Number(t.time) }); totalBoughtQty += qty; }
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
    const remainingQty = inv.reduce((s, l) => s + l.qty, 0);
    // Ignora poeira residual (taxa/arredondamento) — uma venda que fechou quase tudo
    // (mas não a 100,000%) não pode deixar a posição marcada como "ainda aberta" pra
    // sempre. Só considera aberto se sobrar mais que 1% do total comprado.
    if (remainingQty > totalBoughtQty * 0.01) {
      const avgPrice = inv.reduce((s, l) => s + l.qty * l.price, 0) / remainingQty;
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
  if (!buyInfo?.price || !stopLossConfig || stopLossConfig.mode === 'price') return null;
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

function formatPctFromBase(basePrice, price) {
  const pct = ((price - basePrice) / basePrice) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** Acha o índice do candle exibido mais próximo de um timestamp. */
function nearestCandleIdx(candlesticks, ms) {
  let best = 0;
  let bestDiff = Infinity;
  candlesticks.forEach((c, i) => {
    const d = Math.abs(Number(c.openTime) - ms);
    if (d < bestDiff) { bestDiff = d; best = i; }
  });
  return best;
}

/** Dois quadrados a partir da posição de compra ABERTA: compra→alvo (verde) e
 *  compra→stoploss (vermelho). Largura DINÂMICA: acompanha os candles que vão fechando
 *  (cresce a cada novo candle), deixando os 2 candles mais recentes livres na frente — mas só
 *  quando há mais de 5 candles à frente da compra; com 5 ou menos, preenche até o candle mais
 *  recente (sem faixa livre). Mesma regra do LW — ver buildPositionRects em
 *  CandlestickChartLW.jsx. */
function buildBuyPositionSquares(buyInfo, stopLossConfig, targetConfig, candlesticks, DL, LEFT_PAD) {
  if (!buyInfo?.price || !candlesticks?.length) return null;
  const buyPrice = buyInfo.price;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;

  const offset = candlesticks.length - DL;
  let buyIdx = 0;
  if (buyInfo.time != null) {
    const absIdx = nearestCandleIdx(candlesticks, buyInfo.time);
    buyIdx = Math.max(0, Math.min(DL - 1, absIdx - offset));
  }
  const x1 = buyIdx + LEFT_PAD;
  const lastX = LEFT_PAD + DL - 1;
  const candlesAhead = lastX - x1;
  const x2 = candlesAhead > 5 ? lastX - 2 : lastX;

  const pctLabel = (price) => formatPctFromBase(buyPrice, price);

  const areas = [];

  if (targetConfig?.enabled) {
    const targetPrice = targetConfig.mode === 'price'
      ? targetConfig.price
      : buyPrice * (1 + targetConfig.targetPct / 100);
    if (Number.isFinite(targetPrice)) areas.push([
      {
        xAxis: x1, yAxis: buyPrice, itemStyle: { color: 'rgba(34,197,94,0.18)' },
        label: { show: true, position: 'insideTop', formatter: pctLabel(targetPrice), color: '#22c55e', fontSize: 11, fontWeight: 'bold' },
      },
      { xAxis: x2, yAxis: targetPrice },
    ]);
  }

  if (stopLossConfig?.enabled) {
    const stopPrice = stopLossConfig.mode === 'price'
      ? stopLossConfig.price
      : computeStopLossFloor(buyPrice, buyPrice, stopLossConfig);
    if (stopPrice != null) {
      areas.push([
        {
          xAxis: x1, yAxis: buyPrice, itemStyle: { color: 'rgba(239,68,68,0.18)' },
          label: { show: true, position: 'insideBottom', formatter: pctLabel(stopPrice), color: '#ef4444', fontSize: 11, fontWeight: 'bold' },
        },
        { xAxis: x2, yAxis: stopPrice },
      ]);
    }
  }

  if (!areas.length) return null;
  return { silent: true, data: areas };
}

/** Mesma ideia dos quadrados da posição aberta, mas para cada trade JÁ FECHADO do
 *  histórico (markers 'sell' com entryTime/entryPrice — ver buildMarkersFromLiveTrades/
 *  buildMarkersFromExchangeTrades em utils/multitradeChart.js). Largura = candles reais
 *  entre a compra e a venda daquele trade (não fixa em 5, como na posição aberta — ali
 *  não há venda ainda pra medir a distância real). Mostra sempre o resultado REAL
 *  (compra→venda) — não o alvo/stop teórico configurado na estratégia: um trade que
 *  disparou bem além do alvo (ou muito antes do stop) ficava parecendo prejuízo, já
 *  que o quadrado teórico não tem nada a ver com onde a venda de fato aconteceu. */
function buildHistoricalPositionSquares(candlesticks, markers, DL, LEFT_PAD) {
  if (!markers?.length || !candlesticks?.length) return null;

  const offset = candlesticks.length - DL;
  const areas = [];

  // nearestCandleIdx sempre acha "o candle mais próximo", mesmo que seja um trade de
  // 2024 e os candles exibidos sejam só dos últimos dias — sem tolerância, isso gruda
  // o quadrado no candle 0 (bug visto na NEAR: trades histórico com entryTime de anos
  // atrás casavam com o primeiro candle exibido). Só aceita o casamento se o candle
  // achado estiver a no máximo 1.5x o intervalo de distância do horário real.
  const ivMs = candlesticks.length > 1
    ? Math.abs(Number(candlesticks[1].openTime) - Number(candlesticks[0].openTime))
    : Infinity;
  const maxDiffMs = ivMs * 1.5;

  markers.forEach(m => {
    if (m.side !== 'sell' || m.entryPrice == null || m.entryTime == null || m.time == null) return;
    const entryPrice = Number(m.entryPrice);
    const exitPrice = Number(m.price);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return;

    const entryAbsIdx = nearestCandleIdx(candlesticks, m.entryTime);
    let exitAbsIdx = nearestCandleIdx(candlesticks, m.time);
    const entryDiffMs = Math.abs(Number(candlesticks[entryAbsIdx].openTime) - m.entryTime);
    const exitDiffMs = Math.abs(Number(candlesticks[exitAbsIdx].openTime) - m.time);
    if (entryDiffMs > maxDiffMs || exitDiffMs > maxDiffMs) return;
    // Compra e venda podem cair no mesmo candle quando o gráfico é aberto num intervalo mais
    // grosso que o da simulação (ex.: gráfico em 1h pra um ciclo VWAP que durou 40min) — empurra
    // pro próximo candle em vez de descartar o quadrado inteiro (era o bug: comparar x2<=x1 sem
    // essa folga fazia o quadrado sumir e só a seta de compra/venda ficava visível).
    if (exitAbsIdx <= entryAbsIdx) exitAbsIdx = entryAbsIdx + 1;
    const entryLocal = entryAbsIdx - offset;
    const exitLocal = exitAbsIdx - offset;
    // Só desenha se a compra E a venda estiverem dentro da janela de candles
    // atualmente exibida — clampar um lado fora da janela pro início/fim visível
    // fazia o quadrado aparecer numa posição/horário que não é o real.
    if (entryLocal < 0 || exitLocal < 0 || entryLocal >= DL || exitLocal >= DL) return;
    const x1 = entryLocal + LEFT_PAD;
    const x2 = exitLocal + LEFT_PAD;

    // Resultado REAL do trade (compra→venda) — mesma paleta verde/vermelho do alvo/stop
    // da posição aberta (buildBuyPositionSquares): o ciclo já fechou, então só um dos dois
    // desfechos aconteceu de fato — verde se deu lucro, vermelho se deu prejuízo.
    if (!Number.isFinite(exitPrice)) return;
    const isProfit = exitPrice >= entryPrice;
    const color = isProfit ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
    const labelColor = isProfit ? '#22c55e' : '#ef4444';
    areas.push([
      {
        xAxis: x1, yAxis: entryPrice, itemStyle: { color },
        label: { show: true, position: 'inside', formatter: formatPctFromBase(entryPrice, exitPrice), color: labelColor, fontSize: 10, fontWeight: 'bold' },
      },
      { xAxis: x2, yAxis: exitPrice },
    ]);
  });

  if (!areas.length) return null;
  return { silent: true, data: areas };
}

function buildMultitradeMarkLines(candlesticks, interval, markers, DL, LEFT_PAD) {
  if (!markers?.length || !candlesticks?.length) return [];
  const ms = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000 }[interval] ?? 900_000;
  const offset = candlesticks.length - DL;
  const styles = {
    possible_entry: { color: '#ffffff', label: '◌ Entrada pronta' },
  };
  return markers.flatMap(m => {
    // 'entry' (posição aberta) e 'buy'/'sell' (trades fechados do histórico) não
    // desenham mais linha vertical — os quadrados compra→alvo/stoploss (posição
    // aberta) e compra→venda real (histórico) cobrem isso. 'signal' também não
    // desenha mais linha — o triângulo (buildSignalMarkers) já marca o candle certo.
    if (m.side === 'entry' || m.side === 'buy' || m.side === 'sell' || m.side === 'signal') return [];
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
    const dashed = m.side === 'possible_entry';
    const label = m.label ?? st.label;
    return [{
      xAxis: localIdx + LEFT_PAD,
      lineStyle: { color: st.color, width: m.side === 'possible_entry' ? 2 : 1.5, type: dashed ? 'dashed' : 'solid' },
      label: {
        show: true,
        formatter: label,
        color: st.color,
        fontSize: 9,
        position: 'insideStartTop',
        padding: [2, 4],
      },
    }];
  });
}

function buildSrMarkLines(levels) {
  if (!levels?.length) return [];
  const maxTouches = Math.max(...levels.map(l => l.touches ?? 1));
  return levels.map(lvl => {
    const isRes = lvl.type === 'resistance';
    const color = isRes ? C_DOWN : C_UP;
    const strengthRatio = (lvl.touches ?? 1) / maxTouches;
    return {
      yAxis: lvl.price,
      lineStyle: { color, width: 1 + Math.round(strengthRatio * 2), type: 'solid', opacity: 0.35 + strengthRatio * 0.45 },
      label: {
        show: true,
        formatter: `${isRes ? 'R' : 'S'} ${fmtChartPrice(lvl.price)} (${lvl.touches}x)`,
        color,
        fontSize: 9,
        position: 'end',
        padding: [2, 4],
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 2,
      },
    };
  });
}

/** Mapeia cada pivô (time, price, type) pro candle exibido mais próximo — sem agrupar em zonas, um marcador por pivô. */
function buildPivotMarkers(pivots, candlesticks, DL, LEFT_PAD, chartInterval) {
  if (!pivots?.length || !candlesticks?.length) return { highs: [], lows: [] };
  const maxDiffMs = (INTERVAL_MS[chartInterval] ?? 900_000) * 1.5;
  const offset = candlesticks.length - DL;
  const highs = [];
  const lows = [];
  pivots.forEach((p) => {
    let best = 0;
    let bestDiff = Infinity;
    candlesticks.forEach((c, i) => {
      const d = Math.abs(Number(c.openTime) - p.time);
      if (d < bestDiff) { bestDiff = d; best = i; }
    });
    if (bestDiff > maxDiffMs) return;
    const localIdx = best - offset;
    if (localIdx < 0 || localIdx >= DL) return;
    const point = [localIdx + LEFT_PAD, p.price];
    if (p.type === 'high') highs.push(point);
    else lows.push(point);
  });
  return { highs, lows };
}

/** Triângulo apontando para baixo acima do candle do sinal (RSI/MA) que motivou a
 *  entrada — a linha vertical tracejada de 'signal' (buildMultitradeMarkLines) cruza
 *  a altura toda do gráfico e fica difícil de associar a um candle específico quando
 *  há vários candles ou outras linhas na tela; o triângulo fica preso ao candle certo. */
function buildSignalMarkers(candlesticks, markers, DL, LEFT_PAD, chartInterval) {
  if (!markers?.length || !candlesticks?.length) return [];
  const maxDiffMs = (INTERVAL_MS[chartInterval] ?? 900_000) * 1.5;
  const offset = candlesticks.length - DL;
  const points = [];
  markers.forEach((m) => {
    if (m.side !== 'signal' || m.time == null) return;
    const absIdx = nearestCandleIdx(candlesticks, m.time);
    const diff = Math.abs(Number(candlesticks[absIdx].openTime) - m.time);
    if (diff > maxDiffMs) return;
    const localIdx = absIdx - offset;
    if (localIdx < 0 || localIdx >= DL) return;
    const high = Number(candlesticks[absIdx].high);
    if (!Number.isFinite(high)) return;
    points.push([localIdx + LEFT_PAD, high]);
  });
  return points;
}

function buildOption({ symbol, interval, candlesticks, ichimokuCloud, movingAverage, ma50, ma9, ma21, rsi }, colors, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = [], overlayConfigs = [], multitradeMarkers = [], chartLeftPad = CHART_LEFT_MARGIN, buyInfo = null, stopLossConfig = null, targetConfig = null, chartRightPad = CHART_PRICE_PAD + CHART_LEFT_MARGIN, bollingerConfig = null, srConfig = null, pphlConfig = null, vwapConfig = null, chopConfig = null, vwapSlopeHighlight = null, isMobile = false, bbPathEnabled = false) {
  const showMa9      = activeIndicators.includes('ma9');
  const showMa21     = activeIndicators.includes('ma21');
  const showMa50     = activeIndicators.includes('ma50');
  const showMa200    = activeIndicators.includes('ma200');
  const showIchimoku = activeIndicators.includes('ichimoku');
  const showSr       = activeIndicators.includes('sr');
  const showPphl     = activeIndicators.includes('pphl');
  const showRsi      = activeIndicators.includes('rsi');
  const showRsi50    = activeIndicators.includes('rsi50');
  const showRsi80    = activeIndicators.includes('rsi80');
  const showChopZone = activeIndicators.includes('chopZone');
  const showStopLoss = activeIndicators.includes('stopLoss');
  // Subpainéis empilhados abaixo do preço (RSI, CHOP...) — cada um ganha seu próprio grid,
  // na ordem desta lista. subpanelCount define a partir de qual gridIndex os rótulos do
  // eixo X aparecem (só no grid mais de baixo).
  const subpanelIds  = [...(showRsi ? ['rsi'] : []), ...(showChopZone ? ['chopZone'] : [])];
  const subpanelCount = subpanelIds.length;
  const DL = Math.min(displayLimit, candlesticks.length);
  const LEFT_PAD  = 1;
  const RIGHT_PAD = showIchimoku ? 24 : 3;

  const xData = (() => {
    const slicedDates = candlesticks.slice(-DL).map((c) => convertOpenTime(c.openTime, interval));
    return [...new Array(LEFT_PAD).fill(''), ...slicedDates, ...new Array(RIGHT_PAD).fill('')];
  })();

  // Data/hora completa por candle (rótulo do eixo é abreviado: só minuto ou só hora) — usado no tooltip.
  const xFullData = (() => {
    const slicedFull = candlesticks.slice(-DL).map((c) => fmtDate(Number(c.openTime)));
    return [...new Array(LEFT_PAD).fill(''), ...slicedFull, ...new Array(RIGHT_PAD).fill('')];
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

  // Todas as markLines unificadas: separadores de dia + zoom + compras + sinais MT + zonas S/R
  const mtMarkData = buildMultitradeMarkLines(candlesticks, interval, multitradeMarkers, DL, LEFT_PAD);
  const srMarkData = showSr ? buildSrMarkLines(srConfig?.levels) : [];
  const pivotMarkers = showPphl ? buildPivotMarkers(pphlConfig?.points, candlesticks, DL, LEFT_PAD, interval) : { highs: [], lows: [] };
  const signalMarkers = buildSignalMarkers(candlesticks, multitradeMarkers, DL, LEFT_PAD, interval);
  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData, ...mtMarkData, ...srMarkData];

  const lastClose = candlesticks.length ? parseFloat(candlesticks[candlesticks.length - 1].close) : null;
  const buyPnlSeries = buildBuyPnlSeries(buyInfo, candlesticks, DL, LEFT_PAD, RIGHT_PAD, lastClose);
  const stopLossSeries = showStopLoss
    ? buildStopLossLineSeries(buyInfo, stopLossConfig, candlesticks, DL, LEFT_PAD, RIGHT_PAD)
    : null;
  const buyPositionSquares = buildBuyPositionSquares(buyInfo, stopLossConfig, targetConfig, candlesticks, DL, LEFT_PAD);
  const historicalPositionSquares = buildHistoricalPositionSquares(candlesticks, multitradeMarkers, DL, LEFT_PAD);
  const positionSquares = (() => {
    const data = [...(buyPositionSquares?.data ?? []), ...(historicalPositionSquares?.data ?? [])];
    return data.length ? { silent: true, data } : null;
  })();
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
          color: '#111', fontSize: isMobile ? 14 : 10, fontWeight: 'bold',
          backgroundColor: '#facc15', padding: isMobile ? [4, 8] : [2, 5], borderRadius: 2,
        }
      }] : [])
    ]
  };

  const axisBase = (gridIndex) => ({
    gridIndex,
    type: 'category',
    data: xData,
    axisLine: { lineStyle: { color: colors.panel } },
    axisLabel: { color: colors.text, fontSize: 10, show: gridIndex === subpanelCount },
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
  const bbPathNodes = bbPathEnabled && bollingerConfig?.points?.length
    ? simulateBbTouchPath(bollingerConfig.points)
    : [];
  const bbPathSeriesList = bbPathEnabled
    ? buildBbTouchPathSeries(bbPathNodes, candlesticks, DL, LEFT_PAD, RIGHT_PAD, bollingerConfig)
    : [];
  const vwapSeries = buildVwapSeries(vwapConfig, candlesticks, alignSeries, vwapSlopeHighlight);

  const tooltipFormatter = (params) => {
    const idx = params[0]?.dataIndex;
    const time = (idx != null ? xFullData[idx] : null) || params[0]?.axisValue || '';
    return `<div style="font-family:monospace;font-size:11px">${time}</div>`;
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
      ...(positionSquares ? { markArea: positionSquares } : {}),
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
    ...bbPathSeriesList.map(s => ({ ...s, xAxisIndex: idx, yAxisIndex: idx })),
    ...vwapSeries.map(s => ({ ...s, xAxisIndex: idx, yAxisIndex: idx })),
    ...(showPphl && pivotMarkers.highs.length ? [{
      name: 'PPHL Alta',
      type: 'scatter',
      xAxisIndex: idx, yAxisIndex: idx,
      data: pivotMarkers.highs,
      symbol: 'triangle',
      symbolSize: 8,
      symbolRotate: 180,
      itemStyle: { color: C_DOWN },
      z: 5,
    }] : []),
    ...(showPphl && pivotMarkers.lows.length ? [{
      name: 'PPHL Baixa',
      type: 'scatter',
      xAxisIndex: idx, yAxisIndex: idx,
      data: pivotMarkers.lows,
      symbol: 'triangle',
      symbolSize: 8,
      itemStyle: { color: C_UP },
      z: 5,
    }] : []),
    ...(signalMarkers.length ? [{
      name: 'Sinal',
      type: 'scatter',
      xAxisIndex: idx, yAxisIndex: idx,
      data: signalMarkers,
      symbol: 'triangle',
      symbolSize: 9,
      symbolRotate: 180,
      symbolOffset: [0, -10],
      itemStyle: { color: '#f59e0b' },
      z: 6,
      silent: true,
    }] : []),
    ...(buyPnlSeries ? [{ ...buyPnlSeries, xAxisIndex: idx, yAxisIndex: idx }] : []),
    ...(stopLossSeries ? [{ ...stopLossSeries, xAxisIndex: idx, yAxisIndex: idx }] : []),
  ];

  if (subpanelCount === 0) {
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
        axisLabel: { color: colors.text, fontSize: 10, ...(isMobile ? { formatter: fmtAxisPriceMobile } : {}) },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      grid: { top: 40, bottom: 12, left: chartLeftPad, right: chartRightPad },
      dataZoom: zoomWindow
        ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct)
        : buildInsideDataZoom(),
      series: candleSeries(0),
    };
  }

  // Layout dos grids: preço no topo + 1 ou 2 subpainéis empilhados embaixo.
  // O caso de 1 subpainel preserva exatamente as % usadas antes (só RSI existia).
  const subpanelGridRects = subpanelCount === 1
    ? [{ top: 40, bottom: '24%' }, { top: '79%', bottom: 20 }]
    : [{ top: 40, bottom: '46%' }, { top: '58%', bottom: '24%' }, { top: '79%', bottom: 20 }];
  const gridLayout = subpanelGridRects.map(g => ({ ...g, left: chartLeftPad, right: chartRightPad }));

  function buildSubpanelSeries(id, gridIdx) {
    if (id === 'rsi') {
      return {
        name: 'RSI',
        type: 'line',
        xAxisIndex: gridIdx, yAxisIndex: gridIdx,
        data: alignSeries(rsi),
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
      };
    }
    // Choppiness Index (14), intervalo próprio (independente do gráfico): <38.2 = tendência
    // (verde), >61.8 = lateral/choppy (vermelho).
    return {
      name: `CHOP@${chopConfig?.interval ?? ''}`,
      type: 'line',
      xAxisIndex: gridIdx, yAxisIndex: gridIdx,
      data: alignSeries(alignPointsToCandles(candlesticks, chopConfig?.points ?? [])),
      showSymbol: false,
      lineStyle: { color: '#f59e0b', width: 1.5 },
      markLine: {
        silent: true, symbol: 'none',
        data: [
          { yAxis: 38.2, lineStyle: { color: '#26a69a', type: 'dashed', width: 1 },
            label: { formatter: '38', color: '#26a69a', fontSize: 9, position: 'end' } },
          { yAxis: 61.8, lineStyle: { color: '#ef5350', type: 'dashed', width: 1 },
            label: { formatter: '62', color: '#ef5350', fontSize: 9, position: 'end' } },
        ],
      },
    };
  }

  const subpanelYAxis = (id, gridIdx) => ({
    gridIndex: gridIdx, min: 0, max: 100, position: 'right',
    axisLine: { lineStyle: { color: colors.panel } },
    axisLabel: { color: colors.text, fontSize: 9 },
    splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.2 } },
    interval: id === 'chopZone' ? 20 : 30,
  });

  const dataZoomAxisIndex = [0, ...subpanelIds.map((_, i) => i + 1)];

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
    grid: gridLayout,
    xAxis: [
      { ...axisBase(0), axisLabel: { show: false } },
      ...subpanelIds.map((_, i) => axisBase(i + 1)),
    ],
    yAxis: [
      { gridIndex: 0, scale: true, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10, ...(isMobile ? { formatter: fmtAxisPriceMobile } : {}) },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      ...subpanelIds.map((id, i) => subpanelYAxis(id, i + 1)),
    ],
    dataZoom: zoomWindow
      ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct, dataZoomAxisIndex)
      : buildInsideDataZoom(dataZoomAxisIndex),
    series: [
      ...candleSeries(0),
      ...subpanelIds.map((id, i) => buildSubpanelSeries(id, i + 1)),
    ],
  };
}

// ── Painel de histórico de trades (aba Executados) ───────────────────────────

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
      // No MULTITRADE também substitui os markers pelos trades REAIS da exchange —
      // os que vêm do loadMultitradeSymbolChart (rsi_multi_bot_trades) podem ter
      // entry_time/entry_price velhos ou mal casados (visto na NEAR: trades de 2024
      // misturados com os recentes), enquanto os fills da própria exchange são a
      // fonte confiável de quando/a que preço a compra e a venda realmente aconteceram.
      if (chartViewSource === CHART_VIEW.TRADES || chartViewSource === CHART_VIEW.MULTITRADE) {
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
    multitradeChartFocus, tradePurchases, allTrades, chartInterval: savedInterval, setChartInterval,
    chartPanelButtons, uiPrefs, setMaBandsDefaults, setBollingerBandsDefaults, setSrIntervalDefault, setPphlIntervalDefault, setChopIntervalDefault, setVwapDefaults, setVwapSlopeHighlightDefault, setActiveIndicatorsPreference,
    multitradeFavorites, fiveMTradeFavorites, activeTrades } = useCurrency();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const chartRef = useRef(null);
  const lwChartRef = useRef(null);
  const chartWrapRef = useRef(null);
  const [currentInterval, setCurrentInterval] = useState(savedInterval || DEFAULT_INTERVAL);
  const [loadingInterval, setLoadingInterval] = useState(false);
  const [showAllIntervals, setShowAllIntervals] = useState(false);
  const [showAllCandlePresets, setShowAllCandlePresets] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const activeIndicators = uiPrefs.activeIndicators ?? [...DEFAULT_ACTIVE_INDICATORS];
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'rules'
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
  // Trajetória teórica lower→upper (simulada no intervalo da BB) — toggle local da sessão do chart.
  const [bbPathEnabled, setBbPathEnabled] = useState(false);
  // Filtro de tendência da mediana da BB (linha verde/vermelha nos 10 candles antes de cada
  // toque na banda inferior) — mesmo cálculo do bot bollinger-bands (checkMedianTrendFilter).
  const [medianTrendEnabled, setMedianTrendEnabled] = useState(false);
  // Overlay de Bollinger pedido pela aba Estatísticas (clique numa linha da lista) — sobrescreve
  // período/desvio/intervalo locais pelos usados no cálculo daquela ocorrência e liga o overlay.
  useEffect(() => {
    if (!chartZoom?.bollinger) return;
    setBollingerBands((prev) => ({ ...prev, ...chartZoom.bollinger, enabled: true }));
  }, [chartZoom]);
  const [bollingerCache, setBollingerCache] = useState({});
  const [_bollingerLoading, setBollingerLoading] = useState(false);
  const [srInterval, setSrInterval] = useState(() => uiPrefs.srIntervalDefault ?? DEFAULT_SR_INTERVAL);
  const [srCache, setSrCache] = useState({});
  const [_srLoading, setSrLoading] = useState(false);
  const [pphlInterval, setPphlInterval] = useState(() => uiPrefs.pphlIntervalDefault ?? DEFAULT_PPHL_INTERVAL);
  const [pphlCache, setPphlCache] = useState({});
  const [_pphlLoading, setPphlLoading] = useState(false);
  const [chopInterval, setChopInterval] = useState(() => uiPrefs.chopIntervalDefault ?? DEFAULT_CHOP_INTERVAL);
  const [chopCache, setChopCache] = useState({});
  const [_chopLoading, setChopLoading] = useState(false);
  const [vwap, setVwap] = useState(() => ({ ...uiPrefs.vwapDefaults }));
  // Botão "Queda VWAP" (painel do gráfico, tile da VWAP) — liga/desliga a nuvem/destaque
  // vermelho dos trechos em que a própria VWAP está caindo (vwapSlopeAt, mesmo cálculo do
  // vwapSlopeFilter do bot vwap-bands). Só o ON/OFF é local à sessão do gráfico (mesmo padrão
  // do vwap.enabled acima); lookback/inclinação mínima continuam vindo ao vivo de
  // Configurações (uiPrefs.vwapSlopeHighlightDefault) — editar lá vale pro gráfico na hora.
  const [vwapSlopeHighlightOn, setVwapSlopeHighlightOn] = useState(() => uiPrefs.vwapSlopeHighlightDefault.enabled);
  const vwapSlopeHighlight = useMemo(() => ({
    enabled: vwapSlopeHighlightOn,
    lookback: uiPrefs.vwapSlopeHighlightDefault.lookback,
    minSlopePct: uiPrefs.vwapSlopeHighlightDefault.minSlopePct,
  }), [vwapSlopeHighlightOn, uiPrefs.vwapSlopeHighlightDefault.lookback, uiPrefs.vwapSlopeHighlightDefault.minSlopePct]);
  // Overlay de VWAP+bandas pedido pela aba Estatísticas (clique numa linha do vwap-bands) —
  // mesma ideia do overlay de Bollinger acima: sobrescreve intervalo/sessão locais pelos
  // usados na simulação daquela ocorrência e liga bandas.
  useEffect(() => {
    if (!chartZoom?.vwap) return;
    setVwap((prev) => ({ ...prev, ...chartZoom.vwap, enabled: true, bands: true }));
  }, [chartZoom]);
  const [vwapCache, setVwapCache] = useState({});
  const [_vwapLoading, setVwapLoading] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [candleFetchLimit, setCandleFetchLimit] = useState(DEFAULT_CANDLE_LIMIT);
  const [displayCandleCount, setDisplayCandleCount] = useState(DEFAULT_DISPLAY_CANDLE_COUNT);
  // Último preset da toolbar (10/20/40/80/160/320) escolhido explicitamente pelo usuário — ao
  // contrário de displayCandleCount, NÃO muda quando "carregar mais" (+500/+1000) é usado, pra
  // esse carregamento extra ficar restrito à moeda atual em vez de "vazar" pra próxima moeda
  // selecionada (ver lastPresetCandleCount abaixo).
  const [lastPresetCandleCount, setLastPresetCandleCount] = useState(DEFAULT_DISPLAY_CANDLE_COUNT);
  const [hasExplicitCandleWindow, setHasExplicitCandleWindow] = useState(true);
  const [loadingMoreCandles, setLoadingMoreCandles] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState(null);
  const [measureOneShot, setMeasureOneShot] = useState(false);
  const measureClearTimeoutRef = useRef(null);

  function clearMeasureAutoHide() {
    if (measureClearTimeoutRef.current) {
      clearTimeout(measureClearTimeoutRef.current);
      measureClearTimeoutRef.current = null;
    }
  }

  // Timeout do modo "uma vez" é local a este efeito de desmontagem — evita warning de setState após unmount.
  useEffect(() => clearMeasureAutoHide, []);

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

  // Troca de moeda/intervalo invalida qualquer medição de % em aberto (coordenadas ficariam obsoletas).
  useEffect(() => {
    clearMeasureAutoHide();
    setMeasureMode(false);
    setMeasurePoints(null);
    setMeasureOneShot(false);
  }, [selectedChart?.symbol, selectedChart?.interval]);


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
    // Qualquer outra seleção (filtro, favorito comum, TX, VWAP Bands/MA-Cross sem zoom
    // específico): busca os 160 candles padrão — o suficiente pra TX/VWAP Bands terem
    // marcadores/sinais antigos disponíveis arrastando o gráfico pra trás. A janela VISÍVEL
    // volta pro último preset da toolbar (10/20/40/80/160/320) que o usuário escolheu
    // explicitamente — "carregar mais" (+500/+1000) é uma busca funda só da moeda atual e não
    // deve "vazar" pra próxima moeda selecionada.
    setCandleFetchLimit(DEFAULT_CANDLE_LIMIT);
    setDisplayCandleCount(lastPresetCandleCount);
    setHasExplicitCandleWindow(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart?.symbol, selectedChart?.interval, chartViewSource, multitradeChartFocus?.candleLimit, chartCandleWindowReset, lastPresetCandleCount]);

  // A moeda recém-selecionada só vem com a busca padrão (DEFAULT_CANDLE_LIMIT=160) — se o
  // preset ativo pede mais candles que isso (320, por ex.), completa a busca automaticamente
  // aqui, senão a moeda nova "não sabe" quantos candles mostrar e a janela visível fica presa
  // ao que veio na busca padrão.
  useEffect(() => {
    if (!hasExplicitCandleWindow || !selectedChart?.symbol) return undefined;
    const currentLen = selectedChart.candlesticks?.length ?? 0;
    if (displayCandleCount <= currentLen || displayCandleCount <= candleFetchLimit) return undefined;
    let cancelled = false;
    (async () => {
      setLoadingMoreCandles(true);
      try {
        const data = await fetchCandlesticksAndCloud(
          selectedChart.symbol, selectedChart.interval ?? currentInterval, selectedChart.source ?? null, displayCandleCount,
        );
        if (cancelled) return;
        setSelectedChart(data);
        setCandleFetchLimit(displayCandleCount);
      } finally {
        if (!cancelled) setLoadingMoreCandles(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks?.length, displayCandleCount, hasExplicitCandleWindow, candleFetchLimit, currentInterval]);

  // Refs pra checar "fetch em andamento" de dentro do setInterval sem precisar recriá-lo
  // a cada toggle de loading (o timer só precisa reiniciar quando símbolo/intervalo/limite mudam).
  const autoRefreshBusyRef = useRef({ interval: false, more: false });
  useEffect(() => { autoRefreshBusyRef.current.interval = loadingInterval; }, [loadingInterval]);
  useEffect(() => { autoRefreshBusyRef.current.more = loadingMoreCandles; }, [loadingMoreCandles]);

  // Atualização automática dos candles: 1m/3m/5m repetem no próprio período do candle (1m
  // → a cada 60s), do 15m pra cima usa um teto de 5min — mesmo "adaptive polling" já usado
  // pelo bot de trade (ver seção correspondente no CLAUDE.md), suficiente pra pegar o
  // fechamento/formação do candle sem ficar batendo a API a cada segundo. Pausa quando a aba
  // está em segundo plano (document.hidden) e quando o gráfico está travado numa janela
  // histórica (Estatísticas/Multi-Trade/5m Trade setam chartZoom com start/end fixos —
  // reconsultar a API ali só deslocaria a janela pra longe do trade sendo revisado).
  useEffect(() => {
    const symbol = selectedChart?.symbol;
    const interval = selectedChart?.interval;
    const source = selectedChart?.source ?? null;
    if (!symbol || !interval || chartZoom) return undefined;

    const ivMs = INTERVAL_MS[interval] ?? 60_000;
    const pollMs = Math.min(ivMs, 5 * 60_000);
    let cancelled = false;

    const id = setInterval(async () => {
      if (cancelled || document.hidden) return;
      if (autoRefreshBusyRef.current.interval || autoRefreshBusyRef.current.more) return;
      try {
        const data = await fetchCandlesticksAndCloud(symbol, interval, source, candleFetchLimit);
        if (cancelled) return;
        setSelectedChart(prev => (
          prev && prev.symbol === symbol && prev.interval === interval && (prev.source ?? null) === source
            ? { ...prev, ...data, tradeMarkers: prev.tradeMarkers }
            : prev
        ));
      } catch (e) {
        console.warn('[CandlestickChart] auto-refresh candles:', e.message);
      }
    }, pollMs);

    return () => { cancelled = true; clearInterval(id); };
  }, [selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, chartZoom, candleFetchLimit]);

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

  // Favorito vwap-bands: força a banda de VWAP (interval/session do próprio bot) no chart —
  // mesma ideia do overlay de MA acima, mas pro VWAP. Não persiste (o efeito de persistência do
  // VWAP, mais abaixo, já ignora enquanto isTradePanelChartView(chartViewSource) é true); ao sair
  // do favorito vwap-bands (seleciona moeda comum), volta pro default salvo do usuário. Não reseta
  // quando chartZoom.vwap está setado (clique na aba Estatísticas/VWAP Bands, ver useEffect acima)
  // — senão este efeito roda no mesmo commit (chartViewSource muda junto) e sobrescreve aquele.
  const hasForcedVwap = isTradePanelChartView(chartViewSource) && !!multitradeChartFocus?.vwapOverride;
  useEffect(() => {
    if (hasForcedVwap) {
      setVwap(multitradeChartFocus.vwapOverride);
    } else if (chartZoom?.vwap) {
      // aba Estatísticas cuida do próprio overlay (useEffect acima) — não mexe aqui.
    } else if (isTradePanelChartView(chartViewSource)) {
      // Ainda dentro do painel de trade, mas favorito atual não é vwap-bands (ex.: trocou
      // pra MA-Cross ou Bollinger Bands) — desliga a VWAP pra não vazar banda de outro trade.
      setVwap((v) => (v.enabled ? { ...v, enabled: false } : v));
    } else {
      setVwap({ ...uiPrefs.vwapDefaults });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasForcedVwap, multitradeChartFocus?.vwapOverride, chartViewSource, chartZoom?.vwap]);

  // Favorito bollinger-bands: força a banda de Bollinger (período/desvio/intervalo do
  // próprio bot) no chart — mesma ideia do overlay de VWAP acima, mas pra Bollinger. Assim,
  // ao selecionar uma moeda BB rodando em 5m e outra em 1m, o gráfico E a banda acompanham
  // o intervalo configurado de cada uma, não o intervalo manual do painel (tile "BB").
  const hasForcedBollinger = isTradePanelChartView(chartViewSource) && !!multitradeChartFocus?.bollingerOverride;
  useEffect(() => {
    if (hasForcedBollinger) {
      setBollingerBands(multitradeChartFocus.bollingerOverride);
    } else if (chartZoom?.bollinger) {
      // aba Estatísticas cuida do próprio overlay (useEffect acima) — não mexe aqui.
    } else if (isTradePanelChartView(chartViewSource)) {
      // Ainda dentro do painel de trade, mas favorito atual não é bollinger-bands (ex.: trocou
      // pra MA-Cross ou VWAP Bands) — desliga a Bollinger pra não vazar banda de outro trade.
      setBollingerBands((b) => (b.enabled ? { ...b, enabled: false } : b));
    } else {
      setBollingerBands({ ...uiPrefs.bollingerBandsDefaults });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasForcedBollinger, multitradeChartFocus?.bollingerOverride, chartViewSource, chartZoom?.bollinger]);

  // Na primeira renderização, desliga qualquer indicador que tenha ficado ativo de uma sessão
  // anterior (persistido em localStorage) — o gráfico sempre abre limpo. Precisa rodar DEPOIS
  // dos efeitos "favorito vwap-bands"/"favorito bollinger-bands" acima: eles também copiam
  // uiPrefs.vwapDefaults/bollingerBandsDefaults pro estado local no mount (ramo `else`), e como
  // todo useEffect do primeiro commit ainda lê o uiPrefs "velho" (a limpeza abaixo só é
  // aplicada no PRÓXIMO render), rodar antes deste ponto perdia a corrida — o valor antigo
  // (enabled: true) sobrescrevia de volta por cima da limpeza. Ficando depois, esta é a
  // última escrita do commit e vence.
  useEffect(() => {
    if (activeIndicators.length) setActiveIndicatorsPreference([]);
    if (bollingerBands.enabled) {
      setBollingerBands((prev) => ({ ...prev, enabled: false }));
      setBollingerBandsDefaults({ enabled: false });
    }
    if (vwap.enabled) {
      setVwap((prev) => ({ ...prev, enabled: false }));
      setVwapDefaults({ enabled: false });
    }
    if (vwapSlopeHighlightOn) {
      setVwapSlopeHighlightOn(false);
      setVwapSlopeHighlightDefault({ enabled: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Favorito bollinger-bands com o filtro de tendência EMA ligado: sincroniza um grupo Quick
  // EMA (painel manual do gráfico, TRADE_EMA_GROUP_ID) com o período/intervalo/variação
  // daquele filtro — sem isso, o painel ficava com o que o usuário tinha configurado à mão
  // antes, sem relação com a moeda selecionada (ex.: REUSDT com filtro EMA50@30m mostrando um
  // grupo velho EMA50@3m). Some (sem apagar os grupos manuais do usuário) ao trocar pra um
  // favorito sem esse filtro, ou sair do painel de trade.
  const hasForcedQuickEma = isTradePanelChartView(chartViewSource) && !!multitradeChartFocus?.quickEmaOverride;
  useEffect(() => {
    setQuickEmaGroups((prev) => {
      const withoutAuto = prev.filter((g) => g.id !== TRADE_EMA_GROUP_ID);
      if (!hasForcedQuickEma) {
        return withoutAuto.length === prev.length ? prev : withoutAuto;
      }
      const ov = multitradeChartFocus.quickEmaOverride;
      const group = {
        id: TRADE_EMA_GROUP_ID,
        interval: ov.interval,
        periods: [ov.period],
        bandPeriod: ov.period,
        abovePct: null,
        belowPct: ov.belowPct ?? null,
      };
      return [group, ...withoutAuto].slice(0, MAX_QUICK_EMA_GROUPS);
    });
  }, [hasForcedQuickEma, multitradeChartFocus?.quickEmaOverride]);

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

  // Persiste o intervalo do S/R (independente do intervalo do gráfico, como MA1/MA2/BB)
  useEffect(() => {
    if (isTradePanelChartView(chartViewSource)) return;
    setSrIntervalDefault(srInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srInterval]);

  // Persiste o intervalo do Pivot Points High/Low (mesmo padrão do S/R)
  useEffect(() => {
    if (isTradePanelChartView(chartViewSource)) return;
    setPphlIntervalDefault(pphlInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pphlInterval]);

  // Persiste o intervalo do CHOP (mesmo padrão do S/R/PPHL)
  useEffect(() => {
    if (isTradePanelChartView(chartViewSource)) return;
    setChopIntervalDefault(chopInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chopInterval]);

  // Persiste preferências do VWAP (ligado, intervalo, sessão, bandas) — mesmo padrão da Bollinger.
  // A âncora (ancorada/contínua) não é mais escolhida aqui — vem de Configurações (uiPrefs.vwapAnchorDefault).
  useEffect(() => {
    if (isTradePanelChartView(chartViewSource)) return;
    setVwapDefaults({ enabled: vwap.enabled, interval: vwap.interval, session: vwap.session, bands: vwap.bands });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vwap.enabled, vwap.interval, vwap.session, vwap.bands]);

  // Persiste só o ON/OFF do botão "Queda VWAP" — lookback/inclinação mínima continuam
  // exclusivos de Configurações (não têm controle no painel do gráfico).
  useEffect(() => {
    if (isTradePanelChartView(chartViewSource)) return;
    setVwapSlopeHighlightDefault({ enabled: vwapSlopeHighlightOn });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vwapSlopeHighlightOn]);

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
  // Também busca com PATH ou o filtro de tendência da mediana ligados (mesmo sem as linhas BB),
  // pra simular toques lower→upper / calcular a tendência da linha mediana.
  useEffect(() => {
    const bbNeeded = chartPanelButtons.bb !== false
      && (bollingerBands.enabled || bbPathEnabled || medianTrendEnabled);
    if (!selectedChart?.symbol || !bbNeeded) {
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
        if (points.length) {
          const lastAvg = points.slice(-80);
          const expectedGapMs = INTERVAL_MS[bollingerBands.interval] ?? null;
          const actualGapMs = lastAvg.length > 1 ? lastAvg[1].openTime - lastAvg[0].openTime : null;
          const gapMismatch = expectedGapMs != null && actualGapMs != null && actualGapMs !== expectedGapMs;
          console.log(
            `[BollingerBands] ${selectedChart.symbol} — intervalo pedido: ${bollingerBands.interval}`
            + ` (BB${bollingerBands.period}/${bollingerBands.stdDev})`
            + (hasForcedBollinger ? ` — FORÇADO pelo favorito (bollingerOverride: ${JSON.stringify(multitradeChartFocus.bollingerOverride)})` : ''),
          );
          if (gapMismatch) {
            console.warn(
              `[BollingerBands] intervalo entre candles não bate com "${bollingerBands.interval}"`
              + ` — esperado ${expectedGapMs}ms, veio ${actualGapMs}ms. Os pontos abaixo NÃO são desse intervalo.`,
            );
          }
          console.log(
            'últimos 80 valores (largura% = (upper-lower)/lower×100, igual à coluna Larg%):',
            lastAvg.map(p => ({
              time: new Date(p.openTime).toLocaleString('pt-BR'),
              upper: p.upper,
              middle: p.middle,
              lower: p.lower,
              widthPct: p.lower > 0 ? Number((((p.upper - p.lower) / p.lower) * 100).toFixed(4)) : null,
            })),
          );
        }
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
    bbPathEnabled, medianTrendEnabled,
  ]);

  // Busca as zonas de Suporte/Resistência — intervalo próprio (independente do gráfico), como a Bollinger.
  const srShown = activeIndicators.includes('sr') && chartPanelButtons.sr !== false;
  useEffect(() => {
    if (!selectedChart?.symbol || !srShown) {
      setSrLoading(false);
      return undefined;
    }
    const key = srInterval;
    let cancelled = false;
    setSrLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          srInterval,
          5,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const levels = await fetchSupportResistancePoints(
          selectedChart.symbol, srInterval, selectedChart.source, ovLimit,
        );
        if (!cancelled) setSrCache({ [key]: levels });
      } catch (e) {
        console.warn('[sr]', key, e.message);
        if (!cancelled) setSrCache({});
      } finally {
        if (!cancelled) setSrLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, srShown, srInterval,
  ]);

  // Busca os pivôs do Pivot Points High/Low — intervalo próprio, mesmo padrão do S/R (pra comparação lado a lado).
  const pphlShown = activeIndicators.includes('pphl') && chartPanelButtons.pphl !== false;
  useEffect(() => {
    if (!selectedChart?.symbol || !pphlShown) {
      setPphlLoading(false);
      return undefined;
    }
    const key = pphlInterval;
    let cancelled = false;
    setPphlLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          pphlInterval,
          10,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const points = await fetchPivotPointsHighLowPoints(
          selectedChart.symbol, pphlInterval, selectedChart.source, ovLimit,
        );
        if (!cancelled) setPphlCache({ [key]: points });
      } catch (e) {
        console.warn('[pphl]', key, e.message);
        if (!cancelled) setPphlCache({});
      } finally {
        if (!cancelled) setPphlLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, pphlShown, pphlInterval,
  ]);

  // Busca o Choppiness Index — intervalo próprio (independente do gráfico), mesmo padrão do S/R/PPHL.
  const chopShown = activeIndicators.includes('chopZone') && chartPanelButtons.chopZone !== false;
  useEffect(() => {
    if (!selectedChart?.symbol || !chopShown) {
      setChopLoading(false);
      return undefined;
    }
    const key = chopInterval;
    let cancelled = false;
    setChopLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          chopInterval,
          14,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const points = await fetchChopOverlayPoints(
          selectedChart.symbol, chopInterval, selectedChart.source, ovLimit,
        );
        if (!cancelled) setChopCache({ [key]: points });
      } catch (e) {
        console.warn('[chop]', key, e.message);
        if (!cancelled) setChopCache({});
      } finally {
        if (!cancelled) setChopLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, chopShown, chopInterval,
  ]);

  // Busca a série do VWAP — intervalo próprio (independente do gráfico), mesmo padrão da Bollinger.
  useEffect(() => {
    const vwapEnabled = vwap.enabled && chartPanelButtons.vwap !== false;
    if (!selectedChart?.symbol || !vwapEnabled) {
      setVwapLoading(false);
      return undefined;
    }
    const anchor = uiPrefs.vwapAnchorDefault;
    const key = `${vwap.interval}-${vwap.session}-${anchor}`;
    let cancelled = false;
    setVwapLoading(true);
    (async () => {
      try {
        // Usa o MAIOR entre o limite que cobre o span visível do gráfico e o limite real de
        // uma sessão diária/semanal (vwapFetchLimit) — sem isso, uma VWAP semanal em 1m
        // ficava presa ao limite de candles do candlestick (ex.: 160), virando na prática a
        // VWAP de só algumas horas em vez da semana inteira (ver comentário de vwapFetchLimit).
        const ovLimit = Math.max(
          computeOverlayMaFetchLimit(
            selectedChart.interval ?? currentInterval,
            vwap.interval,
            1,
            Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
            overlayFetchLimit,
          ),
          vwapFetchLimit(vwap.interval, vwap.session),
        );
        const points = await fetchVwapPoints(
          selectedChart.symbol, vwap.interval, vwap.session, anchor, selectedChart.source, ovLimit,
        );
        if (!cancelled) setVwapCache({ [key]: points });
      } catch (e) {
        console.warn('[vwap]', key, e.message);
        if (!cancelled) setVwapCache({});
      } finally {
        if (!cancelled) setVwapLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, chartPanelButtons.vwap,
    vwap.enabled, vwap.interval, vwap.session, uiPrefs.vwapAnchorDefault,
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
      } else if (chartViewSource === CHART_VIEW.TRADES || isTradePanelChartView(chartViewSource)) {
        // TX e VWAP Bands/MA-Cross: busca mais candles (LIMIT) pra manter marcadores/sinais
        // antigos disponíveis arrastando o gráfico pra trás, mas a janela visível respeita a
        // quantidade de velas (displayCandleCount) que o usuário já tinha escolhido.
        setCandleFetchLimit(DEFAULT_CANDLE_LIMIT);
        setHasExplicitCandleWindow(true);
      } else {
        // Filtros e favoritos comuns: mantém a quantidade de velas visíveis (displayCandleCount)
        // que o usuário já tinha escolhido — trocar de intervalo não deve voltar pro padrão de 80.
        setCandleFetchLimit(DEFAULT_CANDLE_LIMIT);
        setHasExplicitCandleWindow(true);
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
      // selectedChart.interval (não currentInterval) — o pan que dispara isso (ver
      // onNeedOlderCandles em CandlestickChartLW) pode rodar antes do efeito que sincroniza
      // currentInterval com um selectedChart recém-trocado (ex.: clique numa ocorrência de
      // Estatísticas com intervalo diferente do que estava selecionado antes), fazendo esse
      // fetch usar o intervalo ANTIGO e sobrescrever os candles corretos que acabaram de chegar.
      const data = await fetchCandlesticksAndCloud(
        selectedChart.symbol,
        selectedChart.interval ?? currentInterval,
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
    setLastPresetCandleCount(n);
    setHasExplicitCandleWindow(true);
    const currentLen = selectedChart.candlesticks.length;
    if (n > currentLen && n > candleFetchLimit) {
      setLoadingMoreCandles(true);
      try {
        const data = await fetchCandlesticksAndCloud(
          selectedChart.symbol, selectedChart.interval ?? currentInterval, selectedChart.source ?? null, n,
        );
        setSelectedChart(data);
        setCandleFetchLimit(n);
      } finally {
        setLoadingMoreCandles(false);
      }
    }
  }

  function toggleMeasureMode() {
    clearMeasureAutoHide();
    setMeasureMode((v) => !v);
    setMeasurePoints(null);
    setMeasureOneShot(false);
  }

  // Igual ao toggle normal, mas a medição se desliga sozinha assim que o arraste termina,
  // e o resultado some sozinho ~2s depois (ver onEnd em handleMeasureStart).
  function toggleMeasureModeOnce() {
    clearMeasureAutoHide();
    setMeasureMode((v) => {
      const next = !v;
      setMeasureOneShot(next);
      return next;
    });
    setMeasurePoints(null);
  }

  // Preço sob o cursor, a partir do pixel Y — TradingView (coordinateToPrice) ou ECharts
  // (convertFromPixel), o que estiver ativo no momento.
  function priceAtPixelY(y) {
    if (showLwChart && lwChartRef.current) return lwChartRef.current.coordinateToPrice(y);
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return null;
    return inst.convertFromPixel({ yAxisIndex: 0 }, y);
  }

  // Candle sob o cursor (índice + openTime), a partir do pixel X — usado pra medir tempo/candles
  // decorridos. No TradingView o índice é sobre o array de candles inteiro (não uma janela
  // fatiada como no ECharts), mas a diferença idx2-idx1 continua correta pra contar candles.
  function candleAtPixelX(x) {
    const candles = selectedChart?.candlesticks;
    if (!candles?.length) return null;
    if (showLwChart && lwChartRef.current) {
      const timeSec = lwChartRef.current.coordinateToTime(x);
      if (timeSec == null) return null;
      const targetMs = timeSec * 1000;
      let bestIdx = 0, bestDiff = Infinity;
      candles.forEach((c, i) => {
        const d = Math.abs(Number(c.openTime) - targetMs);
        if (d < bestDiff) { bestDiff = d; bestIdx = i; }
      });
      return { idx: bestIdx, openTime: Number(candles[bestIdx].openTime) };
    }
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return null;
    const DL = Math.min(displayLimit, candles.length);
    const visible = candles.slice(-DL);
    const LEFT_PAD = 1;
    const rawIdx = inst.convertFromPixel({ xAxisIndex: 0 }, x);
    if (!Number.isFinite(rawIdx)) return null;
    const candleIdx = Math.min(Math.max(Math.round(rawIdx) - LEFT_PAD, 0), visible.length - 1);
    const candle = visible[candleIdx];
    if (!candle) return null;
    return { idx: candleIdx, openTime: Number(candle.openTime) };
  }

  function handleMeasureStart(e) {
    if (!measureMode) return;
    const wrap = chartWrapRef.current;
    const usingLw = showLwChart && !!lwChartRef.current;
    const inst = usingLw ? null : chartRef.current?.getEchartsInstance();
    if (!wrap || (!usingLw && !inst)) return;
    e.preventDefault();
    clearMeasureAutoHide();
    const rect = wrap.getBoundingClientRect();
    const point = e.touches?.length ? e.touches[0] : e;
    const startX = point.clientX - rect.left;
    const startY = point.clientY - rect.top;
    const startPrice = priceAtPixelY(startY);
    const startCandle = candleAtPixelX(startX);
    setMeasurePoints({
      x1: startX, y1: startY, x2: startX, y2: startY, price1: startPrice, price2: startPrice,
      candleIdx1: startCandle?.idx ?? null, candleIdx2: startCandle?.idx ?? null,
      openTime1: startCandle?.openTime ?? null, openTime2: startCandle?.openTime ?? null,
    });

    const onMove = (ev) => {
      const p = ev.touches?.length ? ev.touches[0] : ev;
      const x = p.clientX - rect.left;
      const y = p.clientY - rect.top;
      const price = priceAtPixelY(y);
      const candle = candleAtPixelX(x);
      setMeasurePoints((prev) => (prev ? {
        ...prev, x2: x, y2: y, price2: price,
        candleIdx2: candle?.idx ?? prev.candleIdx2, openTime2: candle?.openTime ?? prev.openTime2,
      } : prev));
    };
    const onEnd = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      if (measureOneShot) {
        setMeasureMode(false);
        setMeasureOneShot(false);
        clearMeasureAutoHide();
        measureClearTimeoutRef.current = setTimeout(() => {
          measureClearTimeoutRef.current = null;
          setMeasurePoints(null);
        }, 1000);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
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

  // Ao carregar um novo símbolo/intervalo (sem zoom explícito de Multi-Trade/Estatísticas), força
  // o dataZoom pra 0-100%. Sem isso o ECharts mantém o range percentual da seleção anterior — como
  // o array de categorias agora pode ter tamanhos diferentes entre views (80 no padrão, 160 em
  // TX/VWAP Bands/MA-Cross), o range antigo passa a cobrir só uma fração do novo eixo, deixando
  // as velas encostadas à esquerda em vez de preencher o gráfico.
  useEffect(() => {
    if (chartZoom || !chartRef.current || !selectedChart?.candlesticks?.length) return;
    const instance = chartRef.current.getEchartsInstance();
    instance.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
  }, [selectedChart?.symbol, selectedChart?.interval, selectedChart?.candlesticks?.length, chartViewSource, chartZoom]);

  // Linhas azuis legadas (últimas 2 compras). Na view TX usamos só chartTradeMarkers (buy/sell + PnL).
  const tradeTimes = chartViewSource === CHART_VIEW.TRADES
    ? []
    : [...tradePurchases]
      .sort((a, b) => Number(a.time) - Number(b.time))
      .slice(-2)
      .map(t => Number(t.time));

  // Só expande a janela pra caber a compra/marcador antigo na aba Trades — em qualquer outra
  // seleção (favorito, VWAP Bands etc.) o padrão continua sendo os LIMIT candles de sempre, mesmo
  // que a última compra real seja de muitos candles atrás.
  const markerTimesForWindow = chartViewSource === CHART_VIEW.TRADES
    ? (chartTradeMarkers?.length ? chartTradeMarkers.map(m => Number(m.time)).filter(Number.isFinite) : tradeTimes)
    : [];

  const displayLimit = (() => {
    const candles = selectedChart?.candlesticks;
    if (chartZoom && (isTradePanelChartView(chartViewSource) || chartViewSource === CHART_VIEW.STATISTICS)) {
      return candles?.length ?? displayCandleCount;
    }
    // Botões 20/50/100 / load more — prioridade sobre expansão automática por marcadores
    if (hasExplicitCandleWindow) {
      return Math.min(displayCandleCount, candles?.length ?? displayCandleCount);
    }
    if ((chartTradeMarkers?.length || selectedChart?.tradeMarkers?.length) && candles?.length && candles.length <= LIMIT) {
      return candles.length;
    }
    if (chartZoom) return candles?.length ?? displayCandleCount;
    if (!candles?.length || !markerTimesForWindow.length) return LIMIT;
    const oldest = Math.min(...markerTimesForWindow);
    const idx = candles.findIndex(c => Number(c.openTime) >= oldest);
    if (idx === -1 || idx >= candles.length - LIMIT) return LIMIT;
    return Math.min(candles.length, candles.length - idx + 5);
  })();

  const chartLeftPad = CHART_LEFT_MARGIN;
  const chartRightPad = CHART_PRICE_PAD + CHART_LEFT_MARGIN;

  // Zoom horizontal por scroll manual (nativo do ECharts desligado em buildInsideDataZoom/
  // buildFixedDataZoom — ver chartView.js) — passo pequeno e fixo, ancorado no cursor, pra
  // crescer aos poucos em vez de pular direto de 1x pra 5x.
  useEffect(() => {
    const wrap = chartWrapRef.current;
    if (!wrap) return undefined;

    function handleWheel(e) {
      if (e.shiftKey) return; // shift+scroll continua sendo o zoom vertical de preço (nativo)
      const inst = chartRef.current?.getEchartsInstance?.();
      if (!inst) return;
      const dz = inst.getOption?.()?.dataZoom?.[0];
      if (!dz || !Number.isFinite(dz.start) || !Number.isFinite(dz.end)) return;

      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const usableWidth = Math.max(1, rect.width - chartLeftPad - chartRightPad);
      const relX = Math.min(1, Math.max(0, (e.clientX - rect.left - chartLeftPad) / usableWidth));
      const anchorPct = dz.start + relX * (dz.end - dz.start);
      const { start, end } = computeManualWheelZoom(dz.start, dz.end, anchorPct, e.deltaY < 0);
      inst.dispatchAction({ type: 'dataZoom', start, end });
    }

    // capture: true é essencial aqui — o zrender (canvas do ECharts) escuta 'wheel' no próprio
    // container interno e chama stopPropagation ao tratar o roam nativo, o que impedia esse
    // listener (no wrapper, um ancestral do canvas) de nunca receber o evento em fase de bubble.
    // Em fase de captura ele roda antes disso, no caminho de descida do evento até o canvas.
    wrap.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => wrap.removeEventListener('wheel', handleWheel, { capture: true });
  }, [chartLeftPad, chartRightPad, selectedChart?.symbol, activeTab]);

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

  // Alvo/stop reais da escada VWAP Bands (posição BOUGHT em modo ladder) — o alvo é
  // sempre a próxima banda acima (targetLevel) e o stop a banda tocada que armou o
  // degrau (touchLevel), ambos ao vivo (recalculados a cada tick pelo bot, não fixos
  // no momento da compra). activeSetup vem do rules_state salvo pelo bot (ver
  // enrichMultitradeEntriesWithState em backend/services/supabaseService.js).
  const [vwapLadderLevels, setVwapLadderLevels] = useState(null);

  useEffect(() => {
    const sym = selectedChart?.symbol;
    if (!sym) { setVwapLadderLevels(null); return undefined; }
    const entry = multitradeFavorites?.find(
      e => e.symbol?.toUpperCase() === sym.toUpperCase() && e.phase === 'BOUGHT' && isVwapBandsEntry(e),
    );
    const setup = entry?.activeSetup;
    if (!entry || !setup?.targetLevel || !setup?.touchLevel) {
      setVwapLadderLevels(null);
      return undefined;
    }
    let cancelled = false;
    const vwapInterval = entry.tradeConfig?.entry?.vwapInterval ?? '4h';
    const session = entry.tradeConfig?.entry?.session ?? 'weekly';
    const source = selectedChart.source === 'gate' ? 'gate' : 'binance';
    const sessionCoverageMs = session === 'weekly' ? 14 * 86_400_000 : 2 * 86_400_000;
    const ivMs = INTERVAL_MS[vwapInterval] ?? 4 * 3_600_000;
    const limit = Math.min(1000, Math.max(60, Math.ceil(sessionCoverageMs / ivMs)));
    const levelField = { lower2: 'lower2', lower1: 'lower1', vwap: 'value', upper1: 'upper1', upper2: 'upper2' };
    // 'rolling' fixo — precisa espelhar exatamente o cálculo ao vivo do bot (strategyEngine.js),
    // que sempre usa VWAP contínua/rolante, independente do que o usuário escolher em Configurações.
    const stopLossCfg = entry.tradeConfig?.stopLoss ?? entry.stopLoss ?? {};
    const maxLossPct = Math.max(0, Number(stopLossCfg.maxLossPct ?? 5));
    const buyPrice = Number(entry.buyPrice);
    fetchVwapPoints(sym, vwapInterval, session, 'rolling', source, limit)
      .then(points => {
        if (cancelled || !points?.length) return;
        const last = points[points.length - 1];
        const targetPrice = Number(last?.[levelField[setup.targetLevel]]);
        let stopPrice = Number(last?.[levelField[setup.touchLevel]]);
        // Mesmo teto do bot (ver computeLadderLevelPrices em strategyEngine.js): o stop
        // estrutural (banda tocada) nunca fica mais de maxLossPct% abaixo da compra — sem
        // isso o gráfico desenhava a linha de stop mais funda do que a ordem resting
        // realmente coloca na corretora (bandas largas ficam bem além do teto).
        if (stopLossCfg.enabled !== false && (stopLossCfg.mode ?? 'ladder') === 'ladder'
          && Number.isFinite(stopPrice) && Number.isFinite(buyPrice) && buyPrice > 0) {
          const stopFloor = buyPrice * (1 - maxLossPct / 100);
          if (stopPrice < stopFloor) stopPrice = stopFloor;
        }
        setVwapLadderLevels({
          symbol: sym,
          targetPrice: Number.isFinite(targetPrice) ? targetPrice : null,
          stopPrice: Number.isFinite(stopPrice) ? stopPrice : null,
          targetLevel: setup.targetLevel,
          touchLevel: setup.touchLevel,
        });
      })
      .catch(() => { if (!cancelled) setVwapLadderLevels(null); });
    return () => { cancelled = true; };
  }, [selectedChart?.symbol, selectedChart?.source, multitradeFavorites]);

  // Alvo real da Bollinger Bands (posição BOUGHT) — banda superior ao vivo (recalculada a
  // cada tick pelo bot, não fixa no momento da compra); mesma ideia do vwapLadderLevels
  // acima, mas sem escada (só uma banda). Sem stop especial aqui — o stop de BB já é um piso
  // percentual simples, coberto por resolveChartStopLoss/buildTrailingStopSeries (chartStopLossConfig
  // abaixo não precisa de override pro bollinger-bands).
  const [bollingerTargetLevels, setBollingerTargetLevels] = useState(null);

  useEffect(() => {
    const sym = selectedChart?.symbol;
    if (!sym) { setBollingerTargetLevels(null); return undefined; }
    const entry = multitradeFavorites?.find(
      e => e.symbol?.toUpperCase() === sym.toUpperCase() && e.phase === 'BOUGHT' && isBollingerBandsEntry(e),
    );
    if (!entry) { setBollingerTargetLevels(null); return undefined; }
    let cancelled = false;
    const e = entry.tradeConfig?.entry ?? entry.entry ?? {};
    const interval = e.interval ?? '4h';
    const period = e.period ?? 20;
    const stdDev = e.stdDev ?? 2;
    const source = selectedChart.source === 'gate' ? 'gate' : 'binance';
    const limit = Math.min(1000, period * 3 + 30);
    fetchBollingerOverlayPoints(sym, interval, period, stdDev, source, limit)
      .then(points => {
        if (cancelled || !points?.length) return;
        const targetPrice = Number(points[points.length - 1]?.upper);
        setBollingerTargetLevels({
          symbol: sym,
          targetPrice: Number.isFinite(targetPrice) ? targetPrice : null,
        });
      })
      .catch(() => { if (!cancelled) setBollingerTargetLevels(null); });
    return () => { cancelled = true; };
  }, [selectedChart?.symbol, selectedChart?.source, multitradeFavorites]);

  const chartStopLossConfig = useMemo(() => {
    if (!selectedChart?.symbol) return null;
    if (vwapLadderLevels?.symbol === selectedChart.symbol && vwapLadderLevels.stopPrice != null) {
      return { enabled: true, mode: 'price', price: vwapLadderLevels.stopPrice, levelLabel: vwapLadderLevels.touchLevel };
    }
    return resolveChartStopLoss(selectedChart.symbol, multitradeFavorites);
  }, [selectedChart?.symbol, multitradeFavorites, vwapLadderLevels]);

  const chartTargetConfig = useMemo(() => {
    if (!selectedChart?.symbol) return null;
    if (vwapLadderLevels?.symbol === selectedChart.symbol && vwapLadderLevels.targetPrice != null) {
      return { enabled: true, mode: 'price', price: vwapLadderLevels.targetPrice, levelLabel: vwapLadderLevels.targetLevel };
    }
    if (bollingerTargetLevels?.symbol === selectedChart.symbol && bollingerTargetLevels.targetPrice != null) {
      return { enabled: true, mode: 'price', price: bollingerTargetLevels.targetPrice, levelLabel: 'upper' };
    }
    return resolveChartTarget(selectedChart.symbol, multitradeFavorites);
  }, [selectedChart?.symbol, multitradeFavorites, vwapLadderLevels, bollingerTargetLevels]);

  // Aba "Bot": mostra a estratégia REAL do favorito da moeda selecionada (ma-cross ou
  // vwap-bands) — antes disso era sempre tratado como ma-cross, mostrando linhas de
  // EMA e rodando o backtest errado até pra favoritos vwap-bands. Sem favorito nenhum,
  // cai no molde ad-hoc de ma-cross (comportamento antigo, só pra estudo livre).
  const botFavoriteEntry = useMemo(() => {
    const sym = selectedChart?.symbol;
    if (!sym) return null;
    const entries = getEntriesForSymbol(multitradeFavorites, sym).filter(e => e.enabled !== false);
    return entries.find(e => isMaCrossEntry(e)) ?? entries.find(e => isVwapBandsEntry(e)) ?? null;
  }, [selectedChart?.symbol, multitradeFavorites]);

  const botStrategyId = botFavoriteEntry ? (isVwapBandsEntry(botFavoriteEntry) ? 'vwap-bands' : 'ma-cross') : 'ma-cross';

  const botAdHocTradeConfig = useMemo(() => {
    const sym = selectedChart?.symbol;
    if (!sym || botFavoriteEntry) return null;
    const exchange = selectedChart.source === 'gate' ? 'gate' : 'binance';
    return buildAdHocMaCrossEntry(sym, exchange).tradeConfig;
  }, [selectedChart?.symbol, selectedChart?.source, botFavoriteEntry]);

  const botTradeConfig = botFavoriteEntry?.tradeConfig ?? botAdHocTradeConfig;

  const chartBollingerConfig = useMemo(() => {
    const linesOn = bollingerBands.enabled && chartPanelButtons.bb !== false;
    const pathOn = bbPathEnabled && chartPanelButtons.bb !== false;
    const medianTrendOn = medianTrendEnabled && chartPanelButtons.bb !== false;
    if (!linesOn && !pathOn && !medianTrendOn) return null;
    const key = `${bollingerBands.period}-${bollingerBands.stdDev}-${bollingerBands.interval}`;
    return {
      enabled: linesOn,
      showPath: pathOn,
      showMedianTrend: medianTrendOn,
      medianTrendLookback: 10,
      period: bollingerBands.period,
      stdDev: bollingerBands.stdDev,
      interval: bollingerBands.interval,
      points: bollingerCache[key] ?? [],
    };
  }, [bollingerBands, bollingerCache, chartPanelButtons.bb, bbPathEnabled, medianTrendEnabled]);

  const chartSrConfig = useMemo(() => {
    if (!srShown) return null;
    return { interval: srInterval, levels: srCache[srInterval] ?? [] };
  }, [srShown, srInterval, srCache]);

  const chartPphlConfig = useMemo(() => {
    if (!pphlShown) return null;
    return { interval: pphlInterval, points: pphlCache[pphlInterval] ?? [] };
  }, [pphlShown, pphlInterval, pphlCache]);

  const chartChopConfig = useMemo(() => {
    if (!chopShown) return null;
    return { interval: chopInterval, points: chopCache[chopInterval] ?? [] };
  }, [chopShown, chopInterval, chopCache]);

  const chartVwapConfig = useMemo(() => {
    const enabled = vwap.enabled && chartPanelButtons.vwap !== false;
    if (!enabled) return null;
    const anchor = uiPrefs.vwapAnchorDefault;
    const key = `${vwap.interval}-${vwap.session}-${anchor}`;
    return {
      enabled: true,
      interval: vwap.interval,
      session: vwap.session,
      anchor,
      bands: vwap.bands,
      points: vwapCache[key] ?? [],
    };
  }, [vwap, vwapCache, chartPanelButtons.vwap, uiPrefs.vwapAnchorDefault]);

  const option = useMemo(() => {
    if (!selectedChart) return null;
    return buildOption(
      selectedChart, colors, effectiveIndicators, displayLimit, chartZoom, tradeTimes, overlayConfigs,
      chartTradeMarkers?.length ? chartTradeMarkers : (selectedChart.tradeMarkers ?? []),
      chartLeftPad, chartBuyInfo, chartStopLossConfig, chartTargetConfig, chartRightPad, chartBollingerConfig, chartSrConfig, chartPphlConfig, chartVwapConfig, chartChopConfig, vwapSlopeHighlight, isMobile,
      bbPathEnabled,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart, colors, effectiveIndicators, chartZoom, tradePurchases, chartTradeMarkers, activeTab, overlayConfigs, displayLimit, chartLeftPad, chartRightPad, chartBuyInfo, chartStopLossConfig, chartTargetConfig, chartBollingerConfig, chartSrConfig, chartPphlConfig, chartVwapConfig, chartChopConfig, vwapSlopeHighlight, isMobile, bbPathEnabled]);

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

  // Só falta a nuvem Ichimoku hoje (precisa preencher a área entre spanA/spanB — sem primitive
  // pronta no Lightweight Charts). Todo o resto (S/R, PPHL, RSI/CHOP, Bollinger, Stop/Alvo,
  // marcadores de trade, zoom de período, régua de medição) já funciona nativamente em
  // CandlestickChartLW.jsx — a régua usa lwChartRef (coordinateToPrice/coordinateToTime) em vez
  // de getEchartsInstance(), então medir não força mais a troca pro ECharts.
  const lwUnsupportedReason = [];
  if (effectiveIndicators.includes('ichimoku')) lwUnsupportedReason.push('Ichimoku');
  const lwSupported = lwUnsupportedReason.length === 0;
  // Motor escolhido em Configurações → Gráfico padrão; cai pro ECharts sozinho quando um
  // recurso não suportado pelo TradingView está ativo (ver lwUnsupportedReason acima).
  const showLwChart = uiPrefs.chartEngineDefault !== 'echarts' && lwSupported;

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

  const measurePct = measurePoints && Number.isFinite(measurePoints.price1) && measurePoints.price1
    ? ((measurePoints.price2 - measurePoints.price1) / measurePoints.price1) * 100
    : null;
  const measureColor = measurePct == null ? '#94a3b8' : measurePct >= 0 ? '#26a69a' : '#ef5350';
  const measureCandleCount = measurePoints && Number.isFinite(measurePoints.candleIdx1) && Number.isFinite(measurePoints.candleIdx2)
    ? Math.abs(measurePoints.candleIdx2 - measurePoints.candleIdx1)
    : null;
  const measureElapsed = measurePoints && Number.isFinite(measurePoints.openTime1) && Number.isFinite(measurePoints.openTime2)
    ? fmtElapsedTime(Math.abs(measurePoints.openTime2 - measurePoints.openTime1))
    : null;
  const measureOverlay = (measureMode || measurePoints) && (
    <div
      className={`absolute inset-0 z-20 select-none ${measureMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
      onMouseDown={measureMode ? handleMeasureStart : undefined}
      onTouchStart={measureMode ? handleMeasureStart : undefined}
    >
      {measurePoints && (
        <>
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <line
              x1={measurePoints.x1} y1={measurePoints.y1} x2={measurePoints.x2} y2={measurePoints.y2}
              stroke={measureColor} strokeWidth="1.5" strokeDasharray="4 3"
            />
            <circle cx={measurePoints.x1} cy={measurePoints.y1} r="3" fill={measureColor} />
            <circle cx={measurePoints.x2} cy={measurePoints.y2} r="3" fill={measureColor} />
          </svg>
          {measurePct != null && (
            <div
              className="absolute px-2 py-1 rounded text-[11px] font-mono pointer-events-none shadow-lg"
              style={{
                left: measurePoints.x2 + 12, top: measurePoints.y2 - 14,
                background: measureColor, color: '#0a0a0a', fontWeight: 'bold',
              }}
            >
              {measurePct >= 0 ? '+' : ''}{measurePct.toFixed(2)}%
              <div style={{ fontWeight: 'normal', opacity: 0.85, fontSize: '9px' }}>
                {fmtChartPrice(measurePoints.price1)} → {fmtChartPrice(measurePoints.price2)}
              </div>
              {(measureElapsed || measureCandleCount != null) && (
                <div style={{ fontWeight: 'normal', opacity: 0.85, fontSize: '9px' }}>
                  {measureElapsed ?? '—'}
                  {measureCandleCount != null ? ` · ${measureCandleCount} candle${measureCandleCount === 1 ? '' : 's'}` : ''}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  // Botões de medir % — vivem dentro da área do gráfico, no canto superior direito
  // (o painel de indicadores agora abre como dropdown centralizado no topo, sem reservar
  // espaço lateral).
  const measureButtons = (
    <div className="absolute top-3 right-3 z-30 flex items-center gap-1">
      <button
        onClick={toggleMeasureMode}
        title="Medir variação % — arraste de um candle a outro (fica ligado até você clicar de novo)"
        className={`w-6 h-5 md:w-7 md:h-6 inline-flex items-center justify-center text-[10px] md:text-[11px] rounded font-mono font-bold transition-colors border shrink-0 shadow-lg ${
          measureMode && !measureOneShot
            ? 'bg-amber-400 text-black border-amber-200 shadow-amber-400/50'
            : 'bg-amber-500/80 text-black border-amber-400 hover:bg-amber-400'
        }`}
      >
        %
      </button>
      <button
        onClick={toggleMeasureModeOnce}
        title="Medir variação % uma vez — desliga sozinho ao soltar o arraste e o resultado some após 1s"
        className={`w-6 h-5 md:w-7 md:h-6 inline-flex items-center justify-center text-[10px] md:text-[11px] rounded font-mono font-bold transition-colors border shrink-0 shadow-lg ${
          measureMode && measureOneShot
            ? 'bg-amber-400 text-black border-amber-200 shadow-amber-400/50'
            : 'bg-amber-500/80 text-black border-amber-400 hover:bg-amber-400'
        }`}
      >
        %<sup className="leading-none">1</sup>
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar — compacta no mobile (intervalos em scroll horizontal) */}
      <div className="flex flex-col px-2 md:px-3 pt-1 md:pt-2 pb-0.5 md:pb-1 shrink-0 gap-0.5 md:gap-1 border-b border-p2/40">
        {/* Linha 0 — abas + botões de janela de candles (separados dos intervalos) */}
        <div className="flex items-center gap-1 border-b border-p2/20 pb-0.5 md:pb-1 mb-0.5">
          {[
            { id: 'chart',  label: t('chart.tab.chart') },
            { id: 'rules',  label: t('chart.tab.rules') },
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

          {/* Grupo de janela de candles — alinhado à direita, isolado dos intervalos. Só os mais
              usados ficam visíveis; "›" abre os demais (mesmo padrão da linha de intervalos abaixo). */}
          <div className="ml-auto flex items-center gap-1 pl-2 border-l border-p2/30">
            {(showAllCandlePresets
              ? LAST_CANDLE_PRESETS
              : LAST_CANDLE_PRESETS.filter((n) => COMMON_CANDLE_PRESETS.includes(n) || (hasExplicitCandleWindow && displayCandleCount === n))
            ).map((n) => {
              // Mesmo critério de "o zoom manda mais que o preset" usado em displayLimit acima:
              // fora de Estatísticas/Multi-Trade um chartZoom perdido (ex.: sobra de navegação
              // anterior) não afeta o que é renderizado, então não pode apagar o destaque do botão.
              const zoomOverridesWindow = chartZoom
                && (isTradePanelChartView(chartViewSource) || chartViewSource === CHART_VIEW.STATISTICS);
              const active = hasExplicitCandleWindow && displayCandleCount === n && !zoomOverridesWindow;
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
              onClick={() => setShowAllCandlePresets((v) => !v)}
              title={showAllCandlePresets ? 'Mostrar menos opções' : 'Mais opções de candles'}
              className="px-1 py-0.5 text-[10px] md:text-xs rounded font-mono text-p5/60 hover:bg-p3/40 hover:text-white transition-colors shrink-0"
            >
              {showAllCandlePresets ? '‹' : '›'}
            </button>
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

        {/* Linha 1 — intervalos (uma linha no mobile). Só os mais usados ficam visíveis; "›" abre os demais pro lado. */}
        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto touch-pan-x scrollbar-thin md:flex-wrap md:overflow-visible">
          {(showAllIntervals
            ? INTERVALS
            : INTERVALS.filter((iv) => (uiPrefs.commonChartIntervals ?? COMMON_CHART_INTERVALS).includes(iv) || iv === currentInterval)
          ).map((iv) => (
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
          <button
            onClick={() => setShowAllIntervals((v) => !v)}
            title={showAllIntervals ? 'Mostrar menos intervalos' : 'Mais intervalos'}
            className="px-1 py-0.5 text-[10px] md:text-xs rounded font-mono text-p5/60 hover:bg-p3/40 hover:text-white transition-colors shrink-0"
          >
            {showAllIntervals ? '‹' : '›'}
          </button>
          {loadingInterval && (
            <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin ml-1 shrink-0" />
          )}
        </div>


      </div>

      {/* Conteúdo da aba */}
      {activeTab === 'rules' ? (
        <div
          className="flex-1 min-h-0 flex flex-col px-2 md:px-3 py-2 relative"
          onClick={() => { if (!panelCollapsed) setPanelCollapsed(true); }}
        >
          {selectedChart?.symbol ? (
            <MaCrossRuleCheckChart
              symbol={selectedChart.symbol}
              exchange={selectedChart.source === 'gate' ? 'gate' : 'binance'}
              strategyId={botStrategyId}
              tradeConfig={botTradeConfig}
              realPhase={botFavoriteEntry?.phase}
              realBuyTime={botFavoriteEntry?.buyTime}
              realTradeMarkers={selectedChart?.tradeMarkers ?? chartTradeMarkers ?? []}
              fillHeight
              activeIndicators={activeIndicators}
              quickEmaGroups={quickEmaGroups}
              bollingerBands={bollingerBands}
              panelButtons={chartPanelButtons}
              candleWindowCount={hasExplicitCandleWindow ? displayCandleCount : null}
            />
          ) : (
            <div className="text-p5/50 text-xs font-mono">Selecione uma moeda pra conferir as regras.</div>
          )}
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
            bbPathEnabled={bbPathEnabled}
            setBbPathEnabled={setBbPathEnabled}
            medianTrendEnabled={medianTrendEnabled}
            setMedianTrendEnabled={setMedianTrendEnabled}
            srInterval={srInterval}
            setSrInterval={setSrInterval}
            pphlInterval={pphlInterval}
            setPphlInterval={setPphlInterval}
            chopInterval={chopInterval}
            setChopInterval={setChopInterval}
            vwap={vwap}
            setVwap={setVwap}
            vwapSlopeHighlightOn={vwapSlopeHighlightOn}
            setVwapSlopeHighlightOn={setVwapSlopeHighlightOn}
            overlayMaLoading={overlayMaLoading}
            panelButtons={chartPanelButtons}
            collapsed={panelCollapsed}
            onToggleCollapse={() => setPanelCollapsed(v => !v)}
          />
        </div>
      ) : (
        <div
          ref={chartWrapRef}
          className="flex-1 min-h-0 relative"
          onClick={() => { if (!panelCollapsed) setPanelCollapsed(true); }}
        >
          {showLwChart ? (
            <CandlestickChartLW
              ref={lwChartRef}
              symbol={selectedChart.symbol}
              interval={selectedChart.interval ?? currentInterval}
              candlesticks={selectedChart.candlesticks}
              colors={colors}
              activeIndicators={effectiveIndicators}
              ma9={selectedChart.ma9}
              ma21={selectedChart.ma21}
              ma50={selectedChart.ma50}
              ma200={selectedChart.movingAverage}
              overlayConfigs={overlayConfigs}
              vwapConfig={chartVwapConfig}
              vwapSlopeHighlight={vwapSlopeHighlight}
              bollingerConfig={chartBollingerConfig}
              srConfig={chartSrConfig}
              pphlConfig={chartPphlConfig}
              rsi={selectedChart.rsi}
              chopConfig={chartChopConfig}
              stopLossConfig={chartStopLossConfig}
              targetConfig={chartTargetConfig}
              buyInfo={chartBuyInfo}
              multitradeMarkers={chartTradeMarkers?.length ? chartTradeMarkers : (selectedChart.tradeMarkers ?? [])}
              zoomPeriod={chartZoom}
              focusLastN={hasExplicitCandleWindow ? displayCandleCount : null}
              onNeedOlderCandles={handleLoadMoreCandles}
              loadingMoreCandles={loadingMoreCandles}
            />
          ) : chartNode}
          {!showLwChart && !lwSupported && uiPrefs.chartEngineDefault !== 'echarts' && (
            <div
              className="absolute top-1 left-2 z-10 text-[10px] font-mono text-p5/50 pointer-events-none"
              title={`TradingView indisponível agora: ${lwUnsupportedReason.join(', ')}`}
            >
              ECharts (auto: {lwUnsupportedReason.join(', ')})
            </div>
          )}
          {measureOverlay}
          {measureButtons}
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
            bbPathEnabled={bbPathEnabled}
            setBbPathEnabled={setBbPathEnabled}
            medianTrendEnabled={medianTrendEnabled}
            setMedianTrendEnabled={setMedianTrendEnabled}
            srInterval={srInterval}
            setSrInterval={setSrInterval}
            pphlInterval={pphlInterval}
            setPphlInterval={setPphlInterval}
            chopInterval={chopInterval}
            setChopInterval={setChopInterval}
            vwap={vwap}
            setVwap={setVwap}
            vwapSlopeHighlightOn={vwapSlopeHighlightOn}
            setVwapSlopeHighlightOn={setVwapSlopeHighlightOn}
            overlayMaLoading={overlayMaLoading}
            panelButtons={chartPanelButtons}
            collapsed={panelCollapsed}
            onToggleCollapse={() => setPanelCollapsed(v => !v)}
          />
        </div>
      )}
    </div>
  );
}
