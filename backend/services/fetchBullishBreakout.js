'use strict';

const router = require('express').Router();
const supabase = require('../supabase/client');
const fetchKlines = require('../binance/fetchKlines');
const { getBullishBreakouts, findBreakoutSignals, normalizeOptions } = require('../market/bullishBreakoutScanner');
const { CONFIG: AUTO_CONFIG, SOURCE: AUTO_SOURCE } = require('../bot/breakout-auto/bullishBreakoutAuto');
const { bullishClosePattern, intervalMs } = require('../bot/shared/candleCloseCondition');

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

    // Padrão de alta do candle (v1.187.0) — o mesmo bullishClosePattern que o watcher usa no
    // fechamento; no candle ainda aberto não vale (pode mudar até fechar).
    const num = candles.map((k) => ({
      openTime: Number(k.openTime), open: Number(k.open), high: Number(k.high), low: Number(k.low), close: Number(k.close),
    }));
    const ivMs = intervalMs(opts.interval);
    const idxByTime = new Map(num.map((k, i) => [k.openTime, i]));
    const patternAt = (t) => {
      const i = idxByTime.get(t);
      return i == null ? null : bullishClosePattern(num[i], num.slice(Math.max(0, i - 4), i));
    };

    const byCandle = new Map();
    for (const s of findBreakoutSignals(candles, opts)) {
      byCandle.set(s.openTime, {
        candleOpenTime: s.openTime, closed: s.closed, price: s.close,
        bodyPct: s.bodyPct, volumeRatio: s.volumeRatio, order: null,
        bullishPattern: s.closed ? patternAt(s.openTime) : null, authorizedBy: s.closed ? 'body' : null,
      });
    }
    for (const o of orders) {
      const t = Number(o.close_condition?.candleOpenTime);
      if (!Number.isFinite(t)) continue;
      const cur = byCandle.get(t) ?? {
        candleOpenTime: t, closed: true, price: num[idxByTime.get(t)]?.close ?? null,
        bodyPct: o.close_condition?.detected?.bodyPct ?? null,
        volumeRatio: o.close_condition?.detected?.volumeRatio ?? null,
        order: null, bullishPattern: t + ivMs <= Date.now() ? patternAt(t) : null, authorizedBy: null,
      };
      if (!cur.order) {
        // Registro do fechamento gravado pelo watcher: vale mais que o replay (é o que o bot decidiu).
        const chk = o.close_condition?.closeCheck;
        if (chk) {
          cur.authorizedBy = chk.authorizedBy ?? null;
          cur.bullishPattern = chk.bullishPattern ?? cur.bullishPattern;
          if (chk.bodyPct != null) cur.bodyPct = chk.bodyPct;
        }
        cur.order = {
          id: o.id, status: o.status, error: o.error ?? null, avgPrice: o.fill?.avgPrice ?? null,
          entryKind: o.entry_kind, discountPct: o.close_condition?.entryDiscount?.discountPct ?? null,
        };
      }
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
