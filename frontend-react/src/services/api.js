/**
 * Serviços de API — chamadas ao backend Express.
 * O proxy do Vite (vite.config.js) redireciona /services → http://localhost:3000
 */

import { buildRsiNomeFromQuery } from '../utils/filterNames';

/** Evita fetch duplicado (React StrictMode / init concorrente). */
let allCurrenciesCache = null;
let allCurrenciesInflight = null;

export async function fetchAllCurrencies() {
  if (allCurrenciesCache) return allCurrenciesCache;
  if (allCurrenciesInflight) return allCurrenciesInflight;

  allCurrenciesInflight = fetch('/services/currencies')
    .then((res) => {
      if (!res.ok) throw new Error('Falha ao buscar moedas');
      return res.json();
    })
    .then((data) => {
      allCurrenciesCache = data;
      return data;
    })
    .finally(() => {
      allCurrenciesInflight = null;
    });

  return allCurrenciesInflight;
}

/** Limpa cache após refresh manual (opcional). */
export function invalidateAllCurrenciesCache() {
  allCurrenciesCache = null;
  allCurrenciesInflight = null;
}

export async function fetchUserPrefs() {
  try {
    const res = await fetch('/services/sb/user-prefs');
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function saveUserPrefs(update) {
  fetch('/services/sb/user-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  }).catch(() => {});
}

export async function fetchStablecoins() {
  const res = await fetch('/services/stablecoins');
  if (!res.ok) throw new Error(`stablecoins falhou: HTTP ${res.status}`);
  return res.json(); // [{ name, list }]
}

export async function fetchMarketCapFilter(metric, preset) {
  const res = await fetch(`/services/market-cap-filter?metric=${metric}&preset=${preset}`);
  if (!res.ok) throw new Error(`market-cap-filter falhou: HTTP ${res.status}`);
  return res.json(); // { name, list }
}

export async function fetch24hVolume() {
  const res = await fetch('/services/24hs-volume');
  if (!res.ok) throw new Error('Falha ao buscar volume 24h');
  return res.json();
}

/** Top 10 em alta + novas listagens (Binance e Gate.io). */
export async function fetchMarketHighlights(limit = 10) {
  const res = await fetch(`/services/market-highlights?limit=${limit}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `market-highlights falhou: HTTP ${res.status}`);
  }
  return res.json(); // [{ name, list, meta? }]
}

/** Pares com salto de volume em tempo real (últimos 15min), detectado pelo monitor do backend. */
export async function fetchVolumeIgnition() {
  const res = await fetch('/services/volume-ignition');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `volume-ignition falhou: HTTP ${res.status}`);
  }
  return res.json(); // { list: [{ symbol, firedAt, ratio, priceChangePct, price }] }
}

/**
 * Analisa ciclos MA: entrada EMA9↑EMA21, saída EMA9↓EMA21.
 */
export async function fetchMaCrossStats(symbol, {
  entryInterval = '15m',
  exitInterval = '15m',
  period1 = 9,
  period2 = 21,
  source = null,
  candleCount = null,
} = {}) {
  const params = new URLSearchParams({
    symbol,
    entryInterval,
    exitInterval,
    period1: String(period1),
    period2: String(period2),
  });
  if (source) params.set('source', source);
  if (candleCount) params.set('candleCount', String(candleCount));
  const res = await fetch(`/services/ma-cross-stats?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchVwapBandsStats(symbol, {
  source = null, entryInterval = null, session = null, vwapInterval = null, pollInterval = null,
  emaFilterEnabled = null, emaFilterPeriod = null, emaFilterInterval = null, candleCount = null,
} = {}) {
  const params = new URLSearchParams({ symbol });
  if (source) params.set('source', source);
  if (entryInterval) params.set('entryInterval', entryInterval);
  if (session) params.set('session', session);
  if (vwapInterval) params.set('vwapInterval', vwapInterval);
  if (pollInterval) params.set('pollInterval', pollInterval);
  if (emaFilterEnabled !== null) params.set('emaFilterEnabled', emaFilterEnabled ? '1' : '0');
  if (emaFilterPeriod !== null) params.set('emaFilterPeriod', String(emaFilterPeriod));
  if (emaFilterInterval) params.set('emaFilterInterval', emaFilterInterval);
  if (candleCount) params.set('candleCount', String(candleCount));
  const res = await fetch(`/services/vwap-bands-stats?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchRsiOversoldRecovery(symbol, interval, oversold = 30, overbought = 70, source = null, candleCount = null) {
  const params = new URLSearchParams({ symbol, interval, oversold, overbought });
  if (source) params.set('source', source);
  if (candleCount) params.set('candleCount', String(candleCount));
  const res = await fetch(`/services/rsi-oversold-recovery?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchRsiThresholdBacktest(symbol, interval, options = {}) {
  const {
    rsiThreshold = 70, pullbackPct = 0, targetPct = 5, stopLossPct = 5, positionSizeUsd = 40,
    source = null, candleCount = null, lookbackHours = 0, bandWidth = null, prevDayCloud = null,
    minVolumeUsdt = 0, excludeOpenExits = false, prevCandleStop = false,
    adxFilter = null, macdFilter = null, trailingStop = null, trailingTarget = null, targetMode = null, entriesDayRange = null,
  } = options;
  const params = new URLSearchParams({
    symbol, interval, rsiThreshold, pullbackPct, targetPct, stopLossPct, positionSizeUsd,
  });
  if (source) params.set('source', source);
  if (candleCount) params.set('candleCount', String(candleCount));
  if (lookbackHours) params.set('lookbackHours', String(lookbackHours));
  if (bandWidth?.enabled) {
    params.set('bandWidthEnabled', '1');
    params.set('bandWidthInterval', bandWidth.interval ?? '5m');
    params.set('bandWidthMinPct', String(bandWidth.minPct ?? 2));
    if (bandWidth.period) params.set('bandWidthPeriod', String(bandWidth.period));
    if (bandWidth.stdDev) params.set('bandWidthStdDev', String(bandWidth.stdDev));
    if (bandWidth.lookback) params.set('bandWidthLookback', String(bandWidth.lookback));
  }
  if (prevDayCloud?.enabled) {
    params.set('prevDayCloudEnabled', '1');
    params.set('prevDayCloudMaxPct', String(prevDayCloud.maxPct ?? 100));
    params.set('prevDayCloudInterval', prevDayCloud.interval ?? '1d');
    params.set('prevDayCloudCandleCount', String(prevDayCloud.candleCount ?? 1));
    params.set('prevDayCloudUseHighLow', prevDayCloud.useHighLow === false ? '0' : '1');
  }
  if (minVolumeUsdt) params.set('minVolumeUsdt', String(minVolumeUsdt));
  if (excludeOpenExits) params.set('excludeOpenExits', '1');
  if (prevCandleStop) params.set('prevCandleStopEnabled', '1');
  if (adxFilter?.enabled) {
    params.set('adxFilterEnabled', '1');
    params.set('adxFilterInterval', adxFilter.interval ?? '1h');
    params.set('adxFilterMinAdx', String(adxFilter.minAdx ?? 25));
  }
  if (macdFilter?.enabled) {
    params.set('macdFilterEnabled', '1');
    params.set('macdFilterInterval', macdFilter.interval ?? '1h');
  }
  if (trailingStop?.enabled) {
    params.set('trailingStopEnabled', '1');
    params.set('trailingStopStartPct', String(trailingStop.startPct ?? stopLossPct));
    params.set('trailingStopCoinStepPct', String(trailingStop.coinStepPct ?? 1));
    params.set('trailingStopStopStepPct', String(trailingStop.stopStepPct ?? 1));
  }
  if (targetMode && targetMode !== 'fixed') params.set('targetMode', targetMode);
  if (targetMode === 'continuous' && trailingTarget) {
    params.set('trailingTargetCoinStepPct', String(trailingTarget.coinStepPct ?? 3));
    params.set('trailingTargetStepPct', String(trailingTarget.stepPct ?? 3));
  }
  if (entriesDayRange?.max != null) {
    params.set('entriesDayRangeMin', String(entriesDayRange.min ?? 2));
    params.set('entriesDayRangeMax', String(entriesDayRange.max));
  }
  const res = await fetch(`/services/rsi-threshold-backtest?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchRsiThresholdBacktestMarket(interval, options = {}) {
  const {
    rsiThreshold = 70, pullbackPct = 0, targetPct = 5, stopLossPct = 5, positionSizeUsd = 40,
    source = null, candleCount = null, lookbackHours = 0, bandWidth = null, maxRows = null,
    prevDayCloud = null, minVolumeUsdt = 0, excludeOpenExits = false, prevCandleStop = false,
    adxFilter = null, macdFilter = null, trailingStop = null, trailingTarget = null, targetMode = null, entriesDayRange = null,
  } = options;
  const params = new URLSearchParams({
    interval, rsiThreshold, pullbackPct, targetPct, stopLossPct, positionSizeUsd,
  });
  if (source) params.set('source', source);
  if (candleCount) params.set('candleCount', String(candleCount));
  if (lookbackHours) params.set('lookbackHours', String(lookbackHours));
  if (maxRows) params.set('maxRows', String(maxRows));
  if (bandWidth?.enabled) {
    params.set('bandWidthEnabled', '1');
    params.set('bandWidthInterval', bandWidth.interval ?? '5m');
    params.set('bandWidthMinPct', String(bandWidth.minPct ?? 2));
    if (bandWidth.period) params.set('bandWidthPeriod', String(bandWidth.period));
    if (bandWidth.stdDev) params.set('bandWidthStdDev', String(bandWidth.stdDev));
    if (bandWidth.lookback) params.set('bandWidthLookback', String(bandWidth.lookback));
  }
  if (prevDayCloud?.enabled) {
    params.set('prevDayCloudEnabled', '1');
    params.set('prevDayCloudMaxPct', String(prevDayCloud.maxPct ?? 100));
    params.set('prevDayCloudInterval', prevDayCloud.interval ?? '1d');
    params.set('prevDayCloudCandleCount', String(prevDayCloud.candleCount ?? 1));
    params.set('prevDayCloudUseHighLow', prevDayCloud.useHighLow === false ? '0' : '1');
  }
  if (minVolumeUsdt) params.set('minVolumeUsdt', String(minVolumeUsdt));
  if (excludeOpenExits) params.set('excludeOpenExits', '1');
  if (prevCandleStop) params.set('prevCandleStopEnabled', '1');
  if (adxFilter?.enabled) {
    params.set('adxFilterEnabled', '1');
    params.set('adxFilterInterval', adxFilter.interval ?? '1h');
    params.set('adxFilterMinAdx', String(adxFilter.minAdx ?? 25));
  }
  if (macdFilter?.enabled) {
    params.set('macdFilterEnabled', '1');
    params.set('macdFilterInterval', macdFilter.interval ?? '1h');
  }
  if (trailingStop?.enabled) {
    params.set('trailingStopEnabled', '1');
    params.set('trailingStopStartPct', String(trailingStop.startPct ?? stopLossPct));
    params.set('trailingStopCoinStepPct', String(trailingStop.coinStepPct ?? 1));
    params.set('trailingStopStopStepPct', String(trailingStop.stopStepPct ?? 1));
  }
  if (targetMode && targetMode !== 'fixed') params.set('targetMode', targetMode);
  if (targetMode === 'continuous' && trailingTarget) {
    params.set('trailingTargetCoinStepPct', String(trailingTarget.coinStepPct ?? 3));
    params.set('trailingTargetStepPct', String(trailingTarget.stepPct ?? 3));
  }
  if (entriesDayRange?.max != null) {
    params.set('entriesDayRangeMin', String(entriesDayRange.min ?? 2));
    params.set('entriesDayRangeMax', String(entriesDayRange.max));
  }
  const res = await fetch(`/services/rsi-threshold-backtest-market?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Salva uma pesquisa da tela Estatísticas → Momentum RSI (config + resumo do resultado) num
 *  JSON no backend, pra comparar combinações depois. Fire-and-forget — não deve quebrar a UI. */
export async function saveRsiMomentumStatsSearch(payload) {
  const res = await fetch('/services/rsi-momentum-stats-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Lista as pesquisas salvas (mais recente primeiro). */
export async function getRsiMomentumStatsSearches() {
  const res = await fetch('/services/rsi-momentum-stats-searches');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Apaga TODAS as pesquisas salvas do log. */
export async function clearRsiMomentumStatsSearches() {
  const res = await fetch('/services/rsi-momentum-stats-searches', { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSimpleMaCross(symbol, entryInterval = '15m', exitInterval = '30m', source = null) {
  const params = new URLSearchParams({ symbol, entryInterval, exitInterval });
  if (source) params.set('source', source);
  const res = await fetch(`/services/ma-cross-simple?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Analisa ciclos fundo→topo na Bollinger Bands (4h por padrão) para uma moeda.
 *  `pullbackPct` (>0) exige que o preço caia esse tanto % abaixo da banda inferior antes de
 *  contar a entrada — simula um limite de compra nesse preço (mesmo `entry.pullback.belowPct`
 *  do bot). 0 = desligado, entra assim que a banda é tocada (padrão).
 *  `permFilter` ({h1,m30,m15}, cada um opcional/independente): só conta a entrada se a nuvem
 *  PERM (EMA9×EMA21) de TODOS os níveis habilitados já estiver verde/fechada nesse instante (sem
 *  look-ahead — ver analyseBollingerBandRecovery.js no backend). Ausente/todos false = não filtra. */
export async function fetchBollingerBandRecovery(symbol, interval = '4h', period = 20, stdDev = 2, source = null, medianTrendFilter = false, medianTrendLookback = 10, pullbackPct = 0, candleCount = 1000, permFilter = null, lookback = 0) {
  const params = new URLSearchParams({ symbol, interval, period, stdDev, candleCount });
  if (source) params.set('source', source);
  if (medianTrendFilter) {
    params.set('medianTrendFilter', '1');
    params.set('medianTrendLookback', medianTrendLookback);
  }
  if (pullbackPct > 0) params.set('pullbackPct', pullbackPct);
  if (lookback > 0) params.set('lookback', lookback);
  if (permFilter?.h1) params.set('permH1', '1');
  if (permFilter?.m30) params.set('permM30', '1');
  if (permFilter?.m15) params.set('permM15', '1');
  const res = await fetch(`/services/bollinger-band-recovery?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Filtra moedas por posição na Bollinger Bands (%B): mais próximas do fundo ou do topo. */
export async function fetchBollingerBandPositionFilter({
  interval = '4h', period = '20', stdDev = '2', position = 'near_bottom', proximityPct = '20',
} = {}) {
  const params = new URLSearchParams({ interval, period, stdDev, position, proximityPct });
  const res = await fetch(`/services/bollinger-band-position-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Filtra moedas por exaustão nas bandas de VWAP: preço perto do topo ou do fundo. */
export async function fetchVwapPositionFilter({
  interval = '4h', session = 'daily', bandMultiplier = '2', position = 'near_bottom', proximityPct = '20',
} = {}) {
  const params = new URLSearchParams({ interval, session, bandMultiplier, position, proximityPct });
  const res = await fetch(`/services/vwap-position-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Filtra moedas por largura das bandas de VWAP (±2σ), média nos últimos N candles: mais/menos distantes. */
export async function fetchVwapBandWidthFilter({
  interval = '4h', session = 'weekly', lookback = '100', order = 'far',
} = {}) {
  const params = new URLSearchParams({ interval, session, lookback, order });
  const res = await fetch(`/services/vwap-band-width-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Filtra moedas por largura das Bandas de Bollinger (upper-lower como % da banda inferior),
 * média nos últimos N candles: mais/menos distantes. Com `symbols`, pula o scan do mercado
 * inteiro e calcula só pros símbolos pedidos (resposta rápida, usado pelos favoritos BB).
 */
export async function fetchBollingerBandWidthFilter({
  interval = '4h', period = '20', stdDev = '2', lookback = '100', order = 'far', symbols = null, gateSymbols = null,
  force = false, widthMinPct = null, widthMaxPct = null,
} = {}) {
  const params = new URLSearchParams({ interval, period, stdDev, lookback, order });
  if (symbols?.length) params.set('symbols', symbols.join(','));
  if (gateSymbols?.length) params.set('gateSymbols', gateSymbols.join(','));
  if (force) params.set('force', '1');
  if (widthMinPct != null && widthMinPct !== '') params.set('widthMinPct', widthMinPct);
  if (widthMaxPct != null && widthMaxPct !== '') params.set('widthMaxPct', widthMaxPct);
  const res = await fetch(`/services/bollinger-band-width-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Simula trades teóricos na Bollinger Band (compra na banda inferior, vende na superior)
 * filtrados pela regra de tendência da linha mediana, nos últimos N candles fechados —
 * retorna quantidade de trades e média de ganho/perda (`side`: pos=só ganhos, neg=só perdas,
 * all=todos).
 */
export async function fetchBollingerMedianTrendFilter({
  interval = '15m', period = '20', stdDev = '2', lookback = '700', side = 'pos', order = 'best',
} = {}) {
  const params = new URLSearchParams({ interval, period, stdDev, lookback, side, order });
  const res = await fetch(`/services/bollinger-median-trend-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Filtra moedas por expansão do afastamento entre -1σ e +2σ da VWAP: mínimo recente vs. atual. */
export async function fetchVwapBandExpansionFilter({
  interval = '15m', vwapInterval = '4h', lookback = '10', multiplier = '3',
} = {}) {
  const params = new URLSearchParams({ interval, vwapInterval, lookback, multiplier });
  const res = await fetch(`/services/vwap-band-expansion-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getFavorites(type) {
  const res = await fetch(`/services/sb/favorites?type=${type}`);
  if (!res.ok) throw new Error('Falha ao buscar favoritos');
  return res.json();
}

export async function addFavorite(symbol, type) {
  console.log('[Favoritos] API addFavorite', { symbol, type });
  const res = await fetch('/services/sb/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, type }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error('[Favoritos] API addFavorite falhou', { symbol, type, status: res.status, body });
    throw new Error(body?.error || 'Falha ao adicionar favorito');
  }
  const data = await res.json();
  console.log('[Favoritos] API addFavorite OK', { symbol, type });
  return data;
}

export async function addTradeFavorite(symbol, { exchange = 'binance', interval, rsiBuy, rsiSell, sellInterval }) {
  console.log('[Favoritos] API addTradeFavorite', { symbol, exchange, interval, rsiBuy, rsiSell });
  const res = await fetch('/services/sb/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, type: 'trade', exchange, interval, rsiBuy, rsiSell, sellInterval: sellInterval || null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error('[Favoritos] API addTradeFavorite falhou', { symbol, status: res.status, body });
    throw new Error(body?.error || 'Falha ao salvar configuração de trade');
  }
  const data = await res.json();
  console.log('[Favoritos] API addTradeFavorite OK', symbol);
  return data;
}

export async function removeFavorite(symbol, type) {
  console.log('[Favoritos] API removeFavorite', { symbol, type });
  const res = await fetch(`/services/sb/favorites/${encodeURIComponent(symbol)}?type=${type}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error('[Favoritos] API removeFavorite falhou', { symbol, type, status: res.status, body });
    throw new Error(body?.error || 'Falha ao remover favorito');
  }
  const data = await res.json();
  console.log('[Favoritos] API removeFavorite OK', { symbol, type });
  return data;
}

// ── Active Trades (posições reais nas exchanges) ─────────────────────────────

/**
 * Retorna os símbolos com saldo real nas exchanges (Gate.io + Binance) acima de $3.
 * @returns {Promise<Array<{symbol, exchange, buyPrice, buyQty}>>}
 */
export async function fetchActiveTrades() {
  const res = await fetch('/services/active-trades');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function ignoreActiveTrade(symbol) {
  const res = await fetch('/services/active-trades/ignore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function unignoreActiveTrade(symbol) {
  const res = await fetch(`/services/active-trades/ignore/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchIgnoredActiveTrades() {
  const res = await fetch('/services/active-trades/ignore');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * @returns {Promise<{minHoldingUsdt: number, showCash: boolean}>}
 */
export async function fetchActiveTradesSettings() {
  const res = await fetch('/services/active-trades/settings');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateActiveTradesSettings(patch) {
  const res = await fetch('/services/active-trades/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Resumo de moedas compradas/vendidas (Gate + Binance) com PnL por período.
 * @param {string[]} [extraSymbols] símbolos extras (favoritos) para buscar na Binance
 */
export async function fetchTradeFavorites(extraSymbols = [], { fresh = false } = {}) {
  const params = new URLSearchParams();
  if (extraSymbols?.length) params.set('symbols', extraSymbols.join(','));
  if (fresh) params.set('fresh', '1');
  const qs = params.toString();
  const res = await fetch(`/services/trade-favorites${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Gate.io Trading ──────────────────────────────────────────────────────────

/** Retorna os trades do usuário para um símbolo na Gate.io (máx 1000). */
export async function fetchGateTrades(symbol, limit = 500) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase(), limit });
  const res = await fetch(`/services/gate-trades?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Retorna saldos da conta Gate.io (somente não-zero). */
export async function fetchGateAccount() {
  const res = await fetch('/services/gate-account');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Envia uma ordem na Gate.io.
 * @param {{ symbol, side: 'buy'|'sell', type?: 'market'|'limit', amount, price?, allowCancelBracket? }} params
 */
export async function placeGateOrder({ symbol, side, type = 'market', amount, price, strategyId, allowCancelBracket }) {
  const res = await fetch('/services/gate-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, side, type, amount, price, strategyId, allowCancelBracket }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.needsBracketCancel = !!body.needsBracketCancel;
    throw err;
  }
  return res.json();
}

/**
 * Coloca uma OCO de venda na Gate.io (TP em entryPrice*(1+targetPct/100), SL em
 * entryPrice*(1-stopPct/100)) em vez de vender a mercado — mesma bracket que o bot coloca
 * sozinho, disparada manualmente pelo botão de vender (venda direta vs. OCO).
 * @param {{ symbol, quantity, entryPrice, targetPct, stopPct, strategyId?, allowCancelBracket? }} params
 */
export async function placeGateBracketSell({ symbol, quantity, entryPrice, targetPct, stopPct, strategyId, allowCancelBracket }) {
  const res = await fetch('/services/gate-bracket-sell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, quantity, entryPrice, targetPct, stopPct, strategyId, allowCancelBracket }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.needsBracketCancel = !!body.needsBracketCancel;
    throw err;
  }
  return res.json();
}

/** Último preço negociado na Gate.io — usado pelo slider OCO do botão de vender pra avisar
 *  quando o alvo/stop arrastado (sobre o preço de compra) está longe do preço atual. */
export async function fetchGatePrice(symbol) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  const res = await fetch(`/services/gate-price?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Diz se vender `quantity` desse símbolo na Gate.io vai precisar cancelar uma bracket resting. */
export async function checkGateOrderLock(symbol, quantity) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase(), quantity: String(quantity) });
  const res = await fetch(`/services/gate-order-lock?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Binance Trading ──────────────────────────────────────────────────────────

/** Retorna os trades do usuário para um símbolo (máx 500). */
export async function fetchBinanceTrades(symbol, limit = 500) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase(), limit });
  const res = await fetch(`/services/binance-trades?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Retorna saldos da conta Binance (somente não-zero). */
export async function fetchBinanceAccount() {
  const res = await fetch('/services/binance-account');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Envia uma ordem na Binance.
 * @param {{ symbol, side: 'BUY'|'SELL', type?: 'MARKET'|'LIMIT', quantity, price?, allowCancelBracket? }} params
 */
export async function placeBinanceOrder({ symbol, side, type = 'MARKET', quantity, price, strategyId, allowCancelBracket }) {
  const res = await fetch('/services/binance-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, side, type, quantity, price, strategyId, allowCancelBracket }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.needsBracketCancel = !!body.needsBracketCancel;
    throw err;
  }
  return res.json();
}

/**
 * Coloca uma OCO de venda na Binance (TP em entryPrice*(1+targetPct/100), SL em
 * entryPrice*(1-stopPct/100)) em vez de vender a mercado — mesma bracket que o bot coloca
 * sozinho, disparada manualmente pelo botão de vender (venda direta vs. OCO).
 * @param {{ symbol, quantity, entryPrice, targetPct, stopPct, strategyId?, allowCancelBracket? }} params
 */
export async function placeBinanceBracketSell({ symbol, quantity, entryPrice, targetPct, stopPct, strategyId, allowCancelBracket }) {
  const res = await fetch('/services/binance-bracket-sell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, quantity, entryPrice, targetPct, stopPct, strategyId, allowCancelBracket }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.needsBracketCancel = !!body.needsBracketCancel;
    throw err;
  }
  return res.json();
}

/** Último preço negociado na Binance — usado pelo slider OCO do botão de vender pra avisar
 *  quando o alvo/stop arrastado (sobre o preço de compra) está longe do preço atual. */
export async function fetchBinancePrice(symbol) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  const res = await fetch(`/services/binance-price?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Até quantos % abaixo do preço atual a Binance aceita numa ordem LIMIT de compra desse
 *  símbolo (filtro PERCENT_PRICE_BY_SIDE, lado bid) — usado pelo campo "Pullback" do
 *  formulário Bollinger Bands. */
export async function fetchBinancePercentPriceFilter(symbol) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  const res = await fetch(`/services/binance-percent-price-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Diz se vender `quantity` desse símbolo na Binance vai precisar cancelar uma OCO resting. */
export async function checkBinanceOrderLock(symbol, quantity) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase(), quantity: String(quantity) });
  const res = await fetch(`/services/binance-order-lock?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────

export async function reloadCandles(symbol, interval = 'all') {
  const params = new URLSearchParams({ symbol, interval });
  const res = await fetch(`/services/reload-candles?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Retorna lista de todas as moedas USDT disponíveis na Gate.io (cache 5min no backend). */
export async function fetchGateCurrencies() {
  const res = await fetch('/services/gate-currencies');
  if (!res.ok) throw new Error('Falha ao buscar moedas Gate.io');
  return res.json(); // [{ symbol, price, volume }]
}

/** Dispara o pré-carregamento de todos os intervalos padrão para um símbolo Gate.io. */
export function gatePreloadCandles(symbol) {
  fetch(`/services/gate-prefetch?symbol=${encodeURIComponent(symbol)}`).catch(() => {});
}

/**
 * Busca candles + Ichimoku + EMA para exibir no gráfico.
 * @param {string} symbol   ex: 'BTCUSDT'
 * @param {string} interval ex: '1h'
 * @param {string} [source] 'gate' para forçar Gate.io; omitir para Binance
 */
export const DEFAULT_CANDLE_LIMIT = 160;

export async function fetchCandlesticksAndCloud(symbol, interval, source = null, limit = DEFAULT_CANDLE_LIMIT) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candlesRaw = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then((r) => r.json());

  if (!Array.isArray(candlesRaw)) {
    throw new Error(`Candles indisponíveis para ${symbol} ${interval}`);
  }
  // Dedup por openTime + ordenação ascendente — o cache local de candles (backend) já tenta
  // manter isso, mas paginação/merge de histórico grande (arrasto pra carregar mais) ocasionalmente
  // devolve fora de ordem, e o Lightweight Charts derruba a página inteira (assert "data must be
  // asc ordered by time") quando isso chega no RSI (alignIndicatorToCandles usa esse array cru).
  // Ordenar aqui, antes de mandar pros services de indicador, garante que candlesticks e os
  // indicadores calculados em cima dele fiquem sempre alinhados e em ordem.
  const candles = Array.from(
    new Map(candlesRaw.map((c) => [c.openTime, c])).values(),
  ).sort((a, b) => a.openTime - b.openTime);

  const [ichimokuCloud, movingAverage, ma50, ma9, ma21, rsi] = await Promise.all([
    fetch('/services/ichimoku-cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candles.slice(-Math.max(limit, 166))),
    }).then((r) => r.json()),

    fetch('/services/sma?period=200', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candles.slice(-600)),
    }).then((r) => r.json()),

    fetch('/services/sma?period=50', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candles.slice(-300)),
    }).then((r) => r.json()),

    fetch('/services/sma?period=9', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candles.slice(-300)),
    }).then((r) => r.json()),

    fetch('/services/sma?period=21', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candles.slice(-300)),
    }).then((r) => r.json()),

    fetch('/services/rsi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candles),
    }).then((r) => r.json()),
  ]);

  return { symbol, interval, source: source ?? null, price: candles.at(-1)?.close, candlesticks: candles, ichimokuCloud, movingAverage, ma50, ma9, ma21, rsi };
}

/**
 * Envia apenas a query string para o backend e retorna um filtro pronto
 * para o CurrencyContext: { name, list }.
 * Ex: fetchIndicatorSearch("8h|rsi|above|70|bellow|99", "en")
 */
export async function fetchIndicatorSearch(query, lang = 'en') {
  console.log('[frontend-react] fetchIndicatorSearch → enviando query:', query);

  const params = new URLSearchParams({ query, lang });
  const res = await fetch(`/services/indicator-search?${params}`);
  if (!res.ok) throw new Error(`indicator-search falhou: HTTP ${res.status}`);

  const data = await res.json();
  console.log('[frontend-react] fetchIndicatorSearch ← recebido:', data.length, 'moedas', data);

  const nome = data.length > 0 ? data[0].nome : buildRsiNomeFromQuery(query, lang);
  const list = data.map((r) => r.coin.symbol.replace('/USDT', 'USDT'));
  const meta = {};
  data.forEach((r) => {
    const symbol = r.coin.symbol.replace('/USDT', 'USDT');
    const rsi = r.rsi ?? r.values?.at(-1) ?? null;
    meta[symbol] = { rsi };
  });

  console.log('[frontend-react] filtro criado:', nome, '→', list.length, 'símbolos:', list);
  return { name: nome, list, meta };
}

export async function fetchMaFilter({ interval, period = '50', compare = 'above', candle = 'close', lang = 'en' }) {
  const params = new URLSearchParams({ interval, period: String(period), compare, candle, lang });
  const res = await fetch(`/services/ma-filter?${params}`);
  if (!res.ok) throw new Error(`ma-filter falhou: HTTP ${res.status}`);
  return res.json();
}

/** Moedas com ≥minPct% do histórico com close acima da MA (cache no servidor). */
export async function fetchMaTimeAboveFilter({ interval, period = '50', minPct = '70', force = false }) {
  const params = new URLSearchParams({
    interval,
    period: String(period),
    minPct: String(minPct),
  });
  if (force) params.set('force', '1');
  const res = await fetch(`/services/ma-time-above-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `ma-time-above-filter falhou: HTTP ${res.status}`);
  }
  return res.json();
}

/** Moedas com cruzamento ou proximidade de cruzamento entre duas MAs. */
let _maCrossFilterLastAt = 0;
let _maCrossFilterCount = 0;

export async function fetchMaCrossoverFilter({
  period1 = '9',
  interval1 = '15m',
  period2 = '21',
  interval2 = '15m',
  mode = 'cross_up',
  maxAgeMin = 'last',
  tolerancePct = '0',
  proximityPct = '1',
  live = true,
}) {
  const startedAt = Date.now();
  _maCrossFilterCount += 1;
  const n = _maCrossFilterCount;
  const sinceLastMs = _maCrossFilterLastAt ? startedAt - _maCrossFilterLastAt : null;
  _maCrossFilterLastAt = startedAt;

  const params = new URLSearchParams({
    period1: String(period1),
    interval1,
    period2: String(period2),
    interval2,
    mode,
    maxAgeMin: String(maxAgeMin),
    tolerancePct: String(tolerancePct),
    proximityPct: String(proximityPct),
  });
  if (live) params.set('live', '1');

  const label = `${period1}(${interval1})×${period2}(${interval2}) ${mode} age=${maxAgeMin} live=${live ? 1 : 0}`;
  console.log(
    `[ma-crossover-filter] #${n} start` +
    (sinceLastMs != null ? ` | intervalo desde última: ${(sinceLastMs / 1000).toFixed(1)}s` : ' | primeira solicitação') +
    ` | ${label}`,
  );

  try {
    const res = await fetch(`/services/ma-crossover-filter?${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `ma-crossover-filter falhou: HTTP ${res.status}`);
    }
    const data = await res.json();
    const durationMs = Date.now() - startedAt;
    console.log(
      `[ma-crossover-filter] #${n} ok` +
      ` | duração: ${(durationMs / 1000).toFixed(1)}s` +
      (sinceLastMs != null ? ` | intervalo: ${(sinceLastMs / 1000).toFixed(1)}s` : '') +
      ` | símbolos: ${data?.list?.length ?? 0}`,
    );
    return data;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    console.warn(
      `[ma-crossover-filter] #${n} erro` +
      ` | duração: ${(durationMs / 1000).toFixed(1)}s` +
      (sinceLastMs != null ? ` | intervalo: ${(sinceLastMs / 1000).toFixed(1)}s` : '') +
      ` | ${err.message}`,
    );
    throw err;
  }
}

export async function fetchMaCompareFilter({
  period1 = '9',
  period2 = '21',
  interval = '1h',
  compare = 'above',
  tolerancePct = '0.5',
  proximityPct = '0.5',
  lang = 'pt',
} = {}) {
  const params = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval,
    compare,
    tolerancePct: String(tolerancePct),
    proximityPct: String(proximityPct),
    lang,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`/services/ma-compare-filter?${params}`, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `ma-compare-filter falhou: HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('ma-compare-filter: tempo limite excedido (20s) — cache do servidor ocupado, tente novamente');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Filtra moedas por distância do preço vs uma única EMA (ex.: acima da EMA21 no 4h). */
export async function fetchMaDistanceFilter({
  interval = '4h', period = '21', compare = 'above', lang = 'pt',
} = {}) {
  const params = new URLSearchParams({ interval, period: String(period), compare, lang });
  const res = await fetch(`/services/ma-distance-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `ma-distance-filter falhou: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Filtra moedas por "crescimento por ciclo" (fundo→topo): valorização média (%) entre o
 * fundo (ex.: toque na banda inferior de Bollinger / RSI sobrevendido / cruzamento EMA↑) e
 * o topo (banda superior / RSI sobrecomprado / cruzamento EMA↓), usando todo o histórico
 * de candles salvo em disco.
 */
export async function fetchIndicatorGrowthFilter({
  indicator = 'bollinger', interval = '4h', thresholdPct = '10',
  period = '20', stdDev = '2', oversold = '30', overbought = '70', period1 = '9', period2 = '21',
  from = '50', to = '70', maxMinutes = '60',
  confluenceInterval, confluenceThresholdPct = '0', bbPeriod = '20', bbStdDev = '2',
} = {}) {
  const params = new URLSearchParams({ indicator, interval, thresholdPct: String(thresholdPct) });
  if (indicator === 'bollinger') {
    params.set('period', String(period));
    params.set('stdDev', String(stdDev));
  } else if (indicator === 'rsi') {
    params.set('rsiPeriod', String(period));
    params.set('oversold', String(oversold));
    params.set('overbought', String(overbought));
  } else if (indicator === 'maCross') {
    params.set('period1', String(period1));
    params.set('period2', String(period2));
  } else if (indicator === 'rsiThrust') {
    params.set('rsiPeriod', String(period));
    params.set('from', String(from));
    params.set('to', String(to));
    params.set('maxMinutes', String(maxMinutes));
    if (confluenceInterval) {
      params.set('confluenceInterval', String(confluenceInterval));
      params.set('confluenceThresholdPct', String(confluenceThresholdPct));
      params.set('bbPeriod', String(bbPeriod));
      params.set('bbStdDev', String(bbStdDev));
    }
  }
  const res = await fetch(`/services/indicator-growth-filter?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `indicator-growth-filter falhou: HTTP ${res.status}`);
  }
  return res.json();
}

/** Gap e cruzamento MA por símbolo (favoritos MA-Cross). */
export async function fetchMaCrossStatus(items, { tolerancePct = '0.5', crossLookbackMin = 1440 } = {}) {
  const res = await fetch('/services/ma-cross-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, tolerancePct, crossLookbackMin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `ma-cross-status falhou: HTTP ${res.status}`);
  }
  return res.json();
}

// ── 5m Trade Favorites (bot RSI 5m) ─────────────────────────────────────────

export async function fetchFiveMTradeFavorites() {
  const res = await fetch('/services/sb/five-m-trade-favorites');
  if (!res.ok) throw new Error(`five-m-trade-favorites falhou: HTTP ${res.status}`);
  return res.json();
}

export async function fetchFiveMTradeSignals({ symbol, limit = 80, eventType } = {}) {
  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol.toUpperCase());
  if (eventType) params.set('event_type', eventType);
  params.set('limit', String(limit));
  const res = await fetch(`/services/sb/five-m-trade-signals?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-signals falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function addFiveMTradeFavorite({ symbol, exchange = 'binance', capital = 40, rsiBuy = 30, rsiSell = 70, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths }) {
  const res = await fetch('/services/sb/five-m-trade-favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `addFiveMTradeFavorite falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateFiveMTradeFavorite(id, { exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths }) {
  const res = await fetch(`/services/sb/five-m-trade-favorites/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `updateFiveMTradeFavorite falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function removeFiveMTradeFavorite(id) {
  const res = await fetch(`/services/sb/five-m-trade-favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `removeFiveMTradeFavorite falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchFiveMTradeSuggestRsi({ symbol, exchange = 'binance', entryValue = 30, exitValue = 70, maFilters }) {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    exchange,
    entryValue: String(entryValue),
    exitValue: String(exitValue),
  });
  if (maFilters) params.set('maFilters', JSON.stringify(maFilters));
  const res = await fetch(`/services/sb/five-m-trade-suggest-rsi?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-suggest-rsi falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchFiveMTradeSuggestMaAdaptation({
  symbol, exchange = 'binance', rsiBuy = 30, rsiSell = 70, maFilters,
}) {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    exchange,
    rsiBuy: String(rsiBuy),
    rsiSell: String(rsiSell),
  });
  if (maFilters) params.set('maFilters', JSON.stringify(maFilters));
  const res = await fetch(`/services/sb/five-m-trade-suggest-ma-adaptation?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-suggest-ma-adaptation falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchFiveMTradeSuggestRecovery({ symbol, exchange = 'binance', rsiBuy = 30, rsiSell = 70, maFilters }) {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    exchange,
    rsiBuy: String(rsiBuy),
    rsiSell: String(rsiSell),
  });
  if (maFilters) params.set('maFilters', JSON.stringify(maFilters));
  const res = await fetch(`/services/sb/five-m-trade-suggest-recovery?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-suggest-recovery falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchFiveMTradeSuggestEntryBelow({ symbol, exchange = 'binance', rsiBuy = 30 }) {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    exchange,
    rsiBuy: String(rsiBuy),
  });
  const res = await fetch(`/services/sb/five-m-trade-suggest-entry-below?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-suggest-entry-below falhou: HTTP ${res.status}`);
  }
  return res.json();
}

/** @deprecated painel 5m não usa mais — ver fetchFiveMTradeSuggestRecovery */
export async function fetchFiveMTradeSuggestStop({ symbol, exchange = 'binance', rsiBuy = 30, rsiSell = 70, maFilters }) {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    exchange,
    rsiBuy: String(rsiBuy),
    rsiSell: String(rsiSell),
  });
  if (maFilters) params.set('maFilters', JSON.stringify(maFilters));
  const res = await fetch(`/services/sb/five-m-trade-suggest-stop?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-suggest-stop falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchFiveMTradeSuggestPathCooldown({
  symbol, exchange = 'binance', rsiBuy = 30, maFilters, trigger = 'touch', tolerancePct = 0.5,
}) {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    exchange,
    rsiBuy: String(rsiBuy),
    trigger,
    tolerancePct: String(tolerancePct),
  });
  if (maFilters) params.set('maFilters', JSON.stringify(maFilters));
  const res = await fetch(`/services/sb/five-m-trade-suggest-path-cooldown?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-suggest-path-cooldown falhou: HTTP ${res.status}`);
  }
  return res.json();
}

export async function evaluateFiveMTradeLive({
  symbol, exchange = 'binance', rsiBuy = 30, rsiSell = 70, maFilters, recoveryPattern,
  phase = 'WATCHING', lastBuyTime = null, buyCount = 0, entryPaths, entryPath,
  sellScope,
}) {
  const res = await fetch('/services/sb/five-m-trade-evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: symbol.toUpperCase(),
      exchange,
      rsiBuy,
      rsiSell,
      maFilters,
      recoveryPattern,
      sellScope,
      phase,
      lastBuyTime,
      buyCount,
      entryPaths,
      entryPath,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `five-m-trade-evaluate falhou: HTTP ${res.status}`);
  }
  return res.json();
}

// ── Screener automático BB+VWAP (4h) do ma-cross ─────────────────────────────

/**
 * @returns {Promise<{enabled: boolean, minVolume24h: number, blacklist: string[], maxNewPerCycle: number, capitalPerSymbol: number}>}
 */
export async function getMaCrossScreenerConfig() {
  const res = await fetch('/services/sb/ma-cross-screener-config');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function saveMaCrossScreenerConfig(config) {
  const res = await fetch('/services/sb/ma-cross-screener-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Filtro de tendência da mediana da Bollinger — limiar padrão (global, toda moeda) ────────

export async function getBollingerMedianTrendConfig() {
  const res = await fetch('/services/sb/bollinger-median-trend-config');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function saveBollingerMedianTrendConfig(config) {
  const res = await fetch('/services/sb/bollinger-median-trend-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Config global do bot RSI Momentum (entry/exit/stopLoss/polling/volume) ──────────────────

export async function getRsiMomentumConfig() {
  const res = await fetch('/services/sb/rsi-momentum-config');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function saveRsiMomentumConfig(config) {
  const res = await fetch('/services/sb/rsi-momentum-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Configurações de cache (liga/desliga por cache no backend) ──────────────

export async function getCacheSettings() {
  const res = await fetch('/services/cache-settings');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function saveCacheSettings(enabled) {
  const res = await fetch('/services/cache-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Multitrade Favorites ─────────────────────────────────────────────────────

export async function fetchMultitradeFavorites() {
  const res = await fetch('/services/sb/multitrade-favorites');
  if (!res.ok) throw new Error(`multitrade-favorites falhou: HTTP ${res.status}`);
  return res.json();
}

/** Estado ao vivo do bot (rsi_multi_bot_state) pra um símbolo, mesmo sem favorito ativo em
 *  multitrade_favorites — cobre o caso de símbolo desfavoritado no meio de um ciclo
 *  PENDING/BOUGHT (ver comentário na rota /bot-state em supabaseService.js). Devolve um
 *  array (pode ter mais de uma estratégia rodando o mesmo símbolo). */
export async function fetchBotState(symbol) {
  const res = await fetch(`/services/sb/bot-state?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`bot-state falhou: HTTP ${res.status}`);
  return res.json();
}

export async function addMultitradeFavorite(data) {
  const res = await fetch('/services/sb/multitrade-favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`addMultitradeFavorite falhou: HTTP ${res.status}`);
  return res.json();
}

export async function updateMultitradeFavorite(id, data) {
  const res = await fetch(`/services/sb/multitrade-favorites/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateMultitradeFavorite falhou: HTTP ${res.status}`);
  return res.json();
}

export async function removeMultitradeFavorite(id) {
  const res = await fetch(`/services/sb/multitrade-favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`removeMultitradeFavorite falhou: HTTP ${res.status}`);
  return res.json();
}

/** Ajuste manual de fase no rsi_multi_bot_state (WATCHING ou BOUGHT). */
export async function patchMultitradeBotState({
  symbol, strategyId, phase, buyPrice, buyQty, buyTime, buyUsdt, sell,
}) {
  const res = await fetch('/services/sb/multitrade-bot-state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol, strategyId, phase, buyPrice, buyQty, buyTime, buyUsdt, sell,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `patchMultitradeBotState falhou: HTTP ${res.status}`);
  }
  return res.json();
}

/** Compra a mercado imediata no capital configurado do favorito (ordem real, não é só bookkeeping). */
export async function buyMultitradeNow({ symbol, strategyId }) {
  const res = await fetch('/services/sb/multitrade-buy-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, strategyId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `buyMultitradeNow falhou: HTTP ${res.status}`);
  return body;
}

/** Compra adicional (média de preço) numa posição já BOUGHT — mercado ou LIMIT com pullback
 *  (%, ordem resting que só preenche depois). Ordem real, não é só bookkeeping. No modo
 *  mercado, `oco` ({ targetPct, stopPct }) é opcional — se enviado, coloca a OCO de saída
 *  (sobre a posição já com a média/quantidade atualizadas) logo depois da compra preencher. */
export async function buyMultitradeMore({ symbol, strategyId, amountUsdt, mode, pullbackPct, oco }) {
  const res = await fetch('/services/sb/multitrade-buy-more', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, strategyId, amountUsdt, mode, pullbackPct, oco }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `buyMultitradeMore falhou: HTTP ${res.status}`);
  return body;
}

export async function fetchMultitradeTrades({ symbol, strategyId, limit } = {}) {
  const params = new URLSearchParams();
  if (symbol)      params.set('symbol', symbol);
  if (strategyId)  params.set('strategy_id', strategyId);
  if (limit)       params.set('limit', String(limit));
  const res = await fetch(`/services/sb/multitrade-trades?${params}`);
  if (!res.ok) throw new Error(`multitrade-trades falhou: HTTP ${res.status}`);
  return res.json();
}

export async function fetchMultitradeTimeline({ symbol, limit } = {}) {
  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol);
  if (limit)  params.set('limit', String(limit));
  const res = await fetch(`/services/sb/multitrade-timeline?${params}`);
  if (!res.ok) throw new Error(`multitrade-timeline falhou: HTTP ${res.status}`);
  return res.json();
}

export async function checkMultitradeVolume(symbol, exchange, minVolumeUsdt) {
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    minVolumeUsdt: String(minVolumeUsdt ?? 1_000_000),
  });
  const res = await fetch(`/services/sb/multitrade-volume?${params}`);
  if (!res.ok) throw new Error(`multitrade-volume falhou: HTTP ${res.status}`);
  return res.json();
}

/** Sugere desconto PENDING a partir do histórico (queda após RSI de entrada). */
export async function suggestMultitradeDiscount({ symbol, exchange, entryRsi, exitRsi, execution }) {
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    entryInterval: entryRsi.interval,
    entryPeriod: String(entryRsi.period),
    entryOperator: entryRsi.operator,
    entryValue: String(entryRsi.value),
    exitInterval: exitRsi.interval,
    exitPeriod: String(exitRsi.period),
    exitOperator: exitRsi.operator,
    exitValue: String(exitRsi.value),
    pendingTimeoutMs: String(execution?.pendingTimeoutMs ?? 30 * 60_000),
    pendingCancelPct: String(execution?.pendingCancelPct ?? 0.002),
  });
  const res = await fetch(`/services/sb/multitrade-suggest-discount?${params}`);
  if (!res.ok) throw new Error(`multitrade-suggest-discount falhou: HTTP ${res.status}`);
  return res.json();
}

/** Sugere dip % para filtro MA adaptativo (histórico de quedas abaixo da MA). */
export async function suggestMultitradeAdaptive({ symbol, exchange, period, interval, adaptiveOpts }) {
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    period: String(period ?? 50),
    interval: interval ?? '1h',
    defaultPct: String(adaptiveOpts?.defaultPct ?? 3),
    maxPct: String(adaptiveOpts?.maxPct ?? 5),
    minPct: String(adaptiveOpts?.minPct ?? 0.5),
    minEpisodes: String(adaptiveOpts?.minEpisodes ?? 3),
  });
  const res = await fetch(`/services/sb/multitrade-suggest-adaptive?${params}`);
  if (!res.ok) throw new Error(`multitrade-suggest-adaptive falhou: HTTP ${res.status}`);
  return res.json();
}

/** Piso/teto adaptativos para bandas do chart (histórico da moeda). */
export async function fetchChartAdaptiveBands({
  symbol, exchange, period, interval, limit,
  maxDipPct, maxAbovePct, fixedDipPct, fixedAbovePct, adaptiveOpts,
}) {
  const opts = adaptiveOpts ?? {};
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    period: String(period ?? 50),
    interval: interval ?? '1h',
    limit: String(limit ?? 350),
    maxDipPct: String(maxDipPct ?? 4),
    maxAbovePct: String(maxAbovePct ?? 4),
    defaultPct: String(opts.defaultPct ?? 3),
    maxPct: String(opts.maxPct ?? 8),
    minPct: String(opts.minPct ?? 0.5),
    minEpisodes: String(opts.minEpisodes ?? 3),
    defaultAbovePct: String(opts.defaultAbovePct ?? 4),
    minAbovePct: String(opts.minAbovePct ?? 0.5),
  });
  if (fixedDipPct != null) params.set('fixedDipPct', String(fixedDipPct));
  if (fixedAbovePct != null) params.set('fixedAbovePct', String(fixedAbovePct));
  const res = await fetch(`/services/sb/chart-adaptive-bands?${params}`);
  if (!res.ok) throw new Error(`chart-adaptive-bands falhou: HTTP ${res.status}`);
  return res.json();
}

/** Sugere piso e teto adaptativos para filtro MA do MA-Cross (histórico de cruzamentos). */
export async function suggestMaCrossFilterBounds({ symbol, exchange, form, filterId }) {
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    tradeConfig: JSON.stringify(form),
  });
  if (filterId != null) params.set('filterId', String(filterId));
  const res = await fetch(`/services/sb/multitrade-suggest-ma-cross-bounds?${params}`);
  if (!res.ok) throw new Error(`multitrade-suggest-ma-cross-bounds falhou: HTTP ${res.status}`);
  return res.json();
}

/** Sugere % acima da MA para ativar regras 3/4 candles. */
export async function suggestMultitradeExtensionAbove({
  symbol, exchange, entryRsi, exitRsi, extension, maConditions, stopLoss,
}) {
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    entryInterval: entryRsi.interval,
    entryPeriod: String(entryRsi.period),
    entryOperator: entryRsi.operator,
    entryValue: String(entryRsi.value),
    exitInterval: exitRsi.interval,
    exitPeriod: String(exitRsi.period),
    exitOperator: exitRsi.operator,
    exitValue: String(exitRsi.value),
    maPeriod: String(extension?.maPeriod ?? 50),
    maInterval: extension?.maInterval ?? '1h',
    threeInterval: extension?.threeInterval ?? extension?.confirmInterval ?? '1h',
    fourInterval: extension?.fourInterval ?? extension?.confirmInterval ?? '1h',
    threeCandles: String(extension?.threeCandles !== false),
    fourCandles: String(extension?.fourCandles !== false),
    confirmLogic: extension?.confirmLogic ?? 'any',
    stopLossEnabled: String(stopLoss?.enabled !== false),
  });
  if (maConditions?.length) {
    params.set('maConditions', JSON.stringify(maConditions.map(({ period, interval, mode, fixedDipPct }) => ({
      period, interval, mode,
      ...(fixedDipPct !== '' && fixedDipPct != null ? { fixedDipPct: Number(fixedDipPct) } : {}),
    }))));
  }
  const res = await fetch(`/services/sb/multitrade-suggest-extension-above?${params}`);
  if (!res.ok) throw new Error(`multitrade-suggest-extension-above falhou: HTTP ${res.status}`);
  return res.json();
}

/** Sugere nível RSI de saída a partir do pico histórico no intervalo escolhido. */
export async function suggestMultitradeExitRsi({
  symbol, exchange, entryRsi, exitRsi, entryRsiPath, entryMa, maConditions, extension, stopLoss, entryPath,
}) {
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    entryInterval: entryRsi.interval,
    entryPeriod: String(entryRsi.period),
    entryOperator: entryRsi.operator ?? '<',
    entryValue: String(entryRsi.value),
    exitInterval: exitRsi.interval,
    exitPeriod: String(exitRsi.period),
    exitOperator: exitRsi.operator ?? '>',
    exitValue: String(exitRsi.value),
    stopLossEnabled: String(stopLoss?.enabled !== false),
  });
  if (entryPath) params.set('entryPath', entryPath);
  if (entryRsiPath) params.set('entryRsiPath', JSON.stringify(entryRsiPath));
  if (entryMa) params.set('entryMa', JSON.stringify({ ...entryMa, enabled: entryMa.enabled !== false }));
  if (maConditions?.length) {
    params.set('maConditions', JSON.stringify(maConditions.map(({ period, interval, mode, fixedDipPct }) => ({
      period, interval, mode,
      ...(fixedDipPct !== '' && fixedDipPct != null ? { fixedDipPct: Number(fixedDipPct) } : {}),
    }))));
  }
  if (extension) {
    params.set('extension', JSON.stringify(extension));
  }
  const res = await fetch(`/services/sb/multitrade-suggest-exit-rsi?${params}`);
  if (!res.ok) throw new Error(`multitrade-suggest-exit-rsi falhou: HTTP ${res.status}`);
  return res.json();
}

function buildMultitradeSuggestParams({
  symbol, exchange, entryRsi, exitRsi, entryRsiPath, entryMa, maConditions, extension, stopLoss,
}) {
  const params = new URLSearchParams({
    symbol,
    exchange: exchange ?? 'binance',
    entryInterval: entryRsi.interval,
    entryPeriod: String(entryRsi.period),
    entryOperator: entryRsi.operator ?? '<',
    entryValue: String(entryRsi.value),
    exitInterval: exitRsi.interval,
    exitPeriod: String(exitRsi.period),
    exitOperator: exitRsi.operator ?? '>',
    exitValue: String(exitRsi.value),
    stopLossEnabled: String(stopLoss?.enabled !== false),
  });
  if (entryRsiPath) params.set('entryRsiPath', JSON.stringify(entryRsiPath));
  if (entryMa) params.set('entryMa', JSON.stringify(entryMa));
  if (maConditions?.length) {
    params.set('maConditions', JSON.stringify(maConditions.map(({ period, interval, mode, fixedDipPct }) => ({
      period, interval, mode,
      ...(fixedDipPct !== '' && fixedDipPct != null ? { fixedDipPct: Number(fixedDipPct) } : {}),
    }))));
  }
  if (extension) params.set('extension', JSON.stringify(extension));
  return params;
}

/** Sugere limiar RSI de entrada (ex.: < 30 vs < 34 vs < 40) pelo histórico. */
export async function suggestMultitradeEntryRsi({
  symbol, exchange, entryRsi, exitRsi, entryRsiPath, entryMa, maConditions, extension, stopLoss,
}) {
  const params = buildMultitradeSuggestParams({
    symbol, exchange, entryRsi, exitRsi, entryRsiPath, entryMa, maConditions, extension, stopLoss,
  });
  const res = await fetch(`/services/sb/multitrade-suggest-entry-rsi?${params}`);
  if (!res.ok) throw new Error(`multitrade-suggest-entry-rsi falhou: HTTP ${res.status}`);
  return res.json();
}

/** Sugere trigger/tolerância (e RSI combinado) para entrada por MA. */
export async function suggestMultitradeEntryMa({
  symbol, exchange, entryRsi, exitRsi, entryRsiPath, entryMa, maConditions, extension, stopLoss,
}) {
  const params = buildMultitradeSuggestParams({
    symbol, exchange, entryRsi, exitRsi, entryRsiPath, entryMa, maConditions, extension, stopLoss,
  });
  const res = await fetch(`/services/sb/multitrade-suggest-entry-ma?${params}`);
  if (!res.ok) throw new Error(`multitrade-suggest-entry-ma falhou: HTTP ${res.status}`);
  return res.json();
}

/** Backtest histórico MA-Cross / AMAP. Com tradeConfig, funciona sem favorito MC. */
export async function fetchMultitradeBacktest({ symbol, exchange, capital, strategyId, tradeConfig, since } = {}) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  if (exchange) params.set('exchange', exchange);
  if (capital != null) params.set('capital', String(capital));
  if (strategyId) params.set('strategy_id', strategyId);
  if (tradeConfig) params.set('tradeConfig', JSON.stringify(tradeConfig));
  if (since) params.set('since', typeof since === 'number' ? String(since) : since);
  const res = await fetch(`/services/sb/multitrade-backtest?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `multitrade-backtest falhou: HTTP ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca candles + todos os indicadores para o painel de busca.
 * @param {Array<{symbol:string}>} currencies
 * @param {string[]} intervals
 */
export async function fetchCandlesAndIndicators(currencies, intervals, maPeriod = 200) {
  async function fetchOne(symbol, interval) {
    const candlesRaw = await fetch(
      `/services/candles/?symbol=${symbol}&limit=266&interval=${interval}`,
    ).then((r) => r.json());

    if (!Array.isArray(candlesRaw)) return null;
    const candles = candlesRaw;

    const [ichimokuCloud, movingAverage, rsiIndicator] =
      await Promise.all([
        fetch('/services/ichimoku-cloud', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(candles.slice(-166)),
        }).then((r) => r.json()),

        fetch(`/services/sma?period=${maPeriod}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(candles),
        }).then((r) => r.json()),

        fetch('/services/rsi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(candles.slice(-166)),
        }).then((r) => r.json()),
      ]);

    return {
      symbol,
      price: candles.at(-1)?.close,
      interval,
      candlesticks: candles,
      ichimokuCloud,
      movingAverage,
      rsiIndicator,
    };
  }

  // Limita concorrência: processa BATCH_SIZE moedas por vez para evitar
  // ERR_INSUFFICIENT_RESOURCES com centenas de requests simultâneos.
  const BATCH_SIZE = 5;
  const tasks = currencies.flatMap((c) => intervals.map((iv) => () => fetchOne(c.symbol, iv)));
  const results = [];

  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((fn) => fn().catch(() => null)));
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}
