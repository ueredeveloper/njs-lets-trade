/**
 * Detectores de S/R, Pivot Points High/Low, Williams Fractals e ZigZag rodando NO CLIENTE — pra
 * o gráfico recalcular os níveis ao vivo conforme o usuário arrasta/dá zoom (janela deslizante),
 * sem um round-trip pro backend a cada pan.
 *
 * PORT VERBATIM de:
 *   backend/utils/supportResistance.js
 *   backend/utils/pivotPointsHighLow.js
 *   backend/utils/williamsFractals.js
 *   backend/utils/zigzag.js
 * As rotas /services/support-resistance etc. continuam existindo e são a fonte da verdade do
 * BACKTEST de Estatísticas — se mexer na lógica lá, replicar aqui (e vice-versa).
 */

/**
 * Suporte/Resistência estilo LuxAlgo: detecta pivôs de fractal confirmados (leftBars candles
 * antes e rightBars depois, todos já fechados), agrupa pivôs a menos de mergePct% de distância
 * na mesma zona (mais toques = zona mais forte) e devolve só os níveis mais fortes, classificados
 * como suporte (abaixo do último close) ou resistência (acima).
 */
export function detectSupportResistance(candles, opts = {}) {
  const leftBars = opts.leftBars ?? 5;
  const rightBars = opts.rightBars ?? 5;
  const mergePct = opts.mergePct ?? 0.5;
  const maxLevels = opts.maxLevels ?? 6;

  if (!Array.isArray(candles) || candles.length < leftBars + rightBars + 1) return [];

  const highs = candles.map((c) => parseFloat(c.high));
  const lows = candles.map((c) => parseFloat(c.low));
  const lastClose = parseFloat(candles[candles.length - 1].close);

  const pivots = [];
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const windowHighs = highs.slice(i - leftBars, i + rightBars + 1);
    if (highs[i] === Math.max(...windowHighs)) {
      pivots.push({ price: highs[i], time: Number(candles[i].openTime) });
    }
    const windowLows = lows.slice(i - leftBars, i + rightBars + 1);
    if (lows[i] === Math.min(...windowLows)) {
      pivots.push({ price: lows[i], time: Number(candles[i].openTime) });
    }
  }
  if (!pivots.length) return [];

  pivots.sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of pivots) {
    const last = clusters[clusters.length - 1];
    if (last && (Math.abs(p.price - last.avgPrice) / last.avgPrice) * 100 <= mergePct) {
      last.prices.push(p.price);
      last.times.push(p.time);
      last.avgPrice = last.prices.reduce((s, v) => s + v, 0) / last.prices.length;
    } else {
      clusters.push({ prices: [p.price], times: [p.time], avgPrice: p.price });
    }
  }

  const zones = clusters.map((c) => ({
    price: c.avgPrice,
    touches: c.prices.length,
    type: c.avgPrice >= lastClose ? 'resistance' : 'support',
    firstTime: Math.min(...c.times),
    lastTime: Math.max(...c.times),
  }));

  const byStrength = (a, b) =>
    b.touches - a.touches || Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose);

  const resistances = zones.filter((z) => z.type === 'resistance').sort(byStrength);
  const supports = zones.filter((z) => z.type === 'support').sort(byStrength);

  const half = Math.ceil(maxLevels / 2);
  let picked = [...resistances.slice(0, half), ...supports.slice(0, half)];
  if (picked.length < maxLevels) {
    const rest = [...resistances.slice(half), ...supports.slice(half)].sort(byStrength);
    picked = picked.concat(rest.slice(0, maxLevels - picked.length));
  }

  return picked.sort((a, b) => b.price - a.price);
}

/**
 * Pivot Points High/Low, estilo TradingView: marca cada pivô de topo/fundo confirmado (leftBars
 * candles antes e rightBars depois, todos já fechados) — um marcador por pivô, sem agrupar.
 */
export function detectPivotPointsHighLow(candles, opts = {}) {
  const leftBars = opts.leftBars ?? 10;
  const rightBars = opts.rightBars ?? 10;

  if (!Array.isArray(candles) || candles.length < leftBars + rightBars + 1) return [];

  const highs = candles.map((c) => parseFloat(c.high));
  const lows = candles.map((c) => parseFloat(c.low));

  const pivots = [];
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const windowHighs = highs.slice(i - leftBars, i + rightBars + 1);
    if (highs[i] === Math.max(...windowHighs)) {
      pivots.push({ type: 'high', price: highs[i], time: Number(candles[i].openTime) });
    }
    const windowLows = lows.slice(i - leftBars, i + rightBars + 1);
    if (lows[i] === Math.min(...windowLows)) {
      pivots.push({ type: 'low', price: lows[i], time: Number(candles[i].openTime) });
    }
  }

  return pivots.sort((a, b) => a.time - b.time);
}

/**
 * Williams Fractals: caso particular do detectPivotPointsHighLow com leftBars = rightBars = bars
 * (padrão 2, a definição clássica de fractal do Bill Williams).
 */
export function detectWilliamsFractals(candles, opts = {}) {
  const bars = Math.max(1, opts.bars ?? 2);
  return detectPivotPointsHighLow(candles, { leftBars: bars, rightBars: bars });
}

/**
 * ZigZag: liga os pontos de reversão relevantes numa linha alternada topo→fundo→topo, ignorando
 * movimentos menores que `deviationPct`%. Retorna { points, lastLeg }.
 */
export function detectZigZag(candles, opts = {}) {
  const depth = Math.max(1, opts.depth ?? 5);
  const deviationPct = opts.deviationPct ?? 3;

  if (!Array.isArray(candles) || !candles.length) return { points: [], lastLeg: null };

  const candidates = detectPivotPointsHighLow(candles, { leftBars: depth, rightBars: depth });
  if (!candidates.length) return { points: [], lastLeg: null };

  const points = [];
  for (const c of candidates) {
    const last = points[points.length - 1];
    if (!last) {
      points.push({ type: c.type, price: c.price, time: c.time });
      continue;
    }
    if (c.type === last.type) {
      const moreExtreme = c.type === 'high' ? c.price > last.price : c.price < last.price;
      if (moreExtreme) {
        last.price = c.price;
        last.time = c.time;
      }
      continue;
    }
    const movePct = (Math.abs(c.price - last.price) / last.price) * 100;
    if (movePct >= deviationPct) {
      points.push({ type: c.type, price: c.price, time: c.time });
    }
  }

  let lastLeg = null;
  const lastPivot = points[points.length - 1];
  if (lastPivot) {
    const lastCandle = candles[candles.length - 1];
    const price = parseFloat(lastPivot.type === 'high' ? lastCandle.low : lastCandle.high);
    const time = Number(lastCandle.openTime);
    if (Number.isFinite(price) && time > lastPivot.time) {
      lastLeg = { from: { ...lastPivot }, to: { price, time } };
    }
  }

  return { points, lastLeg };
}
