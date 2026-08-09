/**
 * Simulação teórica mean-reversion nas Bandas de Bollinger: compra no toque da
 * banda inferior (preço = lower) e vende no toque da superior (preço = upper).
 * `bbPoints` precisa de upper/lower + high/low (candle do mesmo intervalo da BB).
 * Se a posição continuar aberta no fim, emite um ponto `open` no último close com %.
 */
export function simulateBbTouchPath(bbPoints) {
  if (!bbPoints?.length) return [];
  const nodes = [];
  let buy = null;
  for (const p of bbPoints) {
    const lower = Number(p.lower);
    const upper = Number(p.upper);
    const low = Number(p.low);
    const high = Number(p.high);
    const close = Number(p.close);
    const t = Number(p.openTime);
    if (![lower, upper, low, high, t].every(Number.isFinite)) continue;

    if (buy == null) {
      if (low <= lower) {
        buy = { openTime: t, price: lower, lastClose: close, lastTime: t };
        nodes.push({ openTime: t, price: lower, side: 'buy', pnlPct: null });
        // Mesmo candle também pode tocar a superior depois (OHLC: low→high típico do mean-reversion)
        if (high >= upper) {
          const pnlPct = ((upper - buy.price) / buy.price) * 100;
          nodes.push({ openTime: t, price: upper, side: 'sell', pnlPct });
          buy = null;
        }
      }
    } else if (high >= upper) {
      const pnlPct = ((upper - buy.price) / buy.price) * 100;
      nodes.push({ openTime: t, price: upper, side: 'sell', pnlPct });
      buy = null;
    } else if (Number.isFinite(close)) {
      buy.lastClose = close;
      buy.lastTime = t;
    }
  }
  if (buy != null && Number.isFinite(buy.lastClose) && Number.isFinite(buy.lastTime)
      && (buy.lastTime !== buy.openTime || buy.lastClose !== buy.price)) {
    const pnlPct = ((buy.lastClose - buy.price) / buy.price) * 100;
    nodes.push({
      openTime: buy.lastTime, price: buy.lastClose, side: 'open', pnlPct,
    });
  }
  return nodes;
}

/** Emparelha só entrada→saída (buy→sell/open). Não cria aresta saída→próxima entrada. */
export function pairBbPathCycles(pathNodes) {
  const cycles = [];
  if (!pathNodes?.length) return cycles;
  for (let i = 0; i < pathNodes.length; i++) {
    const n = pathNodes[i];
    if (n.side !== 'buy') continue;
    const exit = pathNodes[i + 1];
    if (!exit || (exit.side !== 'sell' && exit.side !== 'open')) continue;
    cycles.push({ buy: n, exit });
  }
  return cycles;
}
