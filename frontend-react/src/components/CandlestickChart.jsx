import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '../i18n';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud, fetchGateTrades, fetchBinanceTrades, fetchChartAdaptiveBands, fetchBollingerBandRecovery, DEFAULT_CANDLE_LIMIT, getBollingerMedianTrendConfig } from '../services/api';
import { buildMarkersFromExchangeTrades, attachPnlToExchangeTrades, isMaCrossEntry, isVwapBandsEntry, isBollingerBandsEntry, resolveBollingerBandsPermFilter } from '../utils/multitradeChart';
import { computeVwapSlopeFlags } from '../utils/vwapSlopeHighlight';
import { buildTrailingStopSeries, resolveChartStopLoss, resolveChartTarget, computeStopLossFloor } from '../utils/trailingStopLoss';
import { getEntriesForSymbol, buildAdHocMaCrossEntry } from '../constants/strategyPresets';
import MaCrossRuleCheckChart from './MaCrossRuleCheckChart';
import CandlestickChartLW from './CandlestickChartLW';
import convertOpenTime from '../utils/convertOpenTime';
import Tooltip from './Tooltip';
import { useIsMobile } from '../hooks/useIsMobile';
import { DEFAULT_OVERLAY_SLOTS, DEFAULT_ACTIVE_INDICATORS, VALID_ACTIVE_INDICATORS, BB_PERIOD_OPTIONS, BB_STDDEV_OPTIONS, DEFAULT_PREV_DAY_CLOUD_INTERVAL, GATE_PREV_DAY_CLOUD_INTERVALS, DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT, DEFAULT_EMA_PERSIST_CLOUD_INTERVAL, DEFAULT_PERM_CLOUD_TONES, DEFAULT_EMA_PERSIST_CLOUD_LAYERS, DEFAULT_RSI_CROSS_INTERVAL, DEFAULT_COMMON_CHART_INTERVALS, getEmaPersistCloudConfirmInterval } from '../utils/uiPreferences';
import { computeRsiUpCrossingsFromCandles } from '../utils/rsiThresholdCrossings';
import { detectSupportResistance, detectPivotPointsHighLow, detectWilliamsFractals, detectZigZag } from '../utils/srDetectors';
import { logSrLevels } from '../utils/srLevelLog';
import { CHART_VIEW, INTERVAL_MS, computeZoomWindow, buildFixedDataZoom, buildInsideDataZoom, computeCandleLimitFromTime, isTradePanelChartView, computeManualWheelZoom } from '../utils/chartView';
import { simulateBbTouchPath, pairBbPathCycles } from '../utils/bollingerTouchPath';
import { detectFlags } from '../utils/detectFlags';
import PanelTip from './PanelTip';
import {
  PANEL_GAP,
  CARD_CONTROL_H,
  panelCard, cardHeader, cardTitle, cardSectionLabel,
  cardOnBtn, cardCloseBtn, cardAddBtn, toggleGroup, toggleBtn, cardSelect,
} from '../utils/chartPanelStyles';
import GroupBox from './chartHandlers/GroupBox';
import { SR_PALETTE } from '../utils/chartHandlers/descriptors';
import { sliceRankedSrLevels } from '../utils/srRank';
import { HANDLER_DESCRIPTORS, HANDLER_GROUP_STORES } from '../utils/chartHandlers/descriptors';
import { useGroupedHandlers } from '../utils/chartHandlers/useGroupedHandlers';

const LIMIT = DEFAULT_CANDLE_LIMIT;

// Escala de fonte do gráfico ECharts (Configurações → Tamanho da fonte). Singleton de módulo
// setado pelo componente ANTES de montar o `option` (os builders de série são funções de módulo
// e leem daqui). `efs(base, cat)` = tamanho final: base × escala geral × escala da categoria.
let ECHART_FONT_SCALE = { chart: 1, price: 1, pct: 1, oco: 1 };
function setEchartFontScale(fs) {
  ECHART_FONT_SCALE = {
    chart: Number(fs?.chart) || 1,
    price: Number(fs?.chartPrice) || 1,
    pct: Number(fs?.chartPct) || 1,
    oco: Number(fs?.chartOco) || 1,
  };
}
function efs(base, cat = 'chart') {
  const mult = ECHART_FONT_SCALE.chart * (cat === 'chart' ? 1 : (ECHART_FONT_SCALE[cat] ?? 1));
  return Math.max(5, Math.round(base * mult));
}
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
// Degraus intermediários (não só 500→1000→10500 direto pro MAX_CANDLES) — sem eles, o 3º
// clique em "carregar mais" (ou arrastar pra trás uma 3ª vez) pulava de 1000 pra 10500 candles
// de uma vez: fetch grande + TODAS as séries do LW (EMAs, VWAP, Bollinger, BB path etc.)
// recalculadas e re-setData()'adas de uma vez travava a renderização por um tempo perceptível.
const CANDLE_FETCH_STEPS = [500, 1000, 2000, 3500, 5500, 8000, 10500];
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
const PANEL_CARD_PAD = 6;
// PANEL_GAP e os primitivos de card (panelCard/cardHeader/toggleBtn/…) vêm de
// ../utils/chartPanelStyles; PanelTip de ./PanelTip (imports acima).
/** Painel de indicadores abre como dropdown no topo do gráfico (flutua por cima, sem empurrar o
 *  chart) — largura responsiva, altura limitada com scroll vertical pro que não couber. Os cards
 *  têm altura natural (empilham); nada de dimensionamento pixel-a-pixel. */
const PANEL_WIDTH_RATIO = 0.2;      // desktop/notebook: 20% da largura do gráfico
const PANEL_MAX_HEIGHT_RATIO = 0.45; // acima disso, rola em vez de cobrir o gráfico inteiro
const PANEL_MAX_HEIGHT_PX = 320;    // teto absoluto, mesmo em telas bem altas
const C_UP   = '#26a69a';
const C_DOWN = '#ef5350';
/** Cores das linhas de S/R — resistência em tons de rosa, suporte em tons de azul (do mais
 *  forte/próximo do preço pro mais fraco). O backend devolve no máximo `maxLevels` = 6 níveis
 *  (≈3 resistências + 3 suportes, ver detectSupportResistance), então 6 tons por paleta cobrem o
 *  pior caso. Ver buildSrMarkLines / o efeito de S/R no LW. */
const SR_RESISTANCE_COLORS = ['#9d174d', '#be185d', '#db2777', '#ec4899', '#f472b6', '#f9a8d4'];
const SR_SUPPORT_COLORS = ['#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd'];
function srLevelColor(type, indexWithinType) {
  const palette = type === 'resistance' ? SR_RESISTANCE_COLORS : SR_SUPPORT_COLORS;
  return palette[indexWithinType % palette.length];
}
// BB: slate — distinto das EMAs (9 fúcsia, 21 laranja, 50 ciano, 200 âmbar)
const BB_COLOR = '#94a3b8';
const BB_PATH_COLOR = '#64748b';
const MEDIAN_TREND_COLOR = '#38bdf8';
/** Mesma cor do botão "Perman." (INDICATOR_GROUPS abaixo) — mesmo indicador, aqui como
 *  variante que filtra o PATH em vez de desenhar a nuvem inteira. */
const PERM_FILTER_COLOR = '#4ade80';

const INDICATOR_GROUPS = [
  { id: 'ma9',      label: 'EMA9',   color: '#e879f9', tipKey: 'chart.tip.sma9' },
  { id: 'ma21',     label: 'EMA21',  color: '#fb923c', tipKey: 'chart.tip.sma21' },
  { id: 'ma50',     label: 'EMA50',  color: '#22d3ee', tipKey: 'chart.tip.sma50' },
  { id: 'ma200',    label: 'EMA200', color: '#f59e0b', tipKey: 'chart.tip.sma200' },
  { id: 'ichimoku', label: 'Ichi',  color: '#60a5fa', tipKey: 'chart.tip.ichimoku' },
  { id: 'flags',    label: 'Band.', color: '#f5d90a', tipKey: 'chart.tip.flags' },
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

/**
 * Bollinger Bands do gráfico — mesmo padrão dos grupos de Quick EMA acima: lista de até
 * MAX_BB_GROUPS bandas, cada uma com seu próprio intervalo/período/desvio e quais das 3 linhas
 * (superior/média/inferior), PATH e tendência da mediana mostrar.
 */
const MAX_BB_GROUPS = 4;
const BB_GROUPS_STORAGE_KEY = 'lets_trade_bb_groups_v1';
const BB_DEFAULT_INTERVAL = '4h';
/** Cor por posição na lista — precisa ser visualmente distinta banda a banda. */
const BB_GROUP_PALETTE = ['#94a3b8', '#38bdf8', '#f472b6', '#facc15'];
function bbGroupColor(index) {
  return BB_GROUP_PALETTE[index % BB_GROUP_PALETTE.length];
}
/** id fixo do grupo auto-sincronizado com o favorito bollinger-bands selecionado (mesma ideia
 *  do TRADE_EMA_GROUP_ID) — nunca persiste (ver saveBbGroups). */
const TRADE_BB_GROUP_ID = 'trade-bb-filter';
/** id fixo do grupo "seguido" a partir de um clique numa ocorrência da aba Estatísticas
 *  (chartZoom.bollinger) — mesma ideia, também nunca persiste. */
const STATS_BB_GROUP_ID = 'stats-bb-zoom';
const AUTO_BB_GROUP_IDS = [TRADE_BB_GROUP_ID, STATS_BB_GROUP_ID];

/** Converte a resposta de /services/bollinger-band-recovery (occurrences[] + openOccurrence,
 *  ver backend/utils/analyseBollingerBandRecovery.js) pro mesmo formato de nó que
 *  simulateBbTouchPath produz (bollingerTouchPath.js) — {openTime, price, side, pnlPct} — pra
 *  poder alimentar o MESMO pipeline de desenho do PATH (pairBbPathCycles, buildBbTouchPathSeries
 *  no motor ECharts, buildBbPathLineAndMarkers no motor Lightweight Charts) sem duplicar nada
 *  lá. Usado só pro botão PERM (ciclos já filtrados pela nuvem PERM do manipulador no backend —
 *  ver botPermInterval), em vez da simulação pura no cliente. */
function occurrencesToBbPathNodes(data) {
  const nodes = [];
  for (const o of data?.occurrences ?? []) {
    nodes.push({ openTime: new Date(o.startDate).getTime(), price: o.entryPrice, side: 'buy', pnlPct: null });
    nodes.push({ openTime: new Date(o.endDate).getTime(), price: o.exitPrice, side: 'sell', pnlPct: o.appreciationPercent });
  }
  const open = data?.openOccurrence;
  if (open) {
    const entryPrice = Number(open.entryPrice);
    nodes.push({ openTime: new Date(open.startDate).getTime(), price: entryPrice, side: 'buy', pnlPct: null });
    nodes.push({
      openTime: Date.now(),
      price: entryPrice * (1 + Number(open.appreciationPercent) / 100),
      side: 'open',
      pnlPct: open.appreciationPercent,
    });
  }
  return nodes;
}

function makeBbGroup(overrides) {
  return {
    id: `bb${Date.now()}`,
    interval: BB_DEFAULT_INTERVAL,
    period: '20',
    stdDev: 2,
    enabled: true,
    showUpper: true,
    showMiddle: true,
    showLower: true,
    showPath: false,
    showMedianTrend: false,
    showPermFilter: false,
    ...overrides,
  };
}

/** Grupo inicial (1ª vez que o usuário abre o gráfico, sem nada salvo ainda) — igual ao Quick
 *  EMA, começa com uma banda já visível no painel, mas com tudo desligado (linhas/PATH/
 *  tendência), pra o usuário simplesmente clicar no que quiser em vez de ter que "+ Bollinger"
 *  antes de configurar a primeira. */
function defaultBbGroups() {
  return [makeBbGroup({ enabled: false, showUpper: false, showMiddle: false, showLower: false })];
}

function loadBbGroups() {
  try {
    const raw = localStorage.getItem(BB_GROUPS_STORAGE_KEY);
    if (raw == null) return defaultBbGroups();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultBbGroups();
    return parsed
      .filter((g) => g && OVERLAY_MA_INTERVALS.includes(g.interval))
      .slice(0, MAX_BB_GROUPS)
      .map((g, i) => ({
        id: typeof g.id === 'string' && g.id ? g.id : `bb${i + 1}`,
        interval: g.interval,
        period: BB_PERIOD_OPTIONS.includes(String(g.period)) ? String(g.period) : '20',
        stdDev: BB_STDDEV_OPTIONS.includes(Number(g.stdDev)) ? Number(g.stdDev) : 2,
        enabled: typeof g.enabled === 'boolean' ? g.enabled : true,
        showUpper: typeof g.showUpper === 'boolean' ? g.showUpper : true,
        showMiddle: typeof g.showMiddle === 'boolean' ? g.showMiddle : true,
        showLower: typeof g.showLower === 'boolean' ? g.showLower : true,
        showPath: typeof g.showPath === 'boolean' ? g.showPath : false,
        showMedianTrend: typeof g.showMedianTrend === 'boolean' ? g.showMedianTrend : false,
        showPermFilter: typeof g.showPermFilter === 'boolean' ? g.showPermFilter : false,
      }));
  } catch {
    return defaultBbGroups();
  }
}

/** Nunca persiste os grupos auto-sincronizados (AUTO_BB_GROUP_IDS) — mesmo motivo do
 *  saveQuickEmaGroups acima. */
function saveBbGroups(groups) {
  try {
    localStorage.setItem(BB_GROUPS_STORAGE_KEY, JSON.stringify(groups.filter((g) => !AUTO_BB_GROUP_IDS.includes(g.id))));
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

/** Indicadores que sobrevivem à troca manual de intervalo do gráfico (botões 1m/5m/15m/...):
 *  RSI e CHOP abrem em subpainel próprio (embaixo do candle, com seu próprio eixo/dados), então
 *  continuam válidos no novo intervalo. R50/R80 são só marcações dentro desse subpainel de RSI.
 *  Todo o resto (EMA9/21/50/200, Ichimoku, S/R, PPHL, SL, Bollinger, Quick EMA, VWAP) é desenhado
 *  em cima do candle a partir de dados buscados pro intervalo antigo — ficaria "colado" no
 *  intervalo errado até recarregar, por isso some ao trocar. */
const INTERVAL_CHANGE_KEEP_INDICATORS = new Set(['rsi', 'rsi50', 'rsi80']);
// CHOP/MACD (agora manipuladores caixa) sobrevivem à troca de intervalo via
// descriptor.keepOnIntervalChange = true (têm intervalo próprio); Bars×/TD Seq = false.

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
        padding: [2, 4], borderRadius: 2, fontSize: efs(17, 'pct'), fontWeight: 'bold', position: 'top',
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

/** Candles brutos de um intervalo próprio (S/R, PPHL, WF, ZigZag) — o cálculo dos níveis é feito
 *  no cliente (ver srDetectors.js + os useMemo chartSrConfig/chartPphlConfig/...), pra recalcular
 *  ao vivo conforme o usuário arrasta/dá zoom (janela deslizante). */
async function fetchPivotRawCandles(symbol, interval, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  return Array.isArray(candles) ? candles : [];
}

/** "Janela deslizante" pro S/R/PPHL/WF/ZZ: os candles (asc por openTime) que caem no trecho
 *  visível [fromMs, toMs] do gráfico, limitados a `maxCount`. Se o zoom estiver fechado demais
 *  (poucos candles no trecho), estende pra trás terminando na borda direita do visível, até ter
 *  ~`maxCount` candles — pra sempre haver histórico suficiente pra clusterizar. Sem visibleRange
 *  → últimos `maxCount` candles (comportamento antigo). */
const SR_MIN_WINDOW = 30;
function sliceForVisibleWindow(candles, visibleRange, maxCount) {
  if (!Array.isArray(candles) || !candles.length) return [];
  if (!visibleRange || !Number.isFinite(visibleRange.toMs)) {
    return candles.slice(-maxCount);
  }
  const { fromMs, toMs } = visibleRange;
  let end = candles.length - 1;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (Number(candles[i].openTime) <= toMs) { end = i; break; }
  }
  let start = 0;
  if (Number.isFinite(fromMs)) {
    for (let i = 0; i <= end; i++) {
      if (Number(candles[i].openTime) >= fromMs) { start = i; break; }
    }
  }
  // zoom fechado demais → estende pra trás pra ter pelo menos SR_MIN_WINDOW candles
  if (end - start + 1 < SR_MIN_WINDOW) start = Math.max(0, end - SR_MIN_WINDOW + 1);
  // teto = maxCount, mantendo a borda direita
  if (end - start + 1 > maxCount) start = end - maxCount + 1;
  return candles.slice(start, end + 1);
}

/** Nº de candles-âncora do S/R ROLANTE: pra cada um dos últimos SR_ROLL_WIDTH candles (o da borda
 *  direita do trecho visível + os anteriores) roda-se detectSupportResistance sobre os
 *  `srCandleCount` candles anteriores àquela âncora. Largura fixa — não muda com zoom. */
const SR_ROLL_WIDTH = 10;

/** Abertura do último candle do intervalo do S/R que JÁ FECHOU até `targetMs` — o candle em
 *  formação NÃO entra. Mesma regra do backtest (resolveSupportResistanceAt), sem look-ahead:
 *  um candle abre em `o` e fecha em `o + step`, então está fechado até `t` sse `o + step <= t`. */
function srClosedAnchorMs(targetMs, stepMs) {
  if (!Number.isFinite(targetMs) || !(stepMs > 0)) return null;
  return Math.floor((targetMs - stepMs) / stepMs) * stepMs;
}

/** Corte pro S/R rolante: os `lookback + width` candles (asc por openTime) que terminam na borda
 *  direita do trecho visível [.., toMs]. Sem visibleRange → os últimos. A borda direita acompanha
 *  o pan, mas a quantidade de candles (e portanto o cálculo por âncora) é fixa. */
function sliceForRollingSR(candles, visibleRange, lookback, width) {
  if (!Array.isArray(candles) || !candles.length) return [];
  let end = candles.length - 1;
  if (visibleRange && Number.isFinite(visibleRange.toMs)) {
    for (let i = candles.length - 1; i >= 0; i--) {
      if (Number(candles[i].openTime) <= visibleRange.toMs) { end = i; break; }
    }
  }
  const start = Math.max(0, end - (lookback + width) + 1);
  return candles.slice(start, end + 1);
}

/**
 * Candles nativos no intervalo escolhido (ver prevDayCloudInterval) da Binance/Gate pra nuvem
 * "D-1" — de propósito o candle NATIVO (janela UTC), não um agregado por dia de Brasília: precisa
 * bater exatamente com o candle que o usuário vê na própria Binance/Gate (cor e valores), mesmo
 * que isso desloque o início visual de cada degrau (não meia-noite BRT nos intervalos ≥1d) —
 * confirmado com dados reais da ONTUSDT (dia 23/08 nativo em 1d: abertura 0.04786, fechamento
 * 0.04827, alta; batia com o app só quando calculado sobre o candle nativo, não sobre um agregado
 * de 1h por dia BRT). `interval` já vem resolvido pelo chamador (prevDayCloudEffectiveInterval) —
 * a Gate.io não tem todo intervalo nativo (ver GATE_PREV_DAY_CLOUD_INTERVALS), então essa função
 * não precisa reclampar nada aqui.
 */
async function fetchPrevDayCloudCandles(symbol, source, limit, interval = '1d') {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  return Array.isArray(candles) ? candles : [];
}

/** Quantos candles (1d ou 3d, ver interval) buscar pra cobrir a janela do gráfico principal
 *  (chartInterval × candleCount) + folga de 2×windowSize+3 candles (o bloco de windowSize
 *  candles anterior ao mais antigo visível também precisa estar completo pra ter nuvem, e o
 *  alinhamento à grade fixa pode "desperdiçar" até windowSize-1 candles no início — ver
 *  buildPrevDayCloudSegments). Cresce conforme o usuário arrasta o gráfico pra trás (candleCount
 *  sobe via onNeedOlderCandles). Teto de 500 candles — bem além do que faz sentido arrastar na
 *  prática. */
function computePrevDayCloudFetchLimit(chartInterval, candleCount, interval = '1d', windowSize = 1) {
  const chartMs = INTERVAL_MS[chartInterval] ?? 900_000;
  const cloudMs = INTERVAL_MS[interval] ?? 86_400_000;
  const spanCandles = Math.max(Number(candleCount) || 0, DEFAULT_CANDLE_LIMIT);
  const spanSteps = Math.ceil((spanCandles * chartMs) / cloudMs);
  return Math.min(500, Math.max(10, spanSteps + windowSize * 2 + 3));
}

/**
 * Degraus da nuvem D-1: a faixa DESENHADA de cada degrau cobre exatamente 1 candle nativo do
 * intervalo D-1 escolhido (ex.: 4h → degraus de 4h) — largura igual ao passo com que o VALOR
 * muda de verdade (ver abaixo). Contados de trás pra frente a partir do candle mais recente — o
 * degrau mais novo sempre termina exatamente no candle mais recente (em formação), então a
 * largura não depende de quantos candles foram buscados (arrastar o gráfico pra trás só soma
 * mais degraus antigos).
 *
 * IMPORTANTE: a largura desenhada precisa ser igual ao passo do valor (1 candle) — usar
 * `windowSize - 1` aqui (como antes) desalinha os dois depois de poucos degraus: o valor anda 1
 * candle por degrau, mas o desenho andava `windowSize-1` candles por degrau, então a partir do
 * 2º degrau pra trás o índice do VALOR passa a ficar à FRENTE do índice do próprio degrau
 * desenhado — o bloco acaba mostrando candles do FUTURO em vez do passado (caso real: ZRO,
 * bloco desenhado em 18/08 21:00 mostrando candles de 22/08, ver conversa). Ver
 * resolvePrevDayCloud em backend/utils/analyseRsiThresholdBacktest.js, que usa a mesma ideia
 * (1 degrau = 1 candle) — gráfico e backtest/bot ficam consistentes.
 *
 * O VALOR (upper/lower/open/close) é uma janela de `windowSize` candles JÁ FECHADOS — pro degrau
 * k passos atrás do mais recente (k=0 é o degrau "ao vivo"), a janela termina no candle
 * (últimoFechado - k). Ou seja, o valor anda 1 candle pra trás a cada degrau mais antigo — o
 * degrau "ao vivo" sempre reflete os últimos candles fechados, atualizando a cada novo
 * fechamento. Cor (bullish) compara a abertura do primeiro candle da janela com o fechamento do
 * último.
 *
 * endTime é sempre o fim matemático do bloco (mesmo se ele ainda não fechou de verdade) — o
 * render (CandlestickChartLW.jsx) já clampa em "agora", então o degrau em formação aparece
 * corretamente cortado sem precisar de um caso especial aqui.
 */
function buildPrevDayCloudSegments(dailyCandles, windowSize = 1, useHighLow = false) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length < 2) return [];
  const n = Math.max(1, Math.round(Number(windowSize) || 1));
  const w = 1;
  const nativeMs = Number(dailyCandles[1]?.openTime) - Number(dailyCandles[0]?.openTime);
  if (!Number.isFinite(nativeMs) || nativeMs <= 0) return [];

  const lastIndex = dailyCandles.length - 1;
  const lastClosedIndex = dailyCandles.length - 2;
  if (lastClosedIndex < 0) return [];

  const segments = [];
  for (let k = 0, hi = lastIndex; ; k++, hi -= w) {
    const startIndex = hi - w + 1;
    if (startIndex < 0) break;
    const startTime = Number(dailyCandles[startIndex].openTime);
    if (!Number.isFinite(startTime)) break;
    const endTime = startTime + w * nativeMs;

    const valueEnd = lastClosedIndex - k;
    const valueStart = valueEnd - n + 1;
    if (valueStart < 0) break;
    const valueWindow = dailyCandles.slice(valueStart, valueEnd + 1);
    let lower = Infinity;
    let upper = -Infinity;
    for (const c of valueWindow) {
      if (useHighLow) {
        // Aumenta a nuvem: máxima/mínima (pavios) em vez de abertura/fechamento (corpo).
        const hi2 = Number(c.high);
        const lo2 = Number(c.low);
        if (Number.isFinite(lo2)) lower = Math.min(lower, lo2);
        if (Number.isFinite(hi2)) upper = Math.max(upper, hi2);
      } else {
        const o = Number(c.open);
        const cl = Number(c.close);
        if (Number.isFinite(o)) { lower = Math.min(lower, o); upper = Math.max(upper, o); }
        if (Number.isFinite(cl)) { lower = Math.min(lower, cl); upper = Math.max(upper, cl); }
      }
    }
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) continue;
    const openPrice = Number(valueWindow[0].open);
    const closePrice = Number(valueWindow[valueWindow.length - 1].close);
    if (!Number.isFinite(openPrice) || !Number.isFinite(closePrice)) continue;
    segments.push({
      startTime,
      endTime,
      openPrice,
      closePrice,
      upper,
      lower,
      bullish: closePrice >= openPrice,
    });
  }
  segments.reverse();
  return segments;
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

/** MACD (12/26/9, períodos fixos) num intervalo próprio (independente do gráfico) — mesmo padrão
 *  do S/R/PPHL/CHOP. Devolve { macd, signal, histogram }, cada um como [{openTime, value}]. */
async function fetchMacdOverlayPoints(symbol, interval, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return { macd: [], signal: [], histogram: [] };
  const series = await fetch('/services/macd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(series)) return { macd: [], signal: [], histogram: [] };
  const offset = candles.length - series.length;
  const field = (key) => series
    .map((r, i) => ({ openTime: Number(candles[offset + i].openTime), value: r?.[key] }))
    .filter(p => Number.isFinite(p.value));
  return { macd: field('macd'), signal: field('signal'), histogram: field('histogram') };
}

/** Candles + EMA9 + EMA21 num intervalo próprio (independente do gráfico), mesmo padrão do
 *  S/R/PPHL/CHOP — usado pela nuvem PERM (inclinação EMA9) e pelo Bars Since MA Cross (BARS).
 *  Os pontos resultantes (candles no intervalo escolhido) são depois "encaixados" nos candles
 *  REALMENTE exibidos no gráfico via snapPointsToChartCandles (CandlestickChartLW.jsx). */
async function fetchEmaCrossOverlayData(symbol, interval, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return { candlesticks: [], ma9: [], ma21: [] };
  const [ma9, ma21] = await Promise.all([
    fetch('/services/sma?period=9', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candles),
    }).then(r => r.json()),
    fetch('/services/sma?period=21', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candles),
    }).then(r => r.json()),
  ]);
  return {
    candlesticks: candles,
    ma9: Array.isArray(ma9) ? ma9 : [],
    ma21: Array.isArray(ma21) ? ma21 : [],
  };
}

/** Só os candles, num intervalo próprio — usado pelo TD Sequential (não precisa de EMA, só do
 *  fechamento de cada candle vs. o de 4 candles atrás). Mesmo padrão de fetchEmaCrossOverlayData. */
async function fetchIntervalCandlesOnly(symbol, interval, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  return Array.isArray(candles) ? candles : [];
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

const COMPACT_LABELS = {
  ma9: '9', ma21: '21', ma50: '50', ma200: '200', ichimoku: 'Ich', sr: 'S/R', pphl: 'PPHL', wfractals: 'WF', zigzag: 'ZZ', flags: 'Band.', rsi: 'RSI',
  rsi80: 'R80', rsi50: 'R50', stopLoss: 'SL', chopZone: 'CHOP', emaPersistCloud: 'PERM',
  barsSinceCross: 'BARS', tdSequential: 'TDSEQ', macd: 'MACD',
};

/**
 * Bollinger Bands — lista de até MAX_BB_GROUPS bandas (mesmo padrão do Quick EMA acima), cada
 * uma com intervalo/período/desvio próprios, ON/OFF geral, quais das 3 linhas mostrar
 * (LS=superior, LM=média, LI=inferior), PATH/TENDÊNCIA e PERM independentes.
 *
 * `botPermInterval` ('h1'|'m30'|'m15'|null, ver botPermInterval no componente principal): nível
 * de PERM configurado no favorito Bollinger Bands do manipulador (bot ao vivo) pra moeda atual.
 * O botão PERM some liga o filtro, mas só tem efeito enquanto isso não for null (sem favorito
 * BB com PERM habilitado num nível 1h/30m/15m pra essa moeda, o botão fica sem dado pra mostrar
 * — ver bbPermPathCache/occurrencesToBbPathNodes).
 */
/** Sub-bloco (uma instância de grupo) dentro de um card de manipulador multi-instância. */
const HANDLER_SUB_BLOCK = {
  border: '1px solid var(--color-pnl-border)',
  borderRadius: 4,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

function renderBollingerCard(
  { groups },
  t,
  addBbGroup,
  removeBbGroup,
  updateBbGroup,
  toggleBbGroupFlag,
  botPermInterval,
) {
  const permAvailable = !!botPermInterval;
  const permTip = permAvailable
    ? `Mostra só os ciclos do PATH que passariam pelo filtro PERM (nuvem EMA9×EMA21) do manipulador dessa moeda, no nível ${botPermInterval === 'h1' ? '1h' : botPermInterval === 'm30' ? '30m' : '15m'} — mesmo nível configurado no favorito Bollinger Bands (bot ao vivo)`
    : 'Sem favorito Bollinger Bands com PERM habilitado (1h/30m/15m) pra essa moeda — sem dado pra filtrar';

  return (
    <div style={panelCard()}>
      <div style={cardHeader()}>
        <span style={cardTitle()}>Bollinger Bands</span>
        <span style={cardSectionLabel()}>{groups.length}/{MAX_BB_GROUPS}</span>
      </div>
      {groups.map((g, i) => {
        const color = bbGroupColor(i);
        return (
          <div key={g.id} style={HANDLER_SUB_BLOCK}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              <div style={{ display: 'flex', gap: 2 }}>
                <PanelTip text={t('chart.tip.bb_on')}>
                  <button type="button" onClick={() => toggleBbGroupFlag(g.id, 'enabled')} style={cardOnBtn(!!g.enabled)}>ON</button>
                </PanelTip>
                <PanelTip text={t('chart.tip.bb_remove')}>
                  <button type="button" onClick={() => removeBbGroup(g.id)} style={cardCloseBtn()}>×</button>
                </PanelTip>
              </div>
            </div>
            <div style={toggleGroup()}>
              <div style={{ flex: 2, minWidth: 0, display: 'flex' }}>
                <PanelTip text={t('chart.tip.bb_interval')}>
                  <select value={g.interval} onChange={(e) => updateBbGroup(g.id, { interval: e.target.value })} style={cardSelect(color)}>
                    {OVERLAY_MA_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </PanelTip>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                <PanelTip text={t('chart.tip.bb_period')}>
                  <select value={g.period} onChange={(e) => updateBbGroup(g.id, { period: e.target.value })} style={cardSelect(color)}>
                    {BB_PERIOD_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </PanelTip>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                <PanelTip text={t('chart.tip.bb_stddev')}>
                  <select value={g.stdDev} onChange={(e) => updateBbGroup(g.id, { stdDev: Number(e.target.value) })} style={cardSelect(color)}>
                    {BB_STDDEV_OPTIONS.map((s) => <option key={s} value={s}>±{s}σ</option>)}
                  </select>
                </PanelTip>
              </div>
            </div>
            <div style={toggleGroup()}>
              <PanelTip text={t('chart.tip.bb_upper')}>
                <button type="button" onClick={() => toggleBbGroupFlag(g.id, 'showUpper')} style={toggleBtn(g.showUpper, color)}>LS</button>
              </PanelTip>
              <PanelTip text={t('chart.tip.bb_middle')}>
                <button type="button" onClick={() => toggleBbGroupFlag(g.id, 'showMiddle')} style={toggleBtn(g.showMiddle, color)}>LM</button>
              </PanelTip>
              <PanelTip text={t('chart.tip.bb_lower')}>
                <button type="button" onClick={() => toggleBbGroupFlag(g.id, 'showLower')} style={toggleBtn(g.showLower, color)}>LI</button>
              </PanelTip>
            </div>
            <div style={toggleGroup()}>
              <PanelTip text={t('chart.tip.bb_path')}>
                <button type="button" onClick={() => toggleBbGroupFlag(g.id, 'showPath')} style={toggleBtn(g.showPath, BB_PATH_COLOR)}>
                  {g.showPath ? 'PATH ON' : 'PATH'}
                </button>
              </PanelTip>
              <PanelTip text={t('chart.tip.bb_median_trend')}>
                <button type="button" onClick={() => toggleBbGroupFlag(g.id, 'showMedianTrend')} style={toggleBtn(g.showMedianTrend, MEDIAN_TREND_COLOR)}>
                  {g.showMedianTrend ? 'TEND ON' : 'TENDÊNCIA'}
                </button>
              </PanelTip>
            </div>
            <div style={{ ...toggleGroup(), opacity: permAvailable ? 1 : 0.4 }}>
              <PanelTip text={permTip}>
                <button type="button" onClick={() => toggleBbGroupFlag(g.id, 'showPermFilter')} style={toggleBtn(g.showPermFilter, PERM_FILTER_COLOR)}>
                  {g.showPermFilter ? 'PERM ON' : 'PERM'}
                </button>
              </PanelTip>
            </div>
          </div>
        );
      })}
      {groups.length < MAX_BB_GROUPS && (
        <PanelTip text={t('chart.tip.bb_add')}>
          <button type="button" onClick={addBbGroup} style={cardAddBtn()}>+ Bollinger</button>
        </PanelTip>
      )}
    </div>
  );
}

/**
 * VWAP de sessão: intervalo próprio + sessão (diário/semanal) + bandas ±σ + ON/OFF —
 * mesmo padrão da Bollinger, sem período/desvio (é um único acumulado por sessão, não uma média móvel).
 */
function renderVwapCard(t, vwap, setVwap, slopeHighlightOn, setSlopeHighlightOn) {
  const color = '#4ade80';
  const declineColor = '#ef4444';
  return (
    <div style={panelCard()}>
      <div style={cardHeader()}>
        <span style={cardTitle()}>VWAP</span>
        <PanelTip text={t('chart.tip.vwap_on')}>
          <button type="button" onClick={() => setVwap(v => ({ ...v, enabled: !v.enabled }))} style={cardOnBtn(!!vwap.enabled)}>ON</button>
        </PanelTip>
      </div>
      <div style={toggleGroup()}>
        <PanelTip text={t('chart.tip.vwap_interval')}>
          <select value={vwap.interval} onChange={e => setVwap(v => ({ ...v, interval: e.target.value }))} style={cardSelect(color)}>
            {OVERLAY_MA_INTERVALS.map(iv => <option key={iv} value={iv}>{`VWAP ${iv}`}</option>)}
          </select>
        </PanelTip>
      </div>
      <div style={toggleGroup()}>
        <PanelTip text={t('chart.tip.vwap_session')}>
          <button type="button" onClick={() => setVwap(v => ({ ...v, session: 'daily' }))} style={toggleBtn(vwap.session === 'daily', color)}>Diário</button>
        </PanelTip>
        <PanelTip text={t('chart.tip.vwap_session')}>
          <button type="button" onClick={() => setVwap(v => ({ ...v, session: 'weekly' }))} style={toggleBtn(vwap.session === 'weekly', color)}>Semanal</button>
        </PanelTip>
      </div>
      <div style={toggleGroup()}>
        <PanelTip text={t('chart.tip.vwap_bands')}>
          <button type="button" onClick={() => setVwap(v => ({ ...v, bands: !v.bands }))} style={toggleBtn(vwap.bands, color)}>
            {vwap.bands ? 'Bandas ON' : 'Bandas OFF'}
          </button>
        </PanelTip>
        <PanelTip text={t('chart.tip.vwap_slope_highlight')}>
          <button type="button" onClick={() => setSlopeHighlightOn(v => !v)} style={toggleBtn(slopeHighlightOn, declineColor)}>
            {slopeHighlightOn ? 'Queda VWAP ON' : 'Queda VWAP OFF'}
          </button>
        </PanelTip>
      </div>
    </div>
  );
}

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

/** Card "Indicadores rápidos" — todos os botões simples de indicador (EMA9/21/50/200, Ichi,
 *  Band., RSI, R80, R50, SL) num wrap de toggles. Seguem o intervalo do próprio gráfico. */
function renderQuickIndicatorsCard(indicators, t, toggleIndicator) {
  if (!indicators.length) return null;
  const hint = t('chart.panel.chart_interval_hint');
  return (
    <div style={panelCard()}>
      <div style={cardHeader()}>
        <span style={cardTitle()}>{t('chart.panel.card_quick_indicators')}</span>
        <span style={cardSectionLabel()}>{hint === 'chart.panel.chart_interval_hint' ? 'intervalo do gráfico' : hint}</span>
      </div>
      <div style={toggleGroup(true)}>
        {indicators.map((ind) => (
          <PanelTip key={ind.id} text={t(ind.tipKey)}>
            <button
              type="button"
              onClick={() => toggleIndicator(ind.id)}
              style={{ ...toggleBtn(ind.active, ind.color), flex: '0 0 auto', minWidth: 30 }}
            >
              {COMPACT_LABELS[ind.id] ?? ind.id}
            </button>
          </PanelTip>
        ))}
      </div>
    </div>
  );
}

function renderQuickEmaCard(
  { groups },
  t,
  addQuickEmaGroup,
  removeQuickEmaGroup,
  updateQuickEmaGroupInterval,
  toggleQuickEmaGroupPeriod,
  updateQuickEmaGroupBandPct,
  updateQuickEmaGroupBandPeriod,
) {
  const pctSelect = (kind, g) => {
    const val = kind === 'above' ? g.abovePct : g.belowPct;
    const accent = val === QUICK_EMA_BAND_ADAPTIVE ? '#facc15' : (val != null ? (kind === 'above' ? '#22c55e' : '#f87171') : undefined);
    const sign = kind === 'above' ? '+' : '-';
    return (
      <PanelTip text={t(kind === 'above' ? 'chart.tip.quick_ema_band_above' : 'chart.tip.quick_ema_band_below')}>
        <select
          value={val ?? 'off'}
          onChange={(e) => updateQuickEmaGroupBandPct(g.id, kind, e.target.value === 'off' ? null : (e.target.value === QUICK_EMA_BAND_ADAPTIVE ? QUICK_EMA_BAND_ADAPTIVE : Number(e.target.value)))}
          style={{ ...cardSelect(accent), opacity: val != null ? 1 : 0.6 }}
        >
          <option value="off">OFF</option>
          <option value={QUICK_EMA_BAND_ADAPTIVE}>ADAPT</option>
          {QUICK_EMA_BAND_PCT_OPTIONS.map((pct) => <option key={pct} value={pct}>{`${sign}${pct}%`}</option>)}
        </select>
      </PanelTip>
    );
  };

  return (
    <div style={panelCard()}>
      <div style={cardHeader()}>
        <span style={cardTitle()}>EMA rápida</span>
        <span style={cardSectionLabel()}>{groups.length}/{MAX_QUICK_EMA_GROUPS}</span>
      </div>
      {groups.map((g) => {
        const bandColor = g.bandPeriod ? (QUICK_EMA_PERIOD_COLORS[g.bandPeriod] ?? '#94a3b8') : undefined;
        return (
          <div key={g.id} style={HANDLER_SUB_BLOCK}>
            <div style={toggleGroup()}>
              <div style={{ flex: 3, minWidth: 0, display: 'flex' }}>
                <PanelTip text={t('chart.tip.quick_ema_interval')}>
                  <select value={g.interval} onChange={(e) => updateQuickEmaGroupInterval(g.id, e.target.value)} style={cardSelect()}>
                    {OVERLAY_MA_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                </PanelTip>
              </div>
              <PanelTip text={t('chart.tip.quick_ema_remove')}>
                <button type="button" onClick={() => removeQuickEmaGroup(g.id)} style={cardCloseBtn()}>×</button>
              </PanelTip>
            </div>
            <div style={toggleGroup()}>
              {QUICK_EMA_PERIODS.map((p) => (
                <PanelTip key={p} text={t('chart.tip.quick_ema_period', p, g.interval)}>
                  <button
                    type="button"
                    onClick={() => toggleQuickEmaGroupPeriod(g.id, p)}
                    style={toggleBtn(g.periods.includes(p), QUICK_EMA_PERIOD_COLORS[p])}
                  >
                    {p}
                  </button>
                </PanelTip>
              ))}
            </div>
            <div style={toggleGroup()}>
              <PanelTip text={t('chart.tip.quick_ema_band_period')}>
                <select
                  value={g.bandPeriod ?? 'off'}
                  onChange={(e) => updateQuickEmaGroupBandPeriod(g.id, e.target.value === 'off' ? null : e.target.value)}
                  style={{ ...cardSelect(bandColor), opacity: g.bandPeriod ? 1 : 0.6 }}
                >
                  <option value="off">OFF</option>
                  {QUICK_EMA_PERIODS.map((p) => <option key={p} value={p}>{`EMA${p}`}</option>)}
                </select>
              </PanelTip>
            </div>
            <div style={toggleGroup()}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>{pctSelect('above', g)}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>{pctSelect('below', g)}</div>
            </div>
          </div>
        );
      })}
      {groups.length < MAX_QUICK_EMA_GROUPS && (
        <PanelTip text={t('chart.tip.quick_ema_add')}>
          <button type="button" onClick={addQuickEmaGroup} style={cardAddBtn()}>+ Intervalo</button>
        </PanelTip>
      )}
    </div>
  );
}


function ChartIndicatorPanel({
  handlers = {},
  activeIndicators,
  toggleIndicator,
  quickEmaGroups,
  addQuickEmaGroup,
  removeQuickEmaGroup,
  updateQuickEmaGroupInterval,
  toggleQuickEmaGroupPeriod,
  updateQuickEmaGroupBandPct,
  updateQuickEmaGroupBandPeriod,
  bbGroups,
  addBbGroup,
  removeBbGroup,
  updateBbGroup,
  toggleBbGroupFlag,
  botPermInterval,
  vwap,
  setVwap,
  vwapSlopeHighlightOn,
  setVwapSlopeHighlightOn,
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
    // Manipuladores no padrão caixa (Bollinger/EMA), dirigidos por descriptor.
    for (const d of HANDLER_DESCRIPTORS) {
      if (panelButtons[d.panelButtonKey] === false) continue;
      if (typeof d.panelGate === 'function' && !d.panelGate({ activeIndicators })) continue;
      const api = handlers[d.id];
      if (!api) continue;
      list.push({ key: `handler-${d.id}`, kind: 'handler', data: { descriptor: d, api } });
    }
    if (showBb) {
      list.push({ key: 'bb', kind: 'bb', data: { groups: bbGroups } });
    }
    if (showVwap) {
      list.push({ key: 'vwap', kind: 'vwap', data: {} });
    }
    list.push({ key: 'quickEma', kind: 'quickEma', data: { groups: quickEmaGroups } });
    return list;
  }, [panelButtons, activeIndicators, quickEmaGroups, bbGroups, handlers]);

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

  const indicatorTiles = tileDefs.filter((tile) => tile.kind === 'indicator').map((tile) => tile.data);
  const blocks = tileDefs.filter((tile) => tile.kind !== 'indicator');

  if (!tileDefs.length) {
    return null;
  }

  const collapseToggle = (
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
      {collapsed && collapseToggle}

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
            background: 'var(--color-pnl-bg)',
            border: '1px solid var(--color-pnl-border-2)',
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
                  color: panelTab === id ? 'var(--color-pnl-text)' : 'var(--color-pnl-muted)',
                  background: panelTab === id ? 'var(--color-pnl-toggle)' : 'transparent',
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
          ) : (
            <>
              {renderQuickIndicatorsCard(indicatorTiles, t, toggleIndicator)}
              {blocks.map((tile) => (
                <div key={tile.key}>
                  {tile.kind === 'handler' && (
                    <GroupBox descriptor={tile.data.descriptor} api={tile.data.api} t={t} />
                  )}
                  {tile.kind === 'bb' && renderBollingerCard(
                    tile.data, t, addBbGroup, removeBbGroup, updateBbGroup, toggleBbGroupFlag, botPermInterval,
                  )}
                  {tile.kind === 'vwap' && renderVwapCard(t, vwap, setVwap, vwapSlopeHighlightOn, setVwapSlopeHighlightOn)}
                  {tile.kind === 'quickEma' && renderQuickEmaCard(
                    tile.data, t,
                    addQuickEmaGroup, removeQuickEmaGroup, updateQuickEmaGroupInterval, toggleQuickEmaGroupPeriod,
                    updateQuickEmaGroupBandPct, updateQuickEmaGroupBandPeriod,
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {!collapsed && collapseToggle}
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
      fontSize: efs(17, 'pct'),
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
        fontSize: efs(16, 'price'),
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
        label: { show: true, position: 'insideTop', formatter: pctLabel(targetPrice) + (targetConfig.simulated ? ' (simulado)' : ''), color: '#22c55e', fontSize: efs(15, 'oco'), fontWeight: 'bold' },
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
          label: { show: true, position: 'insideBottom', formatter: pctLabel(stopPrice) + (stopLossConfig.simulated ? ' (simulado)' : ''), color: '#ef4444', fontSize: efs(15, 'oco'), fontWeight: 'bold' },
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
        label: { show: true, position: 'inside', formatter: formatPctFromBase(entryPrice, exitPrice), color: labelColor, fontSize: efs(14, 'oco'), fontWeight: 'bold' },
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

const srPriceEq = (a, b) => a != null && b != null && Math.abs(a - b) / b < 1e-6;

function buildSrMarkLines(levels, entrySupport = null, exitResistance = null, showSupport = 3, showResistance = 3) {
  if (!levels?.length) return [];
  const maxTouches = Math.max(...levels.map(l => l.touches ?? 1));
  // Posto por proximidade do preço (R1 = resistência mais baixa, S1 = suporte mais alto) —
  // mesmo critério do efeito de S/R no LW (rankSrLevels).
  const rankOf = new Map();
  for (const type of ['resistance', 'support']) {
    (levels.filter(l => l.type === type)
      .sort((a, b) => (type === 'resistance' ? a.price - b.price : b.price - a.price)))
      .forEach((l, i) => rankOf.set(l, i + 1));
  }
  // "Mostrar" (showSupport/showResistance): filtra por posto.
  return levels.filter((l) => {
    const r = rankOf.get(l) ?? 1;
    return r <= (l.type === 'resistance' ? showResistance : showSupport);
  }).map(lvl => {
    const isRes = lvl.type === 'resistance';
    const rank = rankOf.get(lvl) ?? 1;
    const color = srLevelColor(isRes ? 'resistance' : 'support', rank - 1);
    const strengthRatio = (lvl.touches ?? 1) / maxTouches;
    // Suporte desenhado bem mais grosso que a resistência — é a linha de referência da entrada
    // no backtest de S/R, o usuário precisa localizá-la de relance.
    const baseWidth = isRes ? 1 : 3;
    // Linhas de referência do trade (ao abrir um trade das Estatísticas): entrada e alvo.
    const isEntry = srPriceEq(lvl.price, entrySupport);
    const isExit = srPriceEq(lvl.price, exitResistance);
    const tag = isEntry ? ' • entrada' : isExit ? ' • alvo' : '';
    return {
      yAxis: lvl.price,
      lineStyle: {
        color,
        width: (isEntry || isExit ? baseWidth + 2 : baseWidth) + Math.round(strengthRatio * 2),
        type: 'solid',
        opacity: (isEntry || isExit) ? 1 : 0.4 + strengthRatio * 0.45,
      },
      label: {
        show: true,
        formatter: `${isRes ? 'R' : 'S'}${rank} ${fmtChartPrice(lvl.price)} (${lvl.touches}x)${tag}`,
        color,
        fontSize: efs(14, 'price'),
        fontWeight: (isEntry || isExit) ? 'bold' : 'normal',
        position: 'end',
        padding: [2, 4],
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 2,
      },
    };
  });
}

/** Linhas verticais nos candles em que o RSI(14) do intervalo ESCOLHIDO cruzou PRA CIMA do
 *  "Limiar RSI" — mesmo gatilho de entrada do bot RSI Momentum. `crossTimes` = openTime (ms) já
 *  snapado pra grade do gráfico (ver chartRsiCrossTimes). Roxo, igual à cor do botão RSI. */
function buildRsiCrossMarkLines(crossTimes, candlesticks, DL, LEFT_PAD, threshold) {
  if (!crossTimes?.length) return [];
  const offset = candlesticks.length - DL;
  const set = new Set(crossTimes.map(Number));
  const out = [];
  for (let j = 0; j < DL; j++) {
    const c = candlesticks[offset + j];
    if (c && set.has(Number(c.openTime))) {
      out.push({
        xAxis: j + LEFT_PAD,
        lineStyle: { color: '#a78bfa', width: 1, type: 'solid', opacity: 0.55 },
        label: {
          show: true, formatter: `RSI ${threshold}`, color: '#a78bfa',
          fontSize: 8, position: 'insideEndBottom', padding: [1, 2],
        },
      });
    }
  }
  return out;
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

/** Liga os pivôs do ZigZag numa polilinha (mesmo mapeamento time→índice de candle exibido do
 *  buildPivotMarkers). Devolve { line, tentative }: `line` = pivôs confirmados; `tentative` = os
 *  dois pontos da perna final ainda não confirmada (do último pivô até o candle mais recente). */
function buildZigZagLine(zigzagConfig, candlesticks, DL, LEFT_PAD, chartInterval) {
  const pts = zigzagConfig?.points;
  if (!pts?.length || !candlesticks?.length) return { line: [], tentative: [] };
  const maxDiffMs = (INTERVAL_MS[chartInterval] ?? 900_000) * 1.5;
  const offset = candlesticks.length - DL;
  const mapPoint = (time, price) => {
    let best = 0;
    let bestDiff = Infinity;
    candlesticks.forEach((c, i) => {
      const d = Math.abs(Number(c.openTime) - time);
      if (d < bestDiff) { bestDiff = d; best = i; }
    });
    if (bestDiff > maxDiffMs) return null;
    const localIdx = best - offset;
    if (localIdx < 0 || localIdx >= DL) return null;
    return [localIdx + LEFT_PAD, price];
  };
  const line = pts.map((p) => mapPoint(p.time, p.price)).filter(Boolean);
  let tentative = [];
  const leg = zigzagConfig.lastLeg;
  if (leg?.from && leg?.to) {
    const a = mapPoint(leg.from.time, leg.from.price);
    const b = mapPoint(leg.to.time, leg.to.price);
    if (a && b) tentative = [a, b];
  }
  return { line, tentative };
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

function buildOption({ symbol, interval, candlesticks, ichimokuCloud, movingAverage, ma50, ma9, ma21, rsi }, colors, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = [], overlayConfigs = [], multitradeMarkers = [], chartLeftPad = CHART_LEFT_MARGIN, buyInfo = null, stopLossConfig = null, targetConfig = null, chartRightPad = CHART_PRICE_PAD + CHART_LEFT_MARGIN, bollingerConfig = null, srConfigs = [], pphlConfig = null, wfractalsConfig = null, zigzagConfig = null, vwapConfig = null, chopConfig = null, vwapSlopeHighlight = null, isMobile = false, bbPathEnabled = false, macdConfig = null, rsiCrossThreshold = 0, rsiCrossTimes = []) {
  const showMa9      = activeIndicators.includes('ma9');
  const showMa21     = activeIndicators.includes('ma21');
  const showMa50     = activeIndicators.includes('ma50');
  const showMa200    = activeIndicators.includes('ma200');
  const showIchimoku = activeIndicators.includes('ichimoku');
  const showPphl     = !!pphlConfig;      // PPHL/WF/ZZ viraram manipuladores caixa — gate pela config
  const showWfractals = !!wfractalsConfig;
  const showZigzag   = !!zigzagConfig;
  const showRsi      = activeIndicators.includes('rsi');
  const showRsi50    = activeIndicators.includes('rsi50');
  const showRsi80    = activeIndicators.includes('rsi80');
  const showChopZone = !!chopConfig; // CHOP virou manipulador caixa — gate pela config, não activeIndicators
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
  // Motor ECharts legado não desenha o S/R rolante — usa só os níveis da âncora mais recente de
  // cada instância. `srConfigs` = 1+ instâncias (ou 1 do override de trade das Estatísticas).
  const srMarkData = srConfigs.flatMap((cfg) => {
    const latest = cfg.rolling?.length ? cfg.rolling[cfg.rolling.length - 1].levels : cfg.levels;
    return buildSrMarkLines(latest, cfg.entrySupport, cfg.exitResistance, cfg.showSupport ?? 3, cfg.showResistance ?? 3);
  });
  const pivotMarkers = showPphl ? buildPivotMarkers(pphlConfig?.points, candlesticks, DL, LEFT_PAD, interval) : { highs: [], lows: [] };
  const wfractalsMarkers = showWfractals ? buildPivotMarkers(wfractalsConfig?.points, candlesticks, DL, LEFT_PAD, interval) : { highs: [], lows: [] };
  const zigzagLine = showZigzag ? buildZigZagLine(zigzagConfig, candlesticks, DL, LEFT_PAD, interval) : { line: [], tentative: [] };
  const signalMarkers = buildSignalMarkers(candlesticks, multitradeMarkers, DL, LEFT_PAD, interval);
  const rsiCrossMarkData = (showRsi && rsiCrossThreshold > 0)
    ? buildRsiCrossMarkLines(rsiCrossTimes, candlesticks, DL, LEFT_PAD, rsiCrossThreshold)
    : [];
  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData, ...mtMarkData, ...srMarkData, ...rsiCrossMarkData];

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
          color: '#111', fontSize: efs(isMobile ? 19 : 16, 'price'), fontWeight: 'bold',
          backgroundColor: '#facc15', padding: isMobile ? [4, 8] : [3, 6], borderRadius: 2,
        }
      }] : [])
    ]
  };

  const axisBase = (gridIndex) => ({
    gridIndex,
    type: 'category',
    data: xData,
    axisLine: { lineStyle: { color: colors.panel } },
    axisLabel: { color: colors.text, fontSize: 14, show: gridIndex === subpanelCount },
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
  const bbPathNodes = !bbPathEnabled ? [] : (
    bollingerConfig?.showPermFilter
      ? (bollingerConfig.permPathNodes ?? [])
      : (bollingerConfig?.points?.length ? simulateBbTouchPath(bollingerConfig.points) : [])
  );
  const bbPathSeriesList = bbPathEnabled
    ? buildBbTouchPathSeries(bbPathNodes, candlesticks, DL, LEFT_PAD, RIGHT_PAD, bollingerConfig)
    : [];
  const vwapSeries = buildVwapSeries(vwapConfig, candlesticks, alignSeries, vwapSlopeHighlight);

  // MACD (12/26/9) sobreposto no gráfico de preço — eixo Y próprio (esquerda), confinado à
  // faixa inferior do painel (min/max assimétricos: linha do zero fica ~25% acima da base) pra
  // não achatar os candles. Intervalo próprio, alinhado por candle igual ao CHOP.
  const showMacd = !!macdConfig; // MACD virou manipulador caixa — gate pela config
  const macdAbsVals = showMacd && macdConfig
    ? [...(macdConfig.macd ?? []), ...(macdConfig.signal ?? []), ...(macdConfig.histogram ?? [])]
        .map((p) => Math.abs(p.value)).filter(Number.isFinite)
    : [];
  const macdMaxAbs = macdAbsVals.length ? Math.max(...macdAbsVals) : 0;
  const macdEnabled = showMacd && macdMaxAbs > 0;
  const macdLineData   = macdEnabled ? alignSeries(alignPointsToCandles(candlesticks, macdConfig.macd ?? [])) : [];
  const macdSignalData = macdEnabled ? alignSeries(alignPointsToCandles(candlesticks, macdConfig.signal ?? [])) : [];
  const macdHistData   = macdEnabled ? alignSeries(alignPointsToCandles(candlesticks, macdConfig.histogram ?? [])) : [];
  const buildMacdSeries = (macdYIndex) => (!macdEnabled ? [] : [
    {
      name: `MACD hist@${macdConfig.interval}`,
      type: 'bar',
      xAxisIndex: 0, yAxisIndex: macdYIndex,
      data: macdHistData,
      barWidth: '55%',
      itemStyle: { color: (p) => (Number(p.data) >= 0 ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)') },
      z: 2,
    },
    {
      name: `MACD@${macdConfig.interval}`,
      type: 'line',
      xAxisIndex: 0, yAxisIndex: macdYIndex,
      data: macdLineData,
      showSymbol: false,
      lineStyle: { color: '#38bdf8', width: 1.5 },
      z: 3,
    },
    {
      name: `Sinal@${macdConfig.interval}`,
      type: 'line',
      xAxisIndex: 0, yAxisIndex: macdYIndex,
      data: macdSignalData,
      showSymbol: false,
      lineStyle: { color: '#f97316', width: 1.5 },
      z: 3,
    },
  ]);
  const macdYAxis = (gridIndex) => ({
    gridIndex,
    position: 'left',
    min: -macdMaxAbs * 1.15,
    max: macdMaxAbs * 1.15 * 4,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#38bdf8', fontSize: 8 },
    splitLine: { show: false },
  });

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
    ...(showWfractals && wfractalsMarkers.highs.length ? [{
      name: 'WF Alta',
      type: 'scatter',
      xAxisIndex: idx, yAxisIndex: idx,
      data: wfractalsMarkers.highs,
      symbol: 'diamond',
      symbolSize: 7,
      symbolOffset: [0, -8],
      itemStyle: { color: '#f472b6' },
      z: 5,
    }] : []),
    ...(showWfractals && wfractalsMarkers.lows.length ? [{
      name: 'WF Baixa',
      type: 'scatter',
      xAxisIndex: idx, yAxisIndex: idx,
      data: wfractalsMarkers.lows,
      symbol: 'diamond',
      symbolSize: 7,
      symbolOffset: [0, 8],
      itemStyle: { color: '#f472b6' },
      z: 5,
    }] : []),
    ...(showZigzag && zigzagLine.line.length >= 2 ? [{
      name: 'ZigZag',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: zigzagLine.line,
      showSymbol: true,
      symbolSize: 5,
      lineStyle: { color: '#818cf8', width: 1.5 },
      itemStyle: { color: '#818cf8' },
      z: 4,
      silent: true,
    }] : []),
    ...(showZigzag && zigzagLine.tentative.length === 2 ? [{
      name: 'ZigZag (tentativa)',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: zigzagLine.tentative,
      showSymbol: false,
      lineStyle: { color: '#818cf8', width: 1, type: 'dashed', opacity: 0.6 },
      z: 4,
      silent: true,
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
        axisLabel: { color: colors.text, fontSize: 14 },
        splitLine: { show: false } },
      yAxis: [
        { scale: true, position: 'right', splitNumber: 8,
          axisLine: { lineStyle: { color: colors.panel } },
          axisLabel: { color: colors.text, fontSize: efs(17, 'price'), ...(isMobile ? { formatter: fmtAxisPriceMobile } : {}) },
          splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
        ...(macdEnabled ? [macdYAxis(0)] : []),
      ],
      grid: { top: 40, bottom: 12, left: chartLeftPad, right: chartRightPad },
      dataZoom: zoomWindow
        ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct)
        : buildInsideDataZoom(),
      series: [...candleSeries(0), ...buildMacdSeries(1)],
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
              label: { formatter: '30', color: '#ef5350', fontSize: 6, position: 'end' } },
            { yAxis: 50, lineStyle: { color: '#ffffff', type: 'dashed', width: 1, opacity: 0.5 },
              label: { formatter: '50', color: '#ffffff', fontSize: 6, position: 'end' } },
            ...(showRsi50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.6 },
              label: { formatter: '50', color: '#facc15', fontSize: 6, position: 'end' } }] : []),
            { yAxis: 70, lineStyle: { color: '#26a69a', type: 'dashed', width: 1 },
              label: { formatter: '70', color: '#26a69a', fontSize: 6, position: 'end' } },
            ...(showRsi80 ? [{ yAxis: 80, lineStyle: { color: '#fb923c', type: 'dashed', width: 1 },
              label: { formatter: '80', color: '#fb923c', fontSize: 6, position: 'end' } }] : []),
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
    // RSI ganhou mais linhas de grade (10/20/40/60/90) — fonte menor pra não sobrepor números.
    axisLabel: { color: colors.text, fontSize: id === 'rsi' ? 6 : 9 },
    splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.2 } },
    // RSI a cada 10 (não 30) — mais linhas de referência pra ler o valor depois de dar zoom.
    interval: id === 'chopZone' ? 20 : 10,
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
      { gridIndex: 0, scale: true, position: 'right', splitNumber: 8,
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: efs(17, 'price'), ...(isMobile ? { formatter: fmtAxisPriceMobile } : {}) },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      ...subpanelIds.map((id, i) => subpanelYAxis(id, i + 1)),
      ...(macdEnabled ? [macdYAxis(0)] : []),
    ],
    dataZoom: zoomWindow
      ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct, dataZoomAxisIndex)
      : buildInsideDataZoom(dataZoomAxisIndex),
    series: [
      ...candleSeries(0),
      ...subpanelIds.map((id, i) => buildSubpanelSeries(id, i + 1)),
      ...buildMacdSeries(1 + subpanelCount),
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
  const { selectedChart, setSelectedChart, chartZoom, setChartZoom, chartTradeMarkers, chartViewSource, chartSrOverride,
    chartCandleWindowReset,
    multitradeChartFocus, tradePurchases, allTrades, chartInterval: savedInterval, setChartInterval,
    chartPanelButtons, uiPrefs, setMaBandsDefaults,
    setVwapDefaults, setVwapSlopeHighlightDefault, setActiveIndicatorsPreference,
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
  const [bbGroups, setBbGroups] = useState(loadBbGroups);
  // Manipuladores de indicador no padrão "caixa de grupos" (Bollinger/EMA) — um hook só pra todos.
  const handlers = useGroupedHandlers(HANDLER_GROUP_STORES);
  // max:1 — o grupo habilitado de cada manipulador de instância única.
  const chopGroup = handlers.chop?.groups.find((g) => g.enabled) ?? null;
  const macdGroup = handlers.macd?.groups.find((g) => g.enabled) ?? null;
  const barsSinceCrossGroup = handlers.barsSinceCross?.groups.find((g) => g.enabled) ?? null;
  const tdSequentialGroup = handlers.tdSequential?.groups.find((g) => g.enabled) ?? null;
  const pphlGroup = handlers.pphl?.groups.find((g) => g.enabled) ?? null;
  const wfractalsGroup = handlers.wfractals?.groups.find((g) => g.enabled) ?? null;
  const zigzagGroup = handlers.zigzag?.groups.find((g) => g.enabled) ?? null;
  // Nível do filtro PERM (1h/30m/15m) configurado no favorito Bollinger Bands do manipulador
  // (bot ao vivo) pra essa moeda — ver resolveBollingerBandsPermFilter (multitradeChart.js).
  // Usado tanto pelo botão PERM manual (renderBollingerCard) quanto pra ligar showPermFilter
  // sozinho no grupo auto-sincronizado (TRADE_BB_GROUP_ID, ver hasForcedBollinger abaixo).
  // null = sem favorito BB pra essa moeda, filtro desligado no bot, ou intervalo sem
  // equivalente aqui (4h, 2h, 5m…) — o botão PERM fica sem efeito nesse caso.
  const botPermInterval = useMemo(() => {
    const sym = selectedChart?.symbol;
    if (!sym) return null;
    const entry = getEntriesForSymbol(multitradeFavorites, sym).find(isBollingerBandsEntry) ?? null;
    return resolveBollingerBandsPermFilter(entry);
  }, [selectedChart?.symbol, multitradeFavorites]);
  const addBbGroup = useCallback(() => {
    setBbGroups((prev) => {
      if (prev.length >= MAX_BB_GROUPS) return prev;
      const next = [...prev, makeBbGroup()];
      saveBbGroups(next);
      return next;
    });
  }, []);
  const removeBbGroup = useCallback((id) => {
    setBbGroups((prev) => {
      const next = prev.filter((g) => g.id !== id);
      saveBbGroups(next);
      return next;
    });
  }, []);
  const updateBbGroup = useCallback((id, patch) => {
    setBbGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, ...patch } : g));
      saveBbGroups(next);
      return next;
    });
  }, []);
  // Liga/desliga um flag booleano do grupo (enabled/showUpper/showMiddle/showLower/showPath/
  // showMedianTrend/showPermFilter). Ligar showPath junto liga `enabled` também — senão o
  // usuário via só o path sem a referência visual das bandas (mesmo comportamento do botão
  // PATH antigo). Ligar showPermFilter liga showPath+enabled junto pelo mesmo motivo — o PERM
  // é uma variante filtrada do PATH (troca a fonte dos ciclos, não desenha nada sozinho).
  const toggleBbGroupFlag = useCallback((id, key) => {
    setBbGroups((prev) => {
      const next = prev.map((g) => {
        if (g.id !== id) return g;
        const value = !g[key];
        if (key === 'showPath' && value) return { ...g, showPath: true, enabled: true };
        if (key === 'showPermFilter' && value) return { ...g, showPermFilter: true, showPath: true, enabled: true };
        return { ...g, [key]: value };
      });
      saveBbGroups(next);
      return next;
    });
  }, []);
  // Overlay de Bollinger pedido pela aba Estatísticas (clique numa linha da lista) — mostra a
  // banda usada no cálculo daquela ocorrência como um grupo próprio (STATS_BB_GROUP_ID), sem
  // mexer nas bandas manuais que o usuário já tinha configurado no painel.
  useEffect(() => {
    if (!chartZoom?.bollinger) return;
    setBbGroups((prev) => {
      const withoutStats = prev.filter((g) => g.id !== STATS_BB_GROUP_ID);
      const group = makeBbGroup({
        id: STATS_BB_GROUP_ID,
        period: String(chartZoom.bollinger.period),
        stdDev: Number(chartZoom.bollinger.stdDev),
        interval: chartZoom.bollinger.interval,
      });
      return [group, ...withoutStats].slice(0, MAX_BB_GROUPS);
    });
  }, [chartZoom]);
  const [bollingerCache, setBollingerCache] = useState({});
  const [_bollingerLoading, setBollingerLoading] = useState(false);
  // Ciclos PATH pré-filtrados pelo PERM do manipulador (ver botPermInterval acima) — só
  // buscado pros grupos com showPermFilter ligado, chave `${period}-${stdDev}-${interval}-
  // ${botPermInterval}`. Ao contrário de bollingerCache (linhas superior/média/inferior,
  // calculadas no cliente por simulateBbTouchPath), esses ciclos vêm prontos do backend
  // (mesma rota /services/bollinger-band-recovery da aba Estatísticas — ver
  // backend/utils/analyseBollingerBandRecovery.js), já que reproduzir a nuvem PERM
  // (EMA9×EMA21) inteira no cliente duplicaria a lógica de backend/utils/emaPersistCloud.js.
  const [bbPermPathCache, setBbPermPathCache] = useState({});
  // S/R: multi-instância (handlers.sr). Cada instância tem intervalo/estilo/candleCount + quais
  // linhas calcular/mostrar. O rolling roda em chartSrConfigs (mais abaixo).
  const srGroups = handlers.sr?.groups ?? [];
  const enabledSrGroups = srGroups.filter((g) => g.enabled);
  // PPHL/WF/ZZ: intervalo + candleCount agora vivem no grupo do manipulador (handlers.pphl / .wfractals / .zigzag).
  // Candles brutos por intervalo próprio (S/R, PPHL, WF, ZigZag) — key `${symbol}|${interval}`.
  // O cálculo dos níveis roda no cliente (srDetectors.js) sobre a janela visível (janela
  // deslizante), ver os useMemo chartSrConfig/chartPphlConfig/... e visibleChartRange.
  const [pivotRawCache, setPivotRawCache] = useState({});
  const [_pivotRawLoading, setPivotRawLoading] = useState(false);
  // Limiar RSI: virou manipulador caixa (handlers.rsiCross). `rsiCrossThreshold` (0 = desligado) e
  // `rsiCrossInterval` são derivados do grupo habilitado — o resto do arquivo/motores usa eles
  // como antes. Só aparece com o subpainel RSI ligado (panelGate do descriptor).
  const rsiCrossGroup = handlers.rsiCross?.groups.find((g) => g.enabled) ?? null;
  // Trecho de TEMPO visível do gráfico (ms) — reportado pelos dois motores (LW via
  // subscribeVisibleTimeRangeChange, ECharts via evento dataZoom), com debounce.
  const [visibleChartRange, setVisibleChartRange] = useState(null);
  const visibleRangeDebounceRef = useRef(null);
  const reportVisibleRange = useCallback((range) => {
    if (visibleRangeDebounceRef.current) clearTimeout(visibleRangeDebounceRef.current);
    visibleRangeDebounceRef.current = setTimeout(() => setVisibleChartRange(range), 180);
  }, []);
  useEffect(() => {
    setVisibleChartRange(null);
    return () => { if (visibleRangeDebounceRef.current) clearTimeout(visibleRangeDebounceRef.current); };
  }, [selectedChart?.symbol, selectedChart?.interval]);
  // D-1: intervalo/candleCount/source agora vivem no grupo do manipulador (handlers.prevDayCloud).
  const prevDayCloudGroup = handlers.prevDayCloud?.groups.find((g) => g.enabled) ?? null;
  // Cache por símbolo + intervalo (1d/3d) — ver prevDayCloudEffectiveInterval.
  const [prevDayCloudCache, setPrevDayCloudCache] = useState({});
  // CHOP/MACD: intervalo agora vive no grupo do manipulador (handlers.chop / handlers.macd).
  const [chopCache, setChopCache] = useState({});
  const [_chopLoading, setChopLoading] = useState(false);
  const [macdCache, setMacdCache] = useState({});
  const [_macdLoading, setMacdLoading] = useState(false);
  // PERM: intervalo/tons/camadas agora vivem no grupo do manipulador (handlers.emaPersistCloud).
  const emaPersistCloudGroup = handlers.emaPersistCloud?.groups.find((g) => g.enabled) ?? null;
  const emaPersistCloudInterval = emaPersistCloudGroup?.interval ?? DEFAULT_EMA_PERSIST_CLOUD_INTERVAL;
  const emaPersistCloudTones = emaPersistCloudGroup?.tones ?? DEFAULT_PERM_CLOUD_TONES;
  const emaPersistCloudLayers = emaPersistCloudGroup?.layers ?? DEFAULT_EMA_PERSIST_CLOUD_LAYERS;
  const [emaPersistCloudCache, setEmaPersistCloudCache] = useState({});
  const [_emaPersistCloudLoading, setEmaPersistCloudLoading] = useState(false);
  // Dados do intervalo de confirmação da nuvem verde (ex.: 15m quando emaPersistCloudInterval é
  // 1h — ver EMA_PERSIST_CLOUD_CONFIRM_INTERVAL). Cache separado, mesma chave (intervalo principal).
  const [emaPersistCloudConfirmCache, setEmaPersistCloudConfirmCache] = useState({});
  // Dados de mais um nível de confirmação (3ª nuvem, só quando emaPersistCloudLayers === 3).
  const [emaPersistCloudConfirm2Cache, setEmaPersistCloudConfirm2Cache] = useState({});
  // Bars×/TD Seq: intervalo agora vive no grupo do manipulador (handlers.barsSinceCross / .tdSequential).
  const [barsSinceCrossCache, setBarsSinceCrossCache] = useState({});
  const [_barsSinceCrossLoading, setBarsSinceCrossLoading] = useState(false);
  const [tdSequentialCache, setTdSequentialCache] = useState({});
  const [_tdSequentialLoading, setTdSequentialLoading] = useState(false);
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
  const [displayCandleCount, setDisplayCandleCount] = useState(() => uiPrefs.candleCountDisplayDefault ?? DEFAULT_DISPLAY_CANDLE_COUNT);
  // Último preset da toolbar (10/20/40/80/160/320) escolhido explicitamente pelo usuário — ao
  // contrário de displayCandleCount, NÃO muda quando "carregar mais" (+500/+1000) é usado, pra
  // esse carregamento extra ficar restrito à moeda atual em vez de "vazar" pra próxima moeda
  // selecionada (ver lastPresetCandleCount abaixo).
  const [lastPresetCandleCount, setLastPresetCandleCount] = useState(() => uiPrefs.candleCountDisplayDefault ?? DEFAULT_DISPLAY_CANDLE_COUNT);
  const [hasExplicitCandleWindow, setHasExplicitCandleWindow] = useState(true);
  const [loadingMoreCandles, setLoadingMoreCandles] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState(null);
  const [measureOneShot, setMeasureOneShot] = useState(false);
  const measureClearTimeoutRef = useRef(null);
  // Caixa de análise: o usuário arrasta um retângulo sobre alguns candles pra rodar a
  // detecção de bandeiras SÓ naquele trecho (ver chartFlagsConfig). `analysisBox` guarda a
  // seleção efetivada {fromMs,toMs,priceLow,priceHigh}; `analysisDrag` é o preview em pixels
  // enquanto arrasta. Só no motor TradingView (as bandeiras já são LW-only).
  const [analysisBoxMode, setAnalysisBoxMode] = useState(false);
  const [analysisBox, setAnalysisBox] = useState(null);
  const [analysisDrag, setAnalysisDrag] = useState(null);

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
    // A caixa de análise é presa a candles de um símbolo/intervalo específico — descarta ao trocar.
    setAnalysisBoxMode(false);
    setAnalysisBox(null);
    setAnalysisDrag(null);
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
    // Se esse fetch for cancelado (ex.: troca de intervalo no meio do caminho), desliga a flag
    // aqui — sem isso, quando a nova execução do efeito cai no `return undefined` antecipado
    // acima (janela padrão do novo intervalo já cobre displayCandleCount), ninguém liga nem
    // desliga loadingMoreCandles de novo e ela fica travada em `true` pra sempre, desabilitando
    // os botões de quantidade de candles e bloqueando o gatilho de "carregar mais" ao arrastar
    // o gráfico pra trás (loadingMoreCandlesRef em CandlestickChartLW.jsx).
    return () => { cancelled = true; setLoadingMoreCandles(false); };
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
  // próprio bot) no chart como um grupo próprio (TRADE_BB_GROUP_ID) — mesma ideia do
  // TRADE_EMA_GROUP_ID do Quick EMA (ver efeito hasForcedQuickEma abaixo), sem mexer nas bandas
  // manuais que o usuário já tinha configurado no painel. Assim, ao selecionar uma moeda BB
  // rodando em 5m e outra em 1m, o gráfico E a banda acompanham o intervalo configurado de cada
  // uma, não o intervalo manual do painel (tile "BB"). Também vale pra CHART_VIEW.TABLE: é o
  // view usado ao selecionar uma moeda comum sob um filtro de largura de Bollinger (ex.:
  // 15m|bbwidth|20|2|100 — ver isBbWidthFilter em CurrencyTable), que reaproveita o mesmo
  // bollingerOverride pra forçar a banda do próprio filtro em vez de um favorito.
  const hasForcedBollinger = (isTradePanelChartView(chartViewSource) || chartViewSource === CHART_VIEW.TABLE)
    && !!multitradeChartFocus?.bollingerOverride;
  useEffect(() => {
    setBbGroups((prev) => {
      const withoutAuto = prev.filter((g) => g.id !== TRADE_BB_GROUP_ID);
      if (!hasForcedBollinger) {
        return withoutAuto.length === prev.length ? prev : withoutAuto;
      }
      const ov = multitradeChartFocus.bollingerOverride;
      const group = makeBbGroup({
        id: TRADE_BB_GROUP_ID,
        interval: ov.interval,
        period: String(ov.period),
        stdDev: Number(ov.stdDev),
        // PATH + tendência da mediana também ligados de cara — o usuário quer ver de imediato
        // como o bot está simulando os ciclos e a tendência que alimenta o filtro dele, sem
        // precisar clicar em nada. PERM entra junto quando o próprio bot dessa moeda tem o
        // filtro PERM ligado num nível com equivalente aqui (ver botPermInterval acima) — o
        // ciclo mostrado passa a ser exatamente o que o bot real teria aceitado.
        showPath: true,
        showMedianTrend: true,
        showPermFilter: !!botPermInterval,
      });
      return [group, ...withoutAuto].slice(0, MAX_BB_GROUPS);
    });
  }, [hasForcedBollinger, multitradeChartFocus?.bollingerOverride, botPermInterval]);

  // Na primeira renderização, o gráfico abre com os indicadores marcados como "habilitado por
  // padrão" em Configurações → Botões do gráfico (uiPrefs.defaultActiveIndicators) — ignora
  // qualquer estado ativo de uma sessão anterior (persistido em localStorage). Só entra o que
  // ainda está visível (chartPanelButtons). Precisa rodar DEPOIS do efeito "favorito vwap-bands"
  // acima: ele também copia uiPrefs.vwapDefaults pro estado local no mount (ramo `else`), e como
  // todo useEffect do primeiro commit ainda lê o uiPrefs "velho" (a normalização abaixo só é
  // aplicada no PRÓXIMO render), rodar antes deste ponto perdia a corrida — o valor antigo
  // (enabled: true) sobrescrevia de volta por cima. Ficando depois, esta é a última escrita do
  // commit e vence.
  useEffect(() => {
    const defaults = uiPrefs.defaultActiveIndicators ?? {};
    const initialIndicators = VALID_ACTIVE_INDICATORS.filter(
      (key) => defaults[key] && chartPanelButtons[key] !== false,
    );
    const sameAsInitial = activeIndicators.length === initialIndicators.length
      && activeIndicators.every((id) => initialIndicators.includes(id));
    if (!sameAsInitial) setActiveIndicatorsPreference(initialIndicators);
    setBbGroups((prev) => {
      if (!prev.some((g) => g.enabled || g.showPath || g.showMedianTrend || g.showPermFilter)) return prev;
      const next = prev.map((g) => ({ ...g, enabled: false, showPath: false, showMedianTrend: false, showPermFilter: false }));
      saveBbGroups(next);
      return next;
    });
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

  // S/R, PPHL/WF/ZZ, Limiar RSI, CHOP/MACD: persistência agora no store do manipulador
  // (localStorage direto, ver groupStore).

  // D-1: persistência agora no store do manipulador (localStorage direto, ver groupStore).

  // PERM, Bars×/TD Seq: persistência agora no store do manipulador (localStorage direto, ver groupStore).

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

  // Busca as séries de Bandas de Bollinger (upper/middle/lower) — uma por combinação única de
  // período/desvio/intervalo entre os grupos habilitados do painel (mesmo padrão do efeito de
  // overlayMaCache/quickEmaGroups acima). Um grupo entra na busca mesmo só com PATH ou a
  // tendência da mediana ligados (sem as linhas BB), pra simular toques lower→upper / calcular
  // a tendência da linha mediana.
  useEffect(() => {
    const bbNeeded = chartPanelButtons.bb !== false
      ? bbGroups.filter((g) => g.enabled || g.showPath || g.showMedianTrend || g.showPermFilter)
      : [];
    if (!selectedChart?.symbol || !bbNeeded.length) {
      setBollingerCache({});
      setBollingerLoading(false);
      return undefined;
    }
    const toFetch = [];
    for (const g of bbNeeded) {
      const key = `${g.period}-${g.stdDev}-${g.interval}`;
      if (toFetch.some((f) => f.key === key)) continue;
      toFetch.push({ key, period: g.period, stdDev: g.stdDev, interval: g.interval });
    }
    let cancelled = false;
    setBollingerLoading(true);
    (async () => {
      const next = {};
      await Promise.all(toFetch.map(async ({ key, period, stdDev, interval }) => {
        try {
          const ovLimit = computeOverlayMaFetchLimit(
            selectedChart.interval ?? currentInterval,
            interval,
            period,
            Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
            overlayFetchLimit,
          );
          const points = await fetchBollingerOverlayPoints(
            selectedChart.symbol, interval, period, stdDev, selectedChart.source, ovLimit,
          );
          next[key] = points;
          if (points.length > 1) {
            const expectedGapMs = INTERVAL_MS[interval] ?? null;
            const actualGapMs = points[points.length - 1].openTime - points[points.length - 2].openTime;
            if (expectedGapMs != null && actualGapMs !== expectedGapMs) {
              console.warn(
                `[BollingerBands] ${selectedChart.symbol} — intervalo entre candles não bate com "${interval}"`
                + ` — esperado ${expectedGapMs}ms, veio ${actualGapMs}ms.`,
              );
            }
          }
        } catch (e) {
          console.warn('[bollingerBands]', key, e.message);
        }
      }));
      if (!cancelled) {
        setBollingerCache(next);
        setBollingerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    bbGroups, selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, chartPanelButtons.bb,
  ]);

  // Busca os ciclos PATH pré-filtrados pelo PERM do manipulador (ver bbPermPathCache acima) —
  // só roda pros grupos com showPermFilter ligado, e só quando a moeda atual tem um favorito
  // Bollinger Bands com PERM habilitado num nível com equivalente aqui (botPermInterval).
  useEffect(() => {
    const needed = chartPanelButtons.bb !== false ? bbGroups.filter((g) => g.showPermFilter) : [];
    if (!selectedChart?.symbol || !needed.length || !botPermInterval) {
      setBbPermPathCache({});
      return undefined;
    }
    const toFetch = [];
    for (const g of needed) {
      const key = `${g.period}-${g.stdDev}-${g.interval}-${botPermInterval}`;
      if (toFetch.some((f) => f.key === key)) continue;
      toFetch.push({ key, period: g.period, stdDev: g.stdDev, interval: g.interval });
    }
    const permFilterParam = {
      h1: botPermInterval === 'h1', m30: botPermInterval === 'm30', m15: botPermInterval === 'm15',
    };
    let cancelled = false;
    (async () => {
      const next = {};
      await Promise.all(toFetch.map(async ({ key, period, stdDev, interval }) => {
        try {
          const ovLimit = computeOverlayMaFetchLimit(
            selectedChart.interval ?? currentInterval,
            interval,
            Number(period),
            Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
            overlayFetchLimit,
          );
          const data = await fetchBollingerBandRecovery(
            selectedChart.symbol, interval, Number(period), Number(stdDev), selectedChart.source,
            false, 10, 0, ovLimit, permFilterParam,
          );
          next[key] = occurrencesToBbPathNodes(data);
        } catch (e) {
          console.warn('[bollingerBandsPerm]', key, e.message);
        }
      }));
      if (!cancelled) setBbPermPathCache(next);
    })();
    return () => { cancelled = true; };
  }, [
    bbGroups, selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, chartPanelButtons.bb, botPermInterval,
  ]);

  // S/R, PPHL, Williams Fractals e ZigZag — todos calculados NO CLIENTE (srDetectors.js) sobre a
  // janela deslizante do trecho visível (ver os useMemo chartSrConfig/... e visibleChartRange).
  // Este efeito só garante que `pivotRawCache` tem candles brutos suficientes do intervalo próprio
  // de cada indicador ligado (deduplicado por intervalo — se dois usam 4h, um fetch só). O `limit`
  // cresce junto com o histórico carregado do gráfico (arrastar pra trás), igual à Bollinger.
  // Ao abrir um trade das Estatísticas com S/R, desenha o S/R do backtest mesmo com o botão
  // "S/R" desligado — faz parte do trade (ver chartSrOverride).
  const srTradeOverride = chartViewSource === CHART_VIEW.STATISTICS && !!chartSrOverride?.levels?.length;
  const pphlShown = !!pphlGroup && chartPanelButtons.pphl !== false;
  const wfractalsShown = !!wfractalsGroup && chartPanelButtons.wfractals !== false;
  const zigzagShown = !!zigzagGroup && chartPanelButtons.zigzag !== false;

  // Linha vertical do "Limiar RSI": precisa dos candles brutos do intervalo escolhido pra calcular
  // o RSI(14) no cliente (o `selectedChart.rsi` é só do intervalo do gráfico e das últimas ~166
  // velas). Reutiliza o mesmo cache/fetch dos pivôs.
  const rsiCrossShown = !!rsiCrossGroup && activeIndicators.includes('rsi');
  const rsiCrossThreshold = rsiCrossShown ? Number(rsiCrossGroup.value) : 0; // 0 = desligado
  const rsiCrossInterval = rsiCrossGroup?.interval ?? DEFAULT_RSI_CROSS_INTERVAL;

  const srIntervalsKey = enabledSrGroups.map((g) => g.interval).sort().join(',');
  const pivotIntervalsNeeded = useMemo(() => {
    const set = new Set();
    if (srTradeOverride && chartSrOverride?.interval) set.add(chartSrOverride.interval);
    for (const g of enabledSrGroups) set.add(g.interval);
    if (pphlShown) set.add(pphlGroup.interval);
    if (wfractalsShown) set.add(wfractalsGroup.interval);
    if (zigzagShown) set.add(zigzagGroup.interval);
    if (rsiCrossShown) set.add(rsiCrossInterval);
    return [...set];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srTradeOverride, chartSrOverride?.interval, srIntervalsKey, pphlShown, wfractalsShown, zigzagShown, rsiCrossShown, pphlGroup?.interval, wfractalsGroup?.interval, zigzagGroup?.interval, rsiCrossInterval]);

  useEffect(() => {
    if (!selectedChart?.symbol || !pivotIntervalsNeeded.length) {
      setPivotRawLoading(false);
      return undefined;
    }
    const chartIv = selectedChart.interval ?? currentInterval;
    const chartSpan = Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT);
    let cancelled = false;
    const toFetch = pivotIntervalsNeeded
      .map((iv) => {
        const key = `${selectedChart.symbol}|${iv}`;
        const needed = Math.min(1500, computeOverlayMaFetchLimit(chartIv, iv, 10, chartSpan, overlayFetchLimit));
        const have = pivotRawCache[key];
        return { iv, key, needed, stale: !have || have.limit < needed };
      })
      .filter((x) => x.stale);
    if (!toFetch.length) return undefined;
    setPivotRawLoading(true);
    (async () => {
      const next = {};
      await Promise.all(toFetch.map(async ({ iv, key, needed }) => {
        try {
          const candles = await fetchPivotRawCandles(selectedChart.symbol, iv, selectedChart.source, needed);
          next[key] = { candles, limit: needed };
        } catch (e) {
          console.warn('[pivot-raw]', key, e.message);
        }
      }));
      if (!cancelled && Object.keys(next).length) {
        setPivotRawCache((prev) => ({ ...prev, ...next }));
      }
      if (!cancelled) setPivotRawLoading(false);
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.source, selectedChart?.interval, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, pivotIntervalsNeeded, pivotRawCache,
  ]);

  // Busca os candles (ver prevDayCloudInterval) pra nuvem D-1 — botão "D-1" do painel. Refaz
  // quando o gráfico carrega mais candles (arrastar pra trás via onNeedOlderCandles) pra cobrir
  // os candles mais antigos também — ver computePrevDayCloudFetchLimit. Nem todo intervalo existe
  // nativamente na Gate.io (ver GATE_PREV_DAY_CLOUD_INTERVALS/CLAUDE.md): com source='gate' e um
  // intervalo não suportado lá, o efetivo cai pra '1d'.
  const prevDayCloudShown = !!prevDayCloudGroup && chartPanelButtons.prevDayCloud !== false;
  const prevDayCloudInterval = prevDayCloudGroup?.interval ?? DEFAULT_PREV_DAY_CLOUD_INTERVAL;
  const prevDayCloudCandleCount = prevDayCloudGroup?.candleCount ?? DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT;
  const prevDayCloudUseHighLow = prevDayCloudGroup?.source !== 'oc';
  const prevDayCloudEffectiveInterval = (selectedChart?.source === 'gate' && !GATE_PREV_DAY_CLOUD_INTERVALS.includes(prevDayCloudInterval))
    ? '1d'
    : prevDayCloudInterval;
  useEffect(() => {
    if (!selectedChart?.symbol || !prevDayCloudShown) return undefined;
    const key = `${selectedChart.symbol}|${prevDayCloudEffectiveInterval}`;
    const limit = computePrevDayCloudFetchLimit(
      selectedChart.interval ?? currentInterval,
      Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
      prevDayCloudEffectiveInterval,
      prevDayCloudCandleCount,
    );
    let cancelled = false;
    (async () => {
      try {
        const candles = await fetchPrevDayCloudCandles(
          selectedChart.symbol, selectedChart.source, limit, prevDayCloudEffectiveInterval,
        );
        if (!cancelled) setPrevDayCloudCache((prev) => ({ ...prev, [key]: candles }));
      } catch (e) {
        console.warn('[prevDayCloud]', key, e.message);
        if (!cancelled) setPrevDayCloudCache((prev) => ({ ...prev, [key]: [] }));
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, displayCandleCount, prevDayCloudShown, prevDayCloudEffectiveInterval, prevDayCloudCandleCount,
  ]);

  // Busca o Choppiness Index — intervalo próprio (independente do gráfico), mesmo padrão do S/R/PPHL.
  const chopShown = !!chopGroup && chartPanelButtons.chopZone !== false;
  useEffect(() => {
    if (!selectedChart?.symbol || !chopShown) {
      setChopLoading(false);
      return undefined;
    }
    const key = chopGroup.interval;
    let cancelled = false;
    setChopLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          chopGroup.interval,
          14,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const points = await fetchChopOverlayPoints(
          selectedChart.symbol, chopGroup.interval, selectedChart.source, ovLimit,
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
    currentInterval, overlayFetchLimit, displayCandleCount, chopShown, chopGroup?.interval,
  ]);

  // Busca o MACD (12/26/9) — intervalo próprio (independente do gráfico), mesmo padrão do CHOP.
  const macdShown = !!macdGroup && chartPanelButtons.macd !== false;
  useEffect(() => {
    if (!selectedChart?.symbol || !macdShown) {
      setMacdLoading(false);
      return undefined;
    }
    const key = macdGroup.interval;
    let cancelled = false;
    setMacdLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          macdGroup.interval,
          35, // warmup MACD: slow(26) + signal(9)
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const data = await fetchMacdOverlayPoints(
          selectedChart.symbol, macdGroup.interval, selectedChart.source, ovLimit,
        );
        if (!cancelled) setMacdCache({ [key]: data });
      } catch (e) {
        console.warn('[macd]', key, e.message);
        if (!cancelled) setMacdCache({});
      } finally {
        if (!cancelled) setMacdLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, macdShown, macdGroup?.interval,
  ]);

  // Busca candles + EMA9/21 pra nuvem PERM (inclinação EMA9) — intervalo próprio (independente
  // do gráfico), mesmo padrão do S/R/PPHL/CHOP. 3 switches independentes em emaPersistCloudLayers
  // controlam o que é DESENHADO (ver renderPermIntervalTile/buildEmaCrossPersistenceClouds):
  // layer1 é o próprio intervalo principal, layer2 o de confirmação (ex.: 1h → 30m), layer3 mais
  // um nível abaixo (ex.: 1h → 30m → 15m). O intervalo de confirmação (layer2) é SEMPRE buscado
  // — mesmo com o switch desligado na tela — porque também é usado pra confirmar/esmaecer o
  // layer1 (ver isBullishConfirmedAt); só o de layer3 é opcional de buscar, já que só serve pra
  // desenho (ver EMA_PERSIST_CLOUD_CONFIRM_INTERVAL).
  const emaPersistCloudShown = !!emaPersistCloudGroup && chartPanelButtons.emaPersistCloud !== false;
  const emaPersistCloudConfirmInterval = getEmaPersistCloudConfirmInterval(emaPersistCloudInterval);
  const emaPersistCloudConfirm2IntervalRaw = emaPersistCloudConfirmInterval
    ? getEmaPersistCloudConfirmInterval(emaPersistCloudConfirmInterval) : null;
  const emaPersistCloudConfirm2Interval = emaPersistCloudLayers?.layer3 ? emaPersistCloudConfirm2IntervalRaw : null;
  useEffect(() => {
    if (!selectedChart?.symbol || !emaPersistCloudShown) {
      setEmaPersistCloudLoading(false);
      return undefined;
    }
    const key = emaPersistCloudInterval;
    let cancelled = false;
    setEmaPersistCloudLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          emaPersistCloudInterval,
          21,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const fetches = [fetchEmaCrossOverlayData(
          selectedChart.symbol, emaPersistCloudInterval, selectedChart.source, ovLimit,
        )];
        if (emaPersistCloudConfirmInterval) {
          const confirmLimit = computeOverlayMaFetchLimit(
            selectedChart.interval ?? currentInterval,
            emaPersistCloudConfirmInterval,
            21,
            Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
            overlayFetchLimit,
          );
          fetches.push(fetchEmaCrossOverlayData(
            selectedChart.symbol, emaPersistCloudConfirmInterval, selectedChart.source, confirmLimit,
          ));
        }
        if (emaPersistCloudConfirm2Interval) {
          const confirm2Limit = computeOverlayMaFetchLimit(
            selectedChart.interval ?? currentInterval,
            emaPersistCloudConfirm2Interval,
            21,
            Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
            overlayFetchLimit,
          );
          fetches.push(fetchEmaCrossOverlayData(
            selectedChart.symbol, emaPersistCloudConfirm2Interval, selectedChart.source, confirm2Limit,
          ));
        }
        const [data, confirmData, confirmData2] = await Promise.all(fetches);
        if (cancelled) return;
        setEmaPersistCloudCache({ [key]: data });
        setEmaPersistCloudConfirmCache(emaPersistCloudConfirmInterval ? { [key]: confirmData } : {});
        setEmaPersistCloudConfirm2Cache(emaPersistCloudConfirm2Interval ? { [key]: confirmData2 } : {});
      } catch (e) {
        console.warn('[emaPersistCloud]', key, e.message);
        if (!cancelled) {
          setEmaPersistCloudCache({});
          setEmaPersistCloudConfirmCache({});
          setEmaPersistCloudConfirm2Cache({});
        }
      } finally {
        if (!cancelled) setEmaPersistCloudLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, emaPersistCloudShown, emaPersistCloudInterval,
    emaPersistCloudConfirmInterval, emaPersistCloudConfirm2Interval,
  ]);

  // Busca candles + EMA9/21 pro Bars Since MA Cross (BARS) — mesmo padrão acima.
  const barsSinceCrossShown = !!barsSinceCrossGroup && chartPanelButtons.barsSinceCross !== false;
  useEffect(() => {
    if (!selectedChart?.symbol || !barsSinceCrossShown) {
      setBarsSinceCrossLoading(false);
      return undefined;
    }
    const key = barsSinceCrossGroup.interval;
    let cancelled = false;
    setBarsSinceCrossLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          barsSinceCrossGroup.interval,
          21,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const data = await fetchEmaCrossOverlayData(
          selectedChart.symbol, barsSinceCrossGroup.interval, selectedChart.source, ovLimit,
        );
        if (!cancelled) setBarsSinceCrossCache({ [key]: data });
      } catch (e) {
        console.warn('[barsSinceCross]', key, e.message);
        if (!cancelled) setBarsSinceCrossCache({});
      } finally {
        if (!cancelled) setBarsSinceCrossLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, barsSinceCrossShown, barsSinceCrossGroup?.interval,
  ]);

  // Busca só os candles pro TD Sequential (TD SEQ) — não precisa de EMA, mesmo padrão acima.
  const tdSequentialShown = !!tdSequentialGroup && chartPanelButtons.tdSequential !== false;
  useEffect(() => {
    if (!selectedChart?.symbol || !tdSequentialShown) {
      setTdSequentialLoading(false);
      return undefined;
    }
    const key = tdSequentialGroup.interval;
    let cancelled = false;
    setTdSequentialLoading(true);
    (async () => {
      try {
        const ovLimit = computeOverlayMaFetchLimit(
          selectedChart.interval ?? currentInterval,
          tdSequentialGroup.interval,
          10,
          Math.max(displayCandleCount, selectedChart.candlesticks?.length ?? 0, DEFAULT_CANDLE_LIMIT),
          overlayFetchLimit,
        );
        const candlesticks = await fetchIntervalCandlesOnly(
          selectedChart.symbol, tdSequentialGroup.interval, selectedChart.source, ovLimit,
        );
        if (!cancelled) setTdSequentialCache({ [key]: candlesticks });
      } catch (e) {
        console.warn('[tdSequential]', key, e.message);
        if (!cancelled) setTdSequentialCache({});
      } finally {
        if (!cancelled) setTdSequentialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks,
    currentInterval, overlayFetchLimit, displayCandleCount, tdSequentialShown, tdSequentialGroup?.interval,
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

    // Overlays desenhados sobre o candle (EMA, Ichimoku, S/R, PPHL, SL, Bollinger, Quick EMA,
    // VWAP) ficam presos ao intervalo em que foram buscados — trocar o intervalo pelos botões
    // do gráfico limpa esses overlays. RSI/CHOP continuam: abrem em subpainel próprio, que já
    // recalcula sozinho pro novo intervalo.
    const keptIndicators = activeIndicators.filter((id) => INTERVAL_CHANGE_KEEP_INDICATORS.has(id));
    if (keptIndicators.length !== activeIndicators.length) {
      setActiveIndicatorsPreference(keptIndicators);
    }
    // Manipuladores caixa sem intervalo próprio recalculável (descriptor.keepOnIntervalChange:false)
    // são desligados na troca de intervalo — mesmo motivo dos overlays.
    for (const d of HANDLER_DESCRIPTORS) {
      if (d.keepOnIntervalChange === false) handlers[d.id]?.disableAll();
    }
    setBbGroups((prev) => {
      if (!prev.some((g) => g.enabled || g.showPath || g.showMedianTrend || g.showPermFilter)) return prev;
      const next = prev.map((g) => ({ ...g, enabled: false, showPath: false, showMedianTrend: false, showPermFilter: false }));
      saveBbGroups(next);
      return next;
    });
    setQuickEmaGroups((prev) => {
      if (!prev.some((g) => g.periods.length || g.bandPeriod)) return prev;
      const next = prev.map((g) => ({ ...g, periods: [], bandPeriod: null }));
      saveQuickEmaGroups(next);
      return next;
    });
    if (vwap.enabled) {
      setVwap((prev) => ({ ...prev, enabled: false }));
      setVwapDefaults({ enabled: false });
    }
    if (vwapSlopeHighlightOn) {
      setVwapSlopeHighlightOn(false);
      setVwapSlopeHighlightDefault({ enabled: false });
    }

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

    // Gráfico ANCORADO num trade específico (ver openOnChart em StatisticsPanel.jsx — trade do
    // Momentum RSI, com ou sem reforço no stop): "carregar mais" tem que ALARGAR a MESMA âncora
    // (mais candles de folga pra cada lado de fromMs/toMs), nunca trocar pra "últimos N até
    // agora" (fetchCandlesticksAndCloud sem `anchor`) — isso substituiria a janela do trade
    // inteira por candles recentes sem relação nenhuma com ele; o corte abrupto entre os dois
    // períodos (timestamps não contínuos) é o que fazia o gráfico "quebrar" ao arrastar (poucos
    // candles giantes, sem sentido, até dar zoom in de novo).
    if (selectedChart.anchor) {
      const currentPad = Math.max(100, Number(selectedChart.anchor.pad) || 100);
      const nextPad = Math.min(2000, currentPad * 2);
      if (nextPad <= currentPad) return; // já no teto de folga
      setLoadingMoreCandles(true);
      try {
        const data = await fetchCandlesticksAndCloud(
          selectedChart.symbol,
          selectedChart.interval ?? currentInterval,
          selectedChart.source ?? null,
          undefined,
          { fromMs: selectedChart.anchor.fromMs, toMs: selectedChart.anchor.toMs, pad: nextPad },
        );
        setSelectedChart(data);
        setDisplayCandleCount(data.candlesticks?.length ?? currentLen);
        setHasExplicitCandleWindow(true);
      } finally {
        setLoadingMoreCandles(false);
      }
      return;
    }

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
    setAnalysisBoxMode(false);
    setAnalysisDrag(null);
  }

  // Igual ao toggle normal, mas a medição se desliga sozinha assim que o arraste termina,
  // e o resultado some sozinho ~2s depois (ver onEnd em handleMeasureStart).
  function toggleMeasureModeOnce() {
    clearMeasureAutoHide();
    setAnalysisBoxMode(false);
    setAnalysisDrag(null);
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

  function toggleAnalysisBoxMode() {
    setAnalysisBoxMode((v) => !v);
    setAnalysisDrag(null);
    clearMeasureAutoHide();
    setMeasureMode(false);
    setMeasurePoints(null);
    setMeasureOneShot(false);
  }

  function clearAnalysisBox() {
    setAnalysisBoxMode(false);
    setAnalysisBox(null);
    setAnalysisDrag(null);
  }

  // Arrasto da caixa de análise — mesma mecânica do handleMeasureStart, mas o que interessa é
  // a FAIXA DE TEMPO (openTime dos candles nas bordas) e a faixa de preço. Snapa nos candles
  // pra "últimos 50 candles" sair uma seleção limpa. Ao soltar, vira `analysisBox` e o modo
  // desliga (one-shot) — clique no botão de novo pra redesenhar.
  function handleAnalysisBoxStart(e) {
    if (!analysisBoxMode) return;
    const wrap = chartWrapRef.current;
    if (!wrap || !(showLwChart && lwChartRef.current)) return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const point = e.touches?.length ? e.touches[0] : e;
    const startX = point.clientX - rect.left;
    const startY = point.clientY - rect.top;
    setAnalysisDrag({ x1: startX, y1: startY, x2: startX, y2: startY });

    const onMove = (ev) => {
      const p = ev.touches?.length ? ev.touches[0] : ev;
      setAnalysisDrag((prev) => (prev ? { ...prev, x2: p.clientX - rect.left, y2: p.clientY - rect.top } : prev));
    };
    const onEnd = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      setAnalysisDrag((drag) => {
        if (!drag) return null;
        const candles = selectedChart?.candlesticks ?? [];
        const firstT = candles.length ? Number(candles[0].openTime) : NaN;
        const lastT = candles.length ? Number(candles[candles.length - 1].openTime) : NaN;
        const midX = (rect.width) / 2;
        // openTime da vela na borda — se cair fora do range (arrastou além da última vela),
        // clampa na ponta pro lado do arrasto.
        const edgeTime = (x) => {
          const c = candleAtPixelX(x);
          if (c) return c.openTime;
          return x < midX ? firstT : lastT;
        };
        const tA = edgeTime(drag.x1);
        const tB = edgeTime(drag.x2);
        const pA = priceAtPixelY(drag.y1);
        const pB = priceAtPixelY(drag.y2);
        if (!Number.isFinite(tA) || !Number.isFinite(tB) || tA === tB) return null;
        setAnalysisBox({
          fromMs: Math.min(tA, tB),
          toMs: Math.max(tA, tB),
          priceLow: Number.isFinite(pA) && Number.isFinite(pB) ? Math.min(pA, pB) : null,
          priceHigh: Number.isFinite(pA) && Number.isFinite(pB) ? Math.max(pA, pB) : null,
        });
        return null;
      });
      setAnalysisBoxMode(false);
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

  // Motor ECharts: traduz o dataZoom (start/end em %) pro trecho de TEMPO visível e reporta pro
  // estado compartilhado (visibleChartRange) — mesmo sinal que o LW manda via
  // subscribeVisibleTimeRangeChange. Base da janela deslizante do S/R/PPHL/WF/ZZ.
  const emitEChartsVisibleRange = useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance?.();
    const candles = selectedChart?.candlesticks;
    if (!inst || !candles?.length) return;
    const dz = inst.getOption?.()?.dataZoom?.[0];
    const startPct = Number.isFinite(dz?.start) ? dz.start : 0;
    const endPct = Number.isFinite(dz?.end) ? dz.end : 100;
    const visible = candles.slice(-displayLimit);
    if (visible.length < 2) return;
    const lastIdx = visible.length - 1;
    const fromIdx = Math.max(0, Math.floor((startPct / 100) * lastIdx));
    const toIdx = Math.min(lastIdx, Math.ceil((endPct / 100) * lastIdx));
    const fromMs = Number(visible[fromIdx]?.openTime);
    const toMs = Number(visible[toIdx]?.openTime);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) reportVisibleRange({ fromMs, toMs });
  }, [selectedChart?.candlesticks, displayLimit, reportVisibleRange]);

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

  // Bracket TP/SL REAL travado na corretora (rules_state.exitBracket — ver
  // parseExitBracket em backend/services/supabaseService.js, gravado por
  // vwap-bands-bot.js/bollinger-bands-bot.js ao colocar o OCO/price_orders). Tem PRIORIDADE
  // sobre qualquer recálculo ao vivo (vwapLadderLevels/bollingerTargetLevels) ou % simulado
  // (resolveChartStopLoss/resolveChartTarget) — sem isso o quadrado do gráfico mostra a banda
  // recalculada agora, que diverge do preço real da ordem resting até o bot decidir substituí-la
  // (maybeReplaceBracket só troca se o desvio passar de um limiar).
  const realExitBracket = useMemo(() => {
    const sym = selectedChart?.symbol;
    if (!sym) return null;
    const entry = multitradeFavorites?.find(
      e => e.symbol?.toUpperCase() === sym.toUpperCase() && e.phase === 'BOUGHT' && e.exitBracket,
    );
    return entry?.exitBracket ?? null;
  }, [selectedChart?.symbol, multitradeFavorites]);

  const chartStopLossConfig = useMemo(() => {
    if (!selectedChart?.symbol) return null;
    if (realExitBracket?.stopPrice != null) {
      return { enabled: true, mode: 'price', price: realExitBracket.stopPrice, real: true };
    }
    if (vwapLadderLevels?.symbol === selectedChart.symbol && vwapLadderLevels.stopPrice != null) {
      return { enabled: true, mode: 'price', price: vwapLadderLevels.stopPrice, levelLabel: vwapLadderLevels.touchLevel, simulated: true };
    }
    const resolved = resolveChartStopLoss(selectedChart.symbol, multitradeFavorites);
    return resolved ? { ...resolved, simulated: true } : resolved;
  }, [selectedChart?.symbol, multitradeFavorites, vwapLadderLevels, realExitBracket]);

  const chartTargetConfig = useMemo(() => {
    if (!selectedChart?.symbol) return null;
    if (realExitBracket?.targetPrice != null) {
      return { enabled: true, mode: 'price', price: realExitBracket.targetPrice, real: true };
    }
    if (vwapLadderLevels?.symbol === selectedChart.symbol && vwapLadderLevels.targetPrice != null) {
      return { enabled: true, mode: 'price', price: vwapLadderLevels.targetPrice, levelLabel: vwapLadderLevels.targetLevel, simulated: true };
    }
    if (bollingerTargetLevels?.symbol === selectedChart.symbol && bollingerTargetLevels.targetPrice != null) {
      return { enabled: true, mode: 'price', price: bollingerTargetLevels.targetPrice, levelLabel: 'upper', simulated: true };
    }
    const resolved = resolveChartTarget(selectedChart.symbol, multitradeFavorites);
    return resolved ? { ...resolved, simulated: true } : resolved;
  }, [selectedChart?.symbol, multitradeFavorites, vwapLadderLevels, bollingerTargetLevels, realExitBracket]);

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

  // Limiar (%) do filtro de tendência da mediana — mesmo valor global editável em
  // Configurações (bollinger_median_trend_config), lido uma vez e reaproveitado pra colorir
  // a linha da mediana no gráfico igual ao bot real (ver checkMedianTrendFilter no backend).
  const [bbMedianTrendThreshold, setBbMedianTrendThreshold] = useState(0.2);
  useEffect(() => {
    getBollingerMedianTrendConfig()
      .then((cfg) => { if (Number.isFinite(cfg?.minAvgDiffPct)) setBbMedianTrendThreshold(cfg.minAvgDiffPct); })
      .catch(() => {});
  }, []);

  // Uma config por grupo BB habilitado (linhas e/ou PATH e/ou tendência da mediana) — motor
  // Lightweight Charts (CandlestickChartLW) desenha todas simultaneamente, cada uma com sua cor.
  const chartBollingerConfigs = useMemo(() => {
    if (chartPanelButtons.bb === false) return [];
    return bbGroups
      .map((g, i) => {
        if (!g.enabled && !g.showPath && !g.showMedianTrend && !g.showPermFilter) return null;
        const key = `${g.period}-${g.stdDev}-${g.interval}`;
        const permKey = `${key}-${botPermInterval}`;
        return {
          id: g.id,
          color: bbGroupColor(i),
          label: `BB${g.period}@${g.interval}`,
          enabled: g.enabled,
          showUpper: g.showUpper,
          showMiddle: g.showMiddle,
          showLower: g.showLower,
          showPath: g.showPath,
          showMedianTrend: g.showMedianTrend,
          showPermFilter: g.showPermFilter,
          medianTrendLookback: 10,
          medianTrendThreshold: bbMedianTrendThreshold,
          period: g.period,
          stdDev: g.stdDev,
          interval: g.interval,
          points: bollingerCache[key] ?? [],
          // Só populado quando showPermFilter está ligado E o manipulador dessa moeda tem PERM
          // configurado num nível com equivalente aqui (ver botPermInterval/bbPermPathCache).
          permPathNodes: g.showPermFilter ? (bbPermPathCache[permKey] ?? []) : null,
        };
      })
      .filter(Boolean);
  }, [bbGroups, bollingerCache, bbPermPathCache, botPermInterval, chartPanelButtons.bb, bbMedianTrendThreshold]);
  // Motor ECharts legado (buildOption abaixo) só sabe desenhar 1 Bollinger — usa a 1ª config
  // habilitada como aproximação (sem multi-BB nesse motor, fora do escopo desta feature).
  const chartBollingerConfig = chartBollingerConfigs[0] ?? null;

  // Candles brutos do intervalo `iv` cortados pra janela deslizante do trecho visível, limitados
  // a `count` candles. Base pros 4 indicadores da família pivô (S/R, PPHL, WF, ZZ).
  const pivotWindow = useCallback((iv, count) => {
    const raw = pivotRawCache[`${selectedChart?.symbol}|${iv}`]?.candles;
    return sliceForVisibleWindow(raw, visibleChartRange, count);
  }, [pivotRawCache, selectedChart?.symbol, visibleChartRange]);

  // Linha vertical roxa do "Limiar RSI": lista de `openTime` (ms) — já snapada pra grade do
  // intervalo do GRÁFICO — dos candles em que o RSI(14) do intervalo escolhido cruzou pra cima do
  // limiar. Os dois motores (LW e ECharts) casam esses ms com o openTime dos candles exibidos.
  const chartRsiCrossTimes = useMemo(() => {
    if (!rsiCrossShown) return [];
    const raw = pivotRawCache[`${selectedChart?.symbol}|${rsiCrossInterval}`]?.candles;
    const chartCandles = selectedChart?.candlesticks;
    if (!raw?.length || !chartCandles?.length) return [];
    const chartIvMs = INTERVAL_MS[selectedChart.interval ?? currentInterval] ?? 900_000;
    const times = chartCandles.map((c) => Number(c.openTime));
    const firstMs = times[0];
    const lastMs = times[times.length - 1];
    const snapped = new Set();
    for (const openMs of computeRsiUpCrossingsFromCandles(raw, rsiCrossThreshold)) {
      if (openMs < firstMs || openMs > lastMs + chartIvMs) continue;
      // candle do gráfico que contém o instante do cruzamento (último com openTime <= openMs)
      let lo = 0;
      let hi = times.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= openMs) lo = mid; else hi = mid - 1;
      }
      snapped.add(times[lo]);
    }
    return [...snapped].sort((a, b) => a - b);
  }, [rsiCrossShown, pivotRawCache, selectedChart?.symbol, selectedChart?.candlesticks, selectedChart?.interval, currentInterval, rsiCrossInterval, rsiCrossThreshold]);

  // Âncora do S/R rolante = abertura do último candle do intervalo do S/R que JÁ FECHOU até a
  // borda direita do trecho visível (candle em formação não entra — sem look-ahead). Snapado pra
  // grade do intervalo, então arrastar DENTRO do mesmo candle não muda a chave → chartSrConfigs
  // não recalcula os 10×detectSupportResistance por instância a cada frame de arrasto. Uma âncora
  // por intervalo distinto entre as instâncias habilitadas.
  const srAnchorByInterval = useMemo(() => {
    const m = {};
    for (const g of enabledSrGroups) {
      if (!(g.interval in m)) m[g.interval] = srClosedAnchorMs(visibleChartRange?.toMs, INTERVAL_MS[g.interval] ?? 3_600_000);
    }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleChartRange, srIntervalsKey]);
  const srAnchorsKey = Object.entries(srAnchorByInterval).map(([k, v]) => `${k}:${v}`).join('|');

  // S/R MULTI-INSTÂNCIA: uma config por instância habilitada (ou uma única do override do trade
  // das Estatísticas). Cada config: { id, color, interval, style, rolling:[{time,levels}],
  // showSupport, showResistance }. "Calcular" (calcSupport/calcResistance) fatia os níveis já aqui;
  // "Mostrar" (showSupport/showResistance) viaja na config e o LW/ECharts filtra por rank.
  const chartSrConfigs = useMemo(() => {
    if (srTradeOverride) {
      const buyMs = chartTradeMarkers?.find((m) => m.side === 'buy')?.time ?? chartTradeMarkers?.[0]?.time;
      const sellMs = chartTradeMarkers?.find((m) => m.side === 'sell')?.time;
      const lastCandleMs = Number(selectedChart?.candlesticks?.[selectedChart.candlesticks.length - 1]?.openTime);
      const fromMs = Number(buyMs);
      const toMs = Number(sellMs) || (Number.isFinite(lastCandleMs) ? lastCandleMs : Date.now());
      return [{
        id: 'sr-trade-override',
        color: SR_PALETTE[0],
        interval: chartSrOverride.interval,
        levels: chartSrOverride.levels,
        entrySupport: chartSrOverride.entrySupport ?? null,
        exitResistance: chartSrOverride.exitResistance ?? null,
        tradeWindow: Number.isFinite(fromMs) && toMs > fromMs ? { fromMs, toMs } : null,
        showSupport: 3,
        showResistance: 3,
      }];
    }
    if (!enabledSrGroups.length || chartPanelButtons.sr === false) return [];
    const out = [];
    enabledSrGroups.forEach((g, i) => {
      const raw = pivotRawCache[`${selectedChart?.symbol}|${g.interval}`]?.candles ?? [];
      const anchorMs = srAnchorByInterval[g.interval];
      const slice = sliceForRollingSR(raw, anchorMs != null ? { toMs: anchorMs } : null, g.candleCount, SR_ROLL_WIDTH);
      const rolling = [];
      for (let k = Math.max(0, slice.length - SR_ROLL_WIDTH); k < slice.length; k++) {
        const from = Math.max(0, k - g.candleCount + 1);
        let levels = detectSupportResistance(slice.slice(from, k + 1), {});
        levels = sliceRankedSrLevels(levels, g.calcSupport, g.calcResistance);
        if (levels.length) rolling.push({ time: Number(slice[k].openTime), levels });
      }
      out.push({
        id: g.id, color: SR_PALETTE[i % SR_PALETTE.length], interval: g.interval, style: g.style,
        rolling, showSupport: g.showSupport, showResistance: g.showResistance,
      });
    });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srTradeOverride, chartSrOverride, chartTradeMarkers, handlers.sr?.groups, chartPanelButtons.sr, pivotRawCache, selectedChart?.symbol, selectedChart?.candlesticks, srAnchorsKey]);

  const chartPphlConfig = useMemo(() => {
    if (!pphlShown) return null;
    const points = detectPivotPointsHighLow(pivotWindow(pphlGroup.interval, pphlGroup.candleCount), {});
    return { interval: pphlGroup.interval, points };
  }, [pphlShown, pphlGroup?.interval, pphlGroup?.candleCount, pivotWindow]);

  const chartWfractalsConfig = useMemo(() => {
    if (!wfractalsShown) return null;
    const points = detectWilliamsFractals(pivotWindow(wfractalsGroup.interval, wfractalsGroup.candleCount), { bars: 2 });
    return { interval: wfractalsGroup.interval, points };
  }, [wfractalsShown, wfractalsGroup?.interval, wfractalsGroup?.candleCount, pivotWindow]);

  const chartZigzagConfig = useMemo(() => {
    if (!zigzagShown) return null;
    const d = detectZigZag(pivotWindow(zigzagGroup.interval, zigzagGroup.candleCount), {});
    return { interval: zigzagGroup.interval, points: d.points ?? [], lastLeg: d.lastLeg ?? null };
  }, [zigzagShown, zigzagGroup?.interval, zigzagGroup?.candleCount, pivotWindow]);

  // Bandeiras (auto): detecção pura sobre os candles JÁ carregados no gráfico — sem fetch nem
  // intervalo próprio (diferente de PPHL/ZZ), então acompanha o intervalo/zoom atuais.
  //
  //  - botão "Band." ligado  -> varre o gráfico inteiro (só a bandeira "viva" mais recente
  //    de cada trecho é mostrada).
  //  - caixa de análise desenhada -> varre SÓ os candles dentro dela e mostra a melhor
  //    bandeira possível ali, mesmo que já tenha "expirado" (forwardResolveBars: Infinity).
  //    A caixa é opt-in própria — funciona mesmo com o botão "Band." desligado.
  const flagsShown = activeIndicators.includes('flags') && chartPanelButtons.flags !== false;
  const chartFlagsConfig = useMemo(() => {
    const candles = selectedChart?.candlesticks;
    if (!candles?.length) return null;

    if (analysisBox) {
      const scoped = candles.filter((c) => {
        const t = Number(c.openTime);
        return t >= analysisBox.fromMs && t <= analysisBox.toMs;
      });
      const flags = detectFlags(scoped, { forwardResolveBars: Infinity, lookback: 100000 });
      return { flags, scoped: true, scopedCount: scoped.length };
    }

    if (!flagsShown) return null;
    const flags = detectFlags(candles);
    return flags.length ? { flags, scoped: false } : null;
  }, [flagsShown, selectedChart?.candlesticks, analysisBox]);

  // Retângulo da caixa de análise pro motor TradingView — desenhado pela RectanglePrimitive,
  // que reprojeta de tempo/preço a cada frame (não sai do lugar ao dar pan/zoom, diferente de
  // um overlay em pixels). Sem faixa de preço válida, cobre toda a altura visível.
  const analysisBoxRect = useMemo(() => {
    if (!analysisBox) return null;
    const n = chartFlagsConfig?.scoped ? chartFlagsConfig.scopedCount : null;
    return {
      time1: Math.floor(analysisBox.fromMs / 1000),
      time2: Math.floor(analysisBox.toMs / 1000),
      price1: analysisBox.priceLow,
      price2: analysisBox.priceHigh,
      fullHeight: !(Number.isFinite(analysisBox.priceLow) && Number.isFinite(analysisBox.priceHigh)),
      fillColor: 'rgba(148,163,184,0.10)',
      strokeColor: 'rgba(203,213,225,0.7)',
      label: n != null ? `análise · ${n} candle${n === 1 ? '' : 's'}` : 'análise',
      labelColor: '#cbd5e1',
      labelPos: 'top',
    };
  }, [analysisBox, chartFlagsConfig]);

  // DEBUG (Teste): ao criar a caixa de análise, printa no console os níveis de S/R no momento da
  // borda direita da caixa — mesmo cálculo rolante do gráfico, ancorado no último candle do
  // intervalo do S/R que já FECHOU até analysisBox.toMs (sem look-ahead, igual ao backtest).
  useEffect(() => {
    if (!analysisBox) return;
    const g = enabledSrGroups[0]; // dump da 1ª instância S/R habilitada
    if (!g) { console.warn('[S/R] caixa: nenhuma instância S/R ligada — nada a printar'); return; }
    const raw = pivotRawCache[`${selectedChart?.symbol}|${g.interval}`]?.candles ?? [];
    if (!raw.length) { console.warn(`[S/R] caixa: candles de ${g.interval} ainda não carregados`); return; }
    const anchorMs = srClosedAnchorMs(analysisBox.toMs, INTERVAL_MS[g.interval] ?? 3_600_000);
    const slice = sliceForRollingSR(raw, { toMs: anchorMs }, g.candleCount, SR_ROLL_WIDTH);
    const anchorCandle = slice[slice.length - 1];
    const levels = detectSupportResistance(
      slice.slice(Math.max(0, slice.length - g.candleCount), slice.length), {});
    logSrLevels('caixa de análise', selectedChart?.symbol, levels, {
      interval: g.interval,
      lookback: g.candleCount,
      anchorMs: anchorCandle ? Number(anchorCandle.openTime) : null,
      windowMs: [analysisBox.fromMs, analysisBox.toMs],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisBox]);

  const chartPrevDayCloudConfig = useMemo(() => {
    if (!prevDayCloudShown || !selectedChart?.symbol) return null;
    const key = `${selectedChart.symbol}|${prevDayCloudEffectiveInterval}`;
    const segments = buildPrevDayCloudSegments(prevDayCloudCache[key] ?? [], prevDayCloudCandleCount, prevDayCloudUseHighLow);
    return segments.length ? { segments, interval: prevDayCloudEffectiveInterval, candleCount: prevDayCloudCandleCount, useHighLow: prevDayCloudUseHighLow } : null;
  }, [prevDayCloudShown, selectedChart?.symbol, prevDayCloudCache, prevDayCloudEffectiveInterval, prevDayCloudCandleCount, prevDayCloudUseHighLow]);

  const chartChopConfig = useMemo(() => {
    if (!chopShown) return null;
    return { interval: chopGroup.interval, points: chopCache[chopGroup.interval] ?? [] };
  }, [chopShown, chopGroup?.interval, chopCache]);

  const chartMacdConfig = useMemo(() => {
    if (!macdShown) return null;
    const d = macdCache[macdGroup.interval] ?? { macd: [], signal: [], histogram: [] };
    return { interval: macdGroup.interval, macd: d.macd ?? [], signal: d.signal ?? [], histogram: d.histogram ?? [] };
  }, [macdShown, macdGroup?.interval, macdCache]);

  const chartEmaPersistCloudData = useMemo(() => {
    if (!emaPersistCloudShown) return null;
    return emaPersistCloudCache[emaPersistCloudInterval] ?? null;
  }, [emaPersistCloudShown, emaPersistCloudInterval, emaPersistCloudCache]);

  const chartEmaPersistCloudConfirmData = useMemo(() => {
    if (!emaPersistCloudShown || !emaPersistCloudConfirmInterval) return null;
    return emaPersistCloudConfirmCache[emaPersistCloudInterval] ?? null;
  }, [emaPersistCloudShown, emaPersistCloudConfirmInterval, emaPersistCloudInterval, emaPersistCloudConfirmCache]);

  const chartEmaPersistCloudConfirm2Data = useMemo(() => {
    if (!emaPersistCloudShown || !emaPersistCloudConfirm2Interval) return null;
    return emaPersistCloudConfirm2Cache[emaPersistCloudInterval] ?? null;
  }, [emaPersistCloudShown, emaPersistCloudConfirm2Interval, emaPersistCloudInterval, emaPersistCloudConfirm2Cache]);

  const chartBarsSinceCrossData = useMemo(() => {
    if (!barsSinceCrossShown) return null;
    return barsSinceCrossCache[barsSinceCrossGroup.interval] ?? null;
  }, [barsSinceCrossShown, barsSinceCrossGroup?.interval, barsSinceCrossCache]);

  const chartTdSequentialData = useMemo(() => {
    if (!tdSequentialShown) return null;
    const candlesticks = tdSequentialCache[tdSequentialGroup.interval];
    return candlesticks ? { candlesticks } : null;
  }, [tdSequentialShown, tdSequentialGroup?.interval, tdSequentialCache]);

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
    setEchartFontScale(uiPrefs.fontScale); // singleton lido pelos builders de série (efs())
    return buildOption(
      selectedChart, colors, effectiveIndicators, displayLimit, chartZoom, tradeTimes, overlayConfigs,
      chartTradeMarkers?.length ? chartTradeMarkers : (selectedChart.tradeMarkers ?? []),
      chartLeftPad, chartBuyInfo, chartStopLossConfig, chartTargetConfig, chartRightPad, chartBollingerConfig, chartSrConfigs, chartPphlConfig, chartWfractalsConfig, chartZigzagConfig, chartVwapConfig, chartChopConfig, vwapSlopeHighlight, isMobile,
      chartBollingerConfig?.showPath ?? false, chartMacdConfig, rsiCrossThreshold, chartRsiCrossTimes,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart, colors, effectiveIndicators, chartZoom, tradePurchases, chartTradeMarkers, activeTab, overlayConfigs, displayLimit, chartLeftPad, chartRightPad, chartBuyInfo, chartStopLossConfig, chartTargetConfig, chartBollingerConfig, chartSrConfigs, chartPphlConfig, chartWfractalsConfig, chartZigzagConfig, chartVwapConfig, chartChopConfig, chartMacdConfig, vwapSlopeHighlight, isMobile, rsiCrossThreshold, chartRsiCrossTimes, uiPrefs.fontScale]);

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
      onChartReady={emitEChartsVisibleRange}
      onEvents={{ datazoom: emitEChartsVisibleRange }}
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
      {showLwChart && (
        <button
          onClick={toggleAnalysisBoxMode}
          title="Caixa de análise — arraste um retângulo sobre os candles pra detectar a bandeira só naquele trecho (funciona mesmo com o botão Band. desligado)"
          className={`w-6 h-5 md:w-7 md:h-6 inline-flex items-center justify-center text-[11px] md:text-xs rounded font-mono font-bold transition-colors border shrink-0 shadow-lg ${
            analysisBoxMode
              ? 'bg-slate-200 text-black border-white shadow-slate-300/50'
              : 'bg-slate-500/80 text-white border-slate-400 hover:bg-slate-400'
          }`}
        >
          ⬚
        </button>
      )}
      {analysisBox && (
        <button
          onClick={clearAnalysisBox}
          title="Remover a caixa de análise"
          className="w-6 h-5 md:w-7 md:h-6 inline-flex items-center justify-center text-[11px] md:text-xs rounded font-mono font-bold transition-colors border shrink-0 shadow-lg bg-slate-700/80 text-slate-200 border-slate-500 hover:bg-slate-600"
        >
          ×
        </button>
      )}
    </div>
  );

  // Superfície de desenho da caixa de análise + preview em pixels enquanto arrasta. A caixa
  // JÁ efetivada é desenhada dentro do gráfico (RectanglePrimitive, via analysisBoxRect) — aqui
  // fica só o preview transitório do arrasto.
  const analysisBoxOverlay = analysisBoxMode && (
    <div
      className="absolute inset-0 z-20 select-none cursor-crosshair"
      onMouseDown={handleAnalysisBoxStart}
      onTouchStart={handleAnalysisBoxStart}
    >
      {analysisDrag && (
        <div
          className="absolute border-2 border-slate-200 bg-slate-300/10 pointer-events-none"
          style={{
            left: Math.min(analysisDrag.x1, analysisDrag.x2),
            top: Math.min(analysisDrag.y1, analysisDrag.y2),
            width: Math.abs(analysisDrag.x2 - analysisDrag.x1),
            height: Math.abs(analysisDrag.y2 - analysisDrag.y1),
          }}
        />
      )}
    </div>
  );

  // Aviso no gráfico quando a caixa de análise não achou bandeira (ou é pequena demais).
  const analysisBoxNotice = analysisBox && chartFlagsConfig?.scoped && !chartFlagsConfig.flags?.length && (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div className="px-3 py-1.5 rounded-md bg-slate-800/90 border border-slate-500 text-slate-100 text-[11px] md:text-xs font-mono shadow-lg flex items-center gap-2">
        <span className="text-amber-300">⬚</span>
        {chartFlagsConfig.scopedCount != null && chartFlagsConfig.scopedCount < 12
          ? `Seleção pequena (${chartFlagsConfig.scopedCount} candles) — mínimo ~12 para detectar bandeira`
          : 'Nenhuma bandeira detectada na seleção'}
      </div>
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
              bollingerBandsGroups={bbGroups}
              panelButtons={chartPanelButtons}
              candleWindowCount={hasExplicitCandleWindow ? displayCandleCount : null}
            />
          ) : (
            <div className="text-p5/50 text-xs font-mono">Selecione uma moeda pra conferir as regras.</div>
          )}
          <ChartIndicatorPanel
            handlers={handlers}
            activeIndicators={activeIndicators}
            toggleIndicator={toggleIndicator}
            quickEmaGroups={quickEmaGroups}
            addQuickEmaGroup={addQuickEmaGroup}
            removeQuickEmaGroup={removeQuickEmaGroup}
            updateQuickEmaGroupInterval={updateQuickEmaGroupInterval}
            toggleQuickEmaGroupPeriod={toggleQuickEmaGroupPeriod}
            updateQuickEmaGroupBandPct={updateQuickEmaGroupBandPct}
            updateQuickEmaGroupBandPeriod={updateQuickEmaGroupBandPeriod}
            bbGroups={bbGroups}
            addBbGroup={addBbGroup}
            removeBbGroup={removeBbGroup}
            updateBbGroup={updateBbGroup}
            toggleBbGroupFlag={toggleBbGroupFlag}
            botPermInterval={botPermInterval}
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
              fontScale={uiPrefs.fontScale}
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
              bollingerConfigs={chartBollingerConfigs}
              srConfigs={chartSrConfigs}
              pphlConfig={chartPphlConfig}
              wfractalsConfig={chartWfractalsConfig}
              zigzagConfig={chartZigzagConfig}
              rsiCrossThreshold={rsiCrossThreshold}
              rsiCrossTimes={chartRsiCrossTimes}
              flagsConfig={chartFlagsConfig}
              analysisBoxRect={analysisBoxRect}
              prevDayCloudConfig={chartPrevDayCloudConfig}
              rsi={selectedChart.rsi}
              chopConfig={chartChopConfig}
              macdConfig={chartMacdConfig}
              emaPersistCloudData={chartEmaPersistCloudData}
              emaPersistCloudConfirmData={chartEmaPersistCloudConfirmData}
              emaPersistCloudConfirm2Data={chartEmaPersistCloudConfirm2Data}
              emaPersistCloudLayers={emaPersistCloudLayers}
              emaPersistCloudTones={emaPersistCloudTones}
              barsSinceCrossData={chartBarsSinceCrossData}
              tdSequentialData={chartTdSequentialData}
              stopLossConfig={chartStopLossConfig}
              targetConfig={chartTargetConfig}
              buyInfo={chartBuyInfo}
              multitradeMarkers={chartTradeMarkers?.length ? chartTradeMarkers : (selectedChart.tradeMarkers ?? [])}
              zoomPeriod={chartZoom}
              focusLastN={hasExplicitCandleWindow ? displayCandleCount : null}
              onNeedOlderCandles={handleLoadMoreCandles}
              loadingMoreCandles={loadingMoreCandles}
              onVisibleRangeChange={reportVisibleRange}
              visibleRange={visibleChartRange}
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
          {analysisBoxOverlay}
          {analysisBoxNotice}
          {measureButtons}
          <ChartIndicatorPanel
            handlers={handlers}
            activeIndicators={activeIndicators}
            toggleIndicator={toggleIndicator}
            quickEmaGroups={quickEmaGroups}
            addQuickEmaGroup={addQuickEmaGroup}
            removeQuickEmaGroup={removeQuickEmaGroup}
            updateQuickEmaGroupInterval={updateQuickEmaGroupInterval}
            toggleQuickEmaGroupPeriod={toggleQuickEmaGroupPeriod}
            updateQuickEmaGroupBandPct={updateQuickEmaGroupBandPct}
            updateQuickEmaGroupBandPeriod={updateQuickEmaGroupBandPeriod}
            bbGroups={bbGroups}
            addBbGroup={addBbGroup}
            removeBbGroup={removeBbGroup}
            updateBbGroup={updateBbGroup}
            toggleBbGroupFlag={toggleBbGroupFlag}
            botPermInterval={botPermInterval}
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
