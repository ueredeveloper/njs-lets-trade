'use strict';

/**
 * VWAP ancorado em sessão (diária ou semanal, reset em 00:00 UTC / segunda 00:00 UTC),
 * igual ao "Session VWAP" da Binance/TradingView — o valor final não depende do
 * intervalo de candle usado pra calcular, só a granularidade da aproximação (cripto
 * não tem pregão, então o dia/semana UTC faz o papel da "sessão").
 * Bandas (±kσ) usam o desvio padrão populacional do preço típico em torno do VWAP,
 * acumulado desde o mesmo ponto de ancoragem — mesma fórmula do indicador
 * "VWAP with bands" do TradingView.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Início (00:00 UTC) do dia ou da semana (segunda) que contém o timestamp `t`. */
function sessionStartMs(t, session) {
  const d = new Date(t);
  if (session === 'weekly') {
    const day = d.getUTCDay(); // 0=dom .. 6=sáb
    const diffToMonday = (day + 6) % 7; // dias desde a última segunda
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday, 0, 0, 0, 0);
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

/**
 * @param {Array} candles - candles ordenados por openTime crescente.
 * @param {{session?: 'daily'|'weekly', bandMultipliers?: number[]}} opts
 * @returns {Array<{openTime:number, value:number, stdDev:number, upper1?:number, lower1?:number, ...}>}
 */
function computeVwapWithBands(candles, opts = {}) {
  const session = opts.session === 'weekly' ? 'weekly' : 'daily';
  const bandMultipliers = Array.isArray(opts.bandMultipliers) ? opts.bandMultipliers : [1, 2];

  if (!Array.isArray(candles) || !candles.length) return [];

  const results = [];
  let anchor = null;
  let cumVol = 0, cumPV = 0, cumPV2 = 0;

  for (const c of candles) {
    const t = Number(c.openTime);
    const start = sessionStartMs(t, session);
    if (anchor === null || start !== anchor) {
      anchor = start;
      cumVol = 0; cumPV = 0; cumPV2 = 0;
    }

    const high = parseFloat(c.high);
    const low = parseFloat(c.low);
    const close = parseFloat(c.close);
    const volume = parseFloat(c.volume) || 0;
    const typical = (high + low + close) / 3;

    cumVol += volume;
    cumPV += typical * volume;
    cumPV2 += typical * typical * volume;

    const vwap = cumVol > 0 ? cumPV / cumVol : typical;
    const variance = cumVol > 0 ? Math.max(0, (cumPV2 / cumVol) - vwap * vwap) : 0;
    const stdDev = Math.sqrt(variance);

    const point = { openTime: t, value: vwap, stdDev };
    for (const k of bandMultipliers) {
      point[`upper${k}`] = vwap + k * stdDev;
      point[`lower${k}`] = vwap - k * stdDev;
    }
    results.push(point);
  }

  return results;
}

module.exports = { computeVwapWithBands, sessionStartMs, DAY_MS };
