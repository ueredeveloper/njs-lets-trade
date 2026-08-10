/**
 * Sinais de toque na banda inferior da Bollinger (mesmo gatilho de entrada do bot
 * bollinger-bands) + tendência da linha mediana (média): pra cada toque, olha os
 * `lookback` candles fechados imediatamente anteriores — mesma janela de
 * backend/bot/bollinger-bands/strategyEngine.js#checkMedianTrendFilter — e calcula a média
 * das variações candle-a-candle da linha mediana (middle) nesse trecho.
 * avgDiff >= 0 → mediana subindo/estável (verde, libera a compra no bot);
 * avgDiff < 0 → mediana em queda (vermelho, o bot bloqueia/cancela a compra).
 */
export function computeMedianTrendSignals(bbPoints, lookback = 10) {
  if (!bbPoints?.length) return [];
  const pts = [...bbPoints].sort((a, b) => Number(a.openTime) - Number(b.openTime));
  const signals = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const lower = Number(p.lower);
    const low = Number(p.low);
    if (![lower, low].every(Number.isFinite) || low > lower) continue;

    // lookback+1 candles fechados imediatamente antes do sinal (mesma janela do backend:
    // lookback diffs precisam de lookback+1 valores da linha mediana).
    const start = i - lookback - 1;
    if (start < 0) continue;
    const middles = pts.slice(start, i).map(w => Number(w.middle));
    if (middles.length < lookback + 1 || middles.some(m => !Number.isFinite(m))) continue;

    const diffs = [];
    for (let k = 1; k < middles.length; k++) diffs.push(middles[k] - middles[k - 1]);
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;

    // Linha desenhada sobre os `lookback` candles imediatamente anteriores ao sinal.
    const data = pts.slice(i - lookback, i)
      .map(w => ({ time: Math.floor(Number(w.openTime) / 1000), value: Number(w.middle) }))
      .filter(d => Number.isFinite(d.time) && Number.isFinite(d.value));
    if (data.length < 2) continue;

    signals.push({
      signalOpenTime: Number(p.openTime),
      avgDiff,
      trend: avgDiff >= 0 ? 'up' : 'down',
      data,
    });
  }
  return signals;
}
