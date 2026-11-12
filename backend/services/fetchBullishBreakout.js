'use strict';

const router = require('express').Router();
const supabase = require('../supabase/client');
const fetchKlines = require('../binance/fetchKlines');
const { getBullishBreakouts, findBreakoutSignals, normalizeOptions } = require('../market/bullishBreakoutScanner');
const { CONFIG: AUTO_CONFIG, SOURCE: AUTO_SOURCE } = require('../bot/breakout-auto/bullishBreakoutAuto');

// GET /services/bullish-breakout?interval=4h&minBodyPct=5&minVolumeRatio=3&minClosePos=0.4
//   &lookback=20&withinCandles=1&requireBreakout=true&closedOnly=false&minVolume24h=1000000
// Todos opcionais (padrões em bullishBreakoutScanner.js#DEFAULTS). Devolve { name, list, meta }.
router.get('/bullish-breakout', async (req, res) => {
  try {
    res.json(await getBullishBreakouts(req.query));
  } catch (err) {
    const badRequest = /inválido|deve estar/.test(err.message);
    if (!badRequest) console.error('[bullish-breakout]', err.message);
    res.status(badRequest ? 400 : 502).json({ error: err.message });
  }
});

// GET /services/bullish-breakout/signals?symbol=OGUSDT[&limit=300]
// Sinais da Explosão automática numa moeda (seta do sinal no gráfico do favorito B), com ou sem
// entrada. Junta duas fontes:
//   1. ordens que o automático gravou (manual_oco_orders, close_condition.source) — status/erro
//      dizem o que aconteceu (comprou, fechou em padrão de baixa, sem saldo...);
//   2. replay dos critérios do automático (CONFIG.scan, firstOfMove) nos candles fechados — pega o
//      sinal que nem virou ordem (máx. de ordens vivas, moeda já com OCO, bot parado...).
// O volume 24h do automático não entra no replay (não há histórico dele por candle).
router.get('/bullish-breakout/signals', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!/^[A-Z0-9]{2,30}$/.test(symbol)) return res.status(400).json({ error: 'symbol obrigatório' });
  const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 300));
  try {
    const opts = normalizeOptions({ interval: AUTO_CONFIG.interval, ...AUTO_CONFIG.scan });
    const [candles, ordersRes] = await Promise.all([
      fetchKlines(symbol, opts.interval, limit),
      supabase.from('manual_oco_orders')
        .select('id, status, error, entry_kind, close_condition, fill, created_at')
        .eq('symbol', symbol).eq('close_condition->>source', AUTO_SOURCE)
        .order('id', { ascending: false }).limit(100),
    ]);
    const orders = ordersRes.error ? [] : (ordersRes.data ?? []);

    const byCandle = new Map();
    for (const s of findBreakoutSignals(candles, opts)) {
      byCandle.set(s.openTime, {
        candleOpenTime: s.openTime, closed: s.closed, price: s.close,
        bodyPct: s.bodyPct, volumeRatio: s.volumeRatio, order: null,
      });
    }
    for (const o of orders) {
      const t = Number(o.close_condition?.candleOpenTime);
      if (!Number.isFinite(t)) continue;
      const cur = byCandle.get(t) ?? {
        candleOpenTime: t, closed: true, price: null,
        bodyPct: o.close_condition?.detected?.bodyPct ?? null,
        volumeRatio: o.close_condition?.detected?.volumeRatio ?? null,
        order: null,
      };
      if (!cur.order) cur.order = { id: o.id, status: o.status, error: o.error ?? null, avgPrice: o.fill?.avgPrice ?? null };
      byCandle.set(t, cur);
    }
    const signals = [...byCandle.values()].sort((a, b) => a.candleOpenTime - b.candleOpenTime);
    res.json({ symbol, interval: opts.interval, signals, ordersError: ordersRes.error?.message ?? null });
  } catch (err) {
    console.error('[bullish-breakout/signals]', symbol, err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
