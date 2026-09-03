import { DEFAULT_PERM_CLOUD_TONES, normalizeEmaPersistCloudTones } from './emaCrossPersistenceCloud';
import { INTERVAL_MS } from './chartView';

const STORAGE_KEY = 'lets_trade_ui_prefs';

export const CHART_INTERVAL_OPTIONS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
];

export const PANEL_KEYS = ['indicators', 'stats'];

/** Botões de favoritos na tabela de moedas (barra de ferramentas + linhas) — editável em
 *  Configurações pra esconder o que não está em uso no momento (ex.: MC se não usa mais
 *  ma-cross). Todos visíveis por padrão. */
export const FAVORITE_BUTTON_KEYS = ['gate', 'binance', 'macross', 'vwap-bands', 'bollinger-bands', 'rsi-momentum', 'active', 'trades'];

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
  'ichimoku', 'sr', 'pphl', 'wfractals', 'zigzag', 'flags', 'rsi', 'rsi50', 'rsi80', 'stopLoss', 'chopZone', 'prevDayCloud', 'macd',
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
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
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

/** Intervalo de candles usado pra calcular os Williams Fractals (fractais de N candles de cada
 *  lado) — mesmo padrão do S/R/PPHL, independente do intervalo do gráfico. */
export const DEFAULT_WFRACTALS_INTERVAL = '4h';

export function normalizeWfractalsInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_WFRACTALS_INTERVAL;
}

/** Intervalo de candles usado pra calcular a linha ZigZag — mesmo padrão do S/R/PPHL. */
export const DEFAULT_ZIGZAG_INTERVAL = '4h';

export function normalizeZigzagInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_ZIGZAG_INTERVAL;
}

/** Quantidade de candles (do intervalo próprio do indicador) que entram no cálculo do
 *  S/R-Pivot-family (PPHL, Williams Fractals, ZigZag) — independente do zoom do gráfico. */
export const INDICATOR_CANDLE_COUNT_OPTIONS = [20, 50, 100, 200, 300, 500, 1000];
export const DEFAULT_INDICATOR_CANDLE_COUNT = 300;

function normalizeIndicatorCandleCount(raw) {
  const n = Math.round(Number(raw));
  return INDICATOR_CANDLE_COUNT_OPTIONS.includes(n) ? n : DEFAULT_INDICATOR_CANDLE_COUNT;
}

export const normalizePphlCandleCount = normalizeIndicatorCandleCount;
export const normalizeWfractalsCandleCount = normalizeIndicatorCandleCount;
export const normalizeZigzagCandleCount = normalizeIndicatorCandleCount;

/** S/R do gráfico é ROLANTE: pra os últimos SR_ROLL_WIDTH candles-âncora, roda o detector sobre
 *  os `srCandleCount` candles anteriores a cada âncora. Aqui o "count" é o LOOKBACK por âncora
 *  (não a janela total), por isso o default é bem menor que o dos outros pivôs. */
export const DEFAULT_SR_CANDLE_COUNT = 50;
export function normalizeSrCandleCount(raw) {
  const n = Math.round(Number(raw));
  return INDICATOR_CANDLE_COUNT_OPTIONS.includes(n) ? n : DEFAULT_SR_CANDLE_COUNT;
}

/** Estilo de desenho do S/R rolante no gráfico:
 *  - 'degrau'  linhas contínuas em escada, um "posto" de nível ligado entre âncoras vizinhas
 *  - 'traco'   segmentos curtos soltos por âncora (sem ligar as âncoras entre si)
 *  - 'linhas'  clássico: linhas de preço de ponta a ponta, só do conjunto da âncora mais recente */
export const SR_STYLE_OPTIONS = ['degrau', 'traco', 'linhas'];
export const DEFAULT_SR_STYLE = 'degrau';
export function normalizeSrStyle(raw) {
  return SR_STYLE_OPTIONS.includes(raw) ? raw : DEFAULT_SR_STYLE;
}

/** Intervalo de candles usado pra calcular o Choppiness Index — mesmo padrão do S/R/PPHL,
 *  independente do intervalo do gráfico. 4h por padrão (ver estudo: 1h fica contaminado pelo
 *  próprio candle do cruzamento EMA9x21, 4h reflete a estrutura de fundo). */
export const DEFAULT_CHOP_INTERVAL = '4h';

export function normalizeChopInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_CHOP_INTERVAL;
}

/** Intervalo de candles usado pra calcular o MACD (12/26/9, períodos fixos) — independente do
 *  intervalo do gráfico, mesmo padrão do S/R/PPHL/CHOP. Padrão 1h: mesmo default do filtro MACD
 *  do bot RSI Momentum (ver backend/bot/rsi-momentum/strategyEngine.js). */
export const DEFAULT_MACD_INTERVAL = '1h';

export function normalizeMacdInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_MACD_INTERVAL;
}

/** Intervalo do candle usado pela nuvem D-1 — mesmo leque de intervalos do S/R/PPHL/CHOP (a
 *  nuvem é a abertura/fechamento do candle NATIVO nesse intervalo, ver buildPrevDayCloudSegments
 *  em CandlestickChart.jsx). Padrão 4h analisando os 3 candles anteriores (ver
 *  DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT) — trade-off entre reagir rápido e ter uma faixa estável.
 *  Nem todo intervalo existe nativamente na Gate.io (só 1m/5m/15m/30m/1h/2h/4h/8h/1d, ver
 *  CLAUDE.md) — com o gráfico em Gate.io e um intervalo não suportado, o backend/frontend caem
 *  pra '1d' (ver prevDayCloudEffectiveInterval em CandlestickChart.jsx). */
export const DEFAULT_PREV_DAY_CLOUD_INTERVAL = '4h';
export const PREV_DAY_CLOUD_INTERVAL_OPTIONS = CHART_INTERVAL_OPTIONS;
/** Intervalos com candle nativo na Gate.io — subconjunto de PREV_DAY_CLOUD_INTERVAL_OPTIONS. */
export const GATE_PREV_DAY_CLOUD_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

export function normalizePrevDayCloudInterval(raw) {
  return PREV_DAY_CLOUD_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_PREV_DAY_CLOUD_INTERVAL;
}

/** Quantos candles (do intervalo escolhido acima) entram no "envelope" da nuvem D-1: em vez de só
 *  o candle imediatamente anterior, junta os últimos N — nuvem = [min(todo open/close da janela),
 *  max(todo open/close da janela)]. N=1 é exatamente o candle anterior sozinho; padrão 3 (ver
 *  DEFAULT_PREV_DAY_CLOUD_INTERVAL). bullish/cor compara a abertura do candle mais antigo da
 *  janela com o fechamento do mais recente (direção do trecho todo). */
export const DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT = 3;
export const PREV_DAY_CLOUD_CANDLE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function normalizePrevDayCloudCandleCount(raw) {
  const n = Math.round(Number(raw));
  return PREV_DAY_CLOUD_CANDLE_COUNT_OPTIONS.includes(n) ? n : DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT;
}

/** Aumenta a nuvem D-1: usa máxima/mínima (pavios) dos candles da janela em vez de
 *  abertura/fechamento (corpo) — faixa mais larga. Padrão ligado (máx/mín). */
export const DEFAULT_PREV_DAY_CLOUD_USE_HIGH_LOW = true;

export function normalizePrevDayCloudUseHighLow(raw) {
  return typeof raw === 'boolean' ? raw : DEFAULT_PREV_DAY_CLOUD_USE_HIGH_LOW;
}

/** Intervalo de candles usado pela nuvem PERM (inclinação EMA9 vs EMA21) — independente do
 *  intervalo do gráfico, mesmo padrão do S/R/PPHL/CHOP (ex.: gráfico em 15m, nuvem calculada
 *  sobre candles de 1h). */
export const DEFAULT_EMA_PERSIST_CLOUD_INTERVAL = '1h';

export function normalizeEmaPersistCloudInterval(raw) {
  return CHART_INTERVAL_OPTIONS.includes(raw) ? raw : DEFAULT_EMA_PERSIST_CLOUD_INTERVAL;
}

/** Quais tons da nuvem PERM aparecem no gráfico (vermelho/verde). */
export { DEFAULT_PERM_CLOUD_TONES, normalizeEmaPersistCloudTones };

/** Intervalo menor usado pra confirmar/preencher a nuvem da PERM (ver
 *  buildEmaCrossPersistenceClouds em emaCrossPersistenceCloud.js): a EMA9 do intervalo principal
 *  virou pra cima, mas só é "firme" se a EMA9 desse intervalo menor também estiver subindo no
 *  candle correspondente; o mesmo intervalo menor também preenche por baixo os buracos da nuvem
 *  principal (candle ausente, estado nulo, ou a hora mais recente que ainda não fechou).
 *  Calculado como ~1/2 do intervalo principal, arredondado pro intervalo padrão mais próximo
 *  (sempre estritamente menor): 1h→30m, 2h→1h, 4h→2h, 8h→4h, 1d→12h. Sem intervalo menor
 *  disponível (ex.: já é '1m'), não há confirmação/preenchimento. */
export function getEmaPersistCloudConfirmInterval(interval) {
  const primaryMs = INTERVAL_MS[interval];
  if (!primaryMs) return null;
  const targetMs = primaryMs / 2;
  let best = null;
  let bestDiff = Infinity;
  for (const [iv, ms] of Object.entries(INTERVAL_MS)) {
    if (ms >= primaryMs) continue; // precisa ser estritamente menor que o principal
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = iv; }
  }
  return best;
}

/** Quais nuvens PERM aparecem no gráfico — 3 switches independentes, um por nível: layer1 é o
 *  próprio intervalo principal escolhido (ex.: 1h — ON por padrão), layer2 é o intervalo de
 *  confirmação (ex.: 1h→30m — ON por padrão), layer3 é mais um nível abaixo (a confirmação DA
 *  confirmação, ex.: 1h→30m→15m — OFF por padrão). Só controla o que é DESENHADO — o layer2
 *  continua sendo calculado e usado pra confirmar/esmaecer o layer1 mesmo se estiver desligado
 *  na tela (ver checkPermFilter-like isBullishConfirmedAt em emaCrossPersistenceCloud.js).
 *  Rótulos mostrados na UI são calculados a partir do intervalo principal (ver
 *  getEmaPersistCloudConfirmInterval), não fixos. */
export const DEFAULT_EMA_PERSIST_CLOUD_LAYERS = { layer1: true, layer2: true, layer3: false };

export function normalizeEmaPersistCloudLayers(raw) {
  return {
    layer1: typeof raw?.layer1 === 'boolean' ? raw.layer1 : DEFAULT_EMA_PERSIST_CLOUD_LAYERS.layer1,
    layer2: typeof raw?.layer2 === 'boolean' ? raw.layer2 : DEFAULT_EMA_PERSIST_CLOUD_LAYERS.layer2,
    layer3: typeof raw?.layer3 === 'boolean' ? raw.layer3 : DEFAULT_EMA_PERSIST_CLOUD_LAYERS.layer3,
  };
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

/** "Limiar RSI" — linha vertical no gráfico de candles onde o RSI(14) do intervalo do gráfico
 *  cruza pra CIMA desse valor (mesmo gatilho do bot RSI Momentum). 0 = desligado. Só aparece
 *  quando o subpainel de RSI está ligado. */
export const RSI_CROSS_THRESHOLD_OPTIONS = [0, 50, 55, 60, 65, 70, 75, 80];
export const DEFAULT_RSI_CROSS_THRESHOLD = 0;

export function normalizeRsiCrossThreshold(raw) {
  const n = Math.round(Number(raw));
  return RSI_CROSS_THRESHOLD_OPTIONS.includes(n) ? n : DEFAULT_RSI_CROSS_THRESHOLD;
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

/** Quantidade de candles visíveis ao abrir o gráfico (janela inicial) — mesmos presets da
 *  toolbar do gráfico (ver LAST_CANDLE_PRESETS em CandlestickChart.jsx). Editável em
 *  Configurações → Quantidade de candles padrão. */
export const CANDLE_COUNT_DISPLAY_OPTIONS = [10, 20, 40, 80, 160, 320];
export const DEFAULT_CANDLE_COUNT_DISPLAY = 40;

export function normalizeCandleCountDisplay(raw) {
  const n = Number(raw);
  return CANDLE_COUNT_DISPLAY_OPTIONS.includes(n) ? n : DEFAULT_CANDLE_COUNT_DISPLAY;
}

/** Escalas de fonte (Configurações → Tamanho da fonte). Multiplicadores, 1 = padrão.
 *  - site: aplicado como `zoom` no #root — cobre TODO o HTML (tabelas, filtros, painéis, botões).
 *  - chart: texto do gráfico. No motor Lightweight Charts (padrão) é o layout.fontSize, um só
 *    pra tudo; no ECharts multiplica todo o texto do gráfico.
 *  - chartPrice / chartPct / chartOco: ajuste fino RELATIVO ao `chart`, só no motor ECharts —
 *    preço do eixo lateral / % de PnL e ciclos / rótulos dos quadrados alvo-stop. */
export const FONT_SCALE_DEFAULT = Object.freeze({ site: 1, chart: 1, chartPrice: 1, chartPct: 1, chartOco: 1 });
export const FONT_SCALE_MIN = 0.7;
export const FONT_SCALE_MAX = 2;
export const FONT_SCALE_STEP = 0.05;

function clampFontScale(raw, dflt) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(v * 100) / 100));
}

export function normalizeFontScale(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of Object.keys(FONT_SCALE_DEFAULT)) out[k] = clampFontScale(src[k], FONT_SCALE_DEFAULT[k]);
  return out;
}

export function normalizeActiveIndicators(arr) {
  if (!Array.isArray(arr)) return [...DEFAULT_ACTIVE_INDICATORS];
  return arr.filter((id) => VALID_ACTIVE_INDICATORS.includes(id));
}

/** Quais indicadores (botões on/off do gráfico) já nascem ATIVOS quando o gráfico abre —
 *  complementar a chartPanelButtons.js (que só controla se o botão APARECE). Editável em
 *  Configurações → Botões do gráfico. Só cobre VALID_ACTIVE_INDICATORS — MA1/MA2/BB/VWAP têm
 *  o próprio controle de "ligado por padrão" nas seções deles (overlaySlots/bbGroups/vwapDefaults). */
export function normalizeDefaultActiveIndicators(raw) {
  const result = {};
  for (const key of VALID_ACTIVE_INDICATORS) {
    result[key] = typeof raw?.[key] === 'boolean' ? raw[key] : DEFAULT_ACTIVE_INDICATORS.includes(key);
  }
  return result;
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
  srCandleCountDefault: DEFAULT_SR_CANDLE_COUNT,
  srStyleDefault: DEFAULT_SR_STYLE,
  pphlIntervalDefault: DEFAULT_PPHL_INTERVAL,
  pphlCandleCountDefault: DEFAULT_INDICATOR_CANDLE_COUNT,
  wfractalsIntervalDefault: DEFAULT_WFRACTALS_INTERVAL,
  wfractalsCandleCountDefault: DEFAULT_INDICATOR_CANDLE_COUNT,
  zigzagIntervalDefault: DEFAULT_ZIGZAG_INTERVAL,
  zigzagCandleCountDefault: DEFAULT_INDICATOR_CANDLE_COUNT,
  chopIntervalDefault: DEFAULT_CHOP_INTERVAL,
  macdIntervalDefault: DEFAULT_MACD_INTERVAL,
  prevDayCloudIntervalDefault: DEFAULT_PREV_DAY_CLOUD_INTERVAL,
  prevDayCloudCandleCountDefault: DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT,
  prevDayCloudUseHighLowDefault: DEFAULT_PREV_DAY_CLOUD_USE_HIGH_LOW,
  emaPersistCloudIntervalDefault: DEFAULT_EMA_PERSIST_CLOUD_INTERVAL,
  emaPersistCloudTonesDefault: { ...DEFAULT_PERM_CLOUD_TONES },
  emaPersistCloudLayersDefault: { ...DEFAULT_EMA_PERSIST_CLOUD_LAYERS },
  barsSinceCrossIntervalDefault: DEFAULT_BARS_SINCE_CROSS_INTERVAL,
  tdSequentialIntervalDefault: DEFAULT_TD_SEQUENTIAL_INTERVAL,
  rsiCrossThresholdDefault: DEFAULT_RSI_CROSS_THRESHOLD,
  vwapDefaults: normalizeVwapDefaults(DEFAULT_VWAP),
  vwapAnchorDefault: normalizeVwapAnchor(DEFAULT_VWAP_ANCHOR),
  vwapSlopeHighlightDefault: normalizeVwapSlopeHighlight(DEFAULT_VWAP_SLOPE_HIGHLIGHT),
  activeIndicators: [...DEFAULT_ACTIVE_INDICATORS],
  defaultActiveIndicators: normalizeDefaultActiveIndicators({}),
  currencyPanelWidth: CURRENCY_PANEL_WIDTH_DEFAULT,
  statsDefaults: normalizeStatsDefaults(DEFAULT_STATS),
  chartEngineDefault: DEFAULT_CHART_ENGINE,
  candleCountDisplayDefault: DEFAULT_CANDLE_COUNT_DISPLAY,
  fontScale: { ...FONT_SCALE_DEFAULT },
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
    srCandleCountDefault: DEFAULT_SR_CANDLE_COUNT,
    srStyleDefault: DEFAULT_SR_STYLE,
    pphlIntervalDefault: DEFAULT_PPHL_INTERVAL,
    pphlCandleCountDefault: DEFAULT_INDICATOR_CANDLE_COUNT,
    wfractalsIntervalDefault: DEFAULT_WFRACTALS_INTERVAL,
    wfractalsCandleCountDefault: DEFAULT_INDICATOR_CANDLE_COUNT,
    zigzagIntervalDefault: DEFAULT_ZIGZAG_INTERVAL,
    zigzagCandleCountDefault: DEFAULT_INDICATOR_CANDLE_COUNT,
    chopIntervalDefault: DEFAULT_CHOP_INTERVAL,
    macdIntervalDefault: DEFAULT_MACD_INTERVAL,
    prevDayCloudIntervalDefault: DEFAULT_PREV_DAY_CLOUD_INTERVAL,
  prevDayCloudCandleCountDefault: DEFAULT_PREV_DAY_CLOUD_CANDLE_COUNT,
    prevDayCloudUseHighLowDefault: DEFAULT_PREV_DAY_CLOUD_USE_HIGH_LOW,
    emaPersistCloudIntervalDefault: DEFAULT_EMA_PERSIST_CLOUD_INTERVAL,
    emaPersistCloudTonesDefault: { ...DEFAULT_PERM_CLOUD_TONES },
    emaPersistCloudLayersDefault: { ...DEFAULT_EMA_PERSIST_CLOUD_LAYERS },
    barsSinceCrossIntervalDefault: DEFAULT_BARS_SINCE_CROSS_INTERVAL,
    tdSequentialIntervalDefault: DEFAULT_TD_SEQUENTIAL_INTERVAL,
    rsiCrossThresholdDefault: DEFAULT_RSI_CROSS_THRESHOLD,
    vwapDefaults: normalizeVwapDefaults(DEFAULT_VWAP),
    vwapAnchorDefault: normalizeVwapAnchor(DEFAULT_VWAP_ANCHOR),
    vwapSlopeHighlightDefault: normalizeVwapSlopeHighlight(DEFAULT_VWAP_SLOPE_HIGHLIGHT),
    activeIndicators: [...DEFAULT_ACTIVE_INDICATORS],
    defaultActiveIndicators: normalizeDefaultActiveIndicators({}),
    currencyPanelWidth: CURRENCY_PANEL_WIDTH_DEFAULT,
    statsDefaults: normalizeStatsDefaults(DEFAULT_STATS),
    chartEngineDefault: DEFAULT_CHART_ENGINE,
    candleCountDisplayDefault: DEFAULT_CANDLE_COUNT_DISPLAY,
    fontScale: { ...FONT_SCALE_DEFAULT },
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
    if (parsed.srCandleCountDefault !== undefined) {
      result.srCandleCountDefault = normalizeSrCandleCount(parsed.srCandleCountDefault);
    }
    if (parsed.srStyleDefault !== undefined) {
      result.srStyleDefault = normalizeSrStyle(parsed.srStyleDefault);
    }
    if (parsed.pphlIntervalDefault !== undefined) {
      result.pphlIntervalDefault = normalizePphlInterval(parsed.pphlIntervalDefault);
    }
    if (parsed.pphlCandleCountDefault !== undefined) {
      result.pphlCandleCountDefault = normalizePphlCandleCount(parsed.pphlCandleCountDefault);
    }
    if (parsed.wfractalsIntervalDefault !== undefined) {
      result.wfractalsIntervalDefault = normalizeWfractalsInterval(parsed.wfractalsIntervalDefault);
    }
    if (parsed.wfractalsCandleCountDefault !== undefined) {
      result.wfractalsCandleCountDefault = normalizeWfractalsCandleCount(parsed.wfractalsCandleCountDefault);
    }
    if (parsed.zigzagIntervalDefault !== undefined) {
      result.zigzagIntervalDefault = normalizeZigzagInterval(parsed.zigzagIntervalDefault);
    }
    if (parsed.zigzagCandleCountDefault !== undefined) {
      result.zigzagCandleCountDefault = normalizeZigzagCandleCount(parsed.zigzagCandleCountDefault);
    }
    if (parsed.chopIntervalDefault !== undefined) {
      result.chopIntervalDefault = normalizeChopInterval(parsed.chopIntervalDefault);
    }
    if (parsed.macdIntervalDefault !== undefined) {
      result.macdIntervalDefault = normalizeMacdInterval(parsed.macdIntervalDefault);
    }
    if (parsed.prevDayCloudIntervalDefault !== undefined) {
      result.prevDayCloudIntervalDefault = normalizePrevDayCloudInterval(parsed.prevDayCloudIntervalDefault);
    }
    if (parsed.prevDayCloudCandleCountDefault !== undefined) {
      result.prevDayCloudCandleCountDefault = normalizePrevDayCloudCandleCount(parsed.prevDayCloudCandleCountDefault);
    }
    if (parsed.prevDayCloudUseHighLowDefault !== undefined) {
      result.prevDayCloudUseHighLowDefault = normalizePrevDayCloudUseHighLow(parsed.prevDayCloudUseHighLowDefault);
    }
    if (parsed.emaPersistCloudIntervalDefault !== undefined) {
      result.emaPersistCloudIntervalDefault = normalizeEmaPersistCloudInterval(parsed.emaPersistCloudIntervalDefault);
    }
    if (parsed.emaPersistCloudTonesDefault !== undefined) {
      result.emaPersistCloudTonesDefault = normalizeEmaPersistCloudTones(parsed.emaPersistCloudTonesDefault);
    }
    if (parsed.emaPersistCloudLayersDefault !== undefined) {
      result.emaPersistCloudLayersDefault = normalizeEmaPersistCloudLayers(parsed.emaPersistCloudLayersDefault);
    }
    if (parsed.barsSinceCrossIntervalDefault !== undefined) {
      result.barsSinceCrossIntervalDefault = normalizeBarsSinceCrossInterval(parsed.barsSinceCrossIntervalDefault);
    }
    if (parsed.tdSequentialIntervalDefault !== undefined) {
      result.tdSequentialIntervalDefault = normalizeTdSequentialInterval(parsed.tdSequentialIntervalDefault);
    }
    if (parsed.rsiCrossThresholdDefault !== undefined) {
      result.rsiCrossThresholdDefault = normalizeRsiCrossThreshold(parsed.rsiCrossThresholdDefault);
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
    if (parsed.defaultActiveIndicators) {
      result.defaultActiveIndicators = normalizeDefaultActiveIndicators(parsed.defaultActiveIndicators);
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
    if (parsed.candleCountDisplayDefault !== undefined) {
      result.candleCountDisplayDefault = normalizeCandleCountDisplay(parsed.candleCountDisplayDefault);
    }
    if (parsed.fontScale !== undefined) {
      result.fontScale = normalizeFontScale(parsed.fontScale);
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
