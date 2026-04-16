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
