/**
 * Serviços de API — chamadas ao backend Express.
 * O proxy do Vite (vite.config.js) redireciona /services → http://localhost:3000
 */

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

// ── Active Trades (bot positions) ────────────────────────────────────────────

/**
 * Retorna os símbolos onde o bot tem posição aberta (phase BOUGHT ou ABOVE_70).
 * @returns {Promise<Array<{symbol, phase, buyPrice, buyQty, buyUsdt, buyTime}>>}
 */
export async function fetchActiveTrades() {
  const res = await fetch('/services/active-trades');
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

/** Constrói o nome normalizado a partir da query string.
 *  Ex: "8h|rsi|above|70|bellow|99" → "8h|r|a|70|b|99"
 */
function buildNome(query) {
  const parts = query.trim().split('|');
  const interval = parts[0];
  const indRaw = parts[1].toLowerCase();
  const indicator = (indRaw === 'rsi' || indRaw === 'r') ? 'rsi' : indRaw[0];
  const condParts = [];
  for (let i = 2; i + 1 < parts.length; i += 2) {
    const cond = parts[i][0].toLowerCase() === 'a' ? 'a' : 'b';
    condParts.push(`${cond}|${parts[i + 1]}`);
  }
  return `${interval}|${indicator}|${condParts.join('|')}`;
}

/**
 * Envia apenas a query string para o backend e retorna um filtro pronto
 * para o CurrencyContext: { name, list }.
 * Ex: fetchIndicatorSearch("8h|rsi|above|70|bellow|99")
 */
export async function fetchIndicatorSearch(query) {
  console.log('[frontend-react] fetchIndicatorSearch → enviando query:', query);

  const res = await fetch(`/services/indicator-search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`indicator-search falhou: HTTP ${res.status}`);

  const data = await res.json();
  console.log('[frontend-react] fetchIndicatorSearch ← recebido:', data.length, 'moedas', data);

  const nome = data.length > 0 ? data[0].nome : buildNome(query);
  const list = data.map((r) => r.coin.symbol.replace('/USDT', 'USDT'));

  console.log('[frontend-react] filtro criado:', nome, '→', list.length, 'símbolos:', list);
  return { name: nome, list };
}

/**
 * Busca candles + todos os indicadores para o painel de busca.
 * @param {Array<{symbol:string}>} currencies
 * @param {string[]} intervals
 */
export async function fetchCandlesAndIndicators(currencies, intervals) {
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

        fetch('/services/sma?period=200', {
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
