// Simulador "Price action" da caixa de análise do gráfico (tipo 'priceAction' em
// CandlestickChart.jsx). Roda nos candles JÁ carregados no gráfico (mesmo intervalo da tela):
//
//   1. Sinal = 1º candle FECHADO com abertura dentro da caixa que passa na regra `signalRule`:
//      'bot' (padrão, v1.188.0) = a regra do bot no fechamento (Explosão de Alta): corpo verde
//      >= minBodyPct% OU padrão de alta (martelo, engolfo, estrela da manhã... — candlePatterns.js),
//      e nunca um padrão de baixa (shooting star, enforcado...); 'green' = qualquer candle de alta
//      (close > open), o comportamento antigo. O usuário começa a caixa no candle que quer.
//   2. Entrada (`entryMode`): 'close' (padrão) = compra a mercado no FECHAMENTO do candle do sinal
//      (= bot da Explosão de Alta, CONFIG.entry = null); o trade começa no candle seguinte.
//      'limit' = LIMIT no nível `entryLevelPct`% do candle de referência (0 = mínima, 50 = meio,
//      100 = máxima). Referência: o próprio candle do sinal ('signal' — é o "anterior" à entrada)
//      ou o candle antes dele ('prev').
//   3. A limite precisa preencher DENTRO da caixa (borda direita = validade). Fill quando a mínima
//      toca o nível; abriu abaixo (gap) = preenche na abertura.
//      Sinal novo antes do fill = a limite é refeita nele (v1.190.0).
//   4. Depois do fill: alvo +targetPct% / stop −stopPct% (mínimo 10%) sobre o preço de entrada, até o fim dos
//      candles carregados. Candle que toca os dois = STOP (conservador, sem saber a ordem
//      intra-candle) — inclusive o próprio candle do fill, onde o alvo só vale se o candle FECHOU
//      acima dele (a máxima pode ter vindo antes da entrada). Sem taxa de corretagem.
//   5. Vários trades na caixa (v1.190.0): fechado um trade (alvo/stop), procura o PRÓXIMO sinal a
//      partir do candle seguinte à saída — uma posição por vez, como o bot. Para no trade em aberto,
//      na entrada que não preencheu ou quando não há mais sinal. Antes só o 1º trade aparecia.
//   6. Alvo → entrada (`breakevenDropPct`, 0 = desligado): se depois do fill a mínima cair
//      breakevenDropPct% ou mais abaixo da entrada (sem bater o stop), o alvo passa a ser o PRÓPRIO
//      preço de entrada — o trade sai no zero a zero (outcome 'breakeven') e segue pro próximo sinal.
//      No candle que ativa, só vale sair se ele FECHOU >= entrada (a volta veio depois da mínima).
//   7. Reforço (`dropReinforce`, junto com breakevenDropPct): na mesma queda COMPRA MAIS o mesmo valor
//      da entrada (preço médio pra baixo / averaging down) no nível da queda (ou na abertura, se abriu
//      abaixo); alvo = preço da 1ª entrada. P&L = sobre o capital investido (2× depois do reforço).
//      Cada compra tem o PRÓPRIO stop: a 1ª sempre −stopPct% da entrada; a 2ª −reinforceStopPct%
//      (padrão 15%) do preço dela. Alvo das duas = preço da 1ª entrada. A 2ª pode estopar e a 1ª seguir
//      (outcome 'mixed' quando as duas saem por motivos diferentes).
//      `reinforceMult` = tamanho da 2ª compra em múltiplos da entrada: 1 = preço médio, 2 = martingale
//      (dobra a mão: compra 2× o valor da entrada → capital 3× depois do reforço).

import { MANUAL_OCO_MIN_STOP_PCT } from './manualOco';
import { bearishClosePattern, bullishClosePattern } from './candlePatterns';
import { buildRegimeCheck } from './priceActionRegime';

export const PRICE_ACTION_DEFAULTS = {
  targetPct: 15, // = Explosão de Alta automática (bullishBreakoutAuto.js CONFIG.exit, v1.186.0)
  stopPct: Math.max(15, MANUAL_OCO_MIN_STOP_PCT),
  entryMode: 'close', // 'close' = compra no fechamento do candle do sinal | 'limit' = limite em entryLevelPct%
  entryRef: 'signal',
  entryLevelPct: 50,
  signalRule: 'bot',
  minBodyPct: 5,
  regime: 'off', // filtro de regime (priceActionRegime.js): 'off' | 'btc' | 'btcMacd' | 'btcD1' | 'btcD1Macd'
  bearGuard: 'off', // detector de período de baixa (priceActionRegime.js): 'off' | 'btcE20'
  breakevenDropPct: 0, // caiu X% depois de entrar → alvo vira o preço de entrada (0 = desligado)
  dropReinforce: false, // na mesma queda, compra mais (sai tudo no preço da 1ª entrada)
  reinforceStopPct: 15, // stop da 2ª compra (reforço): −X% do preço dela (a 1ª mantém o stop dela)
  reinforceMult: 1, // tamanho da compra do reforço × valor da entrada: 1 = preço médio, 2 = martingale
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {Array} candlesticks  candles do gráfico ({openTime, open, high, low, close}), ascendentes
 * @param {{fromMs:number,toMs:number}} box
 * @param {object} params  ver PRICE_ACTION_DEFAULTS
 * @param {number} intervalMs  duração do candle (pra saber se o último ainda está em formação)
 * @param {object} [regimeCtx]  { btc4h, coin4h, coin1d, btc1d } — candles pro regime / detector de baixa
 */
export function simulatePriceActionBox(candlesticks, box, params, intervalMs, nowMs = Date.now(), regimeCtx = {}) {
  const p = { ...PRICE_ACTION_DEFAULTS, ...params };
  p.stopPct = Math.max(MANUAL_OCO_MIN_STOP_PCT, Number(p.stopPct));
  const cs = (candlesticks ?? [])
    .map((c) => ({
      openTime: num(c.openTime), open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close),
    }))
    .filter((c) => [c.openTime, c.open, c.high, c.low, c.close].every(Number.isFinite));
  if (!box || !cs.length) return { status: 'noData' };
  if (!(p.targetPct > 0) || !(p.stopPct > 0) || !(p.stopPct < 100)) return { status: 'badParams' };

  const isClosed = (c) => !(intervalMs > 0) || c.openTime + intervalMs <= nowMs;
  // Regime no FECHAMENTO do candle do sinal (só candles 4h/1d já fechados até ali).
  const regimeAt = buildRegimeCheck(p.regime, regimeCtx, p.bearGuard);
  let regimePending = false;
  const regimeOk = (c) => {
    const r = regimeAt(c.openTime + (intervalMs > 0 ? intervalMs : 0));
    if (r.pending) regimePending = true;
    return r;
  };

  // Encadeia os trades: cada um começa no candle depois da saída do anterior.
  const trades = [];
  let first = null;
  let start = cs.findIndex((c) => c.openTime >= box.fromMs);
  while (start >= 0 && start < cs.length) {
    const r = simulateFrom(cs, start, box, p, isClosed, [], regimeOk);
    if (!first) first = r;
    if (r.signal && r.status !== 'noRef') trades.push(r);
    if (r.status !== 'closed') break;
    start = r.exitIdx + 1;
  }
  // Variação da moeda no intervalo da caixa (abertura do 1º candle → fechamento do último dentro
  // dela) — referência pro P&L dos trades ("comprar e segurar" no mesmo período).
  const inBox = cs.filter((c) => c.openTime >= box.fromMs && c.openTime <= box.toMs);
  const intervalChangePct = inBox.length ? ((inBox[inBox.length - 1].close - inBox[0].open) / inBox[0].open) * 100 : null;
  if (!first) return { status: 'noSignal', rejected: [], params: p, trades: [], intervalChangePct, regimePending };
  const closed = trades.filter((t) => t.status === 'closed');
  const totals = {
    count: trades.filter((t) => t.fill).length,
    wins: closed.filter((t) => t.outcome === 'target').length,
    losses: closed.filter((t) => t.outcome === 'stop').length,
    breakevens: closed.filter((t) => t.outcome === 'breakeven').length,
    mixed: closed.filter((t) => t.outcome === 'mixed').length, // reforço: 2ª estopou, 1ª saiu na entrada
    pnlUnits: trades.reduce((acc, t) => acc + (t.fill ? (t.pnlUnits ?? 0) : 0), 0), // × valor da entrada
    pnlSumPct: trades.reduce((acc, t) => acc + (t.fill ? t.pnlPct : 0), 0),
    compoundPct: (trades.reduce((acc, t) => acc * (t.fill ? 1 + t.pnlPct / 100 : 1), 1) - 1) * 100,
  };
  const targets = trades.map((t) => t.targetPrice).filter(Number.isFinite);
  return {
    ...first,
    trades,
    totals,
    intervalChangePct,
    regimePending,
    maxTargetPrice: targets.length ? Math.max(...targets) : null,
    rejected: trades.length ? trades.flatMap((t) => t.rejected ?? []) : first.rejected,
  };
}

/** Um trade: 1º sinal a partir de cs[startIdx] (dentro da caixa) → limite → alvo/stop. */
function simulateFrom(cs, startIdx, box, p, isClosed, carried = [], regimeOk = () => ({ ok: true })) {
  // Análise de candle de cada candle fechado da caixa até o sinal (padrão de alta/baixa + corpo);
  // `rejected` = candles que a regra do bot recusou por padrão de baixa (aparecem no resumo).
  const analyse = (i) => {
    const c = cs[i];
    const prev = cs.slice(Math.max(0, i - 4), i);
    return {
      bodyPct: ((c.close - c.open) / c.open) * 100,
      bullish: bullishClosePattern(c, prev),
      bearish: bearishClosePattern(c, prev),
    };
  };
  const rejected = [...carried];
  // Análise do candle i se ele é sinal pela regra (null se não é); registra os recusados.
  const reject = (c, why) => {
    if (!rejected.some((r) => r.openTime === c.openTime)) rejected.push({ openTime: c.openTime, pattern: why });
  };
  const candleSignal = (i) => {
    const c = cs[i];
    const a = analyse(i);
    if (p.signalRule === 'green') return c.close > c.open ? { ...a, authorizedBy: 'green' } : null;
    if (a.bearish) {
      if (c.close > c.open) reject(c, a.bearish);
      return null;
    }
    if (a.bodyPct >= Number(p.minBodyPct)) return { ...a, authorizedBy: 'body' };
    if (a.bullish) return { ...a, authorizedBy: 'pattern' };
    return null;
  };
  // Sinal do candle que o regime (BTC/MACD/EMA diária) não libera → recusado com o motivo.
  const signalAt = (i) => {
    const sig = candleSignal(i);
    if (!sig) return null;
    const r = regimeOk(cs[i]);
    if (!r.ok) { reject(cs[i], r.reason); return null; }
    return sig;
  };
  let signalIdx = -1;
  let analysis = null;
  for (let i = startIdx; i < cs.length; i++) {
    const c = cs[i];
    if (c.openTime < box.fromMs) continue;
    if (c.openTime > box.toMs || !isClosed(c)) break;
    analysis = signalAt(i);
    if (analysis) { signalIdx = i; break; }
  }
  if (signalIdx < 0) return { status: 'noSignal', rejected, params: p };

  const signal = cs[signalIdx];
  const closeEntry = p.entryMode !== 'limit';
  const refIdx = !closeEntry && p.entryRef === 'prev' ? signalIdx - 1 : signalIdx;
  if (refIdx < 0) return { status: 'noRef', signal, analysis, rejected, params: p };
  const ref = cs[refIdx];
  const level = Math.min(100, Math.max(0, Number(p.entryLevelPct)));
  const entryPlanned = closeEntry ? signal.close : ref.low + (ref.high - ref.low) * (level / 100);
  const targetFor = (e) => e * (1 + p.targetPct / 100);
  const stopFor = (e) => e * (1 - p.stopPct / 100);
  const base = { signal, ref, refIdx, signalIdx, entryPlanned, level, closeEntry, params: p, analysis, rejected };

  let fillIdx = closeEntry ? signalIdx : -1;
  let entry = closeEntry ? signal.close : null;
  for (let i = signalIdx + 1; !closeEntry && i < cs.length; i++) {
    const c = cs[i];
    if (c.openTime > box.toMs) break;
    if (c.low <= entryPlanned) {
      fillIdx = i;
      entry = c.open < entryPlanned ? c.open : entryPlanned;
      break;
    }
    // Sinal NOVO antes de a limite preencher → a limite é refeita nele (senão uma entrada que nunca
    // preenche travaria os trades seguintes da caixa).
    if (isClosed(c) && signalAt(i)) return simulateFrom(cs, i, box, p, isClosed, rejected, regimeOk);
  }
  if (fillIdx < 0) {
    return {
      ...base, status: 'notFilled',
      targetPrice: targetFor(entryPlanned), stopPrice: stopFor(entryPlanned),
    };
  }

  const targetPrice = targetFor(entry);
  const stopPrice = stopFor(entry);
  const fill = cs[fillIdx];
  const beDrop = Number(p.breakevenDropPct);
  const beTrigger = beDrop > 0 ? entry * (1 - beDrop / 100) : null;
  // Índice do candle em que a queda ativou o alvo → entrada (null = não ativou).
  let breakevenIdx = null;
  let addPrice = null; // preço da 2ª compra (reforço)
  const reinforce = !!p.dropReinforce && beTrigger != null;
  const mult = Math.max(0.1, Number(p.reinforceMult) || 1);
  const rStop = Math.max(0.1, Number(p.reinforceStopPct) || 15);
  // Cada compra é uma perna com o PRÓPRIO stop: a 1ª sempre −stopPct% da entrada; a 2ª (reforço)
  // −reinforceStopPct% do preço dela. Alvo das duas = +targetPct% da entrada, ou o preço da 1ª
  // entrada depois da queda. A 2ª pode estopar e a 1ª seguir aberta.
  const legs = [{ price: entry, size: 1, stop: stopPrice, fromIdx: fillIdx, exitIdx: null, exitPrice: null, outcome: null }];
  // P&L sobre o capital investido (1 parte na entrada + `mult` partes no reforço).
  const pnlOf = (lastPx) => {
    const inv = legs.reduce((acc, l) => acc + l.size, 0);
    const val = legs.reduce((acc, l) => acc + l.size * ((l.exitPrice ?? lastPx) / l.price), 0);
    return ((val - inv) / inv) * 100;
  };
  // Resultado em "entradas" (× valor da entrada, ex. 20 USDT): soma das pernas.
  const unitsOf = (lastPx) => legs.reduce((acc, l) => acc + l.size * ((l.exitPrice ?? lastPx) / l.price - 1), 0);
  const extra = () => {
    const leg2 = legs[1] ?? null;
    return {
      breakevenIdx, breakevenAt: breakevenIdx != null ? cs[breakevenIdx] : null, breakevenTrigger: beTrigger,
      addPrice, reinforced: addPrice != null, reinforceMult: mult,
      reinforceStopPrice: leg2?.stop ?? null,
      addExit: leg2?.exitIdx != null ? cs[leg2.exitIdx] : null, addOutcome: leg2?.outcome ?? null,
      legs: legs.map((l) => ({ ...l })),
    };
  };
  // Compra no fechamento: o candle do sinal já acabou na entrada — a saída começa no seguinte.
  for (let i = closeEntry ? fillIdx + 1 : fillIdx; i < cs.length; i++) {
    const c = cs[i];
    // A queda fica ACIMA do stop da 1ª: é tocada antes dele — o reforço compra mesmo que o candle siga
    // até o stop. Só alvo→entrada: candle que bate o stop da 1ª é stop, sem mudar nada.
    if (breakevenIdx == null && beTrigger != null && c.low <= beTrigger && (reinforce || c.low > stopPrice)) {
      breakevenIdx = i;
      if (reinforce) {
        addPrice = i > fillIdx && c.open < beTrigger ? c.open : beTrigger;
        legs.push({ price: addPrice, size: mult, stop: addPrice * (1 - rStop / 100), fromIdx: i, exitIdx: null, exitPrice: null, outcome: null });
      }
    }
    const beActive = breakevenIdx != null;
    const curTarget = beActive ? entry : targetPrice;
    // No candle do fill a máxima pode ter vindo ANTES da entrada — só vale alvo se fechou acima dele.
    // Idem no candle que ativou o alvo → entrada: a máxima pode ter vindo antes da queda.
    const sameCandleGuard = (!closeEntry && i === fillIdx) || i === breakevenIdx;
    const hitTarget = c.high >= curTarget && (!sameCandleGuard || c.close >= curTarget);
    for (const leg of legs) {
      if (leg.exitIdx != null) continue;
      // Candle que toca stop e alvo = STOP (conservador). Gap além do nível sai na abertura.
      if (c.low <= leg.stop) {
        leg.outcome = 'stop';
        leg.exitPrice = i > leg.fromIdx && c.open < leg.stop ? c.open : leg.stop;
      } else if (hitTarget) {
        leg.outcome = beActive ? 'breakeven' : 'target';
        leg.exitPrice = !sameCandleGuard && c.open > curTarget ? c.open : curTarget;
      } else continue;
      leg.exitIdx = i;
    }
    if (legs.every((l) => l.exitIdx != null)) {
      const outs = new Set(legs.map((l) => l.outcome));
      const outcome = outs.size === 1 ? legs[0].outcome : 'mixed';
      return {
        ...base, status: 'closed', outcome, fill, fillIdx, entry, targetPrice, stopPrice,
        ...extra(),
        exit: c, exitIdx: i, exitPrice: legs[0].exitPrice,
        pnlPct: pnlOf(c.close), pnlUnits: unitsOf(c.close),
        candlesHeld: i - fillIdx,
      };
    }
  }
  const last = cs[cs.length - 1];
  return {
    ...base, status: 'open', outcome: 'open', fill, fillIdx, entry, targetPrice, stopPrice,
    ...extra(),
    exit: last, exitIdx: cs.length - 1, exitPrice: last.close,
    pnlPct: pnlOf(last.close), pnlUnits: unitsOf(last.close),
    candlesHeld: cs.length - 1 - fillIdx,
  };
}
