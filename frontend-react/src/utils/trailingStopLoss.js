/**
 * Stop-loss móvel MA-Cross — espelho de backend/bot/ma-cross/strategyEngine.js (computeStopLossFloor).
 * Degraus de trailStepPct (padrão 5%) acima da entrada; piso = anchor × (1 − maxLossPct%).
 */

import { isMaCrossEntry } from './multitradeChart';

export function computeStopLossFloor(entryPrice, peakPrice, stopLoss = {}) {
  const maxLossPct = stopLoss.maxLossPct ?? 5;
  if (!entryPrice || entryPrice <= 0) return null;

  const trailing = stopLoss.trailing !== false;
  const peak = peakPrice != null ? Math.max(entryPrice, peakPrice) : entryPrice;

  if (!trailing || stopLoss.enabled === false) {
    return entryPrice * (1 - maxLossPct / 100);
  }

  const stepPct = Math.max(0.5, Number(stopLoss.trailStepPct ?? maxLossPct));
  const risePct = ((peak - entryPrice) / entryPrice) * 100;
  const steps = Math.floor(Math.max(0, risePct) / stepPct);
  const anchorPrice = entryPrice * (1 + (steps * stepPct) / 100);
  return anchorPrice * (1 - maxLossPct / 100);
}

/** Config stop-loss percentual/trailing (modo compartilhado por ma-cross e vwap-bands
 *  modo 'percent') do favorito — não filtra por fase (BOUGHT): é usada tanto pra
 *  posição aberta (buildBuyPositionSquares, que já depende de buyInfo pra só desenhar
 *  quando há posição aberta) quanto pro histórico de trades fechados
 *  (buildHistoricalPositionSquares), que precisa do % configurado mesmo com a moeda
 *  em WATCHING agora. O modo 'ladder' do vwap-bands (stop estrutural na banda tocada)
 *  NÃO usa % — ver resolveVwapLadderLevels em CandlestickChart.jsx, que resolve o
 *  preço real a partir da escada ativa (só vale pra posição aberta). */
export function resolveChartStopLoss(symbol, multitradeFavorites) {
  const sym = symbol?.toUpperCase();
  if (!sym) return null;

  const entry = multitradeFavorites?.find(e => e.symbol?.toUpperCase() === sym);
  if (!entry) return null;

  const sl = entry.tradeConfig?.stopLoss ?? entry.stopLoss ?? {};
  if (sl.enabled === false) return null;
  if (sl.mode === 'ladder') return null;

  return {
    enabled: true,
    mode: 'pct',
    maxLossPct: Number(sl.maxLossPct ?? 5),
    trailing: sl.trailing !== false,
    trailStepPct: Number(sl.trailStepPct ?? sl.maxLossPct ?? 5),
  };
}

/** Alvo (take-profit) percentual — só existe pra ma-cross (exit.bbTakeProfit.targetPct,
 *  padrão 6%, mostrado mesmo com a saída automática desligada, como referência visual).
 *  vwap-bands NÃO tem alvo fixo por % — o alvo é sempre a próxima banda da escada, ao
 *  vivo — ver resolveVwapLadderLevels em CandlestickChart.jsx. */
export function resolveChartTarget(symbol, multitradeFavorites) {
  const sym = symbol?.toUpperCase();
  if (!sym) return null;

  const entry = multitradeFavorites?.find(e => e.symbol?.toUpperCase() === sym);
  if (!entry || !isMaCrossEntry(entry)) return null;

  const tp = entry.tradeConfig?.exit?.bbTakeProfit ?? {};
  const targetPct = Number(tp.targetPct ?? 6);
  if (!(targetPct > 0)) return null;

  return {
    enabled: true,
    mode: 'pct',
    targetPct,
  };
}

/**
 * Série em degraus (horizontal + salto vertical) do piso do stop desde a compra.
 * @returns {{ data: (number|null)[] } | null}
 */
export function buildTrailingStopSeries(candlesticks, entryPrice, entryTimeMs, stopLoss, DL, LEFT_PAD, RIGHT_PAD) {
  if (!entryPrice || !stopLoss?.enabled || !candlesticks?.length) return null;

  const n = candlesticks.length;
  let startAbs = 0;
  if (entryTimeMs != null) {
    startAbs = candlesticks.findIndex(c => Number(c.openTime) >= entryTimeMs);
    if (startAbs === -1) return null;
  }

  const floors = new Array(n).fill(null);
  let peak = entryPrice;
  for (let i = startAbs; i < n; i++) {
    const high = parseFloat(candlesticks[i].high);
    const close = parseFloat(candlesticks[i].close);
    if (Number.isFinite(high)) peak = Math.max(peak, high);
    else if (Number.isFinite(close)) peak = Math.max(peak, close);
    floors[i] = computeStopLossFloor(entryPrice, peak, stopLoss);
  }

  const offset = n - DL;
  const raw = [];
  for (let i = 0; i < DL; i++) {
    const abs = offset + i;
    raw.push(abs >= startAbs ? floors[abs] : null);
  }

  if (!raw.some(v => v != null)) return null;

  return {
    data: [
      ...new Array(LEFT_PAD).fill(null),
      ...raw,
      ...new Array(RIGHT_PAD).fill(null),
    ],
  };
}
