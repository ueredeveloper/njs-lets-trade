'use strict';

/**
 * Screener automático de exaustão BB+VWAP (4h) → auto-adiciona ao ma-cross.
 *
 * A cada 4h (alinhado ao fechamento do candle 4h + folga), varre todos os pares
 * USDT ativos na Binance: Bollinger Bands (período 20, desvio 2) e VWAP diário
 * (banda 2) em 4h, marca "exaustão" quando o candle 4h fechado mais recente tem
 * %B <= PROXIMITY_PCT e %V <= PROXIMITY_PCT (preço nos dois casos perto do fundo
 * da banda). Filtra por volume 24h mínimo e lista negra (config em
 * ma_cross_screener_config, editável pelo painel), e adiciona as moedas
 * restantes em multitrade_favorites + rsi_multi_bot_state (strategy_id=ma-cross,
 * entrada EMA9↑EMA21 em 1h) — já armadas: o bot compra assim que o cruzamento
 * acontecer, sem revisão manual (ver conversa com o usuário em 2026-07-28).
 *
 * PROXIMITY_PCT=10 foi validado manualmente comparando a lista gerada com a
 * pesquisa visual do usuário antes de virar rotina automática.
 */

const { BollingerBands } = require('technicalindicators');
const { computeRollingVwapWithBands, DAY_MS } = require('../../utils/vwapSession');
const { getActiveUsdtPairs } = require('../../binance/getActiveUsdtPairs');
const getTickers = require('../../binance/cachedTicker24hr');
const { getStrategyPresetBody, buildTradeConfig: buildMaCrossTradeConfig } = require('./strategyPresets');

const BB_PERIOD = 20;
const BB_STDDEV = 2;
const VWAP_BAND = 2;
const PROXIMITY_PCT = 10;
const CONCURRENCY = 25;
const FOUR_HOURS_MS = 4 * 3_600_000;
const SCREENER_BUFFER_MS = 3 * 60_000; // folga após o fechamento do candle 4h

// enabled:false por padrão — só liga quando o usuário salvar a config pelo menos uma
// vez no painel (evita armar moedas sozinho com valores implícitos antes da migration
// supabase/add-macross-screener-config.sql rodar ou de qualquer revisão manual).
const DEFAULT_CONFIG = {
  enabled: false,
  minVolume24h: 5_000_000,
  blacklist: [],
  maxNewPerCycle: 5,
  capitalPerSymbol: 40,
};

async function fetchScreenerConfig(sbReq, userId) {
  let rows;
  try {
    rows = await sbReq('GET', 'ma_cross_screener_config', null, `?user_id=eq.${userId}&limit=1`);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  const row = rows?.[0];
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    enabled: row.enabled !== false,
    minVolume24h: Number(row.min_volume_24h) || DEFAULT_CONFIG.minVolume24h,
    blacklist: Array.isArray(row.blacklist) ? row.blacklist.map(s => String(s).toUpperCase()) : [],
    maxNewPerCycle: Number(row.max_new_per_cycle) || DEFAULT_CONFIG.maxNewPerCycle,
    capitalPerSymbol: Number(row.capital_per_symbol) || DEFAULT_CONFIG.capitalPerSymbol,
  };
}

async function fetchKlines4h(symbol, limit = 40) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=${limit}`;
  const raw = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    openTime: Number(c[0]), high: +c[2], low: +c[3], close: +c[4], volume: +c[5], closeTime: Number(c[6]),
  }));
}

function closedOnly(candles) {
  const now = Date.now();
  return candles.filter(c => c.closeTime <= now);
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) results.push(r.value); });
  }
  return results;
}

/** %B/%V do candle 4h fechado mais recente; null se a moeda não está em exaustão (near_bottom). */
async function checkExhaustion(symbol) {
  const raw = await fetchKlines4h(symbol);
  const candles = closedOnly(raw);
  if (candles.length < BB_PERIOD + 5) return null;

  const closes = candles.map(c => c.close);
  const bb = BollingerBands.calculate({ period: BB_PERIOD, values: closes, stdDev: BB_STDDEV });
  if (!bb.length) return null;
  const last = candles[candles.length - 1];
  const bLast = bb[bb.length - 1];
  const bWidth = bLast.upper - bLast.lower;
  if (!(bWidth > 0)) return null;
  const percentB = Math.min(100, Math.max(0, ((last.close - bLast.lower) / bWidth) * 100));
  if (percentB > PROXIMITY_PCT) return null;

  const vwap = computeRollingVwapWithBands(candles, { windowMs: DAY_MS, bandMultipliers: [VWAP_BAND] });
  if (!vwap.length) return null;
  const vLast = vwap[vwap.length - 1];
  const vWidth = vLast[`upper${VWAP_BAND}`] - vLast[`lower${VWAP_BAND}`];
  if (!(vWidth > 0)) return null;
  const percentV = Math.min(100, Math.max(0, ((last.close - vLast[`lower${VWAP_BAND}`]) / vWidth) * 100));
  if (percentV > PROXIMITY_PCT) return null;

  return { symbol, percentB: +percentB.toFixed(1), percentV: +percentV.toFixed(1), closeTime: last.closeTime };
}

function buildFavoriteRow(userId, symbol, capital, minVolumeUsdt) {
  const preset = getStrategyPresetBody('ma-cross');
  const body = {
    ...preset,
    entry: { ...preset.entry, ma1: { period: 9, interval: '1h' }, ma2: { period: 21, interval: '1h' } },
    volume: { minVolumeUsdt },
  };
  const trade_config = buildMaCrossTradeConfig(body);
  return {
    user_id: userId,
    symbol,
    exchange: 'binance',
    strategy_id: 'ma-cross',
    enabled: true,
    capital,
    entry_rsi: { interval: '1h', period: 14, operator: '<', value: 30 },
    exit_rsi: {
      interval: trade_config.exit.maCross.ma1.interval, period: 14, operator: '>', value: 70,
    },
    ma_conditions: [],
    rule_3_candles: false,
    rule_4_candles: false,
    trade_config,
  };
}

async function symbolAlreadyFavorited(sbReq, userId, symbol) {
  const rows = await sbReq(
    'GET', 'multitrade_favorites', null,
    `?user_id=eq.${userId}&symbol=eq.${symbol}&strategy_id=eq.ma-cross&limit=1`,
  );
  return !!rows?.length;
}

async function addFavoriteAndSync(sbReq, row) {
  const inserted = await sbReq('POST', 'multitrade_favorites', row);
  const fav = inserted?.[0];
  if (!fav) return null;

  const existingState = await sbReq(
    'GET', 'rsi_multi_bot_state', null,
    `?symbol=eq.${fav.symbol}&strategy_id=eq.ma-cross&limit=1`,
  );
  if (!existingState?.length) {
    await sbReq('POST', 'rsi_multi_bot_state', {
      symbol: fav.symbol, exchange: fav.exchange, strategy_id: 'ma-cross',
      initial_capital: fav.capital, capital: fav.capital, trade_config: fav.trade_config,
      phase: 'WATCHING',
    });
  }
  return fav;
}

async function runScreenerCycle({ sbReq, log = console.log }) {
  const userId = process.env.SUPABASE_DEFAULT_USER_ID;
  if (!userId) {
    log('⚠️  [screener] SUPABASE_DEFAULT_USER_ID ausente no .env — screener desativado');
    return;
  }

  const cfg = await fetchScreenerConfig(sbReq, userId);
  if (!cfg.enabled) {
    log('⏸️  [screener] desativado nas configurações — pulando ciclo');
    return;
  }

  const { list: allSymbols } = await getActiveUsdtPairs();
  const blacklistSet = new Set(cfg.blacklist);
  const notBlacklisted = allSymbols.filter(s => !blacklistSet.has(s));

  let tickers;
  try {
    tickers = await getTickers();
  } catch (err) {
    log(`⚠️  [screener] falha ao buscar volumes 24h: ${err.message}`);
    return;
  }
  const volBySymbol = new Map(tickers.map(t => [t.symbol, Number(t.quoteVolume)]));
  const candidates = notBlacklisted.filter(s => (volBySymbol.get(s) ?? 0) >= cfg.minVolume24h);

  log(
    `🔎 [screener] varrendo ${candidates.length}/${allSymbols.length} pares `
    + `(volume≥${cfg.minVolume24h.toLocaleString('pt-BR')} USDT, ${blacklistSet.size} na lista negra)`,
  );

  const hits = await runWithConcurrency(candidates, s => checkExhaustion(s).catch(() => null), CONCURRENCY);
  if (!hits.length) {
    log('🔎 [screener] nenhuma moeda em exaustão BB+VWAP (4h) neste ciclo');
    return;
  }
  hits.sort((a, b) => (a.percentB + a.percentV) - (b.percentB + b.percentV));

  let added = 0;
  for (const hit of hits) {
    if (added >= cfg.maxNewPerCycle) {
      log(
        `🔎 [screener] limite de ${cfg.maxNewPerCycle} nova(s) moeda(s)/ciclo atingido `
        + `— ${hits.length - added} candidata(s) ficam para o próximo ciclo`,
      );
      break;
    }
    try {
      if (await symbolAlreadyFavorited(sbReq, userId, hit.symbol)) continue;
      const row = buildFavoriteRow(userId, hit.symbol, cfg.capitalPerSymbol, cfg.minVolume24h);
      await addFavoriteAndSync(sbReq, row);
      added++;
      log(
        `➕ [screener] ${hit.symbol} adicionado ao ma-cross `
        + `(BB %B=${hit.percentB} VWAP %V=${hit.percentV}, capital ${cfg.capitalPerSymbol} USDT) `
        + `— aguardando EMA9↑EMA21(1h)`,
      );
    } catch (err) {
      log(`❌ [screener] falha ao adicionar ${hit.symbol}: ${err.message}`);
    }
  }
  if (!added) log('🔎 [screener] nenhuma moeda nova (todas já favoritadas ou fora do limite do ciclo)');
}

function msUntilNext4hBoundary(bufferMs = SCREENER_BUFFER_MS) {
  const now = Date.now();
  const next = Math.ceil(now / FOUR_HOURS_MS) * FOUR_HOURS_MS + bufferMs;
  return next - now;
}

function startExhaustionScreener({ sbReq, log = console.log }) {
  const run = () => runScreenerCycle({ sbReq, log }).catch(err => log(`⚠️  [screener] ${err.message}`));
  const delay = msUntilNext4hBoundary();
  log(`🔎 Screener BB+VWAP (4h): próxima varredura em ${Math.round(delay / 60_000)}min, depois a cada 4h`);
  setTimeout(() => {
    run();
    setInterval(run, FOUR_HOURS_MS);
  }, delay);
}

module.exports = {
  PROXIMITY_PCT,
  fetchScreenerConfig,
  checkExhaustion,
  runScreenerCycle,
  startExhaustionScreener,
  msUntilNext4hBoundary,
};
