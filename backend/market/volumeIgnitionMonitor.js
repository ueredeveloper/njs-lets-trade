'use strict';

// Detector de "ignição de volume" em tempo real — pega o tipo de salto que a IOTX
// deu em 08/08 às 22:02 BRT (volume ~50x acima do normal em 1 candle de 1m).
// Usa o stream público !miniTicker@arr (já disponível via binance-api-node,
// sem custo extra de rate-limit — é 1 conexão WS pra todos os símbolos).

const Binance = require('binance-api-node').default;
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');

const RECENT_WINDOW_MS = 60 * 1000; // volume "agora": últimos 60s
const BASELINE_WINDOW_MS = 5 * 60 * 1000; // baseline: os 5 min anteriores a isso
const HISTORY_MS = RECENT_WINDOW_MS + BASELINE_WINDOW_MS + 30_000;
const SPIKE_RATIO = 10; // taxa de volume/min atual >= 10x a média/min do baseline
const MIN_PRICE_MOVE_PCT = 2; // e o preço já andou >= 2% na janela de 60s
const MIN_BASELINE_QUOTE_VOL_PER_MIN = 200; // ignora pares mortos (baseline ~0 dispara falso positivo)
const FLAG_TTL_MS = 15 * 60 * 1000; // símbolo some da lista 15 min depois de disparar

const history = new Map(); // symbol -> [{ t, cumVolumeQuote, price }]
const flagged = new Map(); // symbol -> { firedAt, ratio, priceChangePct, price }

let activeSet = new Set();
let started = false;
let startedAt = null;
let lastTickAt = null;

function pruneOld(samples, now) {
  while (samples.length && now - samples[0].t > HISTORY_MS) samples.shift();
}

function sampleAt(samples, now, minAgeMs) {
  for (const s of samples) {
    if (now - s.t >= minAgeMs) return s;
  }
  return samples[0] ?? null;
}

function onTick(t) {
  const symbol = t.symbol;
  if (!activeSet.has(symbol)) return;

  const now = Date.now();
  const price = Number(t.curDayClose);
  const cumVolumeQuote = Number(t.volumeQuote); // volume acumulado nas últimas 24h, dado pela própria Binance
  if (!Number.isFinite(price) || !Number.isFinite(cumVolumeQuote)) return;

  let samples = history.get(symbol);
  if (!samples) {
    samples = [];
    history.set(symbol, samples);
  }
  samples.push({ t: now, cumVolumeQuote, price });
  pruneOld(samples, now);
  if (samples.length < 3) return;

  const recentAnchor = sampleAt(samples, now, RECENT_WINDOW_MS);
  const baselineAnchor = sampleAt(samples, now, RECENT_WINDOW_MS + BASELINE_WINDOW_MS);
  if (recentAnchor === baselineAnchor) return;

  const recentVol = cumVolumeQuote - recentAnchor.cumVolumeQuote;
  const baselineVol = recentAnchor.cumVolumeQuote - baselineAnchor.cumVolumeQuote;
  if (recentVol < 0 || baselineVol < 0) return; // virada da janela 24h da Binance, descarta essa leitura

  const recentMinElapsed = Math.max((now - recentAnchor.t) / 60000, 0.25);
  const baselineMinElapsed = Math.max((recentAnchor.t - baselineAnchor.t) / 60000, 1);

  const recentRatePerMin = recentVol / recentMinElapsed;
  const baselineRatePerMin = baselineVol / baselineMinElapsed;
  if (baselineRatePerMin < MIN_BASELINE_QUOTE_VOL_PER_MIN) return;

  const ratio = recentRatePerMin / baselineRatePerMin;
  const priceChangePct = ((price - recentAnchor.price) / recentAnchor.price) * 100;

  if (ratio >= SPIKE_RATIO && priceChangePct >= MIN_PRICE_MOVE_PCT) {
    flagged.set(symbol, { firedAt: now, ratio, priceChangePct, price });
  }
}

function pruneFlagged() {
  const now = Date.now();
  for (const [symbol, f] of flagged) {
    if (now - f.firedAt > FLAG_TTL_MS) flagged.delete(symbol);
  }
}

async function start() {
  if (started) return;
  started = true;

  const { list } = await getActiveUsdtPairs();
  activeSet = new Set(list);

  startedAt = Date.now();

  const client = Binance({});
  client.ws.allMiniTickers((tickers) => {
    lastTickAt = Date.now();
    for (const t of tickers) {
      try {
        onTick(t);
      } catch (err) {
        console.error(`[volumeIgnitionMonitor] erro processando ${t?.symbol}:`, err.message);
      }
    }
    pruneFlagged();
  });

  console.log(`[volumeIgnitionMonitor] monitorando ${activeSet.size} pares USDT via !miniTicker@arr`);
}

function getFlagged() {
  pruneFlagged();
  return [...flagged.entries()]
    .map(([symbol, f]) => ({ symbol, ...f }))
    .sort((a, b) => b.firedAt - a.firedAt);
}

function getStatus() {
  return {
    monitoredPairs: activeSet.size,
    startedAt,
    lastTickAt,
  };
}

module.exports = { start, getFlagged, getStatus };
