'use strict';

const { BollingerBands } = require('technicalindicators');

/** Mesmo padrão do bot real (entry.medianTrendFilter.lookback, ver
 *  backend/bot/bollinger-bands/strategyEngine.js#checkMedianTrendFilter). */
const DEFAULT_MEDIAN_LOOKBACK = 10;

/** Limiar mínimo (%) da inclinação média da mediana pro filtro liberar a entrada — mesmo
 *  valor de MEDIAN_TREND_MIN_AVG_DIFF_PCT em strategyEngine.js, pra manter bot e simulação
 *  de estatísticas espelhados. */
const MEDIAN_TREND_MIN_AVG_DIFF_PCT = 0.2;

/**
 * Simula trades teóricos de mean-reversion na Bollinger Band (compra no toque da banda
 * inferior, vende no toque da superior — mesma lógica de
 * frontend-react/src/utils/bollingerTouchPath.js#simulateBbTouchPath) filtrados pela regra de
 * tendência da linha mediana: só entra se a média das variações % candle-a-candle da linha
 * média (últimos `medianLookback` valores fechados) for >= MEDIAN_TREND_MIN_AVG_DIFF_PCT —
 * mesma regra do bot real (checkMedianTrendFilter). `candles` precisa vir só com candles JÁ
 * FECHADOS.
 *
 * `tradeWindow` limita a simulação (compra/venda) aos últimos N pontos de banda — os pontos
 * anteriores a essa janela só existem pra dar contexto de período/mediana (warm-up), sem
 * abrir posição neles. Default Infinity = percorre a série inteira.
 */
function simulateBbMedianTrendTrades(candles, { period, stdDev, medianLookback = DEFAULT_MEDIAN_LOOKBACK, tradeWindow = Infinity }) {
  if (!candles?.length || candles.length < period + medianLookback + 1) return [];

  const closes = candles.map(c => parseFloat(c.close));
  const bb = BollingerBands.calculate({ period, values: closes, stdDev });
  if (!bb.length || bb.length <= medianLookback) return [];

  const offset = candles.length - bb.length;
  const startIdx = Number.isFinite(tradeWindow)
    ? Math.max(medianLookback, bb.length - tradeWindow)
    : medianLookback;

  const trades = [];
  let buy = null;

  for (let i = startIdx; i < bb.length; i++) {
    const candle = candles[i + offset];
    const low = parseFloat(candle.low);
    const high = parseFloat(candle.high);
    const { lower, upper } = bb[i];
    if (![low, high, lower, upper].every(Number.isFinite)) continue;

    if (buy == null) {
      if (low > lower) continue;

      const middles = bb.slice(i - medianLookback, i + 1).map(b => b.middle);
      let sumPct = 0;
      let countPct = 0;
      for (let k = 1; k < middles.length; k++) {
        if (!(middles[k - 1] > 0)) continue;
        sumPct += ((middles[k] - middles[k - 1]) / middles[k - 1]) * 100;
        countPct++;
      }
      const avgDiffPct = countPct ? sumPct / countPct : 0;
      if (avgDiffPct < MEDIAN_TREND_MIN_AVG_DIFF_PCT) continue; // mediana em baixa/estagnada: entrada bloqueada, mesma regra do bot

      buy = { entryTime: Number(candle.openTime), entryPrice: lower };
      if (high >= upper) {
        trades.push({
          entryTime: buy.entryTime, entryPrice: lower,
          exitTime: Number(candle.openTime), exitPrice: upper,
          pnlPct: ((upper - lower) / lower) * 100,
        });
        buy = null;
      }
    } else if (high >= upper) {
      trades.push({
        entryTime: buy.entryTime, entryPrice: buy.entryPrice,
        exitTime: Number(candle.openTime), exitPrice: upper,
        pnlPct: ((upper - buy.entryPrice) / buy.entryPrice) * 100,
      });
      buy = null;
    }
  }

  return trades;
}

module.exports = { simulateBbMedianTrendTrades, DEFAULT_MEDIAN_LOOKBACK };
