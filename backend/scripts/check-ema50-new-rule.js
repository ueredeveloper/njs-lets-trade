'use strict';
/**
 * Verifica se a ultima compra ma-cross de TIA/TAO/ICP ja teria sido barrada
 * pela nova regra do filtro adaptativo EMA50(1h) (maxDipPct 4% -> 1%).
 * Uso: node backend/scripts/check-ema50-new-rule.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { toGateSymbol } = require('../utils/toGateSymbol');
const { checkPriceFilter, closedCandlesOnly } = require('../bot/ma-cross/strategyEngine');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SYMBOLS = ['TIAUSDT', 'TAOUSDT', 'ICPUSDT'];

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
      out.push({ openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4] });
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
    open: +c[5], high: +c[3], low: +c[4], close: +c[2],
  }));
}

function fmtDt(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / KEY ausentes');
    process.exit(1);
  }

  const trades = await sbGet(
    'rsi_multi_bot_trades',
    `?strategy_id=eq.ma-cross&symbol=in.(${SYMBOLS.join(',')})&order=entry_time.desc&limit=20`,
  );

  const states = await sbGet(
    'rsi_multi_bot_state',
    `?strategy_id=eq.ma-cross&symbol=in.(${SYMBOLS.join(',')})&select=symbol,trade_config`,
  );
  const stateBySymbol = new Map(states.map(s => [s.symbol, s]));

  console.log('\n═══ TIA / TAO / ICP — última compra vs regra nova (maxDipPct 1%) ═══\n');

  for (const symbol of SYMBOLS) {
    const last = trades.find(t => t.symbol === symbol);
    if (!last) {
      console.log(`${symbol}: nenhum trade encontrado.\n`);
      continue;
    }

    const state = stateBySymbol.get(symbol);
    const liveFilter = state?.trade_config?.maFilters?.find(
      f => f.period === 50 && f.interval === '1h' && f.mode === 'adaptive',
    );
    const liveMaxDipPct = liveFilter?.maxDipPct;

    const exchange = last.exchange ?? 'binance';
    const entryMs = new Date(last.entry_time).getTime();
    const fetcher = exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
    const start = entryMs - 20 * 86_400_000;
    const raw = await fetcher(symbol, '1h', start, entryMs + 3_600_000);
    const candles = closedCandlesOnly(raw.filter(c => c.openTime <= entryMs));

    const close = +last.entry_price;
    const filterBase = { id: 1, enabled: true, period: 50, interval: '1h', mode: 'adaptive', tolerancePct: 0 };

    const withNewRule = checkPriceFilter(close, candles, { ...filterBase, maxDipPct: 1, maxAbovePct: 4 });
    const withOldRule = checkPriceFilter(close, candles, { ...filterBase, maxDipPct: 4, maxAbovePct: 4 });

    console.log(`${symbol}`);
    console.log(`  Última entrada: ${fmtDt(entryMs)} (${exchange}) @ ${close}`);
    console.log(`  Config salva no Supabase agora: maxDipPct = ${liveMaxDipPct ?? '(sem filtro adaptive 50/1h)'}`);
    console.log(`  EMA50(1h) na entrada: ${withNewRule.ma?.toFixed(6) ?? withOldRule.ma?.toFixed(6) ?? '—'}`);
    console.log(`  Dip vs EMA50(1h): ${withOldRule.distPct != null ? withOldRule.distPct.toFixed(2) : '?'}%`);
    console.log(`  Regra ANTIGA (4%): ${withOldRule.allowed ? 'PASSARIA' : `BLOQUEADA (${withOldRule.reason})`}`);
    console.log(`  Regra NOVA (1%):   ${withNewRule.allowed ? 'PASSARIA' : `BLOQUEADA (${withNewRule.reason})`}`);
    console.log('');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
