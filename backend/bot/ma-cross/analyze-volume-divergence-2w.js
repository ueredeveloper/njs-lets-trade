'use strict';
/**
 * Compara duas formas de usar indicadores de volume (OBV, A/D Line, MFI,
 * Force Index) como filtro de entrada do ma-cross, em 15m / 1h / 4h,
 * sobre uma janela de 2 semanas de trades reais:
 *
 *   modo "trend"      : só olha a inclinação do indicador (como nos scripts
 *                        anteriores) — indicador subindo = confirma.
 *   modo "divergence"  : compara a inclinação do indicador com a do PREÇO no
 *                        mesmo intervalo — só confirma se os dois sobem juntos
 *                        (convergência real); se o preço sobe e o indicador
 *                        cai (ou vice-versa), marca como divergência e bloqueia.
 *
 * Uso: node backend/bot/ma-cross/analyze-volume-divergence-2w.js
 *      node backend/bot/ma-cross/analyze-volume-divergence-2w.js --from 2026-07-01
 *      node backend/bot/ma-cross/analyze-volume-divergence-2w.js --days 14
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ti = require('technicalindicators');
const { toGateSymbol } = require('../../utils/toGateSymbol');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const INTERVALS = ['15m', '1h', '4h'];
const INTERVAL_MS = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
const LOOKBACK = { '15m': 10, '1h': 10, '4h': 6 };
const PAD_MS = { '15m': 5 * 86_400_000, '1h': 20 * 86_400_000, '4h': 45 * 86_400_000 };
const INDICATORS = ['OBV', 'ADL', 'MFI', 'FI'];
const MODES = ['trend', 'divergence'];

function fromMsArg() {
  const fromArg = process.argv.find((a, i) => process.argv[i - 1] === '--from');
  if (fromArg) return new Date(`${fromArg}T00:00:00-03:00`).getTime();

  const daysArg = process.argv.find((a, i) => process.argv[i - 1] === '--days');
  const days = daysArg ? Number(daysArg) : 14;
  return Date.now() - days * 86_400_000;
}

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
  const from = Math.floor(startMs / 1000);
  const to = Math.floor(endMs / 1000);
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
  const raw = await fetch(url).then(r => r.json());
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    openTime: Number(c[0]) * 1000,
    open: +c[5], high: +c[3], low: +c[4], close: +c[2], volume: +c[6],
  }));
}

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const cMapCache = new Map();

async function loadCMap(exchange, symbol, entryMs) {
  const key = `${exchange}:${symbol}`;
  if (cMapCache.has(key)) return cMapCache.get(key);

  const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
  const end = Date.now() + 86_400_000;
  const cMap = {};
  for (const iv of INTERVALS) {
    cMap[iv] = await fetcher(symbol, iv, entryMs - PAD_MS[iv], end);
  }
  cMapCache.set(key, cMap);
  return cMap;
}

function candlesClosedBefore(candles, iv, entryMs) {
  const ms = INTERVAL_MS[iv];
  return (candles ?? []).filter(c => c.openTime + ms <= entryMs);
}

function indicatorsAt(candles, iv) {
  const lb = LOOKBACK[iv];
  if (!candles || candles.length < lb + 20) return null;

  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const close = candles.map(c => c.close);
  const volume = candles.map(c => c.volume);

  const obv = ti.OBV.calculate({ close, volume });
  const adl = ti.ADL.calculate({ high, low, close, volume });
  const mfi = ti.MFI.calculate({ high, low, close, volume, period: 14 });
  const fi = ti.ForceIndex.calculate({ close, volume, period: 13 });

  const rising = arr => {
    if (!arr || arr.length < lb + 1) return null;
    return arr[arr.length - 1] > arr[arr.length - 1 - lb];
  };
  const level = (arr, threshold) => {
    if (!arr || !arr.length) return null;
    return arr[arr.length - 1] > threshold;
  };

  const priceRising = close.length >= lb + 1 ? close[close.length - 1] > close[close.length - 1 - lb] : null;

  return {
    priceRising,
    OBV: { trend: rising(obv), level: null },
    ADL: { trend: rising(adl), level: null },
    MFI: { trend: rising(mfi), level: level(mfi, 50) },
    FI:  { trend: rising(fi),  level: level(fi, 0) },
  };
}

/** modo trend: só a inclinação do indicador. modo divergence: exige convergência com o preço. */
function classify(ind, mode, snap) {
  if (!snap) return null;
  const cell = snap[ind];
  if (!cell) return null;

  // MFI e FI já são "nível" (oscilador/sinal), o teste trend usa a mesma inclinação
  // pra manter os dois modos comparáveis com o mesmo insumo (subiu vs N atrás).
  const indRising = cell.trend;
  if (indRising == null) return null;

  if (mode === 'trend') return indRising;

  if (snap.priceRising == null) return null;
  // divergence: só confirma se preço E indicador sobem juntos (convergência real)
  return snap.priceRising && indRising;
}

async function analyzeTrade(trade) {
  const entryMs = new Date(trade.entry_time).getTime();
  const exchange = trade.exchange ?? 'binance';
  const symbol = trade.symbol;

  const cMap = await loadCMap(exchange, symbol, entryMs);

  const perInterval = {};
  for (const iv of INTERVALS) {
    const closed = candlesClosedBefore(cMap[iv], iv, entryMs);
    perInterval[iv] = indicatorsAt(closed, iv);
  }

  const pnl = trade.pnl_usdt != null ? +trade.pnl_usdt : null;
  const closed = trade.exit_time != null && pnl != null;

  return { symbol, exchange, entryMs, pnlUsdt: pnl, closed, open: !closed, perInterval };
}

function summarize(iv, ind, mode, results) {
  const flagged = results.map(r => ({ r, v: classify(ind, mode, r.perInterval[iv]) }))
    .filter(x => x.v != null);
  const confirmed = flagged.filter(x => x.v).map(x => x.r);
  const diverged = flagged.filter(x => !x.v).map(x => x.r);
  const closedConfirmed = confirmed.filter(r => r.closed);
  const closedDiverged = diverged.filter(r => r.closed);

  const pnlAll = flagged.map(x => x.r).filter(r => r.closed).reduce((s, r) => s + r.pnlUsdt, 0);
  const pnlConfirmed = closedConfirmed.reduce((s, r) => s + r.pnlUsdt, 0);
  const pnlDiverged = closedDiverged.reduce((s, r) => s + r.pnlUsdt, 0);
  const winsConfirmed = closedConfirmed.filter(r => r.pnlUsdt >= 0).length;
  const winsDiverged = closedDiverged.filter(r => r.pnlUsdt >= 0).length;

  return {
    iv, ind, mode,
    n: flagged.length,
    confirmedN: confirmed.length,
    divergedN: diverged.length,
    pnlAll, pnlConfirmed, pnlDiverged,
    closedConfirmedN: closedConfirmed.length,
    closedDivergedN: closedDiverged.length,
    winsConfirmed, winsDiverged,
    delta: pnlConfirmed - pnlAll,
  };
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const fromMs = fromMsArg();
  const fromIso = new Date(fromMs).toISOString();
  console.log(`\n═══ Trend vs Divergência real — indicadores de volume, trades ma-cross (2 semanas) ═══`);
  console.log(`Período: desde ${fmtDt(fromMs)} (${fromIso})\n`);

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&entry_time=gte.${fromIso}&order=entry_time.asc`,
  );

  if (!trades.length) {
    console.log('Nenhum trade ma-cross neste período.');
    return;
  }

  const results = [];
  for (const t of trades) {
    process.stderr.write(`  ${t.symbol}...`);
    try {
      results.push(await analyzeTrade(t));
      process.stderr.write(' ok\n');
    } catch (err) {
      process.stderr.write(` erro: ${err.message}\n`);
      results.push({ symbol: t.symbol, error: err.message, perInterval: {} });
    }
  }

  const valid = results.filter(r => !r.error);
  console.log('── Resumo ──');
  console.log(`Trades no período: ${trades.length} (${valid.filter(r => r.closed).length} fechados, ${valid.filter(r => r.open).length} abertos)\n`);

  const all = [];
  for (const ind of INDICATORS) {
    for (const iv of INTERVALS) {
      for (const mode of MODES) {
        all.push(summarize(iv, ind, mode, valid));
      }
    }
  }

  console.log('Indicador | Interv | Modo       | Confirma/Diverge | PnL real | PnL confirm | PnL diverge | Delta   | W/L confirma | W/L diverge');
  console.log('----------|--------|------------|-------------------|----------|-------------|-------------|---------|--------------|------------');
  for (const s of all) {
    console.log(
      `${s.ind.padEnd(9)} | ${s.iv.padEnd(6)} | ${s.mode.padEnd(10)} | ${`${s.confirmedN}/${s.divergedN}`.padEnd(17)} | ${s.pnlAll.toFixed(2).padStart(8)} | ${s.pnlConfirmed.toFixed(2).padStart(11)} | ${s.pnlDiverged.toFixed(2).padStart(11)} | ${(s.delta >= 0 ? '+' : '') + s.delta.toFixed(2)}`.padEnd(0)
      + ` | ${s.winsConfirmed}W/${s.closedConfirmedN - s.winsConfirmed}L`.padEnd(14) + `| ${s.winsDiverged}W/${s.closedDivergedN - s.winsDiverged}L`,
    );
  }

  console.log('\n── Ranking geral (top 10 por delta) ──');
  const ranked = [...all].sort((a, b) => b.delta - a.delta);
  for (const s of ranked.slice(0, 10)) {
    console.log(`  ${s.ind} ${s.iv} [${s.mode}]: ${(s.delta >= 0 ? '+' : '')}${s.delta.toFixed(2)} USDT — mantém ${s.confirmedN}/${s.n} (PnL confirmado ${(s.pnlConfirmed >= 0 ? '+' : '')}${s.pnlConfirmed.toFixed(2)})`);
  }

  console.log('\n── Trend vs Divergência lado a lado (por indicador/intervalo) ──');
  for (const ind of INDICATORS) {
    for (const iv of INTERVALS) {
      const t = all.find(s => s.ind === ind && s.iv === iv && s.mode === 'trend');
      const d = all.find(s => s.ind === ind && s.iv === iv && s.mode === 'divergence');
      const better = d.delta > t.delta ? 'divergence melhor' : (d.delta < t.delta ? 'trend melhor' : 'empate');
      console.log(`  ${ind} ${iv}: trend delta ${(t.delta >= 0 ? '+' : '')}${t.delta.toFixed(2)} (n=${t.confirmedN})  vs  divergence delta ${(d.delta >= 0 ? '+' : '')}${d.delta.toFixed(2)} (n=${d.confirmedN})  →  ${better}`);
    }
  }

  for (const r of results.filter(r => r.error)) {
    console.log(`\n  ${r.symbol}: erro — ${r.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
