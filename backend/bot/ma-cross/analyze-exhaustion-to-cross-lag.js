'use strict';
/**
 * Quanto tempo levou, em média, entre a moeda ser adicionada aos favoritos
 * ma-cross (proxy: momento em que o usuário percebeu a exaustão BB+VWAP em 4h
 * e adicionou pelo painel) e o primeiro cruzamento EMA9↑EMA21 (1h) executado
 * pelo bot (buy_time / entry_time).
 *
 * Somente leitura — não altera nada no Supabase.
 *
 * Uso: node backend/bot/ma-cross/analyze-exhaustion-to-cross-lag.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

function fmtDur(ms) {
  const h = ms / 3_600_000;
  if (h < 1) return `${(ms / 60_000).toFixed(0)}min`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function fmtDt(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  const favorites = await sbGet(
    'multitrade_favorites',
    '?strategy_id=eq.ma-cross&select=symbol,exchange,created_at,trade_config&order=created_at.asc'
  );
  const states = await sbGet(
    'rsi_multi_bot_state',
    '?strategy_id=eq.ma-cross&select=symbol,exchange,phase,buy_time,updated_at'
  );
  const trades = await sbGet(
    'rsi_multi_bot_trades',
    '?strategy_id=eq.ma-cross&select=symbol,exchange,entry_time&order=entry_time.asc'
  );

  const stateBySymbol = new Map(states.map(s => [`${s.symbol}|${s.exchange}`, s]));
  const tradesBySymbol = new Map();
  for (const t of trades) {
    const k = `${t.symbol}|${t.exchange}`;
    if (!tradesBySymbol.has(k)) tradesBySymbol.set(k, []);
    tradesBySymbol.get(k).push(t);
  }

  console.log(`\n═══ Favoritos ma-cross: exaustão (created_at) → entrada (cruzamento EMA9/21) ═══`);
  console.log(`${favorites.length} favorito(s) com strategy_id=ma-cross\n`);

  const rows = [];
  for (const f of favorites) {
    const key = `${f.symbol}|${f.exchange}`;
    const createdMs = new Date(f.created_at).getTime();
    const interval = f.trade_config?.entry?.ma1?.interval || f.trade_config?.entry?.interval || '?';

    let entryIso = null;
    let source = null;

    const tlist = tradesBySymbol.get(key) || [];
    const firstAfter = tlist.find(t => new Date(t.entry_time).getTime() >= createdMs);
    if (firstAfter) {
      entryIso = firstAfter.entry_time;
      source = 'trades.entry_time';
    } else {
      const st = stateBySymbol.get(key);
      if (st && st.buy_time && new Date(st.buy_time).getTime() >= createdMs) {
        entryIso = st.buy_time;
        source = 'state.buy_time';
      }
    }

    if (!entryIso) {
      rows.push({ symbol: f.symbol, exchange: f.exchange, interval, createdAt: f.created_at, status: 'ainda sem entrada' });
      continue;
    }

    const lagMs = new Date(entryIso).getTime() - createdMs;
    rows.push({
      symbol: f.symbol, exchange: f.exchange, interval,
      createdAt: f.created_at, entryAt: entryIso, lagMs, source,
      status: 'entrou',
    });
  }

  const entered = rows.filter(r => r.status === 'entrou');
  const pending = rows.filter(r => r.status !== 'entrou');

  console.log('── Detalhe ──');
  for (const r of rows) {
    if (r.status === 'entrou') {
      console.log(`${r.symbol.padEnd(12)} [${r.exchange}/${r.interval}]  favoritada ${fmtDt(r.createdAt)}  →  entrou ${fmtDt(r.entryAt)}   lag=${fmtDur(r.lagMs)}  (${r.source})`);
    } else {
      console.log(`${r.symbol.padEnd(12)} [${r.exchange}/${r.interval}]  favoritada ${fmtDt(r.createdAt)}  →  ${r.status}`);
    }
  }

  if (entered.length) {
    const avg = entered.reduce((s, r) => s + r.lagMs, 0) / entered.length;
    const sorted = [...entered].sort((a, b) => a.lagMs - b.lagMs);
    const median = sorted[Math.floor(sorted.length / 2)].lagMs;
    const min = sorted[0].lagMs;
    const max = sorted[sorted.length - 1].lagMs;
    console.log('\n── Resumo (apenas moedas que já entraram) ──');
    console.log(`N = ${entered.length} de ${rows.length} favoritos`);
    console.log(`Média:   ${fmtDur(avg)}`);
    console.log(`Mediana: ${fmtDur(median)}`);
    console.log(`Mín:     ${fmtDur(min)}`);
    console.log(`Máx:     ${fmtDur(max)}`);
  } else {
    console.log('\nNenhuma moeda com entrada registrada ainda.');
  }
  if (pending.length) {
    console.log(`\n${pending.length} favorito(s) ainda sem entrada registrada (fora da média).`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
