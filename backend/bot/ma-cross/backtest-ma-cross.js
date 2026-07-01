'use strict';

/**
 * Backtest MA Cross
 *
 * Uso:
 *   node backend/bot/ma-cross/backtest-ma-cross.js SYNUSDT binance 40 2
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { normalizeMaCrossConfig, toEngineConfig } = require('./tradeConfigSchema');
const {
  getRequiredSpecs, evaluateEntry, evaluateExit, computeAdaptiveDips, INTERVAL_MS,
} = require('./strategyEngine');

const SYMBOL   = (process.argv[2] || 'SYNUSDT').toUpperCase();
const EXCHANGE = (process.argv[3] || 'binance').toLowerCase();
const CAPITAL  = parseFloat(process.argv[4] || '40');
const DAYS     = parseInt(process.argv[5] || '2', 10);

const FEE_RATE = 0.002;
const BINANCE_BASE = 'https://api.binance.com';
const GATE_BASE    = 'https://api.gateio.ws/api/v4';

const CONFIG = toEngineConfig(normalizeMaCrossConfig({
  label: 'MA9/21 15m + MA50 1h',
  entry: {
    ma1: { period: 9, interval: '15m' },
    ma2: { period: 21, interval: '15m' },
    direction: 'cross_up',
    tolerancePct: 0.1,
  },
  maFiltersEnabled: true,
  maFilters: [{
    id: 1, enabled: true, period: 50, interval: '1h',
    mode: 'strict_above', tolerancePct: 0,
  }],
  exit: {
    logic: 'any',
    maCross: {
      enabled: true,
      ma1: { period: 9, interval: '15m' },
      ma2: { period: 21, interval: '15m' },
      direction: 'cross_down',
      tolerancePct: 0.1,
    },
    rsi: { enabled: false, conditions: [] },
  },
  stopLoss: { enabled: true, maxLossPct: 5 },
}));

const INTERVAL_HOURS = {
  '1m': 1 / 60, '3m': 3 / 60, '5m': 5 / 60, '15m': 0.25, '30m': 0.5,
  '1h': 1, '2h': 2, '4h': 4, '8h': 8, '1d': 24,
};

function fmtTime(ts) {
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtPnl(p) {
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

async function fetchBatch(interval, endTimeMs) {
  if (EXCHANGE === 'gate') {
    const pair = toGateSymbol(SYMBOL);
    const toSec = Math.floor(endTimeMs / 1000);
    const hrs = INTERVAL_HOURS[interval] ?? 1;
    const fromSec = toSec - 1000 * hrs * 3600;
    const url = `${GATE_BASE}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=1000&from=${fromSec}&to=${toSec}`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw)) throw new Error(`Gate: ${JSON.stringify(raw)}`);
    return raw.map(c => ({
      openTime: Number(c[0]) * 1000,
      open: parseFloat(c[5]), high: parseFloat(c[3]),
      low: parseFloat(c[4]), close: parseFloat(c[2]),
    }));
  }
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=1000&endTime=${endTimeMs}`;
  const raw = await fetch(url).then(r => r.json());
  if (raw?.code) throw new Error(`Binance: ${raw.msg ?? JSON.stringify(raw)}`);
  if (!Array.isArray(raw)) throw new Error(`Binance: resposta inválida`);
  return raw.map(c => ({
    openTime: Number(c[0]),
    open: parseFloat(c[1]), high: parseFloat(c[2]),
    low: parseFloat(c[3]), close: parseFloat(c[4]),
  }));
}

async function fetchHistory(interval, minCandles) {
  const hrs = INTERVAL_HOURS[interval] ?? 1;
  const needed = minCandles || Math.ceil((DAYS * 24) / hrs) + 120;
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
    await new Promise(r => setTimeout(r, 100));
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

function simulate(config, fullMap) {
  const scanIv = '15m';
  const scanCandles = fullMap[scanIv] ?? [];
  const warmup = 30;
  const startMs = Date.now() - DAYS * 86_400_000;
  const evalOpts = { closedOnly: false };

  let capital = CAPITAL;
  let phase = 'WATCHING';
  let position = null;
  const trades = [];
  const signals = { entry: [], blocked: {} };

  for (let i = warmup; i < scanCandles.length; i++) {
    const c = scanCandles[i];
    if (c.openTime < startMs) continue;

    const cMap = sliceCMap(fullMap, c.openTime);
    const dips = computeAdaptiveDips(config, cMap);

    if (phase === 'WATCHING') {
      const entry = evaluateEntry(config, cMap, dips, evalOpts);
      if (!entry.allowed) {
        if (entry.reason) {
          signals.blocked[entry.reason] = (signals.blocked[entry.reason] ?? 0) + 1;
        }
        continue;
      }

      const entryPrice = entry.close * (1 + FEE_RATE);
      position = {
        entryTime: c.openTime,
        entryPrice,
        qty: capital / entryPrice,
        usdtIn: capital,
        ma1: entry.ma1,
        ma2: entry.ma2,
        desc: entry.entryDesc,
      };
      signals.entry.push({
        time: c.openTime,
        close: entry.close,
        ma1: entry.ma1,
        ma2: entry.ma2,
        desc: entry.entryDesc,
      });
      phase = 'BOUGHT';
    } else if (phase === 'BOUGHT' && position) {
      const exit = evaluateExit(config, cMap, position.entryPrice, evalOpts);

      if (exit.exit) {
        const exitPrice = exit.close * (1 - FEE_RATE);
        const usdtOut = exitPrice * position.qty;
        const pnlPct = (usdtOut - position.usdtIn) / position.usdtIn * 100;
        capital = usdtOut;
        trades.push({
          entryTime: position.entryTime, exitTime: c.openTime,
          entryPrice: position.entryPrice, exitPrice: exit.close,
          pnlPct, reason: exit.reason, desc: exit.exitDesc ?? position.desc,
          ma1: exit.ma1, ma2: exit.ma2,
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
      pnlPct, reason: 'aberto', desc: position.desc,
    });
    capital = usdtOut;
  }

  const closed = trades.filter(t => t.reason !== 'aberto');
  const wins = closed.filter(t => t.pnlPct > 0).length;

  return {
    trades, signals, capital,
    totalPnl: ((capital - CAPITAL) / CAPITAL) * 100,
    wins,
    closed: closed.length,
    blocked: signals.blocked,
  };
}

async function main() {
  console.log(`\n🔬 Backtest MA Cross — ${SYMBOL} [${EXCHANGE}] | últimos ${DAYS} dias | $${CAPITAL}\n`);
  console.log('   Entrada : MA9(15m) cruza ↑ MA21(15m) + preço > MA50(1h)');
  console.log('   Saída   : MA9(15m) cruza ↓ MA21(15m) | stop 5%\n');

  const minByIv = {};
  for (const { interval, limit } of getRequiredSpecs(CONFIG)) {
    const hrs = INTERVAL_HOURS[interval] ?? 1;
    minByIv[interval] = Math.max(minByIv[interval] ?? 0, limit + Math.ceil((DAYS + 5) * 24 / hrs));
  }

  console.log('⏳ Buscando candles…');
  const fullMap = {};
  for (const iv of Object.keys(minByIv)) {
    fullMap[iv] = await fetchHistory(iv, minByIv[iv]);
  }

  const startMs = Date.now() - DAYS * 86_400_000;
  const periodFrom = startMs;
  const periodTo = Date.now();
  console.log(`\n   Janela: ${fmtTime(periodFrom)} → ${fmtTime(periodTo)}`);

  const result = simulate(CONFIG, fullMap);
  const { trades, signals, capital, totalPnl, wins, closed, blocked } = result;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📊 Resultado SYN — ${DAYS} dias`);
  console.log(`   Capital: $${CAPITAL} → $${capital.toFixed(2)} (${fmtPnl(totalPnl)})`);
  console.log(`   Trades : ${closed} fechados | ${wins} wins | win rate ${closed ? (wins / closed * 100).toFixed(0) : 0}%`);
  console.log(`   Sinais entrada (cruzamento ↑): ${signals.entry.length}`);
  if (Object.keys(blocked).length) {
    console.log('   Bloqueios:', Object.entries(blocked).map(([k, v]) => `${k}=${v}`).join(', '));
  }

  if (signals.entry.length) {
    console.log('\n   📍 Entradas detectadas:');
    for (const s of signals.entry) {
      console.log(
        `   ${fmtTime(s.time)}  close=${s.close?.toFixed(6)}  MA9=${s.ma1?.toFixed(6)}  MA21=${s.ma2?.toFixed(6)}  ${s.desc ?? ''}`,
      );
    }
  }

  if (!trades.length) {
    console.log('\n   (nenhum trade no período — cruzamento ↑ bloqueado ou sem saída)');
  } else {
    console.log('\n   Data entrada          → Data saída            PnL      Motivo');
    for (const t of trades) {
      const dur = Math.round((t.exitTime - t.entryTime) / 3_600_000);
      console.log(
        `   ${fmtTime(t.entryTime)} → ${fmtTime(t.exitTime)}  ${fmtPnl(t.pnlPct).padStart(8)}  ${t.reason}` +
        `  (${dur}h)`,
      );
    }
  }
  console.log(`\n${'─'.repeat(70)}\n`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
