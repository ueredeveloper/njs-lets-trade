/**
 * TD Sequential (Tom DeMark) — fase de SETUP, versão simplificada. Botão "TD SEQ" no painel de
 * indicadores. Implementa só a contagem 1-9 de cada lado (sem Countdown/TDST/qualificadores de
 * "true low/true high" da versão oficial completa — aqui é só pra visualizar exaustão de
 * tendência, não pra sinal de entrada automatizado).
 *
 * Regra clássica: compara o fechamento de cada candle com o fechamento 4 candles atrás.
 *  - Buy Setup (marcador ABAIXO do candle): closes consecutivos MENORES que o de 4 atrás —
 *    sinaliza exaustão de vendedores, possível FUNDO (fim da queda).
 *  - Sell Setup (marcador ACIMA do candle): closes consecutivos MAIORES que o de 4 atrás —
 *    sinaliza exaustão de compradores, possível TOPO (fim da subida).
 * A contagem trava em 9 (não continua crescendo) até um "flip": a condição oposta reinicia a
 * contagem do outro lado a partir de 1. Um empate (close igual ao de 4 candles atrás) não avança
 * nem inverte a contagem atual.
 *
 * @returns {Array<{time:number, state:'buy'|'sell', count:number}|null>} um item por candle
 *          (null pros 4 primeiros candles, sem histórico suficiente, e pros empates).
 */
export function computeTdSequentialSetup(candlesticks) {
  if (!candlesticks?.length) return [];
  const closes = candlesticks.map((c) => Number(c.close));
  const out = [];
  let state = null; // 'buy' | 'sell'
  let count = 0;
  for (let i = 0; i < candlesticks.length; i++) {
    const close = closes[i];
    const closeBack4 = closes[i - 4];
    const openTime = candlesticks[i]?.openTime;
    if (i < 4 || !Number.isFinite(close) || !Number.isFinite(closeBack4) || !Number.isFinite(Number(openTime))) {
      out.push(null);
      continue;
    }
    const bar = close < closeBack4 ? 'buy' : (close > closeBack4 ? 'sell' : null);
    if (bar == null) {
      out.push(null);
      continue;
    }
    if (bar === state) {
      if (count < 9) count++;
    } else {
      state = bar;
      count = 1;
    }
    out.push({ time: Math.floor(Number(openTime) / 1000), state, count });
  }
  return out;
}
