/**
 * Serviços de API — chamadas ao backend Express.
 * O proxy do Vite (vite.config.js) redireciona /services → http://localhost:3000
 */

import { buildRsiNomeFromQuery } from '../utils/filterNames';

export async function fetchAllCurrencies() {
  const res = await fetch('/services/currencies');
  if (!res.ok) throw new Error('Falha ao buscar moedas');
  return res.json();
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

/**
 * Analisa ciclos RSI sobrevenda→sobrecompra para uma moeda salva no backend.
 * @param {string} symbol    ex: 'BTCUSDT'
 * @param {string} interval  ex: '1h'
 * @param {number} oversold    limiar de entrada (padrão 30)
 * @param {number} overbought  limiar de saída   (padrão 70)
 */
export async function fetchRsiOversoldRecovery(symbol, interval, oversold = 30, overbought = 70, source = null) {
  const params = new URLSearchParams({ symbol, interval, oversold, overbought });
  if (source) params.set('source', source);
  const res = await fetch(`/services/rsi-oversold-recovery?${params}`);
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
  const res = await fetch('/services/sb/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, type }),
  });
  if (!res.ok) throw new Error('Falha ao adicionar favorito');
  return res.json();
}

export async function addTradeFavorite(symbol, { exchange = 'binance', interval, rsiBuy, rsiSell, sellInterval }) {
  const res = await fetch('/services/sb/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, type: 'trade', exchange, interval, rsiBuy, rsiSell, sellInterval: sellInterval || null }),
  });
  if (!res.ok) throw new Error('Falha ao salvar configuração de trade');
  return res.json();
}

export async function removeFavorite(symbol, type) {
  const res = await fetch(`/services/sb/favorites/${encodeURIComponent(symbol)}?type=${type}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Falha ao remover favorito');
  return res.json();
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
 * @param {{ symbol, side: 'buy'|'sell', type?: 'market'|'limit', amount, price? }} params
 */
export async function placeGateOrder({ symbol, side, type = 'market', amount, price }) {
  const res = await fetch('/services/gate-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, side, type, amount, price }),
  });
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
 * @param {{ symbol, side: 'BUY'|'SELL', type?: 'MARKET'|'LIMIT', quantity, price? }} params
 */
export async function placeBinanceOrder({ symbol, side, type = 'MARKET', quantity, price }) {
  const res = await fetch('/services/binance-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, side, type, quantity, price }),
  });
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
 * Busca candles + Ichimoku + SMA para exibir no gráfico.
 * @param {string} symbol   ex: 'BTCUSDT'
 * @param {string} interval ex: '1h'
 * @param {string} [source] 'gate' para forçar Gate.io; omitir para Binance
 */
export async function fetchCandlesticksAndCloud(symbol, interval, source = null, limit = 500) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candlesRaw = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then((r) => r.json());

  if (!Array.isArray(candlesRaw)) {
    throw new Error(`Candles indisponíveis para ${symbol} ${interval}`);
  }
  const candles = candlesRaw;

  const [ichimokuCloud, movingAverage, ma50, rsi] = await Promise.all([
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

    fetch('/services/rsi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candles),
    }).then((r) => r.json()),
  ]);

  return { symbol, interval, source: source ?? null, price: candles.at(-1)?.close, candlesticks: candles, ichimokuCloud, movingAverage, ma50, rsi };
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

  console.log('[frontend-react] filtro criado:', nome, '→', list.length, 'símbolos:', list);
  return { name: nome, list };
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

// ── Multitrade Favorites ─────────────────────────────────────────────────────

export async function fetchMultitradeFavorites() {
  const res = await fetch('/services/sb/multitrade-favorites');
  if (!res.ok) throw new Error(`multitrade-favorites falhou: HTTP ${res.status}`);
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

/** Backtest histórico AMAP (moeda deve estar no Multi-Trade). */
export async function fetchMultitradeBacktest({ symbol, exchange, capital, strategyId } = {}) {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase() });
  if (exchange) params.set('exchange', exchange);
  if (capital != null) params.set('capital', String(capital));
  if (strategyId) params.set('strategy_id', strategyId);
  const res = await fetch(`/services/sb/multitrade-backtest?${params}`);
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Moeda não está no Multi-Trade');
  }
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
