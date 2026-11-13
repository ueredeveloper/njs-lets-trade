'use strict';

/**
 * Explosão de Alta automática — o mesmo fluxo que dá pra fazer na mão (scanner "Explosão de Alta"
 * em Analisar Indicadores → OCO do gráfico "no fechamento do candle"), rodando sozinho dentro do
 * processo do rsi-momentum-bot:
 *
 *   1. a cada SCAN_EVERY_MS varre os pares USDT da Binance (backend/market/bullishBreakoutScanner.js,
 *      candle 4h EM FORMAÇÃO, critérios padrão do scanner);
 *   2. pra cada moeda nova: adiciona no favorito Binance (favorites_binance) e grava uma ordem em
 *      manual_oco_orders com entry_kind 'candle_close' pro fechamento DAQUELE candle;
 *   3. o manualOcoWatcher executa no fechamento (ver processCandleClose): não compra se o candle
 *      fechou num padrão de baixa OU se a explosão não se confirmou no candle fechado
 *      (close_condition.confirmBreakout); senão arma a entrada 5% ABAIXO do fechamento
 *      (close_condition.entryDiscount → vira entry_kind 'limit', expira em 12h) e, se encher,
 *      compra a mercado e monta a OCO com close_condition.exit — alvo +10% e stop na METADE do
 *      candle fechado ((máx+mín)/2), nunca a menos de 10% do preço comprado. Só a 1ª explosão do
 *      movimento (scan.firstOfMove).
 *
 * Limites: no máximo MAX_ACTIVE ordens automáticas vivas (aguardando + compradas); uma moeda com
 * qualquer ordem OCO viva (manual ou automática) é pulada; e uma ordem por moeda por candle.
 * Desligar: BULLISH_BREAKOUT_AUTO=off no .env (e reiniciar o bot).
 */

const { sbReq } = require('../shared/supabaseRest');
const { sendWhatsApp } = require('../whatsapp');
const { scanBullishBreakouts } = require('../../market/bullishBreakoutScanner');
const { intervalMs } = require('../shared/candleCloseCondition');

const SOURCE = 'bullish_breakout_auto';
const ORDERS = 'manual_oco_orders';
const FAVORITES = 'favorites_binance';
const LIVE_STATUSES = ['NEW', 'OPEN', 'CANCEL_REQUESTED', 'FILLED', 'BRACKETED', 'SELLING', 'OCO_FAILED'];

const CONFIG = {
  interval: '4h',
  usdt: 25,
  maxActive: 3,
  // Critérios do scanner (o resto fica no padrão de bullishBreakoutScanner.js#DEFAULTS): corpo
  // verde >= 5% e volume 24h >= 1,5M USDT. O volume 24h só filtra na varredura (candle aberto) — a
  // reconferência do fechamento (confirmBreakout) olha só o candle, não o volume 24h.
  // firstOfMove: só a 1ª explosão do movimento (2ª/3ª seguidas, como a INITUSDT 09–10/11, ficam de fora).
  scan: { minBodyPct: 5, minVolume24h: 1_500_000, firstOfMove: true },
  exit: { targetPct: 10, stopMode: 'candleMid', minStopPct: 10 },
  // Entrada: em vez de comprar a mercado no fechamento, espera o preço cair discountPct% abaixo do
  // fechamento por até waitHours (backtest 30/10–13/11/2026: direto −3,5%/trade; −5% em 12h encheu
  // 69% e −1,7%/trade). Expirou sem encher → CLOSED.
  entry: { discountPct: 5, waitHours: 12 },
};
const SCAN_EVERY_MS = 15 * 60_000;
const FIRST_SCAN_DELAY_MS = 60_000;

function fmt(p) {
  return Number.isFinite(Number(p)) ? String(Number(Number(p).toPrecision(6))) : '—';
}

function fmtBrt(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Alvo/stop da OCO a partir do preço comprado e do candle de explosão (fechado ou, na prévia
 *  gravada na criação, ainda aberto). Stop = metade do candle, mas no mínimo minStopPct abaixo. */
function exitLevels(buyPrice, candle, exit = CONFIG.exit) {
  const target = buyPrice * (1 + exit.targetPct / 100);
  const floor = buyPrice * (1 - exit.minStopPct / 100);
  const mid = (Number(candle.high) + Number(candle.low)) / 2;
  const stop = Number.isFinite(mid) && mid > 0 ? Math.min(mid, floor) : floor;
  return { target, stop };
}

async function ensureBinanceFavorite(userId, symbol) {
  const rows = await sbReq('GET', FAVORITES, null, `?user_id=eq.${userId}&symbol=eq.${symbol}&select=symbol&limit=1`);
  if (rows?.length) return false;
  await sbReq('POST', FAVORITES, { user_id: userId, symbol });
  return true;
}

async function runCycle(log) {
  const { list, meta } = await scanBullishBreakouts({
    interval: CONFIG.interval, ...CONFIG.scan, withinCandles: 1, closedOnly: false,
  });
  if (!list.length) return;

  const live = await sbReq('GET', ORDERS, null,
    `?status=in.(${LIVE_STATUSES.join(',')})&select=id,symbol,close_condition`) ?? [];
  const liveSymbols = new Set(live.map((o) => o.symbol));
  let activeAuto = live.filter((o) => o.close_condition?.source === SOURCE).length;
  const userId = process.env.SUPABASE_DEFAULT_USER_ID;

  for (const symbol of list) {
    const b = meta.breakouts[symbol];
    if (liveSymbols.has(symbol)) continue;
    // Uma ordem por moeda por candle: se já fechou sem comprar (padrão de baixa), não recria.
    const same = await sbReq('GET', ORDERS, null,
      `?symbol=eq.${symbol}&close_condition->>source=eq.${SOURCE}&close_condition->>candleOpenTime=eq.${b.openTime}&select=id&limit=1`);
    if (same?.length) continue;
    if (activeAuto >= CONFIG.maxActive) {
      log(`🚀 [Explosão auto] ${symbol} explodiu (corpo +${b.bodyPct}%, vol ${b.volumeRatio}×) mas já há ${activeAuto}/${CONFIG.maxActive} ordens automáticas — pulada`);
      continue;
    }

    const ivMs = intervalMs(CONFIG.interval);
    const closeAt = b.openTime + ivMs;
    const preview = exitLevels(b.close, b);
    const [row] = await sbReq('POST', ORDERS, {
      symbol, exchange: 'binance', usdt: CONFIG.usdt,
      entry_price: b.close, target_price: preview.target, stop_price: preview.stop,
      entry_kind: 'candle_close',
      close_condition: {
        interval: CONFIG.interval, candleOpenTime: b.openTime, closeAt,
        source: SOURCE,
        confirmBreakout: { ...meta.options, withinCandles: 1, closedOnly: false },
        exit: CONFIG.exit,
        entryDiscount: CONFIG.entry,
        detected: { bodyPct: b.bodyPct, volumeRatio: b.volumeRatio, closePos: b.closePos, breakoutPct: b.breakoutPct },
      },
    }) ?? [];
    if (!row) continue;
    activeAuto++;
    liveSymbols.add(symbol);

    let favTxt = '';
    if (userId) {
      try {
        if (await ensureBinanceFavorite(userId, symbol)) favTxt = ' · adicionada ao favorito Binance';
      } catch (err) {
        log(`⚠️  [Explosão auto] ${symbol}: favorito Binance falhou (${err.message})`);
      }
    }
    const txt = `${symbol} ${CONFIG.interval} explodiu (corpo +${b.bodyPct}%, vol ${b.volumeRatio}×, rompeu +${b.breakoutPct}%) — `
      + `ordem #${row.id} de ${CONFIG.usdt} USDT: no fechamento ${fmtBrt(closeAt)}, se a explosão se confirmar e não `
      + `fechar em padrão de baixa, arma a entrada ${CONFIG.entry.discountPct}% abaixo do fechamento (espera até `
      + `${CONFIG.entry.waitHours}h) · alvo +${CONFIG.exit.targetPct}% / stop na metade do candle (mín. −${CONFIG.exit.minStopPct}%)${favTxt}`;
    log(`🚀 [Explosão auto] ${txt}`);
    sendWhatsApp(`🚀 Explosão de Alta: ${txt}`).catch((err) => log(`⚠️  [Explosão auto] WhatsApp falhou: ${err.message}`));
  }
}

function startBullishBreakoutAuto({ log = console.log } = {}) {
  if (String(process.env.BULLISH_BREAKOUT_AUTO ?? '').toLowerCase() === 'off') {
    log('⏸️  [Explosão auto] desligada (BULLISH_BREAKOUT_AUTO=off)');
    return null;
  }
  if (!process.env.SUPABASE_DEFAULT_USER_ID) {
    log('⚠️  [Explosão auto] SUPABASE_DEFAULT_USER_ID ausente no .env — ordens seguem, mas sem favorito Binance');
  }
  log(`🚀 [Explosão auto] ligada — scanner ${CONFIG.interval} a cada ${SCAN_EVERY_MS / 60_000} min, `
    + `${CONFIG.usdt} USDT/ordem, máx. ${CONFIG.maxActive} ordens`);
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      await runCycle(log);
    } catch (err) {
      log(`⚠️  [Explosão auto] ciclo falhou: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(pass, FIRST_SCAN_DELAY_MS);
  return setInterval(pass, SCAN_EVERY_MS);
}

module.exports = { startBullishBreakoutAuto, exitLevels, CONFIG, SOURCE };
