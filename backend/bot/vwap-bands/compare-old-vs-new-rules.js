'use strict';

/**
 * Compara, sobre o histórico real das moedas favoritas do vwap-bands, o resultado das
 * regras ANTIGAS (emaFilter só na banda -2%, checado no retorno/pullback; waitCandles=10)
 * contra as regras NOVAS (emaFilter com banda + inclinação, checado no candle do SINAL;
 * waitCandles=5 — ver strategyEngine.js e tradeConfigSchema.js).
 *
 * Roda DUAS simulações independentes (WATCHING/PENDING/BOUGHT) por símbolo sobre os MESMOS
 * candles — uma com o motor antigo (_old-strategyEngine.tmp.js, extraído de HEAD via git
 * show antes das mudanças desta sessão), outra com o motor atual (strategyEngine.js) — e
 * agrega os trades fechados de cada lado. Como o filtro novo pode bloquear/liberar sinais
 * diferentes do antigo, as duas simulações podem gerar trades diferentes (não é só "o mesmo
 * trade marcado como bloqueado"), por isso rodam separadas.
 *
 * Uso:
 *   node backend/bot/vwap-bands/compare-old-vs-new-rules.js
 *   node backend/bot/vwap-bands/compare-old-vs-new-rules.js --days 60
 *   node backend/bot/vwap-bands/compare-old-vs-new-rules.js --symbol PYRUSDT --days 45
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { sbReq } = require('../shared/supabaseRest');
const { normalizeVwapBandsConfig, toEngineConfig } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isVwapBandsStrategy } = require('./strategyPresets');

const oldEngine = require('./_old-strategyEngine.tmp.js');
const newEngine = require('./strategyEngine');

const PRICE_IV = '1h';
const VWAP_IV = '4h';
const PRICE_VWAP_BUFFER_DAYS = 21;

const INTERVAL_SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400 };

function argNum(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? Number(v) : def;
}
function argStr(flag) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? v.toUpperCase() : null;
}

const TEST_DAYS = argNum('--days', 30);
const SYMBOL_FILTER = argStr('--symbol');

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

async function loadFavorites() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?or=(${ids})&select=symbol,exchange,strategy_id&order=symbol.asc`);
  return (rows ?? []).filter(r => isVwapBandsStrategy(r.strategy_id));
}

/** Roda a simulação WATCHING/PENDING/BOUGHT com um motor (old ou new) + config dados,
 *  sobre os candles já buscados (compartilhados entre as duas simulações). */
function runSim(engine, config, { rawPrice, rawVwap, rawPoll, pollStartIdx }, symbol) {
  const { evaluateEntrySignal, evaluatePullbackReady, evaluateExit } = engine;
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
      '15m': rawPoll.slice(0, j + 1),
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
          touchLevel: pending.touchLevel, targetLevel: pending.targetLevel,
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
          symbol, buyTime: position.buyTime, buyPrice: position.buyPrice,
          sellTime, sellPrice: exitResult.close, pnlPct, reason: exitResult.reason,
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
  const bufferStart = testStartTime - PRICE_VWAP_BUFFER_DAYS * 86_400_000;

  const [rawPrice, rawVwap, rawPoll] = await Promise.all([
    fetcher(symbol, PRICE_IV, bufferStart, testEndTime),
    fetcher(symbol, VWAP_IV, bufferStart, testEndTime),
    fetcher(symbol, '15m', bufferStart, testEndTime),
  ]);

  if (!rawPrice.length || !rawVwap.length || !rawPoll.length) {
    return { symbol, error: 'sem candles suficientes' };
  }

  const pollStartIdx = Math.max(0, rawPoll.findIndex(c => Number(c.openTime) >= Number(testStartTime)));
  const shared = { rawPrice, rawVwap, rawPoll, pollStartIdx };

  const oldConfig = toEngineConfig(normalizeVwapBandsConfig({ entry: { pullback: { waitCandles: 10 } } }));
  const newConfig = toEngineConfig(normalizeVwapBandsConfig({}));

  const oldResult = runSim(oldEngine, oldConfig, shared, symbol);
  const newResult = runSim(newEngine, newConfig, shared, symbol);

  return { symbol, oldResult, newResult };
}

function summarize(trades) {
  const sum = trades.reduce((s, t) => s + t.pnlPct, 0);
  const wins = trades.filter(t => t.pnlPct > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : null;
  return { count: trades.length, wins, losses: trades.length - wins, sum, winRate };
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  let favorites = await loadFavorites();
  if (SYMBOL_FILTER) favorites = favorites.filter(r => r.symbol.toUpperCase() === SYMBOL_FILTER);

  console.log(`\n═══ vwap-bands — regras ANTIGAS vs NOVAS — ${favorites.length} moeda(s) favorita(s), janela ${TEST_DAYS} dias ═══`);
  console.log('ANTIGAS: emaFilter (banda -2%, sem inclinação) checado no RETORNO — waitCandles=10.');
  console.log('NOVAS:   emaFilter (banda -2% + inclinação EMA200(15m) >= 0% em 20 candles) checado no SINAL — waitCandles=5.\n');

  const oldTrades = [];
  const newTrades = [];
  const errors = [];
  const perSymbol = [];

  for (const row of favorites) {
    process.stderr.write(`  ${row.symbol} (${row.exchange})...`);
    try {
      const r = await backtestSymbol(row);
      if (r.error) {
        errors.push(r);
        process.stderr.write(` skip (${r.error})\n`);
        continue;
      }
      oldTrades.push(...r.oldResult.trades);
      newTrades.push(...r.newResult.trades);
      perSymbol.push({ symbol: r.symbol, old: summarize(r.oldResult.trades), new: summarize(r.newResult.trades) });
      process.stderr.write(` ok (antigas: ${r.oldResult.trades.length}, novas: ${r.newResult.trades.length})\n`);
    } catch (err) {
      errors.push({ symbol: row.symbol, error: err.message });
      process.stderr.write(` erro: ${err.message}\n`);
    }
  }

  const oldSum = summarize(oldTrades);
  const newSum = summarize(newTrades);

  console.log('\n── Resumo geral ──');
  console.log(`Símbolos analisados: ${favorites.length - errors.length} / ${favorites.length} (${errors.length} sem dados)\n`);

  console.log('Regra      | Trades | Vencedores | Perdedores | Taxa de acerto | PnL total (soma simples)');
  console.log('-----------|--------|------------|------------|----------------|--------------------------');
  console.log(
    `Antigas    | ${String(oldSum.count).padStart(6)} | ${String(oldSum.wins).padStart(10)} | ${String(oldSum.losses).padStart(10)} | `
    + `${(oldSum.winRate?.toFixed(0) ?? '—').padStart(13)}% | ${fmtPct(oldSum.sum)}`,
  );
  console.log(
    `Novas      | ${String(newSum.count).padStart(6)} | ${String(newSum.wins).padStart(10)} | ${String(newSum.losses).padStart(10)} | `
    + `${(newSum.winRate?.toFixed(0) ?? '—').padStart(13)}% | ${fmtPct(newSum.sum)}`,
  );
  console.log(`\nΔ PnL total (novas - antigas): ${fmtPct(newSum.sum - oldSum.sum)}`);
  console.log(`Δ trades (novas - antigas): ${newSum.count - oldSum.count}`);

  if (perSymbol.length) {
    console.log('\n── Por símbolo ──');
    console.log('Símbolo     | Antigas (trades/acerto/PnL)      | Novas (trades/acerto/PnL)');
    console.log('------------|-----------------------------------|-----------------------------------');
    for (const s of perSymbol.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      const o = s.old; const n = s.new;
      console.log(
        `${s.symbol.padEnd(11)} | ${String(o.count).padStart(2)} / ${(o.winRate?.toFixed(0) ?? '—').padStart(3)}% / ${fmtPct(o.sum).padStart(8)}          | `
        + `${String(n.count).padStart(2)} / ${(n.winRate?.toFixed(0) ?? '—').padStart(3)}% / ${fmtPct(n.sum).padStart(8)}`,
      );
    }
  }

  if (errors.length) {
    console.log('\n── Erros / sem dados ──');
    for (const e of errors) console.log(`  ${e.symbol}: ${e.error}`);
  }
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
