// Filtro de REGIME da caixa "Price action" (v1.191.0) — estudo HUMAUSDT + 67 moedas, 4h, 26/06→18/11/2026:
// o resultado do price action depende mais da fase do mercado que do candle. Sem filtro: 52% de
// acerto, +0,49%/trade; BTC > EMA50 4h: 55%, +1,65%; + MACD 4h da moeda > 0: 58%, +2,32%.
//
// Modos (params.regime):
//   'off'      — sem filtro
//   'btc'      — BTCUSDT 4h fechou ACIMA da EMA50 (último candle 4h fechado até o fechamento do sinal)
//   'btcMacd'  — 'btc' + histograma MACD(12,26,9) 4h da moeda > 0
//   'btcD1'    — 'btc' + moeda fechou acima da EMA20 no diário (último 1d fechado)
//   'btcD1Macd'— 'btcD1' + histograma MACD 4h da moeda > 0 (estudo 1000 candles 4h, 50 moedas,
//                05/06→19/11/2026: BTC+EMA20 1d 54% / +1,28%/trade → + MACD 4h 58% / +2,30%)
// Sempre olhando só candles FECHADOS até o fechamento do candle do sinal (sem olhar o futuro).

export const REGIME_OPTIONS = [
  { value: 'off', label: 'Regime: off' },
  { value: 'btc', label: 'BTC > EMA50 4h' },
  { value: 'btcMacd', label: 'BTC + MACD 4h' },
  { value: 'btcD1', label: 'BTC + EMA20 1d' },
  { value: 'btcD1Macd', label: 'BTC + EMA20 1d + MACD 4h' },
];

// Detector de PERÍODO DE BAIXA (params.bearGuard), independente do regime: 'btcE20' = só entra
// com a EMA20 diária do BTC SUBINDO (último 1d fechado > o de 5 dias antes). Estudo 77 moedas, 1000
// candles 4h, alvo +15%, regime BTC+EMA20 1d+MACD 4h: stop −30% foi de +4,07%/trade (2ª metade
// −0,95%, outubro −7,7%) pra +5,61% (2ª metade +0,28%, outubro −2,1%); stop −20%: +4,35%, 2ª metade
// +1,58%. Reage com atraso (média) — a virada de mercado ainda pega os trades abertos antes dela.
export const BEAR_GUARD_OPTIONS = [
  { value: 'off', label: 'Baixa: ignorar' },
  { value: 'btcE20', label: 'Baixa: EMA20 1d BTC subindo' },
];

const H4 = 4 * 3_600_000;
const D1 = 86_400_000;

/** Quais séries o modo precisa: { btc4h, coin4h, coin1d, btc1d } (true = buscar). */
export function regimeNeeds(regime, bearGuard = 'off') {
  return {
    btc1d: bearGuard === 'btcE20',
    btc4h: regime === 'btc' || regime === 'btcMacd' || regime === 'btcD1' || regime === 'btcD1Macd',
    coin4h: regime === 'btcMacd' || regime === 'btcD1Macd',
    coin1d: regime === 'btcD1' || regime === 'btcD1Macd',
  };
}

/** EMA semeada com a SMA dos `period` primeiros (igual ao technicalindicators). */
function ema(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

function macdHist(values) {
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  const macd = values.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const start = macd.findIndex((v) => v != null);
  const out = Array(values.length).fill(null);
  if (start < 0) return out;
  const sig = ema(macd.slice(start), 9);
  sig.forEach((s, j) => { if (s != null) out[start + j] = macd[start + j] - s; });
  return out;
}

const norm = (cs) => (cs ?? [])
  .map((c) => ({ openTime: Number(c.openTime), close: Number(c.close) }))
  .filter((c) => Number.isFinite(c.openTime) && Number.isFinite(c.close))
  .sort((a, b) => a.openTime - b.openTime);

/** Último índice com candle FECHADO até `t` (openTime + iv <= t), busca binária. */
function lastClosedIdx(cs, iv, t) {
  let lo = 0; let hi = cs.length - 1; let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cs[mid].openTime + iv <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Monta o checador do regime. `ctx` = { btc4h, coin4h, coin1d } (candles crus; faltando = ainda
 * carregando). Devolve (closeMs) => { ok: boolean, reason?: string, pending?: true }.
 */
export function buildRegimeCheck(regime, ctx = {}, bearGuard = 'off') {
  const useRegime = !!regime && regime !== 'off';
  if (!useRegime && bearGuard !== 'btcE20') return () => ({ ok: true });
  const need = regimeNeeds(useRegime ? regime : 'off', bearGuard);
  const bd = norm(ctx.btc1d);
  const bdEma = need.btc1d ? ema(bd.map((c) => c.close), 20) : [];
  const btc = norm(ctx.btc4h);
  const btcEma = ema(btc.map((c) => c.close), 50);
  const c4 = norm(ctx.coin4h);
  const hist = need.coin4h ? macdHist(c4.map((c) => c.close)) : [];
  const d1 = norm(ctx.coin1d);
  const d1Ema = need.coin1d ? ema(d1.map((c) => c.close), 20) : [];
  const missing = (need.btc4h && !btc.length) || (need.coin4h && !c4.length) || (need.coin1d && !d1.length)
    || (need.btc1d && !bd.length);

  return (closeMs) => {
    if (missing) return { ok: true, pending: true };
    if (need.btc1d) {
      const j = lastClosedIdx(bd, D1, closeMs);
      if (j < 5 || bdEma[j] == null || bdEma[j - 5] == null) return { ok: true, pending: true };
      if (!(bdEma[j] > bdEma[j - 5])) return { ok: false, reason: 'baixa: EMA20 1d BTC caindo' };
    }
    if (!useRegime) return { ok: true };
    const b = lastClosedIdx(btc, H4, closeMs);
    if (b < 0 || btcEma[b] == null) return { ok: true, pending: true };
    if (!(btc[b].close > btcEma[b])) return { ok: false, reason: 'BTC < EMA50 4h' };
    if (need.coin4h) {
      const i = lastClosedIdx(c4, H4, closeMs);
      if (i < 0 || hist[i] == null) return { ok: true, pending: true };
      if (!(hist[i] > 0)) return { ok: false, reason: 'MACD 4h ≤ 0' };
    }
    if (need.coin1d) {
      const i = lastClosedIdx(d1, D1, closeMs);
      if (i < 0 || d1Ema[i] == null) return { ok: true, pending: true };
      if (!(d1[i].close > d1Ema[i])) return { ok: false, reason: 'abaixo EMA20 1d' };
    }
    return { ok: true };
  };
}
