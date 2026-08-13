
const STORAGE_KEY = 'lets_trade_ui_prefs';

export const CHART_INTERVAL_OPTIONS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
];

export const PANEL_KEYS = ['indicators', 'stats'];

/** Botões de favoritos na tabela de moedas (barra de ferramentas + linhas) — editável em
 *  Configurações pra esconder o que não está em uso no momento (ex.: MC se não usa mais
 *  ma-cross). Todos visíveis por padrão. */
export const FAVORITE_BUTTON_KEYS = ['gate', 'binance', 'macross', 'vwap-bands', 'bollinger-bands', 'active', 'trades'];

export function normalizeVisibleFavoriteButtons(raw) {
  const result = {};
  for (const key of FAVORITE_BUTTON_KEYS) {
    result[key] = typeof raw?.[key] === 'boolean' ? raw[key] : true;
  }
  return result;
}

/** Intervalos que ficam visíveis por padrão na linha de botões rápidos do gráfico — os demais ficam
 *  escondidos atrás do botão "›". Editável em Configurações → Intervalos rápidos do gráfico. */
export const DEFAULT_COMMON_CHART_INTERVALS = ['15m', '1h', '4h', '8h'];

export function normalizeCommonChartIntervals(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_COMMON_CHART_INTERVALS];
  const valid = raw.filter((iv) => CHART_INTERVAL_OPTIONS.includes(iv));
  const deduped = [...new Set(valid)];
  return deduped.length ? deduped : [...DEFAULT_COMMON_CHART_INTERVALS];
}

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
  'ma9', 'ma21', 'ma50', 'ma200', 'emaPersistCloud', 'barsSinceCross', 'tdSequential',
  'ichimoku', 'sr', 'pphl', 'rsi', 'rsi50', 'rsi80', 'stopLoss', 'chopZone',
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

/** 'session' = reset de calendário (00:00 UTC / segunda 00:00 UTC) — bandas colam na vwap
 *  logo após o reset. 'rolling' = janela móvel (24h ou 7d, conforme a sessão escolhida no
 *  painel) sem reset — evita esse artefato, já que cripto negocia 24/7 e não tem fechamento
 *  real. Escolha única e global (Configurações → VWAP padrão) — não é mais um toggle por
 *  painel do gráfico, pra manter consistência com o que o bot vwap-bands realmente usa
 *  (o bot sempre roda em 'rolling', ver backend/bot/vwap-bands/strategyEngine.js). */
export const VWAP_ANCHOR_OPTIONS = ['session', 'rolling'];
export const DEFAULT_VWAP_ANCHOR = 'rolling';

export function normalizeVwapAnchor(raw) {
  return VWAP_ANCHOR_OPTIONS.includes(raw) ? raw : DEFAULT_VWAP_ANCHOR;
}

/**
 * Destaque visual (rosa) dos trechos onde a própria VWAP está em queda acentuada — espelha
 * entry.vwapSlopeFilter do bot vwap-bands (backend/bot/vwap-bands/strategyEngine.js:
 * vwapSlopeAt), mas aqui é só overlay no gráfico (não bloqueia nenhuma compra) pra o usuário
 * visualizar antes de decidir ligar o filtro de verdade num símbolo. Compara o valor da VWAP
 * em cada ponto com o de `lookback` pontos atrás (na mesma série); pinta de rosa (linha +
 * bandas) o trecho onde a queda passa de `minSlopePct`. Desligado por padrão.
 */
export const VWAP_SLOPE_HIGHLIGHT_LOOKBACKS = [3, 6, 12, 24];

export const DEFAULT_VWAP_SLOPE_HIGHLIGHT = {
  enabled: false,
  lookback: 6,
  minSlopePct: -3,
};

export function normalizeVwapSlopeHighlight(raw) {
  const d = DEFAULT_VWAP_SLOPE_HIGHLIGHT;
  const lookback = Math.round(Number(raw?.lookback));
  const minSlopePct = Number(raw?.minSlopePct);
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled,
    lookback: VWAP_SLOPE_HIGHLIGHT_LOOKBACKS.includes(lookback) ? lookback : d.lookback,
    minSlopePct: Number.isFinite(minSlopePct) ? minSlopePct : d.minSlopePct,
  };
}

/** Intervalos disponíveis nas abas de Estatísticas (mesma lista dos selects do painel). */
export const STATS_INTERVAL_OPTIONS = [
  '1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
];

/**
 * Parâmetros iniciais das abas do painel Estatísticas. Cada aba lê daqui ao montar;
 * o usuário ainda pode mudar na hora sem alterar o padrão (isso é feito em Configurações).
 */
export const DEFAULT_STATS = {
  rsi: { interval: '4h', oversold: 30, overbought: 70 },
  maCross: { entryInterval: '4h', exitInterval: '4h' },
  bollingerBands: { interval: '4h', period: 20, stdDev: 2 },
};

function statsInterval(raw, fallback) {
  return STATS_INTERVAL_OPTIONS.includes(raw) ? raw : fallback;
}

/** Clamp de inteiro dentro de [min, max]; volta ao fallback se não for número. */
function statsInt(raw, fallback, min, max) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeStatsDefaults(raw) {
  const d = DEFAULT_STATS;
  const oversold = statsInt(raw?.rsi?.oversold, d.rsi.oversold, 1, 99);
  const overbought = statsInt(raw?.rsi?.overbought, d.rsi.overbought, 1, 99);
  return {
    rsi: {
      interval: statsInterval(raw?.rsi?.interval, d.rsi.interval),
      // Sobrevenda tem que ficar abaixo da sobrecompra, senão a busca não retorna nada.
      oversold: oversold < overbought ? oversold : d.rsi.oversold,
      overbought: oversold < overbought ? overbought : d.rsi.overbought,
    },
    maCross: {
      entryInterval: statsInterval(raw?.maCross?.entryInterval, d.maCross.entryInterval),
      exitInterval: statsInterval(raw?.maCross?.exitInterval, d.maCross.exitInterval),
    },
    bollingerBands: {
      interval: statsInterval(raw?.bollingerBands?.interval, d.bollingerBands.interval),
      period: statsInt(raw?.bollingerBands?.period, d.bollingerBands.period, 2, 200),
      stdDev: statsInt(raw?.bollingerBands?.stdDev, d.bollingerBands.stdDev, 1, 5),
    },
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

/** Intervalo de candles usado pra calcular o Choppiness Index — mesmo padrão do S/R/PPHL,
 *  independente do intervalo do gráfico. 4h por padrão (ver estudo: 1h fica contaminado pelo
 *  próprio candle do cruzamento EMA9x21, 4h reflete a estrutura de fundo). */
export const DEFAULT_CHOP_INTERVAL = '4h';

export function normalizeChopInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_CHOP_INTERVAL;
}

/** Intervalo de candles usado pela nuvem de permanência EMA9×EMA21 (PERM) — independente do
 *  intervalo do gráfico, mesmo padrão do S/R/PPHL/CHOP (ex.: gráfico em 15m, nuvem calculada
 *  sobre candles de 1h). */
export const DEFAULT_EMA_PERSIST_CLOUD_INTERVAL = '1h';

export function normalizeEmaPersistCloudInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_EMA_PERSIST_CLOUD_INTERVAL;
}

/** Intervalo de candles usado pelo "Bars Since MA Cross" (BARS) — mesmo padrão acima. */
export const DEFAULT_BARS_SINCE_CROSS_INTERVAL = '1h';

export function normalizeBarsSinceCrossInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_BARS_SINCE_CROSS_INTERVAL;
}

/** Intervalo de candles usado pelo TD Sequential (TD SEQ) — mesmo padrão acima. */
export const DEFAULT_TD_SEQUENTIAL_INTERVAL = '1h';

export function normalizeTdSequentialInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_TD_SEQUENTIAL_INTERVAL;
}

/** Motor de renderização do gráfico principal. 'lw' = TradingView Lightweight Charts (padrão,
 *  só candles + EMA/VWAP); 'echarts' = motor clássico com todos os overlays/subpainéis. Quando
 *  o gráfico usa um recurso que só existe no ECharts (Ichimoku, S/R, PPHL, RSI, CHOP, Bollinger,
 *  marcadores de trade, régua de medição, zoom de período), o componente cai pro ECharts mesmo
 *  com 'lw' selecionado — ver lwUnsupportedReason em CandlestickChart.jsx. */
export const CHART_ENGINE_OPTIONS = ['lw', 'echarts'];
export const DEFAULT_CHART_ENGINE = 'lw';

export function normalizeChartEngine(raw) {
  return CHART_ENGINE_OPTIONS.includes(raw) ? raw : DEFAULT_CHART_ENGINE;
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
  commonChartIntervals: [...DEFAULT_COMMON_CHART_INTERVALS],
  visiblePanels: {
    indicators: true,
    stats: true,
  },
  visibleFavoriteButtons: normalizeVisibleFavoriteButtons({}),
  overlaySlots: normalizeOverlaySlots(DEFAULT_OVERLAY_SLOTS),
  maBandsDefaults: normalizeMaBandsDefaults(DEFAULT_MA_BANDS),
  srIntervalDefault: DEFAULT_SR_INTERVAL,
  pphlIntervalDefault: DEFAULT_PPHL_INTERVAL,
  chopIntervalDefault: DEFAULT_CHOP_INTERVAL,
  emaPersistCloudIntervalDefault: DEFAULT_EMA_PERSIST_CLOUD_INTERVAL,
  barsSinceCrossIntervalDefault: DEFAULT_BARS_SINCE_CROSS_INTERVAL,
  tdSequentialIntervalDefault: DEFAULT_TD_SEQUENTIAL_INTERVAL,
  vwapDefaults: normalizeVwapDefaults(DEFAULT_VWAP),
  vwapAnchorDefault: normalizeVwapAnchor(DEFAULT_VWAP_ANCHOR),
  vwapSlopeHighlightDefault: normalizeVwapSlopeHighlight(DEFAULT_VWAP_SLOPE_HIGHLIGHT),
  activeIndicators: [...DEFAULT_ACTIVE_INDICATORS],
  currencyPanelWidth: CURRENCY_PANEL_WIDTH_DEFAULT,
  statsDefaults: normalizeStatsDefaults(DEFAULT_STATS),
  chartEngineDefault: DEFAULT_CHART_ENGINE,
};

function cloneDefaults() {
  return {
    defaultChartInterval: DEFAULT_UI_PREFS.defaultChartInterval,
    commonChartIntervals: [...DEFAULT_COMMON_CHART_INTERVALS],
    visiblePanels: { ...DEFAULT_UI_PREFS.visiblePanels },
    visibleFavoriteButtons: normalizeVisibleFavoriteButtons({}),
    overlaySlots: normalizeOverlaySlots(DEFAULT_OVERLAY_SLOTS),
    maBandsDefaults: normalizeMaBandsDefaults(DEFAULT_MA_BANDS),
    srIntervalDefault: DEFAULT_SR_INTERVAL,
    pphlIntervalDefault: DEFAULT_PPHL_INTERVAL,
    chopIntervalDefault: DEFAULT_CHOP_INTERVAL,
    emaPersistCloudIntervalDefault: DEFAULT_EMA_PERSIST_CLOUD_INTERVAL,
    barsSinceCrossIntervalDefault: DEFAULT_BARS_SINCE_CROSS_INTERVAL,
    tdSequentialIntervalDefault: DEFAULT_TD_SEQUENTIAL_INTERVAL,
    vwapDefaults: normalizeVwapDefaults(DEFAULT_VWAP),
    vwapAnchorDefault: normalizeVwapAnchor(DEFAULT_VWAP_ANCHOR),
    vwapSlopeHighlightDefault: normalizeVwapSlopeHighlight(DEFAULT_VWAP_SLOPE_HIGHLIGHT),
    activeIndicators: [...DEFAULT_ACTIVE_INDICATORS],
    currencyPanelWidth: CURRENCY_PANEL_WIDTH_DEFAULT,
    statsDefaults: normalizeStatsDefaults(DEFAULT_STATS),
    chartEngineDefault: DEFAULT_CHART_ENGINE,
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
    if (parsed.commonChartIntervals !== undefined) {
      result.commonChartIntervals = normalizeCommonChartIntervals(parsed.commonChartIntervals);
    }
    if (parsed.visiblePanels && typeof parsed.visiblePanels === 'object') {
      for (const key of PANEL_KEYS) {
        if (typeof parsed.visiblePanels[key] === 'boolean') {
          result.visiblePanels[key] = parsed.visiblePanels[key];
        }
      }
    }
    if (parsed.visibleFavoriteButtons && typeof parsed.visibleFavoriteButtons === 'object') {
      result.visibleFavoriteButtons = normalizeVisibleFavoriteButtons(parsed.visibleFavoriteButtons);
    }
    if (parsed.overlaySlots !== undefined) {
      result.overlaySlots = normalizeOverlaySlots(parsed.overlaySlots);
    }
    if (parsed.maBandsDefaults) {
      result.maBandsDefaults = normalizeMaBandsDefaults(parsed.maBandsDefaults);
    }
    if (parsed.srIntervalDefault !== undefined) {
      result.srIntervalDefault = normalizeSrInterval(parsed.srIntervalDefault);
    }
    if (parsed.pphlIntervalDefault !== undefined) {
      result.pphlIntervalDefault = normalizePphlInterval(parsed.pphlIntervalDefault);
    }
    if (parsed.chopIntervalDefault !== undefined) {
      result.chopIntervalDefault = normalizeChopInterval(parsed.chopIntervalDefault);
    }
    if (parsed.emaPersistCloudIntervalDefault !== undefined) {
      result.emaPersistCloudIntervalDefault = normalizeEmaPersistCloudInterval(parsed.emaPersistCloudIntervalDefault);
    }
    if (parsed.barsSinceCrossIntervalDefault !== undefined) {
      result.barsSinceCrossIntervalDefault = normalizeBarsSinceCrossInterval(parsed.barsSinceCrossIntervalDefault);
    }
    if (parsed.tdSequentialIntervalDefault !== undefined) {
      result.tdSequentialIntervalDefault = normalizeTdSequentialInterval(parsed.tdSequentialIntervalDefault);
    }
    if (parsed.vwapDefaults) {
      result.vwapDefaults = normalizeVwapDefaults(parsed.vwapDefaults);
    }
    if (parsed.vwapAnchorDefault !== undefined) {
      result.vwapAnchorDefault = normalizeVwapAnchor(parsed.vwapAnchorDefault);
    }
    if (parsed.vwapSlopeHighlightDefault) {
      result.vwapSlopeHighlightDefault = normalizeVwapSlopeHighlight(parsed.vwapSlopeHighlightDefault);
    }
    if (Array.isArray(parsed.activeIndicators)) {
      result.activeIndicators = normalizeActiveIndicators(parsed.activeIndicators);
    }
    if (parsed.currencyPanelWidth !== undefined) {
      result.currencyPanelWidth = normalizeCurrencyPanelWidth(parsed.currencyPanelWidth);
    }
    if (parsed.statsDefaults) {
      result.statsDefaults = normalizeStatsDefaults(parsed.statsDefaults);
    }
    if (parsed.chartEngineDefault !== undefined) {
      result.chartEngineDefault = normalizeChartEngine(parsed.chartEngineDefault);
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
