'use strict';

// Detector de "ignição de volume" em tempo real — pega o tipo de salto que a IOTX
// deu em 08/08 às 22:02 BRT (volume ~50x acima do normal em 1 candle de 1m).
//
// Usa um combined stream (1 única conexão WS) assinando só os pares USDT ativos
// via <symbol>@miniTicker — em vez do !miniTicker@arr, que traz TODO o mercado da
// Binance (milhares de pares BTC/ETH/FDUSD/TRY/EUR/BRL etc que não usamos aqui).
// Limite documentado: até 1024 streams por conexão — bem acima dos ~489 pares USDT.

const WebSocket = require('ws');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { sendWhatsApp } = require('../bot/whatsapp');
const { sbReq } = require('../bot/shared/supabaseRest');

const STREAM_BASE = 'wss://stream.binance.com:9443/stream?streams=';
const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_MS = 30 * 1000; // grava status no Supabase — painel roda em outra máquina (Termux), sem memória compartilhada

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

function onTick(symbol, price, cumVolumeQuote) {
  const now = Date.now();
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
    const isNew = !flagged.has(symbol);
    flagged.set(symbol, { firedAt: now, ratio, priceChangePct, price });
    if (isNew) notifyIgnition(symbol, ratio, priceChangePct, price, now);
  }
}

function notifyIgnition(symbol, ratio, priceChangePct, price, firedAt) {
  sendWhatsApp(
    `🚀 Ignição de volume: ${symbol}\n`
    + `Volume ${ratio.toFixed(1)}x acima do normal\n`
    + `Preço: ${price} (${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}% em 60s)`,
  );

  // Painel roda em outra máquina (PC) — sem isso ele nunca saberia que algo disparou aqui no Termux.
  sbReq('POST', 'volume_ignition_events', {
    symbol,
    exchange: 'binance',
    ratio,
    price_change_pct: priceChangePct,
    price,
    fired_at: new Date(firedAt).toISOString(),
  }).catch((err) => console.error('[volumeIgnitionMonitor] falha ao gravar evento no Supabase:', err.message));
}

function pruneFlagged() {
  const now = Date.now();
  for (const [symbol, f] of flagged) {
    if (now - f.firedAt > FLAG_TTL_MS) flagged.delete(symbol);
  }
}

function buildStreamUrl(symbols) {
  const streams = symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
  return `${STREAM_BASE}${streams}`;
}

function connect(symbols) {
  const ws = new WebSocket(buildStreamUrl(symbols));

  ws.on('message', (raw) => {
    lastTickAt = Date.now();
    try {
      const msg = JSON.parse(raw);
      const d = msg?.data;
      if (!d || d.e !== '24hrMiniTicker') return;
      onTick(d.s, Number(d.c), Number(d.q));
    } catch (err) {
      console.error('[volumeIgnitionMonitor] erro processando mensagem:', err.message);
    }
    pruneFlagged();
  });

  ws.on('error', (err) => {
    console.error('[volumeIgnitionMonitor] erro no WebSocket:', err.message);
  });

  ws.on('close', () => {
    console.warn(`[volumeIgnitionMonitor] conexão fechada — reconectando em ${RECONNECT_DELAY_MS / 1000}s`);
    setTimeout(() => connect(symbols), RECONNECT_DELAY_MS);
  });
}

async function sendHeartbeat() {
  try {
    await sbReq('PATCH', 'volume_ignition_status', {
      monitored_pairs: activeSet.size,
      started_at: startedAt ? new Date(startedAt).toISOString() : null,
      last_tick_at: lastTickAt ? new Date(lastTickAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, '?id=eq.1');
  } catch (err) {
    console.error('[volumeIgnitionMonitor] falha no heartbeat do Supabase:', err.message);
  }
}

async function start() {
  if (started) return;
  started = true;

  const { list } = await getActiveUsdtPairs();
  activeSet = new Set(list);
  startedAt = Date.now();

  connect(list);
  sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);

  console.log(`[volumeIgnitionMonitor] monitorando ${activeSet.size} pares USDT via combined stream (miniTicker)`);
}

module.exports = { start };
