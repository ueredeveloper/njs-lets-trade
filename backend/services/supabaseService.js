'use strict';

/**
 * /services/sb/*  — endpoints respaldados pelo Supabase.
 *
 * Autenticação futura: o frontend envia o JWT Supabase no header
 *   Authorization: Bearer <access_token>
 * e o middleware getUserId extrai o user_id do token.
 *
 * Enquanto não há login implementado no frontend, o middleware usa
 * SUPABASE_DEFAULT_USER_ID do .env como fallback.
 */

const router    = require('express').Router();
const supabase  = require('../supabase/client');
const { buildTradeConfig, buildAdaptiveReport, suggestAdaptiveDip, buildEntryDiscountReport, getRequiredSpecs, buildMaSnapshot, evaluateEntry, computeAdaptiveDips } = require('../bot/amap/strategyEngine');
const { buildExtensionAboveReport } = require('../bot/amap/suggestExtensionAbovePct');
const { buildExitRsiReport } = require('../bot/amap/suggestExitRsi');
const { buildEntryRsiReport } = require('../bot/amap/suggestEntryRsi');
const { buildEntryMaReport } = require('../bot/amap/suggestEntryMa');
const { runAmapBacktest } = require('../bot/amap/amapBacktest');
const { toFormState, normalizeTradeConfig, flatConfigToBody, toEngineConfig } = require('../bot/amap/tradeConfigSchema');
const { fetchBinanceCandles, fetchGateCandles } = require('../bot/prices');
const { toGateSymbol } = require('../utils/toGateSymbol');
const { fetch24hVolumeUsdt, fmtVolumeUsdt, DEFAULT_MIN_VOLUME_USDT } = require('../bot/volume24h');

// Se Supabase não estiver configurado, retorna 503 imediatamente para todos os
// endpoints /services/sb/* e evita queries com URL vazia que crasham o processo.
const SUPABASE_OK = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
router.use((req, res, next) => {
  if (!SUPABASE_OK) return res.status(503).json({ error: 'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.' });
  next();
});

// ── Middleware: resolve user_id ───────────────────────────────────────────────
async function getUserId(req, res, next) {
  // 1. JWT Supabase no header Authorization
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user?.id) {
      req.userId = data.user.id;
      return next();
    }
  }

  // 2. Fallback: user_id fixo do .env (modo single-user / desenvolvimento)
  const fallback = process.env.SUPABASE_DEFAULT_USER_ID;
  if (fallback) {
    req.userId = fallback;
    return next();
  }

  res.status(401).json({ error: 'Não autenticado. Defina SUPABASE_DEFAULT_USER_ID no .env ou envie um Bearer token.' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sbError(res, error, context = '') {
  const msg = error.message || String(error);
  console.error(`[supabase] ${context}:`, msg);
  if (/trade_config.*schema cache/i.test(msg)) {
    return res.status(500).json({
      error: msg,
      hint: 'Execute supabase/add-trade-config.sql no SQL Editor do Supabase.',
    });
  }
  res.status(500).json({ error: msg });
}

// ============================================================
//  PERFIL
// ============================================================

// GET /services/sb/profile
router.get('/profile', getUserId, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.userId)
    .single();
  if (error) return sbError(res, error, 'GET profile');
  res.json(data);
});

// PUT /services/sb/profile   { theme?, language?, intervals?, chart_interval?, is_admin? }
router.put('/profile', getUserId, async (req, res) => {
  const allowed = ['theme', 'language', 'intervals', 'chart_interval'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.userId)
    .select()
    .single();
  if (error) return sbError(res, error, 'PUT profile');
  res.json(data);
});

// ============================================================
//  FAVORITES  (gate | binance | trade)
// ============================================================

const TABLES = { gate: 'favorites_gate', binance: 'favorites_binance', trade: 'favorites_trade' };

function validType(req, res) {
  const type = req.query.type || req.body?.type;
  if (!TABLES[type]) {
    res.status(400).json({ error: 'type deve ser gate, binance ou trade' });
    return null;
  }
  return type;
}

// GET /services/sb/favorites?type=gate|binance|trade
router.get('/favorites', getUserId, async (req, res) => {
  const type = validType(req, res);
  if (!type) return;

  const { data, error } = await supabase
    .from(TABLES[type])
    .select('*')
    .eq('user_id', req.userId)
    .order('position');
  if (error) return sbError(res, error, `GET favorites/${type}`);

  // Normaliza para o mesmo formato que o frontend já espera dos JSON files
  if (type === 'trade') {
    return res.json(data.map(r => ({
      symbol:       r.symbol,
      exchange:     r.exchange,
      interval:     r.interval,
      rsiBuy:       Number(r.rsi_buy),
      rsiSell:      Number(r.rsi_sell),
      sellInterval: r.sell_interval ?? null,
      variationMin: r.variation_min !== null ? Number(r.variation_min) : undefined,
    })));
  }
  res.json(data.map(r => r.symbol));
});

// POST /services/sb/favorites  { symbol, type, [exchange, interval, rsiBuy, rsiSell, sellInterval, variationMin] }
router.post('/favorites', getUserId, async (req, res) => {
  const type = validType(req, res);
  if (!type) return;

  const { symbol, exchange = 'gate', interval = '30m', rsiBuy = 30, rsiSell = 70, sellInterval, variationMin } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  const sym = symbol.toUpperCase();

  let row, error;

  if (type === 'trade') {
    const entry = {
      user_id:       req.userId,
      symbol:        sym,
      exchange,
      interval,
      rsi_buy:       Number(rsiBuy),
      rsi_sell:      Number(rsiSell),
      sell_interval: sellInterval || null,
      variation_min: variationMin !== undefined ? Number(variationMin) : null,
    };
    ({ data: row, error } = await supabase
      .from('favorites_trade')
      .upsert(entry, { onConflict: 'user_id,symbol' })
      .select()
      .single());
  } else {
    ({ data: row, error } = await supabase
      .from(TABLES[type])
      .upsert({ user_id: req.userId, symbol: sym }, { onConflict: 'user_id,symbol' })
      .select()
      .single());
  }

  if (error) return sbError(res, error, `POST favorites/${type}`);

  // Retorna a lista completa atualizada (mesmo comportamento dos serviços JSON)
  const { data: list, error: listErr } = await supabase
    .from(TABLES[type])
    .select('*')
    .eq('user_id', req.userId)
    .order('position');
  if (listErr) return sbError(res, listErr, `POST favorites/${type} list`);

  if (type === 'trade') {
    return res.json(list.map(r => ({
      symbol:       r.symbol,
      exchange:     r.exchange,
      interval:     r.interval,
      rsiBuy:       Number(r.rsi_buy),
      rsiSell:      Number(r.rsi_sell),
      sellInterval: r.sell_interval ?? null,
      variationMin: r.variation_min !== null ? Number(r.variation_min) : undefined,
    })));
  }
  res.json(list.map(r => r.symbol));
});

// DELETE /services/sb/favorites/:symbol?type=gate|binance|trade
router.delete('/favorites/:symbol', getUserId, async (req, res) => {
  const type = validType(req, res);
  if (!type) return;

  const sym = req.params.symbol.toUpperCase();
  const { error } = await supabase
    .from(TABLES[type])
    .delete()
    .eq('user_id', req.userId)
    .eq('symbol', sym);
  if (error) return sbError(res, error, `DELETE favorites/${type}/${sym}`);

  const { data: list, error: listErr } = await supabase
    .from(TABLES[type])
    .select('*')
    .eq('user_id', req.userId)
    .order('position');
  if (listErr) return sbError(res, listErr, `DELETE favorites/${type} list`);

  if (type === 'trade') {
    return res.json(list.map(r => ({
      symbol:       r.symbol,
      exchange:     r.exchange,
      interval:     r.interval,
      rsiBuy:       Number(r.rsi_buy),
      rsiSell:      Number(r.rsi_sell),
      sellInterval: r.sell_interval ?? null,
      variationMin: r.variation_min !== null ? Number(r.variation_min) : undefined,
    })));
  }
  res.json(list.map(r => r.symbol));
});

// ============================================================
//  MULTITRADE FAVORITES  + sync rsi_multi_bot_state
// ============================================================

function multitradeToEntry(r) {
  const tc = r.trade_config ? buildTradeConfig(flatConfigToBody(r.trade_config)) : null;
  const form = toFormState(tc ?? {
    entryRsi:     r.entry_rsi,
    exitRsi:      r.exit_rsi,
    maConditions: r.ma_conditions,
    extension:    { threeCandles: r.rule_3_candles, fourCandles: r.rule_4_candles },
  });

  return {
    id:           r.id,
    symbol:       r.symbol,
    exchange:     r.exchange,
    capital:      Number(r.capital),
    entryRsi:     form.entryRsi,
    exitRsi:      form.exitRsi,
    entryRsiPath: form.entryRsiPath,
    entryMa:      form.entryMa,
    maConditions: form.maConditions,
    extension:    form.extension,
    stopLoss:     form.stopLoss,
    execution:    form.execution,
    polling:      form.polling,
    adaptiveOpts: form.adaptiveOpts,
    volume:       form.volume,
    tradeConfig:  tc,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

function bodyToMultitradeRow(userId, body) {
  const sym = body.symbol?.toUpperCase();
  if (!sym) return null;
  const normalized = normalizeTradeConfig(body);
  const trade_config = buildTradeConfig(body);
  return {
    user_id:         userId,
    symbol:          sym,
    exchange:        body.exchange ?? 'binance',
    strategy_id:     'flex',
    capital:         Number(body.capital ?? 100),
    entry_rsi:       normalized.entryRsi,
    exit_rsi:        normalized.exitRsi,
    ma_conditions:   normalized.maConditions,
    rule_3_candles:  !!normalized.extension.threeCandles,
    rule_4_candles:  !!normalized.extension.fourCandles,
    trade_config,
  };
}

async function syncBotState({ symbol, exchange, strategy_id, capital, trade_config }) {
  const row = {
    symbol, exchange, strategy_id, initial_capital: capital, capital, trade_config,
  };
  const { error } = await supabase.from('rsi_multi_bot_state').upsert(row, { onConflict: 'symbol,strategy_id' });
  if (error) console.warn('[supabase] syncBotState:', error.message);
}

// GET /services/sb/multitrade-favorites
router.get('/multitrade-favorites', getUserId, async (req, res) => {
  const { data, error } = await supabase
    .from('multitrade_favorites')
    .select('*')
    .eq('user_id', req.userId)
    .order('position')
    .order('created_at');
  if (error) return sbError(res, error, 'GET multitrade-favorites');
  res.json((data ?? []).map(multitradeToEntry));
});

// POST /services/sb/multitrade-favorites
router.post('/multitrade-favorites', getUserId, async (req, res) => {
  const row = bodyToMultitradeRow(req.userId, req.body);
  if (!row) return res.status(400).json({ error: 'symbol obrigatório' });

  const { data, error } = await supabase
    .from('multitrade_favorites')
    .upsert(row, { onConflict: 'user_id,symbol' })
    .select()
    .single();
  if (error) return sbError(res, error, 'POST multitrade-favorites');

  await syncBotState({
    symbol:      data.symbol,
    exchange:    data.exchange,
    strategy_id: data.strategy_id,
    capital:     Number(data.capital),
    trade_config: data.trade_config,
  });

  res.json(multitradeToEntry(data));
});

// PUT|PATCH /services/sb/multitrade-favorites/:id
async function updateMultitrade(req, res) {
  const row = bodyToMultitradeRow(req.userId, req.body);
  if (!row) return res.status(400).json({ error: 'symbol obrigatório' });

  const { data, error } = await supabase
    .from('multitrade_favorites')
    .update(row)
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .select()
    .single();
  if (error) return sbError(res, error, 'PUT multitrade-favorites');
  if (!data) return res.status(404).json({ error: 'not found' });

  await syncBotState({
    symbol:      data.symbol,
    exchange:    data.exchange,
    strategy_id: data.strategy_id,
    capital:     Number(data.capital),
    trade_config: data.trade_config,
  });

  res.json(multitradeToEntry(data));
}
router.put('/multitrade-favorites/:id', getUserId, updateMultitrade);
router.patch('/multitrade-favorites/:id', getUserId, updateMultitrade);

// DELETE /services/sb/multitrade-favorites/:id
router.delete('/multitrade-favorites/:id', getUserId, async (req, res) => {
  const { data: existing, error: findErr } = await supabase
    .from('multitrade_favorites')
    .select('symbol, strategy_id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();
  if (findErr || !existing) return res.status(404).json({ error: 'not found' });

  const { error } = await supabase
    .from('multitrade_favorites')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId);
  if (error) return sbError(res, error, 'DELETE multitrade-favorites');

  await supabase
    .from('rsi_multi_bot_state')
    .delete()
    .eq('symbol', existing.symbol)
    .eq('strategy_id', existing.strategy_id)
    .eq('phase', 'WATCHING');

  res.json({ deleted: req.params.id });
});

// GET /services/sb/multitrade-trades?symbol=&strategy_id=&limit=50
router.get('/multitrade-trades', getUserId, async (req, res) => {
  let q = supabase.from('rsi_multi_bot_trades').select('*').order('exit_time', { ascending: false });
  if (req.query.symbol)       q = q.eq('symbol', req.query.symbol.toUpperCase());
  if (req.query.strategy_id)  q = q.eq('strategy_id', req.query.strategy_id);
  q = q.limit(Math.min(parseInt(req.query.limit ?? '50', 10), 200));

  const { data, error } = await q;
  if (error) return sbError(res, error, 'GET multitrade-trades');
  res.json(data ?? []);
});

// GET /services/sb/multitrade-timeline?symbol=&limit=100
router.get('/multitrade-timeline', getUserId, async (req, res) => {
  let q = supabase.from('rsi_multi_timeline').select('*').order('event_time', { ascending: false });
  if (req.query.symbol) q = q.eq('symbol', req.query.symbol.toUpperCase());
  q = q.limit(Math.min(parseInt(req.query.limit ?? '100', 10), 500));

  const { data, error } = await q;
  if (error) return sbError(res, error, 'GET multitrade-timeline');
  res.json(data ?? []);
});

// GET /services/sb/multitrade-volume?symbol=&exchange=&minVolumeUsdt=
router.get('/multitrade-volume', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange       = req.query.exchange ?? 'binance';
  const minVolumeUsdt  = Number(req.query.minVolumeUsdt ?? DEFAULT_MIN_VOLUME_USDT);

  try {
    const volumeUsdt = await fetch24hVolumeUsdt(symbol, exchange);
    const meetsMin   = volumeUsdt >= minVolumeUsdt;
    res.json({
      symbol,
      exchange,
      volumeUsdt,
      volumeFmt:      fmtVolumeUsdt(volumeUsdt),
      minVolumeUsdt,
      minVolumeFmt:   fmtVolumeUsdt(minVolumeUsdt),
      meetsMin,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/multitrade-suggest-discount?symbol=&exchange=&entryInterval=&entryPeriod=&entryOperator=&entryValue=&exitInterval=&exitPeriod=&exitOperator=&exitValue=&pendingTimeoutMs=&pendingCancelPct=
router.get('/multitrade-suggest-discount', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const tradeConfig = buildTradeConfig({
    entryRsi: {
      interval: req.query.entryInterval ?? '15m',
      period:   Number(req.query.entryPeriod ?? 14),
      operator: req.query.entryOperator ?? '<',
      value:    Number(req.query.entryValue ?? 30),
    },
    exitRsi: {
      interval: req.query.exitInterval ?? req.query.entryInterval ?? '15m',
      period:   Number(req.query.exitPeriod ?? req.query.entryPeriod ?? 14),
      operator: req.query.exitOperator ?? '>',
      value:    Number(req.query.exitValue ?? 70),
    },
    execution: {
      pendingTimeoutMs: Number(req.query.pendingTimeoutMs ?? 30 * 60_000),
      pendingCancelPct: Number(req.query.pendingCancelPct ?? 0.002),
    },
  });

  const specs = getRequiredSpecs(tradeConfig);
  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, Math.max(limit, 500));
    }));

    const report = buildEntryDiscountReport(cMap, tradeConfig);
    res.json({
      symbol,
      exchange,
      entryDiscount: report.suggestedDiscount,
      entryDiscountPct: report.suggestedPct,
      ...report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /multitrade-suggest-adaptive?symbol=&exchange=&period=50&interval=1h&defaultPct=&maxPct=&minPct=&minEpisodes=
router.get('/multitrade-suggest-adaptive', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const period   = Number(req.query.period ?? 50);
  const interval = req.query.interval ?? '1h';
  const adaptiveOpts = {
    defaultPct:  Number(req.query.defaultPct  ?? 3),
    maxPct:      Number(req.query.maxPct      ?? 8),
    minPct:      Number(req.query.minPct      ?? 0.5),
    minEpisodes: Number(req.query.minEpisodes ?? 3),
  };

  const limit = period + 300;
  try {
    const candles = await fetchCandlesForEval(exchange, symbol, interval, limit);
    const report  = suggestAdaptiveDip(candles, period, interval, adaptiveOpts);
    res.json({ symbol, exchange, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /multitrade-suggest-extension-above?symbol=&exchange=&maPeriod=50&maInterval=1h&entryInterval=15m&...
router.get('/multitrade-suggest-extension-above', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const tradeConfig = buildTradeConfig({
    entryRsi: {
      interval: req.query.entryInterval ?? '15m',
      period:   Number(req.query.entryPeriod ?? 14),
      operator: req.query.entryOperator ?? '<',
      value:    Number(req.query.entryValue ?? 30),
    },
    exitRsi: {
      interval: req.query.exitInterval ?? req.query.entryInterval ?? '15m',
      period:   Number(req.query.exitPeriod ?? req.query.entryPeriod ?? 14),
      operator: req.query.exitOperator ?? '>',
      value:    Number(req.query.exitValue ?? 70),
    },
    maConditions: req.query.maConditions
      ? JSON.parse(req.query.maConditions)
      : undefined,
    extension: {
      enabled:       true,
      maPeriod:      Number(req.query.maPeriod ?? 50),
      maInterval:    req.query.maInterval ?? '1h',
      abovePct:      Number(req.query.abovePct ?? 5),
      threeInterval: req.query.threeInterval ?? '1h',
      fourInterval:  req.query.fourInterval ?? '1h',
      threeCandles:  req.query.threeCandles !== 'false',
      fourCandles:   req.query.fourCandles !== 'false',
      confirmLogic:  req.query.confirmLogic ?? 'any',
    },
    stopLoss: { enabled: req.query.stopLossEnabled !== 'false' },
  });

  const specs = getRequiredSpecs(tradeConfig);
  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, Math.max(limit, 500));
    }));

    const report = buildExtensionAboveReport(cMap, tradeConfig);
    res.json({ symbol, exchange, abovePct: report.suggestedAbovePct, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /multitrade-suggest-exit-rsi?symbol=&exchange=&exitInterval=15m&exitPeriod=14&...
router.get('/multitrade-suggest-exit-rsi', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const tradeConfig = buildTradeConfig({
    entryRsi: {
      interval: req.query.entryInterval ?? '15m',
      period:   Number(req.query.entryPeriod ?? 14),
      operator: req.query.entryOperator ?? '<',
      value:    Number(req.query.entryValue ?? 30),
    },
    exitRsi: {
      interval: req.query.exitInterval ?? '15m',
      period:   Number(req.query.exitPeriod ?? 14),
      operator: req.query.exitOperator ?? '>',
      value:    Number(req.query.exitValue ?? 70),
    },
    maConditions: req.query.maConditions ? JSON.parse(req.query.maConditions) : undefined,
    extension:    req.query.extension ? JSON.parse(req.query.extension) : undefined,
    stopLoss:     { enabled: req.query.stopLossEnabled !== 'false' },
  });

  const specs = getRequiredSpecs(tradeConfig);
  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, Math.max(limit, 500));
    }));

    const report = buildExitRsiReport(cMap, tradeConfig);
    res.json({
      symbol,
      exchange,
      exitRsiValue: report.suggestedExitRsi,
      ...report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseMultitradeSuggestQuery(query) {
  return buildTradeConfig({
    entryRsi: {
      interval: query.entryInterval ?? '15m',
      period:   Number(query.entryPeriod ?? 14),
      operator: query.entryOperator ?? '<',
      value:    Number(query.entryValue ?? 30),
    },
    exitRsi: {
      interval: query.exitInterval ?? query.entryInterval ?? '15m',
      period:   Number(query.exitPeriod ?? query.entryPeriod ?? 14),
      operator: query.exitOperator ?? '>',
      value:    Number(query.exitValue ?? 70),
    },
    entryRsiPath: query.entryRsiPath ? JSON.parse(query.entryRsiPath) : undefined,
    entryMa:        query.entryMa ? JSON.parse(query.entryMa) : undefined,
    maConditions:   query.maConditions ? JSON.parse(query.maConditions) : undefined,
    extension:      query.extension ? JSON.parse(query.extension) : undefined,
    stopLoss:       { enabled: query.stopLossEnabled !== 'false' },
  });
}

// GET /multitrade-suggest-entry-rsi?symbol=&exchange=&entryValue=30&...
router.get('/multitrade-suggest-entry-rsi', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange    = req.query.exchange ?? 'binance';
  const tradeConfig = parseMultitradeSuggestQuery(req.query);
  const specs       = getRequiredSpecs(tradeConfig);

  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, Math.max(limit, 500));
    }));

    const report = buildEntryRsiReport(cMap, tradeConfig);
    const { sweep, ...rest } = report;
    res.json({
      symbol,
      exchange,
      entryRsiValue: report.suggestedEntryRsi,
      sweepSummary: sweep?.map(s => ({
        value: s.value, tradeCount: s.tradeCount, avgPnl: s.avgPnl, winRate: s.winRate,
      })),
      ...rest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /multitrade-suggest-entry-ma?symbol=&exchange=&entryMa={...}&...
router.get('/multitrade-suggest-entry-ma', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange    = req.query.exchange ?? 'binance';
  const tradeConfig = parseMultitradeSuggestQuery(req.query);
  if (!tradeConfig.entryMa?.enabled) {
    tradeConfig.entryMa = { ...tradeConfig.entryMa, enabled: true };
  }
  tradeConfig.entryRsiPath = { enabled: false };

  const specs = getRequiredSpecs(tradeConfig);
  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, Math.max(limit, 500));
    }));

    const report = buildEntryMaReport(cMap, tradeConfig);
    const { sweep, rsiSweep, ...rest } = report;
    res.json({
      symbol,
      exchange,
      trigger: report.suggestedTrigger,
      tolerancePct: report.suggestedTolerancePct,
      maRsiValue: report.suggestedMaRsi,
      sweepSummary: sweep?.map(s => ({
        trigger: s.trigger, tolerancePct: s.tolerancePct,
        tradeCount: s.tradeCount, avgPnl: s.avgPnl, winRate: s.winRate,
      })),
      rsiSweepSummary: rsiSweep?.map(s => ({
        value: s.value, tradeCount: s.tradeCount, avgPnl: s.avgPnl,
      })),
      ...rest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function fetchCandlesForEval(exchange, symbol, interval, limit) {
  if (exchange === 'gate') {
    const pair = toGateSymbol(symbol);
    return fetchGateCandles(pair, limit, interval);
  }
  return fetchBinanceCandles(symbol, limit, interval);
}

// GET /services/sb/multitrade-backtest?symbol=ARUSDT&exchange=binance&capital=40
router.get('/multitrade-backtest', getUserId, async (req, res) => {
  const sym = req.query.symbol?.toUpperCase();
  if (!sym) return res.status(400).json({ error: 'symbol obrigatório' });

  const { data, error } = await supabase
    .from('multitrade_favorites')
    .select('*')
    .eq('user_id', req.userId)
    .eq('symbol', sym)
    .maybeSingle();

  if (error) return sbError(res, error, 'GET multitrade-backtest');
  if (!data) return res.status(404).json({ error: 'Moeda não está no Multi-Trade' });

  const entry    = multitradeToEntry(data);
  const config   = entry.tradeConfig ?? toEngineConfig(normalizeTradeConfig(entry));
  const exchange = req.query.exchange ?? entry.exchange ?? 'binance';
  const capital  = Number(req.query.capital ?? entry.capital ?? 40);

  try {
    const result = await runAmapBacktest({ symbol: sym, config, exchange, capital });
    if (result.error) return res.status(502).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /services/sb/multitrade-evaluate  — snapshot ao vivo da config AMAP
router.post('/multitrade-evaluate', getUserId, async (req, res) => {
  const sym = req.body?.symbol?.toUpperCase();
  if (!sym) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange    = req.body.exchange ?? 'binance';
  const tradeConfig = buildTradeConfig(req.body);
  const specs       = getRequiredSpecs(tradeConfig);

  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, sym, interval, Math.max(limit, 300));
    }));

    const entryIv = tradeConfig.entryRsi.interval;
    const entryCandles = cMap[entryIv];
    if (!entryCandles?.length) return res.status(502).json({ error: 'sem candles' });

    const ti = require('technicalindicators');
    const closes = entryCandles.map(c => c.close);
    const rsiArr = ti.RSI.calculate({ values: closes, period: tradeConfig.entryRsi.period });
    const entryRsi = rsiArr[rsiArr.length - 1];
    const close = closes[closes.length - 1];
    const adaptiveDips = computeAdaptiveDips(cMap, tradeConfig);
    const maSnap = buildMaSnapshot(cMap, tradeConfig);
    const entryCheck = evaluateEntry({
      entryRsi, close, entryTimeMs: Date.now(), config: tradeConfig, maSnap, adaptiveDips, cMap,
    });
    const adaptive = buildAdaptiveReport(cMap, tradeConfig);
    const entryDiscountSuggest = buildEntryDiscountReport(cMap, tradeConfig);

    res.json({
      symbol: sym,
      exchange,
      tradeConfig,
      price: close,
      entryRsi,
      entryAllowed: entryCheck.allowed,
      entryBlockReason: entryCheck.reason ?? null,
      adaptive,
      entryDiscountSuggest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  USER PREFS
// ============================================================

const PREFS_DEFAULTS = {
  intervals:        ['30m', '4h', '8h'],
  chartInterval:    '30m',
  recentIndicators: [],
};

// GET /services/sb/user-prefs
router.get('/user-prefs', getUserId, async (req, res) => {
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('intervals, chart_interval')
    .eq('id', req.userId)
    .single();
  if (pErr) return sbError(res, pErr, 'GET user-prefs profile');

  const { data: recents, error: rErr } = await supabase
    .from('recent_indicators')
    .select('key, config, use_count, last_used')
    .eq('user_id', req.userId)
    .order('use_count', { ascending: false })
    .limit(30);
  if (rErr) return sbError(res, rErr, 'GET user-prefs recents');

  res.json({
    intervals:        profile?.intervals     ?? PREFS_DEFAULTS.intervals,
    chartInterval:    profile?.chart_interval ?? PREFS_DEFAULTS.chartInterval,
    recentIndicators: (recents ?? []).map(r => ({
      key:      r.key,
      config:   r.config,
      count:    r.use_count,
      lastUsed: r.last_used,
    })),
  });
});

// POST /services/sb/user-prefs  { intervals?, chartInterval?, indicator? }
router.post('/user-prefs', getUserId, async (req, res) => {
  const { intervals, chartInterval, indicator } = req.body ?? {};

  // Atualiza intervals / chartInterval no profile
  const profileUpdates = {};
  if (Array.isArray(intervals))            profileUpdates.intervals      = intervals;
  if (typeof chartInterval === 'string')   profileUpdates.chart_interval  = chartInterval;
  if (Object.keys(profileUpdates).length) {
    profileUpdates.updated_at = new Date().toISOString();
    const { error } = await supabase.from('profiles').update(profileUpdates).eq('id', req.userId);
    if (error) return sbError(res, error, 'POST user-prefs profile');
  }

  // Registra indicador recente (upsert incrementa contador)
  if (indicator) {
    const key = JSON.stringify({ type: indicator.type, ...indicator });
    const { error } = await supabase.from('recent_indicators').upsert(
      { user_id: req.userId, key, config: indicator, use_count: 1, last_used: new Date().toISOString() },
      {
        onConflict:    'user_id,key',
        ignoreDuplicates: false,
      }
    );
    // Se já existia, incrementa contador via RPC (evita race condition)
    if (!error) {
      try {
        await supabase.rpc('increment_indicator_count', { p_user_id: req.userId, p_key: key });
      } catch {} // RPC opcional; sem ela o count fica estático em 1
    } else {
      console.warn('[supabase] upsert recent_indicators:', error.message);
    }
  }

  // Retorna prefs atualizadas (reutiliza o GET)
  const { data: profile } = await supabase
    .from('profiles').select('intervals, chart_interval').eq('id', req.userId).single();
  const { data: recents } = await supabase
    .from('recent_indicators').select('key, config, use_count, last_used')
    .eq('user_id', req.userId).order('use_count', { ascending: false }).limit(30);

  res.json({
    intervals:        profile?.intervals      ?? PREFS_DEFAULTS.intervals,
    chartInterval:    profile?.chart_interval  ?? PREFS_DEFAULTS.chartInterval,
    recentIndicators: (recents ?? []).map(r => ({
      key:      r.key,
      config:   r.config,
      count:    r.use_count,
      lastUsed: r.last_used,
    })),
  });
});

// Captura erros assíncronos que escapam dos handlers (Express 4 não faz isso automaticamente).
// Sem este handler, um throw dentro de um async route crasharia o processo inteiro.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[supabase] erro não tratado:', err.message);
  res.status(500).json({ error: err.message });
});

module.exports = router;
