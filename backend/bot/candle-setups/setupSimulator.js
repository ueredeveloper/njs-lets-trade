'use strict';

/**
 * Simulação de UM trade dos "Setups Matadores" a partir de um sinal (setupDetectors.js): ordem de
 * compra por rompimento (stop-buy) no gatilho, stop no extremo do candle-sinal, alvos em R (parcial
 * 50%/50% ou alvo único) e saída por tempo. Pura — o mesmo motor serve ao backtest e, depois, ao bot.
 *
 * Regras conservadoras (candles OHLC não dizem quem veio antes dentro do candle):
 *  - stop primeiro: se o mesmo candle toca o stop e um alvo, conta o stop (inclusive no candle do fill);
 *  - gap além do gatilho preenche na abertura; gap abaixo do stop sai na abertura;
 *  - slippage adverso na entrada e nas saídas a mercado (stop/tempo); alvos são ordens limite;
 *  - taxa por lado sobre o valor negociado; o stop NÃO é movido depois da parcial (o livro: 50% em 1R
 *    paga os outros 50% estopados em −1R — zero a zero).
 */

function iso(ms) {
  return new Date(ms).toISOString();
}

function resolveTargets(targetsCfg, signal, entryPx, risk) {
  const totalQty = targetsCfg.reduce((sum, t) => sum + t.qtyPct, 0) || 100;
  const out = targetsCfg.map((t) => {
    let price;
    let fallback = false;
    if (t.type === 'level') {
      price = signal.levels?.[t.key];
      if (!(price > entryPx)) {
        price = entryPx + (t.fallbackR ?? 2) * risk;
        fallback = true;
      }
    } else {
      price = entryPx + t.value * risk;
    }
    return { price, qty: t.qtyPct / totalQty, r: (price - entryPx) / risk, fallback, hitIndex: null };
  });
  return out.sort((a, b) => a.price - b.price);
}

/**
 * @param {object} s       Séries (toSeries).
 * @param {object} signal  Saída de um detector.
 * @param {object} opts    { common, targets, costs, positionSizeUsd }
 * @returns {{filled:false, reason:string, endIndex:number} | {filled:true, exitIndex:number, open:boolean, trade:object}}
 */
function simulateSetupTrade(s, signal, opts) {
  const { common, costs, positionSizeUsd } = opts;
  const i = signal.index;
  const validCandles = signal.overrides?.validCandles ?? common.validCandles;
  const maxHold = signal.overrides?.maxHoldCandles ?? common.maxHoldCandles;
  const slip = costs.slippagePct / 100;
  const fee = costs.feePct / 100;

  // 1) Rompimento do gatilho dentro da janela de validade.
  let fillIdx = -1;
  let entryRaw = 0;
  const lastWindowIdx = Math.min(i + validCandles, s.n - 1);
  for (let j = i + 1; j <= lastWindowIdx; j++) {
    if (s.h[j] >= signal.trigger) {
      fillIdx = j;
      entryRaw = Math.max(s.o[j], signal.trigger);
      break;
    }
    if (common.cancelOnStopBreak && s.l[j] <= signal.stop) {
      return { filled: false, reason: 'stopBreak', endIndex: j };
    }
  }
  if (fillIdx < 0) {
    return { filled: false, reason: i + validCandles > s.n - 1 ? 'pending' : 'expired', endIndex: lastWindowIdx };
  }

  const entryPx = entryRaw * (1 + slip);
  const risk = entryPx - signal.stop;
  if (!(risk > 0)) return { filled: false, reason: 'invalidRisk', endIndex: fillIdx };
  const targets = resolveTargets(opts.targets, signal, entryPx, risk);

  // 2) Gestão candle a candle até fechar tudo, tempo ou fim dos dados.
  const legs = [];
  let remaining = 1;
  let exitIdx = s.n - 1;
  for (let k = fillIdx; k < s.n && remaining > 1e-9; k++) {
    if (s.l[k] <= signal.stop) {
      legs.push({ idx: k, price: Math.min(s.o[k], signal.stop) * (1 - slip), qty: remaining, reason: 'stop' });
      remaining = 0;
      exitIdx = k;
      break;
    }
    for (const tg of targets) {
      if (tg.hitIndex == null && s.h[k] >= tg.price) {
        tg.hitIndex = k;
        legs.push({ idx: k, price: s.o[k] >= tg.price ? s.o[k] : tg.price, qty: tg.qty, reason: 'target' });
        remaining -= tg.qty;
        exitIdx = k;
      }
    }
    if (remaining <= 1e-9) break;
    if (maxHold > 0 && k - fillIdx >= maxHold) {
      legs.push({ idx: k, price: s.c[k] * (1 - slip), qty: remaining, reason: 'time' });
      remaining = 0;
      exitIdx = k;
      break;
    }
  }
  const open = remaining > 1e-9;
  if (open) {
    legs.push({ idx: s.n - 1, price: s.c[s.n - 1], qty: remaining, reason: 'open' });
    exitIdx = s.n - 1;
  }

  // 3) Resultado líquido por unidade investida na entrada.
  const proceeds = legs.reduce((sum, l) => sum + l.qty * (l.price / entryPx) * (1 - fee), 0);
  const netFrac = proceeds - (1 + fee);
  const riskFrac = risk / entryPx;
  const hits = targets.filter((t) => t.hitIndex != null).length;
  const lastReason = legs[legs.length - 1].reason;
  const outcome = open ? 'open'
    : hits === targets.length ? 'target'
      : hits > 0 ? 'partial'
        : lastReason;

  const round = (v, d) => parseFloat(v.toFixed(d));
  const trade = {
    filled: true,
    setup: signal.setup,
    signalDate: iso(signal.signalTime),
    entryDate: iso(s.t[fillIdx]),
    exitDate: open ? null : iso(s.t[exitIdx]),
    triggerPrice: signal.trigger,
    entryPrice: entryPx,
    stopPrice: signal.stop,
    riskPct: round(riskFrac * 100, 2),
    targets: targets.map((t) => ({
      price: t.price, r: round(t.r, 2), qtyPct: round(t.qty * 100, 1), fallback: t.fallback,
      hitDate: t.hitIndex != null ? iso(s.t[t.hitIndex]) : null,
    })),
    legs: legs.map((l) => ({ date: iso(s.t[l.idx]), price: l.price, qtyPct: round(l.qty * 100, 1), reason: l.reason })),
    outcome,
    targetsHit: hits,
    pnlPct: round(netFrac * 100, 2),
    pnlUsd: round(netFrac * positionSizeUsd, 2),
    rNet: round(netFrac / riskFrac, 2),
    holdCandles: exitIdx - fillIdx,
    holdMs: s.t[exitIdx] - s.t[fillIdx],
    levels: signal.levels,
  };
  return { filled: true, exitIndex: exitIdx, open, trade };
}

module.exports = { simulateSetupTrade, resolveTargets };
