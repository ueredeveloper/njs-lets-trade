// Simulador "Price action" da caixa de análise do gráfico (tipo 'priceAction' em
// CandlestickChart.jsx). Roda nos candles JÁ carregados no gráfico (mesmo intervalo da tela):
//
//   1. Sinal = 1º candle FECHADO com abertura dentro da caixa que passa na regra `signalRule`:
//      'bot' (padrão, v1.188.0) = a regra do bot no fechamento (Explosão de Alta): corpo verde
//      >= minBodyPct% OU padrão de alta (martelo, engolfo, estrela da manhã... — candlePatterns.js),
//      e nunca um padrão de baixa (shooting star, enforcado...); 'green' = qualquer candle de alta
//      (close > open), o comportamento antigo. O usuário começa a caixa no candle que quer.
//   2. Entrada = LIMIT no nível `entryLevelPct`% do candle de referência (0 = mínima, 50 = meio,
//      100 = máxima). Referência: o próprio candle do sinal ('signal' — é o "anterior" à entrada)
//      ou o candle antes dele ('prev').
//   3. A limite precisa preencher DENTRO da caixa (borda direita = validade). Fill quando a mínima
//      toca o nível; abriu abaixo (gap) = preenche na abertura.
//   4. Depois do fill: alvo +targetPct% / stop −stopPct% (mínimo 10%) sobre o preço de entrada, até o fim dos
//      candles carregados. Candle que toca os dois = STOP (conservador, sem saber a ordem
//      intra-candle) — inclusive o próprio candle do fill, onde o alvo só vale se o candle FECHOU
//      acima dele (a máxima pode ter vindo antes da entrada). Sem taxa de corretagem.

import { MANUAL_OCO_MIN_STOP_PCT } from './manualOco';
import { bearishClosePattern, bullishClosePattern } from './candlePatterns';

export const PRICE_ACTION_DEFAULTS = {
  targetPct: 15, // = Explosão de Alta automática (bullishBreakoutAuto.js CONFIG.exit, v1.186.0)
  stopPct: Math.max(15, MANUAL_OCO_MIN_STOP_PCT),
  entryRef: 'signal',
  entryLevelPct: 50,
  signalRule: 'bot',
  minBodyPct: 5,
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
 */
export function simulatePriceActionBox(candlesticks, box, params, intervalMs, nowMs = Date.now()) {
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
  const rejected = [];
  let signalIdx = -1;
  let analysis = null;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.openTime < box.fromMs) continue;
    if (c.openTime > box.toMs || !isClosed(c)) break;
    const a = analyse(i);
    if (p.signalRule === 'green') {
      if (c.close > c.open) { signalIdx = i; analysis = { ...a, authorizedBy: 'green' }; break; }
      continue;
    }
    if (a.bearish) {
      if (c.close > c.open) rejected.push({ openTime: c.openTime, pattern: a.bearish });
      continue;
    }
    if (a.bodyPct >= Number(p.minBodyPct)) { signalIdx = i; analysis = { ...a, authorizedBy: 'body' }; break; }
    if (a.bullish) { signalIdx = i; analysis = { ...a, authorizedBy: 'pattern' }; break; }
  }
  if (signalIdx < 0) return { status: 'noSignal', rejected, params: p };

  const signal = cs[signalIdx];
  const refIdx = p.entryRef === 'prev' ? signalIdx - 1 : signalIdx;
  if (refIdx < 0) return { status: 'noRef', signal, analysis, rejected, params: p };
  const ref = cs[refIdx];
  const level = Math.min(100, Math.max(0, Number(p.entryLevelPct)));
  const entryPlanned = ref.low + (ref.high - ref.low) * (level / 100);
  const targetFor = (e) => e * (1 + p.targetPct / 100);
  const stopFor = (e) => e * (1 - p.stopPct / 100);
  const base = { signal, ref, refIdx, signalIdx, entryPlanned, level, params: p, analysis, rejected };

  let fillIdx = -1;
  let entry = null;
  for (let i = signalIdx + 1; i < cs.length; i++) {
    const c = cs[i];
    if (c.openTime > box.toMs) break;
    if (c.low <= entryPlanned) {
      fillIdx = i;
      entry = c.open < entryPlanned ? c.open : entryPlanned;
      break;
    }
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
  for (let i = fillIdx; i < cs.length; i++) {
    const c = cs[i];
    const hitStop = c.low <= stopPrice;
    // No candle do fill a máxima pode ter vindo ANTES da entrada — só vale alvo se fechou acima dele.
    const hitTarget = c.high >= targetPrice && (i > fillIdx || c.close >= targetPrice);
    if (hitStop || hitTarget) {
      const outcome = hitStop ? 'stop' : 'target';
      // Gap além do nível (abriu já depois do stop/alvo) sai na abertura, não no nível.
      const exitPrice = outcome === 'stop'
        ? (i > fillIdx && c.open < stopPrice ? c.open : stopPrice)
        : (i > fillIdx && c.open > targetPrice ? c.open : targetPrice);
      return {
        ...base, status: 'closed', outcome, fill, fillIdx, entry, targetPrice, stopPrice,
        exit: c, exitIdx: i, exitPrice,
        pnlPct: ((exitPrice - entry) / entry) * 100,
        candlesHeld: i - fillIdx,
      };
    }
  }
  const last = cs[cs.length - 1];
  return {
    ...base, status: 'open', outcome: 'open', fill, fillIdx, entry, targetPrice, stopPrice,
    exit: last, exitIdx: cs.length - 1, exitPrice: last.close,
    pnlPct: ((last.close - entry) / entry) * 100,
    candlesHeld: cs.length - 1 - fillIdx,
  };
}
