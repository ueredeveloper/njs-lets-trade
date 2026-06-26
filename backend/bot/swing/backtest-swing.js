'use strict';

/**
 * Backtest Swing — RSI 1h + MA50 8h
 *
 * Uso:
 *   node backend/bot/swing/backtest-swing.js INJUSDT
 *   node backend/bot/swing/backtest-swing.js INJUSDT binance 40 365
 *   node backend/bot/swing/backtest-swing.js INJUSDT binance 40 365 swing-rsi-1h
 */

const path = require('path');
const ti   = require('technicalindicators');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { buildTradeConfig, getStrategyPresetBody, STRATEGY_IDS } = require('./strategyPresets');
const { getRequiredSpecs, evaluateEntry, evaluateExit, INTERVAL_MS } = require('./strategyEngine');
const { toAmapSuggestConfig } = require('./tradeConfigSchema');
const { buildEntryRsiReport } = require('../amap/suggestEntryRsi');
const { buildExitRsiReport } = require('../amap/suggestExitRsi');

const SYMBOL   = (process.argv[2] || 'INJUSDT').toUpperCase();
const EXCHANGE = (process.argv[3] || 'binance').toLowerCase();
const CAPITAL  = parseFloat(process.argv[4] || '40');
const DAYS     = parseInt(process.argv[5] || '365', 10);
const ONLY     = process.argv[6] || null; // strategy_id filter

const FEE_RATE = 0.002;

const BINANCE_BASE = 'https://api.binance.com';
const GATE_BASE    = 'https://api.gateio.ws/api/v4';

const INTERVAL_HOURS = {
  '1h': 1, '2h': 2, '4h': 4, '8h': 8, '1d': 24,
};

function fmtTime(ts) {
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtPnl(p) {
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(2)}%`;
}

async function fetchBatch(interval, endTimeMs) {
  if (EXCHANGE === 'gate') {
    const pair    = toGateSymbol(SYMBOL);
    const toSec   = Math.floor(endTimeMs / 1000);
    const hrs     = INTERVAL_HOURS[interval] ?? 1;
    const fromSec = toSec - 1000 * hrs * 3600;
    const url     = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=1000&from=${fromSec}&to=${toSec}`;
    const raw     = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Gate: ${JSON.stringify(raw)}`);
    return raw.map(c => ({
      openTime: Number(c[0]) * 1000,
      open: parseFloat(c[5]), high: parseFloat(c[3]),
      low: parseFloat(c[4]), close: parseFloat(c[2]),
    }));
  }
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=1000&endTime=${endTimeMs}`;
  const raw = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) throw new Error(`Binance: ${JSON.stringify(raw)}`);
  return raw.map(c => ({
    openTime: Number(c[0]),
    open: parseFloat(c[1]), high: parseFloat(c[2]),
    low: parseFloat(c[3]), close: parseFloat(c[4]),
  }));
}

async function fetchHistory(interval, minCandles) {
  const hrs = INTERVAL_HOURS[interval] ?? 1;
  const needed = minCandles || Math.ceil((DAYS * 24) / hrs) + 100;
  let all = [];
  let endTime = Date.now();

  process.stdout.write(`   ${interval}: `);
  while (all.length < needed) {
    const batch = await fetchBatch(interval, endTime);
    if (!batch.length) break;
    all = [...batch, ...all];
    endTime = batch[0].openTime - 1;
    process.stdout.write('.');
    if (batch.length < 1000) break;
    await new Promise(r => setTimeout(r, 120));
  }
  process.stdout.write(` ${all.length} candles\n`);

  const seen = new Set();
  return all
    .filter(c => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; })
    .sort((a, b) => a.openTime - b.openTime);
}

function sliceCMap(fullMap, openTime) {
  const out = {};
  for (const [iv, candles] of Object.entries(fullMap)) {
    out[iv] = candles.filter(c => c.openTime <= openTime);
  }
  return out;
}

function scanInterval(config) {
  return config.kind === 'ma' ? config.entryMa.interval : config.entryRsi.interval;
}

function simulate(config, fullMap) {
  const scanIv = scanInterval(config);
  const scanCandles = fullMap[scanIv] ?? [];
  const warmup = config.kind === 'ma'
    ? config.entryMa.period + config.entryMa.aboveMaCandles + 20
    : config.entryRsi.period + 20;

  const startMs = Date.now() - DAYS * 86_400_000;
  let capital = CAPITAL;
  let phase = 'WATCHING';
  let position = null;
  const trades = [];
  const blocked = { MA_FILTER: 0, RSI_ENTRY: 0, other: 0 };

  for (let i = warmup; i < scanCandles.length; i++) {
    const c = scanCandles[i];
    if (c.openTime < startMs) continue;

    const cMap = sliceCMap(fullMap, c.openTime);

    if (phase === 'WATCHING') {
      const entry = evaluateEntry(config, cMap);
      if (!entry.allowed) {
        if (entry.reason === 'MA_FILTER') blocked.MA_FILTER++;
        else if (entry.reason === 'RSI_ENTRY') blocked.RSI_ENTRY++;
        else if (entry.reason && entry.reason !== 'INSUFFICIENT_DATA') blocked.other++;
        continue;
      }

      const entryPrice = entry.close * (1 + FEE_RATE);
      const qty = capital / entryPrice;
      position = {
        entryTime: c.openTime,
        entryPrice,
        qty,
        usdtIn: capital,
        entryRsi: entry.entryRsi,
      };
      phase = 'BOUGHT';
    } else if (phase === 'BOUGHT' && position) {
      const exit = evaluateExit(config, cMap, position.entryPrice);
      const stopHit = exit.reason === 'STOP_LOSS' ||
        (config.stopLoss?.enabled && c.low <= position.entryPrice * (1 - config.stopLoss.maxLossPct / 100));

      if (stopHit) {
        const exitPrice = position.entryPrice * (1 - config.stopLoss.maxLossPct / 100);
        const usdtOut = exitPrice * position.qty * (1 - FEE_RATE);
        const pnlPct = (usdtOut - position.usdtIn) / position.usdtIn * 100;
        capital = usdtOut;
        trades.push({
          entryTime: position.entryTime, exitTime: c.openTime,
          entryPrice: position.entryPrice, exitPrice,
          pnlPct, reason: 'stop-loss', entryRsi: position.entryRsi, exitRsi: exit.exitRsi,
        });
        position = null;
        phase = 'WATCHING';
      } else if (exit.exit) {
        const exitPrice = exit.close * (1 - FEE_RATE);
        const usdtOut = exitPrice * position.qty;
        const pnlPct = (usdtOut - position.usdtIn) / position.usdtIn * 100;
        capital = usdtOut;
        trades.push({
          entryTime: position.entryTime, exitTime: c.openTime,
          entryPrice: position.entryPrice, exitPrice: exit.close,
          pnlPct, reason: exit.reason, entryRsi: position.entryRsi, exitRsi: exit.exitRsi,
        });
        position = null;
        phase = 'WATCHING';
      }
    }
  }

  if (position) {
    const last = scanCandles[scanCandles.length - 1];
    const exitPrice = last.close * (1 - FEE_RATE);
    const usdtOut = exitPrice * position.qty;
    const pnlPct = (usdtOut - position.usdtIn) / position.usdtIn * 100;
    trades.push({
      entryTime: position.entryTime, exitTime: last.openTime,
      entryPrice: position.entryPrice, exitPrice: last.close,
      pnlPct, reason: 'open', entryRsi: position.entryRsi, exitRsi: null,
    });
    capital = usdtOut;
  }

  const wins = trades.filter(t => t.pnlPct > 0 && t.reason !== 'open');
  const totalPnl = ((capital - CAPITAL) / CAPITAL * 100);

  return { trades, capital, totalPnl, wins: wins.length, blocked };
}

function printReport(strategyId, config, result) {
  const { trades, capital, totalPnl, wins, blocked } = result;
  const closed = trades.filter(t => t.reason !== 'open');

  console.log(`\n${'─'.repeat(68)}`);
  console.log(`📊 ${config.label} [${strategyId}]`);
  console.log(`   Entrada: ${config.kind === 'rsi'
    ? `RSI(${config.entryRsi.interval})${config.entryRsi.operator}${config.entryRsi.value}` +
      (config.entryMaFilter.enabled ? ` + preço>MA${config.entryMaFilter.period}(${config.entryMaFilter.interval})` : '')
    : `MA${config.entryMa.period}(${config.entryMa.interval}) ${config.entryMa.trigger}`}`);
  console.log(`   Saída  : RSI(${config.exitRsi.interval})${config.exitRsi.operator}${config.exitRsi.value}` +
    ` | stop ${config.stopLoss.maxLossPct}%`);
  console.log(`   Período: ${DAYS} dias | Capital: $${CAPITAL} → $${capital.toFixed(2)} (${fmtPnl(totalPnl)})`);
  console.log(`   Trades : ${closed.length} fechados | ${wins} wins | win rate ${closed.length ? (wins / closed.length * 100).toFixed(0) : 0}%`);
  if (config.kind === 'rsi') {
    console.log(`   Bloqueios MA: ${blocked.MA_FILTER} | RSI sem sinal: ${blocked.RSI_ENTRY}`);
  }

  if (!trades.length) {
    console.log('   (nenhum trade no período)');
    return;
  }

  console.log('\n   Data entrada          → Data saída            PnL      Motivo');
  for (const t of trades) {
    const dur = Math.round((t.exitTime - t.entryTime) / 3_600_000);
    console.log(
      `   ${fmtTime(t.entryTime)} → ${fmtTime(t.exitTime)}  ${fmtPnl(t.pnlPct).padStart(8)}  ${t.reason}` +
      `  (${dur}h)`,
    );
  }
}

function printSuggest(config, cMap) {
  const suggestCfg = toAmapSuggestConfig(config);
  try {
    const entry = buildEntryRsiReport(cMap, suggestCfg);
    console.log(`\n   💡 Sugestão entrada RSI: ${entry.suggestedEntryRsi} (âncora ${entry.anchorValue}, ${entry.recommendation})`);
    if (entry.bestStats) {
      console.log(`      Melhor sweep: ${entry.bestStats.tradeCount} trades, PnL médio ${entry.bestStats.avgPnl?.toFixed(2)}%`);
    }
  } catch (e) {
    console.log(`   ⚠️  Sugestão entrada: ${e.message}`);
  }
  try {
    const exit = buildExitRsiReport(cMap, suggestCfg, { entryPath: config.kind === 'ma' ? 'ma' : 'rsi' });
    const val = exit.suggestedExitRsi ?? exit.exitRsiValue;
    console.log(`   💡 Sugestão saída RSI: ${val} (mediana pico ${exit.medianPeakRsi ?? '—'})`);
  } catch (e) {
    console.log(`   ⚠️  Sugestão saída: ${e.message}`);
  }
}

async function main() {
  console.log(`\n🔬 Backtest Swing — ${SYMBOL} [${EXCHANGE}] | ${DAYS} dias | $${CAPITAL}/trade\n`);

  const strategies = (ONLY ? [ONLY] : STRATEGY_IDS).filter(id => STRATEGY_IDS.includes(id));
  if (!strategies.length) {
    console.error(`strategy_id inválido: ${ONLY}`);
    process.exit(1);
  }

  const configs = strategies.map(id => ({ id, config: buildTradeConfig(getStrategyPresetBody(id)) }));

  const intervals = new Set();
  for (const { config } of configs) {
    for (const { interval, limit } of getRequiredSpecs(config)) {
      intervals.add(interval);
    }
  }

  console.log('⏳ Buscando candles…');
  const fullMap = {};
  const minByIv = {};
  for (const { config } of configs) {
    for (const { interval, limit } of getRequiredSpecs(config)) {
      minByIv[interval] = Math.max(minByIv[interval] ?? 0, limit + Math.ceil((DAYS * 24) / (INTERVAL_HOURS[interval] ?? 1)));
    }
  }
  for (const iv of intervals) {
    fullMap[iv] = await fetchHistory(iv, minByIv[iv]);
  }

  const periodFrom = Math.min(...Object.values(fullMap).map(a => a[0]?.openTime).filter(Boolean));
  const periodTo   = Math.max(...Object.values(fullMap).map(a => a[a.length - 1]?.openTime).filter(Boolean));
  console.log(`\n   Análise: ${fmtTime(periodFrom)} → ${fmtTime(periodTo)}`);

  for (const { id, config } of configs) {
    const result = simulate(config, fullMap);
    printReport(id, config, result);
    printSuggest(config, fullMap);
  }

  console.log(`\n${'─'.repeat(68)}\n`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
