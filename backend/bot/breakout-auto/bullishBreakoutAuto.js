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
 *      (close_condition.confirmBreakout — v1.187.0: corpo abaixo de minBodyPct passa se o candle
 *      fechou num padrão de ALTA, bullishClosePattern); senão compra a mercado NO FECHAMENTO (v1.186.0 — a
 *      entrada 5% abaixo do fechamento saiu; ordens antigas com close_condition.entryDiscount
 *      ainda seguem a regra delas) e monta a OCO com close_condition.exit — alvo +15% e stop −15%
 *      (ou a METADE do candle fechado, (máx+mín)/2, se ela estiver mais longe). Só a 1ª explosão
 *      do movimento (scan.firstOfMove).
 *
 * Limites: no máximo MAX_ACTIVE ordens automáticas vivas (aguardando + compradas); uma moeda com
 * qualquer ordem OCO viva (manual ou automática) é pulada; e uma ordem por moeda por candle.
 * Desligar: BULLISH_BREAKOUT_AUTO=off no .env (e reiniciar o bot).
 */

const { sbReq } = require('../shared/supabaseRest');
const { sendWhatsApp } = require('../whatsapp');
const { scanBullishBreakouts } = require('../../market/bullishBreakoutScanner');
const { intervalMs } = require('../shared/candleCloseCondition');
const { DEFAULTS: PA_DEFAULTS, loadPriceActionConfig } = require('./priceActionConfig');
const { checkMarketRegime } = require('./marketRegime');

const SOURCE = 'bullish_breakout_auto';
const ORDERS = 'manual_oco_orders';
const FAVORITES = 'favorites_binance';
const LIVE_STATUSES = ['NEW', 'OPEN', 'CANCEL_REQUESTED', 'FILLED', 'BRACKETED', 'SELLING', 'OCO_FAILED'];

/** Config efetiva a partir da config do painel (priceActionConfig.js — Configurações → Price action). */
function buildConfig(pa = PA_DEFAULTS) {
  return {
    interval: '4h',
    enabled: pa.enabled,
    usdt: pa.usdt,
    maxActive: pa.maxActive,
    // Critérios do scanner (o resto fica no padrão de bullishBreakoutScanner.js#DEFAULTS): corpo
    // verde >= minBodyPct e volume 24h >= minVolume24h. O volume 24h só filtra na varredura (candle
    // aberto) — a reconferência do fechamento (confirmBreakout) olha só o candle.
    // firstOfMove: só a 1ª explosão do movimento (2ª/3ª seguidas, como a INITUSDT 09–10/11, ficam de fora).
    scan: { minBodyPct: pa.minBodyPct, minVolume24h: pa.minVolume24h, firstOfMove: pa.firstOfMove },
    // Alvo +targetPct / stop −stopPct do preço comprado (v1.191.0: +15% / −30%; era −15% até
    // v1.190.0). Stop = o mais longe entre −minStopPct% e a metade do candle de explosão.
    exit: { targetPct: pa.targetPct, stopMode: 'candleMid', minStopPct: pa.stopPct },
    // Filtros de mercado (marketRegime.js) — conferidos na varredura E no fechamento do candle.
    regime: pa.regime,
    // Entrada: compra a mercado no fechamento do candle (sem desconto). Até v1.185.0 armava a entrada
    // 5% abaixo do fechamento por 12h ({ discountPct: 5, waitHours: 12 }); null = sem desconto. O
    // watcher ainda honra close_condition.entryDiscount das ordens já gravadas.
    entry: null,
  };
}
const CONFIG = buildConfig();
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

/** Texto curto dos filtros de mercado ligados (log/WhatsApp). */
function regimeLabel(rg) {
  if (!rg) return 'sem filtro de mercado';
  const p = [];
  if (rg.btcEma50_4h) p.push('BTC 4h > EMA50');
  if (rg.coinEma20_1d) p.push('moeda > EMA20 1d');
  if (rg.coinMacd4h) p.push('MACD 4h > 0');
  if (rg.btcEma20_1dRising) p.push('EMA20 1d do BTC subindo');
  if (rg.topGainers > 0) p.push(`top ${rg.topGainers} altas 24h`);
  return p.length ? p.join(' · ') : 'sem filtro de mercado';
}

// Moeda+candle já recusada pelo filtro de mercado — loga uma vez só por candle (a varredura roda a cada 15 min).
const regimeRefused = new Map();

async function runCycle(log) {
  const CONFIG = buildConfig(await loadPriceActionConfig(sbReq, process.env.SUPABASE_DEFAULT_USER_ID));
  if (!CONFIG.enabled) return;
  const { list, meta } = await scanBullishBreakouts({
    interval: CONFIG.interval, ...CONFIG.scan, withinCandles: 1, closedOnly: false,
  });
  if (!list.length) return;

  const live = await sbReq('GET', ORDERS, null,
    `?status=in.(${LIVE_STATUSES.join(',')})&select=id,symbol,close_condition`) ?? [];
  const liveSymbols = new Set(live.map((o) => o.symbol));
  let activeAuto = live.filter((o) => o.close_condition?.source === SOURCE).length;
  const userId = process.env.SUPABASE_DEFAULT_USER_ID;
  for (const [k, at] of regimeRefused) if (Date.now() - at > 8 * 3600_000) regimeRefused.delete(k);

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
    // Filtros de mercado (v1.191.0) no estado ATUAL — reconferidos no fechamento pelo watcher.
    const rg = await checkMarketRegime(symbol, Date.now(), CONFIG.regime);
    if (!rg.ok) {
      const key = `${symbol}|${b.openTime}`;
      if (!regimeRefused.has(key)) {
        regimeRefused.set(key, Date.now());
        log(`⏭️  [Explosão auto] ${symbol} explodiu (corpo +${b.bodyPct}%, vol ${b.volumeRatio}×) mas o filtro de mercado barrou: ${rg.reason}`);
      }
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
        ...(CONFIG.regime && { regime: CONFIG.regime }),
        ...(CONFIG.entry && { entryDiscount: CONFIG.entry }),
        detected: {
          bodyPct: b.bodyPct, volumeRatio: b.volumeRatio, closePos: b.closePos, breakoutPct: b.breakoutPct,
          regime: rg.details,
        },
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
      + `fechar em padrão de baixa, ${CONFIG.entry
        ? `arma a entrada ${CONFIG.entry.discountPct}% abaixo do fechamento (espera até ${CONFIG.entry.waitHours}h)`
        : 'compra a mercado'} · alvo +${CONFIG.exit.targetPct}% / stop −${CONFIG.exit.minStopPct}%`
      + `${rg.details.gainerRank ? ` · #${rg.details.gainerRank} em alta 24h` : ''} · filtros: ${regimeLabel(CONFIG.regime)}${favTxt}`;
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
  loadPriceActionConfig(sbReq, process.env.SUPABASE_DEFAULT_USER_ID).then((pa) => {
    const c = buildConfig(pa);
    log(`🚀 [Explosão auto] ${c.enabled ? 'ligada' : 'DESLIGADA no painel (Configurações → Price action)'} — scanner ${c.interval} a cada ${SCAN_EVERY_MS / 60_000} min, `
      + `${c.usdt} USDT/ordem, máx. ${c.maxActive} ordens, alvo +${c.exit.targetPct}% / stop −${c.exit.minStopPct}% · filtros: ${regimeLabel(c.regime)}`);
  });
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

module.exports = { startBullishBreakoutAuto, exitLevels, buildConfig, regimeLabel, CONFIG, SOURCE };
