'use strict';

/**
 * Filtros de MERCADO da Explosão de Alta automática (v1.191.0) — os mesmos da caixa "Price action"
 * do gráfico (frontend-react/src/utils/priceActionRegime.js, regime 'btcD1Macd' + bearGuard
 * 'btcE20'), mais o ranking de alta do dia. Avaliados no FECHAMENTO do candle do sinal, só com
 * candles 4h/1d JÁ fechados até ali:
 *
 *   btcEma50_4h        BTCUSDT 4h fechou ACIMA da EMA50
 *   coinEma20_1d       a moeda fechou acima da EMA20 no diário
 *   coinMacd4h         histograma MACD(12,26,9) 4h da moeda > 0
 *   btcEma20_1dRising  período de baixa: EMA20 1d do BTC SUBINDO (último 1d fechado > o de 5 dias antes)
 *   topGainers         a moeda está entre as N de maior alta 24h (pares USDT ativos, sem stablecoin /
 *                      ação tokenizada, volume 24h >= minVolume24h) — ranking do MOMENTO da checagem
 *
 * Estudo (caixa Price action, 1000 candles 4h, alvo +15% / stop −30%): 77 moedas, regime + detector
 * de baixa → +5,6%/trade; 20 moedas em maior alta → +6,9%; 40 → +5,0% (com taxa). Ressalva: lista
 * de "em alta hoje" tem viés (o fim do período já é bom pra elas).
 *
 * Falha de rede/dado faltando → NÃO libera (fail-closed): melhor perder um sinal que comprar sem filtro.
 */

const fetchKlines = require('../../binance/fetchKlines');
const getTickers = require('../../binance/cachedTicker24hr');
const { getActiveUsdtPairs } = require('../../binance/getActiveUsdtPairs');
const { getSymbolCategories } = require('../../utils/assetCategories');

const H4 = 4 * 3_600_000;
const D1 = 86_400_000;

const DEFAULT_REGIME = {
  btcEma50_4h: true,
  coinEma20_1d: true,
  coinMacd4h: true,
  btcEma20_1dRising: true,
  topGainers: 40,
  minVolume24h: 1_000_000,
};

/** EMA semeada com a SMA dos `period` primeiros (igual ao technicalindicators e ao frontend). */
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
  ema(macd.slice(start), 9).forEach((s, j) => { if (s != null) out[start + j] = macd[start + j] - s; });
  return out;
}

const norm = (cs) => (cs ?? [])
  .map((c) => ({ openTime: Number(c.openTime), close: Number(c.close) }))
  .filter((c) => Number.isFinite(c.openTime) && Number.isFinite(c.close))
  .sort((a, b) => a.openTime - b.openTime);

/** Só os candles FECHADOS até `t` (openTime + iv <= t). */
const closedUntil = (cs, iv, t) => cs.filter((c) => c.openTime + iv <= t);

/**
 * Avaliação PURA dos filtros de candle (sem o ranking). `series` = { btc4h, btc1d, coin4h, coin1d }.
 * @returns {{ ok: boolean, reason?: string, details: object }}
 */
function evaluateRegime(series, closeMs, cfg = DEFAULT_REGIME) {
  const details = {};
  const fail = (reason) => ({ ok: false, reason, details });

  if (cfg.btcEma50_4h) {
    const b = closedUntil(norm(series.btc4h), H4, closeMs);
    const e = ema(b.map((c) => c.close), 50);
    const i = b.length - 1;
    if (i < 0 || e[i] == null) return fail('sem dado do BTC 4h');
    details.btcVsEma50Pct = +((b[i].close / e[i] - 1) * 100).toFixed(2);
    if (!(b[i].close > e[i])) return fail('BTC 4h abaixo da EMA50');
  }
  if (cfg.btcEma20_1dRising) {
    const b = closedUntil(norm(series.btc1d), D1, closeMs);
    const e = ema(b.map((c) => c.close), 20);
    const j = b.length - 1;
    if (j < 5 || e[j] == null || e[j - 5] == null) return fail('sem dado do BTC 1d');
    details.btcEma20_1dSlopePct = +((e[j] / e[j - 5] - 1) * 100).toFixed(2);
    if (!(e[j] > e[j - 5])) return fail('período de baixa (EMA20 1d do BTC caindo)');
  }
  if (cfg.coinEma20_1d) {
    const d = closedUntil(norm(series.coin1d), D1, closeMs);
    const e = ema(d.map((c) => c.close), 20);
    const j = d.length - 1;
    if (j < 0 || e[j] == null) return fail('sem dado diário da moeda');
    details.coinVsEma20_1dPct = +((d[j].close / e[j] - 1) * 100).toFixed(2);
    if (!(d[j].close > e[j])) return fail('moeda abaixo da EMA20 1d');
  }
  if (cfg.coinMacd4h) {
    const c = closedUntil(norm(series.coin4h), H4, closeMs);
    const h = macdHist(c.map((x) => x.close));
    const i = c.length - 1;
    if (i < 0 || h[i] == null) return fail('sem dado 4h da moeda');
    details.coinMacdHist4h = h[i];
    if (!(h[i] > 0)) return fail('MACD 4h da moeda ≤ 0');
  }
  return { ok: true, details };
}

const isUntradable = (sym) => getSymbolCategories(sym).some((c) => c === 'stablecoins' || c === 'tokenizedStocks');

/**
 * Ranking de alta 24h da Binance — A MESMA regra do bot e das listas ↑B do painel
 * (market/marketHighlights.js): pares USDT ativos, sem stablecoin / ação tokenizada, volume 24h
 * (quoteVolume) >= minVolume24h, ordenado pela variação 24h do ticker (priceChangePercent).
 * @returns {Array<{symbol, changePct, volume}>}
 */
function rankBinanceGainers(tickers, activeSymbols, minVolume24h = DEFAULT_REGIME.minVolume24h) {
  const active = activeSymbols instanceof Set ? activeSymbols : new Set(activeSymbols ?? []);
  return (tickers ?? [])
    .map((t) => ({ symbol: t.symbol, changePct: Number(t.priceChangePercent), volume: Number(t.quoteVolume) }))
    .filter((t) => active.has(t.symbol) && !isUntradable(t.symbol) && t.volume >= minVolume24h && Number.isFinite(t.changePct))
    .sort((a, b) => b.changePct - a.changePct);
}

/** Posição (1 = maior alta) da moeda no ranking de alta 24h, ou null se fora do universo. */
async function topGainerRank(symbol, minVolume24h = DEFAULT_REGIME.minVolume24h) {
  const [{ list }, tickers] = await Promise.all([getActiveUsdtPairs(), getTickers()]);
  const idx = rankBinanceGainers(tickers, list, minVolume24h).findIndex((t) => t.symbol === symbol);
  return idx < 0 ? null : idx + 1;
}

// Cache curto das séries do BTC (iguais pra todas as moedas da mesma varredura).
const btcCache = { at: 0, data: null };
async function btcSeries() {
  if (btcCache.data && Date.now() - btcCache.at < 5 * 60_000) return btcCache.data;
  const [btc4h, btc1d] = await Promise.all([fetchKlines('BTCUSDT', '4h', 120), fetchKlines('BTCUSDT', '1d', 60)]);
  btcCache.data = { btc4h, btc1d };
  btcCache.at = Date.now();
  return btcCache.data;
}

/**
 * Checagem completa (busca os candles + ranking). `closeMs` = fechamento do candle do sinal (na
 * varredura, com o candle ainda aberto, passe Date.now() — vale o estado atual).
 * @returns {Promise<{ ok: boolean, reason?: string, details: object }>}
 */
async function checkMarketRegime(symbol, closeMs, cfg = DEFAULT_REGIME) {
  const c = { ...DEFAULT_REGIME, ...cfg };
  try {
    const [btc, coin4h, coin1d] = await Promise.all([
      c.btcEma50_4h || c.btcEma20_1dRising ? btcSeries() : {},
      c.coinMacd4h ? fetchKlines(symbol, '4h', 120) : null,
      c.coinEma20_1d ? fetchKlines(symbol, '1d', 40) : null,
    ]);
    const r = evaluateRegime({ ...btc, coin4h, coin1d }, closeMs, c);
    if (!r.ok) return r;
    if (c.topGainers > 0) {
      const rank = await topGainerRank(symbol, c.minVolume24h);
      r.details.gainerRank = rank;
      if (rank == null || rank > c.topGainers) {
        return { ok: false, reason: `fora das ${c.topGainers} maiores altas 24h${rank ? ` (#${rank})` : ''}`, details: r.details };
      }
    }
    return r;
  } catch (err) {
    return { ok: false, reason: `filtro de mercado indisponível (${err.message})`, details: {} };
  }
}

/**
 * Estado ATUAL dos filtros (luzes de Configurações → Price action — GET /bullish-breakout/market-state).
 * Filtros do BTC = um sim/não pro mercado todo. Filtros da moeda = avaliados em cada uma das
 * `topGainers` maiores altas 24h de agora (mesmo ranking do bot) — o painel cruza com as caixinhas
 * marcadas pra dizer quantas passariam em tudo. Mesma regra do bot: só candles já fechados.
 */
async function marketStateNow({ topGainers = DEFAULT_REGIME.topGainers, minVolume24h = DEFAULT_REGIME.minVolume24h } = {}) {
  const now = Date.now();
  const only = (k) => ({ btcEma50_4h: false, coinEma20_1d: false, coinMacd4h: false, btcEma20_1dRising: false, [k]: true });
  const btc = await btcSeries();
  const b50 = evaluateRegime(btc, now, only('btcEma50_4h'));
  const b20 = evaluateRegime(btc, now, only('btcEma20_1dRising'));
  const [{ list }, tickers] = await Promise.all([getActiveUsdtPairs(), getTickers()]);
  const n = topGainers > 0 ? topGainers : DEFAULT_REGIME.topGainers;
  const top = rankBinanceGainers(tickers, list, minVolume24h).slice(0, n);
  const coins = [];
  // Poucas por vez pra não estourar o peso da API da Binance.
  for (let i = 0; i < top.length; i += 8) {
    const batch = await Promise.all(top.slice(i, i + 8).map(async (t, k) => {
      try {
        const [coin4h, coin1d] = await Promise.all([fetchKlines(t.symbol, '4h', 120), fetchKlines(t.symbol, '1d', 40)]);
        const e = evaluateRegime({ coin1d }, now, only('coinEma20_1d'));
        const m = evaluateRegime({ coin4h }, now, only('coinMacd4h'));
        return { symbol: t.symbol, rank: i + k + 1, changePct: t.changePct, coinEma20_1d: e.ok, coinMacd4h: m.ok };
      } catch {
        return { symbol: t.symbol, rank: i + k + 1, changePct: t.changePct, coinEma20_1d: null, coinMacd4h: null };
      }
    }));
    coins.push(...batch);
  }
  return {
    at: now,
    btcEma50_4h: { ok: b50.ok, value: b50.details.btcVsEma50Pct ?? null, reason: b50.reason ?? null },
    btcEma20_1dRising: { ok: b20.ok, value: b20.details.btcEma20_1dSlopePct ?? null, reason: b20.reason ?? null },
    topGainers: n,
    coins,
  };
}

module.exports = {
  DEFAULT_REGIME, evaluateRegime, checkMarketRegime, topGainerRank, rankBinanceGainers, ema, macdHist, marketStateNow,
  _test: { resetBtcCache: () => { btcCache.data = null; btcCache.at = 0; } },
};
