/**
 * Serviços de API — chamadas ao backend Express.
 * O proxy do Vite (vite.config.js) redireciona /services → http://localhost:3000
 */

export async function fetchAllCurrencies() {
  const res = await fetch('/services/currencies');
  if (!res.ok) throw new Error('Falha ao buscar moedas');
  return res.json();
}

export async function fetch24hVolume() {
  const res = await fetch('/services/24hs-volume');
  if (!res.ok) throw new Error('Falha ao buscar volume 24h');
  return res.json();
}

/**
 * Busca candles + Ichimoku + SMA para exibir no gráfico.
 * @param {string} symbol  ex: 'BTCUSDT'
 * @param {string} interval ex: '1h'
 */
export async function fetchCandlesticksAndCloud(symbol, interval) {
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=266&interval=${interval}`,
  ).then((r) => r.json());

  const [ichimokuCloud, movingAverage, rsi] = await Promise.all([
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

  return { symbol, interval, price: candles.at(-1)?.close, candlesticks: candles, ichimokuCloud, movingAverage, rsi };
}

/** Constrói o nome normalizado a partir da query string.
 *  Ex: "8h|rsi|above|70|bellow|99" → "8h|r|a|70|b|99"
 */
function buildNome(query) {
  const parts = query.trim().split('|');
  const interval = parts[0];
  const indRaw = parts[1].toLowerCase();
  const indicator = (indRaw === 'rsi' || indRaw === 'r') ? 'r' : indRaw[0];
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
    const candles = await fetch(
      `/services/candles/?symbol=${symbol}&limit=266&interval=${interval}`,
    ).then((r) => r.json());

    const [ichimokuCloud, movingAverage, rsiIndicator, lowestIndex, highLowVariation] =
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

        fetch('/services/fetch-lowest-index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(candles.slice(-20)),
        }).then((r) => r.json()),

        fetch('/services/fetch-high-low-variation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(candles.slice(-10)),
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
      lowestIndex: lowestIndex.lowestIndex,
      highLowVariation: highLowVariation.highLowVariation,
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
