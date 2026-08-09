'use strict';

/**
 * GET /services/volume-ignition — pares que dispararam o alerta de volume nos
 * últimos 15min + heartbeat do monitor.
 *
 * O detector (backend/market/volumeIgnitionMonitor.js) roda como bot separado no
 * Termux (backend/bot/volume-ignition/volume-ignition-bot.js), não dentro deste
 * painel — por isso lê do Supabase em vez de um estado em memória local.
 * Ver supabase/add-volume-ignition-events.sql.
 */

const router = require('express').Router();

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_OK = !!(SB_URL && SB_KEY);
const FLAG_TTL_MS = 15 * 60 * 1000;

async function sbGet(table, query = '') {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status}`);
  return res.json();
}

router.get('/volume-ignition', async (req, res) => {
  if (!SUPABASE_OK) {
    return res.status(503).json({ error: 'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.' });
  }

  try {
    const sinceIso = new Date(Date.now() - FLAG_TTL_MS).toISOString();
    const [events, statusRows] = await Promise.all([
      sbGet('volume_ignition_events', `?fired_at=gte.${sinceIso}&order=fired_at.desc&limit=200`),
      sbGet('volume_ignition_status', '?id=eq.1&limit=1'),
    ]);

    // Um símbolo pode re-disparar dentro da janela de 15min — mantém só o mais recente por símbolo.
    const bySymbol = new Map();
    for (const e of events) {
      if (!bySymbol.has(e.symbol)) bySymbol.set(e.symbol, e);
    }

    const list = [...bySymbol.values()].map((e) => ({
      symbol: e.symbol,
      ratio: Number(e.ratio),
      priceChangePct: Number(e.price_change_pct),
      price: Number(e.price),
      firedAt: new Date(e.fired_at).getTime(),
    }));

    const s = statusRows?.[0];
    const status = {
      monitoredPairs: s?.monitored_pairs ?? 0,
      startedAt: s?.started_at ? new Date(s.started_at).getTime() : null,
      lastTickAt: s?.last_tick_at ? new Date(s.last_tick_at).getTime() : null,
    };

    res.json({ list, status });
  } catch (err) {
    console.error('[volume-ignition]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
