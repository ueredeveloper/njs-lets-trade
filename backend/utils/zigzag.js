'use strict';

const { detectPivotPointsHighLow } = require('./pivotPointsHighLow');

/**
 * ZigZag: liga os pontos de reversão relevantes do preço numa linha em
 * zigue-zague, ignorando o ruído. A linha alterna topo → fundo → topo…; uma
 * reversão só entra na linha quando o movimento desde o último pivô confirmado
 * é de pelo menos `deviationPct`%.
 *
 * Etapas:
 *   1. Candidatos a pivô = fractais de `depth` candles de cada lado
 *      (detectPivotPointsHighLow), todos já fechados.
 *   2. Varredura em ordem de tempo montando a linha alternada:
 *      - candidato do MESMO tipo do último pivô confirmado → mantém o mais
 *        extremo (topo mais alto / fundo mais baixo), reposicionando o pivô;
 *      - candidato de tipo OPOSTO → só confirma se
 *        |preço − preçoÚltimoPivô| / preçoÚltimoPivô * 100 >= deviationPct.
 *
 * Retorna { points, lastLeg }:
 *   - points: [{ type: 'high'|'low', price, time }] ordenado por tempo (a linha);
 *   - lastLeg: { from: <último point>, to: { price, time } } — perna "tentativa"
 *     do último pivô confirmado até o candle mais recente (ainda não confirmada
 *     como reversão), ou null se não houver pivô nenhum.
 */
function detectZigZag(candles, opts = {}) {
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
      // Mesmo tipo em sequência: fica com o mais extremo e move o pivô pra ele.
      const moreExtreme = c.type === 'high' ? c.price > last.price : c.price < last.price;
      if (moreExtreme) { last.price = c.price; last.time = c.time; }
      continue;
    }
    // Tipo oposto: só vira pivô se o movimento passou do limiar.
    const movePct = Math.abs(c.price - last.price) / last.price * 100;
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

module.exports = { detectZigZag };
