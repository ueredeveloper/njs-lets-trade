'use strict';

/**
 * Suporte/Resistência estilo LuxAlgo: detecta pivôs de fractal confirmados
 * (leftBars candles antes e rightBars candles depois, todos já fechados),
 * agrupa pivôs cujo preço está a menos de mergePct% de distância na mesma
 * zona (quanto mais toques, mais forte a zona) e devolve só os níveis mais
 * fortes, já classificados como suporte (abaixo do último close) ou
 * resistência (acima).
 */
function detectSupportResistance(candles, opts = {}) {
  const leftBars = opts.leftBars ?? 5;
  const rightBars = opts.rightBars ?? 5;
  const mergePct = opts.mergePct ?? 0.5;
  const maxLevels = opts.maxLevels ?? 6;

  if (!Array.isArray(candles) || candles.length < leftBars + rightBars + 1) return [];

  const highs = candles.map(c => parseFloat(c.high));
  const lows = candles.map(c => parseFloat(c.low));
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

  // Agrupamento guloso 1D: percorre os pivôs ordenados por preço e funde
  // no cluster anterior quando a distância percentual é pequena.
  pivots.sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of pivots) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.price - last.avgPrice) / last.avgPrice * 100 <= mergePct) {
      last.prices.push(p.price);
      last.times.push(p.time);
      last.avgPrice = last.prices.reduce((s, v) => s + v, 0) / last.prices.length;
    } else {
      clusters.push({ prices: [p.price], times: [p.time], avgPrice: p.price });
    }
  }

  const zones = clusters.map(c => ({
    price: c.avgPrice,
    touches: c.prices.length,
    type: c.avgPrice >= lastClose ? 'resistance' : 'support',
    firstTime: Math.min(...c.times),
    lastTime: Math.max(...c.times),
  }));

  const byStrength = (a, b) => b.touches - a.touches
    || Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose);

  const resistances = zones.filter(z => z.type === 'resistance').sort(byStrength);
  const supports = zones.filter(z => z.type === 'support').sort(byStrength);

  const half = Math.ceil(maxLevels / 2);
  let picked = [...resistances.slice(0, half), ...supports.slice(0, half)];
  if (picked.length < maxLevels) {
    const rest = [...resistances.slice(half), ...supports.slice(half)].sort(byStrength);
    picked = picked.concat(rest.slice(0, maxLevels - picked.length));
  }

  return picked.sort((a, b) => b.price - a.price);
}

module.exports = { detectSupportResistance };
