'use strict';
/**
 * Compara o vwap-bands COM só o emaFilter (produção atual) vs. COM emaFilter + o novo
 * vwapSlopeFilter (backend/bot/vwap-bands/strategyEngine.js) — pedido depois de ver ALLO/PYR
 * armando sinal com a própria VWAP em queda acentuada (o emaFilter mede a EMA de PREÇO, não
 * a VWAP em si, então nem sempre pega esse caso).
 *
 * Ao contrário de analyze-ema200-15m-filter.js (que roda UMA simulação baseline e só marca
 * cada trade como "passaria/não passaria" no filtro por fora), o vwapSlopeFilter já está
 * integrado dentro de evaluateEntrySignal — bloquear um degrau muda o fluxo de estado
 * (WATCHING/PENDING/BOUGHT) e pode fazer o bot pegar um degrau diferente depois. Por isso
 * este script roda DUAS simulações completas e independentes por símbolo (config A = só
 * emaFilter, config B = emaFilter + vwapSlopeFilter) e compara os trades fechados de cada uma.
 *
 * Universo padrão: favoritas "MC" (multitrade_favorites, strategy_id='ma-cross') — conjunto
 * menor (10 símbolos) usado pelo painel Multi-Trade, subconjunto das favoritas vwap-bands.
 * --coins vwap-bands usa as favoritas vwap-bands (rsi_multi_bot_state) inteiras.
 *
 * Uso:
 *   node backend/bot/vwap-bands/analyze-vwap-slope-filter.js
 *   node backend/bot/vwap-bands/analyze-vwap-slope-filter.js --days 60
 *   node backend/bot/vwap-bands/analyze-vwap-slope-filter.js --lookback 6 --min-slope-pct -3
 *   node backend/bot/vwap-bands/analyze-vwap-slope-filter.js --coins vwap-bands
 *   node backend/bot/vwap-bands/analyze-vwap-slope-filter.js --symbol PYRUSDT --days 60
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { sbReq } = require('../shared/supabaseRest');
const { normalizeVwapBandsConfig, toEngineConfig } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isVwapBandsStrategy } = require('./strategyPresets');
const {
  evaluateEntrySignal, evaluatePullbackReady, evaluateExit,
} = require('./strategyEngine');

const PRICE_IV = '1h';
const VWAP_IV = '4h';
const PRICE_VWAP_BUFFER_DAYS = 21; // contexto (sessão VWAP semanal) antes da janela testada

const INTERVAL_SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400 };

function argNum(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? Number(v) : def;
}
function argStr(flag) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? v.toUpperCase() : null;
}
function argLower(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? v.toLowerCase() : def;
}

const TEST_DAYS = argNum('--days', 30);
const SYMBOL_FILTER = argStr('--symbol');
const COINS_UNIVERSE = argLower('--coins', 'mc'); // 'mc' (ma-cross favorites) | 'vwap-bands'
const VF_LOOKBACK = argNum('--lookback', 6);
const VF_MIN_SLOPE_PCT = argNum('--min-slope-pct', -3);

function fmtBRT(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

async function fetchBinanceRange(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      const t = Number(c[0]);
      if (t > endMs) break;
      out.push({ openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] });
    }
    const last = raw[raw.length - 1][0];
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

async function fetchGateRange(symbol, interval, startMs, endMs) {
  const pair = toGateSymbol(symbol);
  const stepSec = INTERVAL_SEC[interval] ?? 3600;
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const from = Math.floor(cursor / 1000);
    const to = Math.min(Math.floor(endMs / 1000), from + 1000 * stepSec);
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      out.push({
        openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2], volume: +c[1],
      });
    }
    const last = Number(raw[raw.length - 1][0]) * 1000;
    if (last <= cursor) break;
    cursor = last + stepSec * 1000;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

function fetcherFor(exchange) {
  return exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
}

async function loadMcFavorites() {
  const rows = await sbReq('GET', 'multitrade_favorites', null, '?select=symbol,exchange&strategy_id=eq.ma-cross&order=symbol.asc');
  return (rows ?? []).map(r => ({ symbol: r.symbol, exchange: r.exchange ?? 'binance' }));
}

async function loadVwapBandsFavorites() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?or=(${ids})&select=symbol,exchange,strategy_id&order=symbol.asc`);
  return (rows ?? []).filter(r => isVwapBandsStrategy(r.strategy_id)).map(r => ({ symbol: r.symbol, exchange: r.exchange }));
}

/** Simula WATCHING/PENDING/BOUGHT (mesmo motor do bot real) sobre o histórico já carregado,
 *  com o `config` dado — devolve os trades fechados. */
function simulate(config, rawPrice, rawVwap, rawPoll, pollStartIdx) {
  const pollIv = config.entry.pullback.pollInterval;
  let phase = 'WATCHING';
  let pending = null;
  let position = null;
  const trades = [];

  for (let j = pollStartIdx; j < rawPoll.length; j++) {
    const now = rawPoll[j].openTime;
    const priceUpTo = rawPrice.filter(c => Number(c.openTime) <= Number(now));
    if (!priceUpTo.length) continue;

    const cMap = {
      [PRICE_IV]: priceUpTo,
      [VWAP_IV]: rawVwap.filter(c => Number(c.openTime) <= Number(now)),
      [pollIv]: rawPoll.slice(0, j + 1),
    };

    if (phase === 'WATCHING') {
      const signal = evaluateEntrySignal(config, cMap);
      if (signal.allowed) {
        pending = {
          setupId: signal.setupId, touchLevel: signal.touchLevel, confirmLevel: signal.confirmLevel,
          targetLevel: signal.targetLevel, signalOpenTime: signal.confirmOpenTime, signalClose: signal.close,
        };
        phase = 'PENDING';
      }
    } else if (phase === 'PENDING') {
      const freshSignal = evaluateEntrySignal(config, cMap);
      if (freshSignal.allowed && Number(freshSignal.confirmOpenTime) > Number(pending.signalOpenTime)) {
        pending = {
          setupId: freshSignal.setupId, touchLevel: freshSignal.touchLevel, confirmLevel: freshSignal.confirmLevel,
          targetLevel: freshSignal.targetLevel, signalOpenTime: freshSignal.confirmOpenTime, signalClose: freshSignal.close,
        };
      }

      const ready = evaluatePullbackReady(config, cMap, pending);
      if (ready.cancel) {
        phase = 'WATCHING';
        pending = null;
      } else if (ready.ready) {
        const decisionTime = ready.decisionTime ?? now;
        position = {
          buyPrice: ready.close, buyTime: decisionTime,
          setupId: pending.setupId, touchLevel: pending.touchLevel, targetLevel: pending.targetLevel,
        };
        phase = 'BOUGHT';
        pending = null;
      }
    } else if (phase === 'BOUGHT') {
      const exitResult = evaluateExit(config, cMap, position.buyPrice, {
        peakPrice: position.buyPrice, targetLevel: position.targetLevel, touchLevel: position.touchLevel,
      });
      if (exitResult.exit) {
        const sellTime = exitResult.decisionTime ?? now;
        const pnlPct = ((exitResult.close - position.buyPrice) / position.buyPrice) * 100;
        trades.push({
          setupId: position.setupId,
          buyTime: position.buyTime, buyPrice: position.buyPrice,
          sellTime, sellPrice: exitResult.close,
          pnlPct, reason: exitResult.reason,
        });
        phase = 'WATCHING';
        position = null;
      }
    }
  }

  return { trades, openPosition: phase === 'BOUGHT' ? position : null };
}

async function backtestSymbol(row) {
  const symbol = row.symbol.toUpperCase();
  const fetcher = fetcherFor(row.exchange);

  const testEndTime = Date.now();
  const testStartTime = testEndTime - TEST_DAYS * 86_400_000;
  const fetchFrom = testStartTime - PRICE_VWAP_BUFFER_DAYS * 86_400_000;

  const [rawPrice, rawVwap] = await Promise.all([
    fetcher(symbol, PRICE_IV, fetchFrom, testEndTime),
    fetcher(symbol, VWAP_IV, fetchFrom, testEndTime),
  ]);

  const configA = toEngineConfig(normalizeVwapBandsConfig({}));
  const pollIv = configA.entry.pullback.pollInterval;
  const rawPoll = pollIv === PRICE_IV ? rawPrice : await fetcher(symbol, pollIv, fetchFrom, testEndTime);

  if (!rawPrice.length || !rawVwap.length || !rawPoll.length) {
    return { symbol, error: 'sem candles suficientes' };
  }

  const configB = toEngineConfig(normalizeVwapBandsConfig({
    entry: { vwapSlopeFilter: { enabled: true, lookback: VF_LOOKBACK, minSlopePct: VF_MIN_SLOPE_PCT } },
  }));

  const pollStartIdx = Math.max(0, rawPoll.findIndex(c => Number(c.openTime) >= Number(testStartTime)));

  const simA = simulate(configA, rawPrice, rawVwap, rawPoll, pollStartIdx);
  const simB = simulate(configB, rawPrice, rawVwap, rawPoll, pollStartIdx);

  return {
    symbol,
    tradesA: simA.trades.map(t => ({ ...t, symbol })),
    tradesB: simB.trades.map(t => ({ ...t, symbol })),
  };
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  let favorites = COINS_UNIVERSE === 'vwap-bands' ? await loadVwapBandsFavorites() : await loadMcFavorites();
  if (SYMBOL_FILTER) favorites = favorites.filter(r => r.symbol.toUpperCase() === SYMBOL_FILTER);

  console.log(`\n═══ vwap-bands — vwapSlopeFilter (lookback=${VF_LOOKBACK} candles ${VWAP_IV}, minSlopePct=${VF_MIN_SLOPE_PCT}%) ═══`);
  console.log(`Universo: ${COINS_UNIVERSE === 'vwap-bands' ? 'favoritas vwap-bands' : 'favoritas MC (ma-cross)'} — ${favorites.length} símbolo(s), janela ${TEST_DAYS} dias`);
  console.log('Config A: emaFilter (produção). Config B: emaFilter + vwapSlopeFilter.\n');

  const allA = [];
  const allB = [];
  const errors = [];

  for (const row of favorites) {
    process.stderr.write(`  ${row.symbol} (${row.exchange})...`);
    try {
      const r = await backtestSymbol(row);
      if (r.error) {
        errors.push(r);
        process.stderr.write(` skip (${r.error})\n`);
        continue;
      }
      allA.push(...r.tradesA);
      allB.push(...r.tradesB);
      process.stderr.write(` ok (A=${r.tradesA.length}, B=${r.tradesB.length})\n`);
    } catch (err) {
      errors.push({ symbol: row.symbol, error: err.message });
      process.stderr.write(` erro: ${err.message}\n`);
    }
  }

  const sum = (arr) => arr.reduce((s, t) => s + t.pnlPct, 0);
  const winRate = (arr) => (arr.length ? (arr.filter(t => t.pnlPct > 0).length / arr.length) * 100 : null);
  const key = (t) => `${t.symbol}|${t.buyTime}`;

  const keysA = new Set(allA.map(key));
  const keysB = new Set(allB.map(key));
  const blockedByVwapFilter = allA.filter(t => !keysB.has(key(t)));
  const newInB = allB.filter(t => !keysA.has(key(t)));
  const keptInBoth = allB.filter(t => keysA.has(key(t)));

  console.log('\n── Resumo geral ──');
  console.log(`Símbolos analisados: ${favorites.length - errors.length} / ${favorites.length} (${errors.length} sem dados)`);
  console.log(`\nConfig A (só emaFilter):        ${allA.length} trade(s), PnL total ${fmtPct(sum(allA))}, acerto ${winRate(allA)?.toFixed(0) ?? '—'}%`);
  console.log(`Config B (emaFilter + vwapSlope): ${allB.length} trade(s), PnL total ${fmtPct(sum(allB))}, acerto ${winRate(allB)?.toFixed(0) ?? '—'}%`);
  console.log(`Δ PnL total (B - A):             ${fmtPct(sum(allB) - sum(allA))}`);
  console.log(`\nTrades de A bloqueados pelo vwapSlopeFilter em B: ${blockedByVwapFilter.length} (PnL somado ${fmtPct(sum(blockedByVwapFilter))}, acerto ${winRate(blockedByVwapFilter)?.toFixed(0) ?? '—'}%)`);
  console.log(`Trades novos em B (degrau diferente após bloqueio): ${newInB.length} (PnL somado ${fmtPct(sum(newInB))}, acerto ${winRate(newInB)?.toFixed(0) ?? '—'}%)`);
  console.log(`Trades mantidos em ambos:                         ${keptInBoth.length}`);

  if (blockedByVwapFilter.length) {
    console.log('\n── Trades que o vwapSlopeFilter bloqueou (existiam em A, sumiram em B) ──');
    console.log('Símbolo     | Compra               | Preço      | Degrau                | Saída          | PnL');
    console.log('------------|----------------------|------------|------------------------|----------------|----------');
    for (const t of blockedByVwapFilter.sort((a, b) => a.buyTime - b.buyTime)) {
      console.log(
        `${t.symbol.padEnd(11)} | ${fmtBRT(t.buyTime).padEnd(20)} | ${t.buyPrice.toFixed(6).padStart(10)} | `
        + `${t.setupId.padEnd(22)} | ${t.reason.padEnd(14)} | ${fmtPct(t.pnlPct)}`,
      );
    }
  }

  if (newInB.length) {
    console.log('\n── Trades novos em B (não existiam em A) ──');
    console.log('Símbolo     | Compra               | Preço      | Degrau                | Saída          | PnL');
    console.log('------------|----------------------|------------|------------------------|----------------|----------');
    for (const t of newInB.sort((a, b) => a.buyTime - b.buyTime)) {
      console.log(
        `${t.symbol.padEnd(11)} | ${fmtBRT(t.buyTime).padEnd(20)} | ${t.buyPrice.toFixed(6).padStart(10)} | `
        + `${t.setupId.padEnd(22)} | ${t.reason.padEnd(14)} | ${fmtPct(t.pnlPct)}`,
      );
    }
  }

  if (errors.length) {
    console.log('\n── Erros / sem dados ──');
    for (const e of errors) console.log(`  ${e.symbol}: ${e.error}`);
  }
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
