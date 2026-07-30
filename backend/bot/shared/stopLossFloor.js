'use strict';

/**
 * Piso do stop-loss (percentual, com trailing opcional) — usado por qualquer estratégia
 * cujo trade_config tenha um bloco `stopLoss: { enabled, maxLossPct, trailing, trailStepPct }`.
 * Extraído de backend/bot/ma-cross/strategyEngine.js pra ser reaproveitado por bots novos
 * (ex.: ema-reclaim) sem duplicar a fórmula; ma-cross/strategyEngine.js reexporta esta
 * mesma função pra não quebrar quem já importa `computeStopLossFloor` de lá.
 *
 * Com trailing ativo, o piso sobe a cada degrau de trailStepPct (padrão = maxLossPct):
 * preço +5% → piso sobe para (novo degrau − maxLossPct).
 */
function computeStopLossFloor(entryPrice, peakPrice, stopLoss = {}) {
  const maxLossPct = stopLoss.maxLossPct ?? 5;
  if (!entryPrice || entryPrice <= 0) return null;

  const trailing = stopLoss.trailing !== false;
  const peak = peakPrice != null ? Math.max(entryPrice, peakPrice) : entryPrice;

  if (!trailing || !stopLoss.enabled) {
    return entryPrice * (1 - maxLossPct / 100);
  }

  const stepPct = Math.max(0.5, Number(stopLoss.trailStepPct ?? maxLossPct));
  const risePct = ((peak - entryPrice) / entryPrice) * 100;
  const steps = Math.floor(Math.max(0, risePct) / stepPct);
  const anchorPrice = entryPrice * (1 + (steps * stepPct) / 100);
  return anchorPrice * (1 - maxLossPct / 100);
}

module.exports = { computeStopLossFloor };
