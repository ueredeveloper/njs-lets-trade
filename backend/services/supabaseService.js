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
const { analyzeAdaptiveDip, analyzeAdaptiveStretch } = require('../bot/amap/adaptiveMaDip');
const supabase  = require('../supabase/client');
const { buildTradeConfig, buildAdaptiveReport, suggestAdaptiveDip, buildEntryDiscountReport, getRequiredSpecs, buildMaSnapshot, evaluateEntry, computeAdaptiveDips } = require('../bot/amap/strategyEngine');
const { buildExtensionAboveReport } = require('../bot/amap/suggestExtensionAbovePct');
const { buildExitRsiReport } = require('../bot/amap/suggestExitRsi');
const { buildEntryRsiReport } = require('../bot/amap/suggestEntryRsi');
const { buildEntryMaReport } = require('../bot/amap/suggestEntryMa');
const { runAmapBacktest } = require('../bot/amap/amapBacktest');
const { runMaCrossBacktest } = require('../bot/ma-cross/maCrossBacktest');
const { runVwapBandsBacktest } = require('../bot/vwap-bands/vwapBandsBacktest');
const { resolveConfigBody: amapResolveConfigBody, normalizeStrategyId: amapNormStrategyId } = require('../bot/amap/strategyPresets');
const {
  isSwingStrategy, resolveConfigBody: swingResolveConfigBody, buildTradeConfig: buildSwingTradeConfig,
} = require('../bot/swing/strategyPresets');
const {
  isMaCrossStrategy, resolveConfigBody: maCrossResolveConfigBody, buildTradeConfig: buildMaCrossTradeConfig,
} = require('../bot/ma-cross/strategyPresets');
const {
  isVwapBandsStrategy, resolveConfigBody: vwapBandsResolveConfigBody, buildTradeConfig: buildVwapBandsTradeConfig,
} = require('../bot/vwap-bands/strategyPresets');
const { toFormState: vwapBandsToFormState, normalizeVwapBandsConfig } = require('../bot/vwap-bands/tradeConfigSchema');
const {
  isBollingerBandsStrategy, resolveConfigBody: bollingerBandsResolveConfigBody, buildTradeConfig: buildBollingerBandsTradeConfig,
} = require('../bot/bollinger-bands/strategyPresets');
const { toFormState: bollingerBandsToFormState, normalizeBollingerBandsConfig } = require('../bot/bollinger-bands/tradeConfigSchema');
const {
  isRsiMomentumStrategy, resolveConfigBody: rsiMomentumResolveConfigBody, buildTradeConfig: buildRsiMomentumTradeConfig,
} = require('../bot/rsi-momentum/strategyPresets');
const { toFormState: rsiMomentumToFormState, normalizeRsiMomentumConfig } = require('../bot/rsi-momentum/tradeConfigSchema');
const { toFormState: swingToFormState, normalizeSwingConfig, toAmapSuggestConfig } = require('../bot/swing/tradeConfigSchema');
const { toFormState: maCrossToFormState, normalizeMaCrossConfig } = require('../bot/ma-cross/tradeConfigSchema');
const { getRequiredSpecs: getMaCrossRequiredSpecs } = require('../bot/ma-cross/strategyEngine');
const { buildMaCrossBoundsReport } = require('../bot/ma-cross/suggestMaCrossFilterBounds');
const { getRequiredSpecs: getSwingRequiredSpecs } = require('../bot/swing/strategyEngine');
const { toFormState, normalizeTradeConfig, flatConfigToBody, toEngineConfig } = require('../bot/amap/tradeConfigSchema');
const { fetchBinanceCandles, fetchGateCandles } = require('../bot/prices');
const fetchKlines = require('../binance/fetchKlines');
const { toGateSymbol } = require('../utils/toGateSymbol');
const { fetch24hVolumeUsdt, fmtVolumeUsdt, DEFAULT_MIN_VOLUME_USDT } = require('../bot/volume24h');
const getBinanceClient = require('../binance/getClient');
const { gateMarketBuy, gatePlaceRestingLimitBuy } = require('../gate/gateMarketBuy');
const { binancePlaceRestingLimitBuy } = require('../binance/tradeClient');
const { getAvgPrice } = require('../binance/ocoClient');
const { gateLastPrice } = require('../gate/gateAccount');
const { buildAdapter: buildTradeAdapter, syncExchangeClocks } = require('../bot/shared/buildAdapter');

// Mesmo buffer conservador aplicado pelos bots (ma-cross-bot.js) na quantidade "utilizável"
// após a compra, pra sobrar margem de segurança na hora de vender (taxa + arredondamento).
const GATE_FEE_RATE_BUFFER = 0.002;

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
  if (/ma_filters.*schema cache/i.test(msg)) {
    return res.status(500).json({
      error: msg,
      hint: 'Execute supabase/add-five-min-bot-columns.sql no SQL Editor do Supabase.',
    });
  }
  if (/rsi_buy.*schema cache/i.test(msg) || /rsi_sell.*schema cache/i.test(msg)) {
    return res.status(500).json({
      error: msg,
      hint: 'Execute supabase/add-five-min-bot-columns.sql no SQL Editor do Supabase.',
    });
  }
  if (/curated.*schema cache/i.test(msg) || /column .*curated/i.test(msg)) {
    return res.status(500).json({
      error: msg,
      hint: 'Execute supabase/add-rsi-momentum-curated-column.sql no SQL Editor do Supabase.',
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

function normStrategyId(id) {
  if (isMaCrossStrategy(id)) return id;
  if (isSwingStrategy(id)) return id;
  if (isVwapBandsStrategy(id)) return id;
  if (isBollingerBandsStrategy(id)) return id;
  if (isRsiMomentumStrategy(id)) return id;
  return amapNormStrategyId(id);
}

function resolveConfigBody(r) {
  if (isMaCrossStrategy(r?.strategy_id)) return maCrossResolveConfigBody(r);
  if (isSwingStrategy(r?.strategy_id)) return swingResolveConfigBody(r);
  if (isVwapBandsStrategy(r?.strategy_id)) return vwapBandsResolveConfigBody(r);
  if (isBollingerBandsStrategy(r?.strategy_id)) return bollingerBandsResolveConfigBody(r);
  if (isRsiMomentumStrategy(r?.strategy_id)) return rsiMomentumResolveConfigBody(r);
  return amapResolveConfigBody(r);
}

function multitradeToEntry(r) {
  const sid = normStrategyId(r.strategy_id);
  const configBody = resolveConfigBody(r);

  if (isMaCrossStrategy(sid)) {
    const tc = buildMaCrossTradeConfig(configBody);
    const form = maCrossToFormState(configBody);
    return {
      id:           r.id,
      symbol:       r.symbol,
      exchange:     r.exchange,
      strategyId:   sid,
      enabled:      r.enabled !== false,
      capital:      Number(r.capital),
      entry:        form.entry,
      exit:         form.exit,
      maFilters:    form.maFilters,
      maFiltersEnabled: form.maFiltersEnabled,
      stopLoss:     form.stopLoss,
      execution:    form.execution,
      polling:      form.polling,
      adaptiveOpts: form.adaptiveOpts,
      volume:       form.volume,
      tradeConfig:  tc,
      kind:         form.kind,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
    };
  }

  if (isSwingStrategy(sid)) {
    const tc = buildSwingTradeConfig(configBody);
    const form = swingToFormState(configBody);
    return {
      id:           r.id,
      symbol:       r.symbol,
      exchange:     r.exchange,
      strategyId:   sid,
      enabled:      r.enabled !== false,
      capital:      Number(r.capital),
      entryRsi:     form.entryRsi,
      exitRsi:      form.exitRsi,
      entryMaFilter: form.entryMaFilter,
      entryMa:      form.entryMa,
      stopLoss:     form.stopLoss,
      execution:    form.execution,
      polling:      form.polling,
      volume:       form.volume,
      tradeConfig:  tc,
      kind:         form.kind,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
    };
  }

  if (isVwapBandsStrategy(sid)) {
    const tc = buildVwapBandsTradeConfig(configBody);
    const form = vwapBandsToFormState(configBody);
    return {
      id:           r.id,
      symbol:       r.symbol,
      exchange:     r.exchange,
      strategyId:   sid,
      enabled:      r.enabled !== false,
      capital:      Number(r.capital),
      entry:        form.entry,
      exit:         form.exit,
      stopLoss:     form.stopLoss,
      execution:    form.execution,
      polling:      form.polling,
      volume:       form.volume,
      tradeConfig:  tc,
      kind:         form.kind,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
    };
  }

  if (isBollingerBandsStrategy(sid)) {
    const tc = buildBollingerBandsTradeConfig(configBody);
    const form = bollingerBandsToFormState(configBody);
    return {
      id:           r.id,
      symbol:       r.symbol,
      exchange:     r.exchange,
      strategyId:   sid,
      enabled:      r.enabled !== false,
      capital:      Number(r.capital),
      entry:        form.entry,
      exit:         form.exit,
      stopLoss:     form.stopLoss,
      polling:      form.polling,
      volume:       form.volume,
      tradeConfig:  tc,
      kind:         form.kind,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
    };
  }

  if (isRsiMomentumStrategy(sid)) {
    const tc = buildRsiMomentumTradeConfig(configBody);
    const form = rsiMomentumToFormState(configBody);
    return {
      id:           r.id,
      symbol:       r.symbol,
      exchange:     r.exchange,
      strategyId:   sid,
      enabled:      r.enabled !== false,
      capital:      Number(r.capital),
      entry:        form.entry,
      exit:         form.exit,
      stopLoss:     form.stopLoss,
      polling:      form.polling,
      volume:       form.volume,
      tradeConfig:  tc,
      kind:         form.kind,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
    };
  }

  const tc = buildTradeConfig(configBody);
  const form = toFormState(configBody);

  return {
    id:           r.id,
    symbol:       r.symbol,
    exchange:     r.exchange,
    strategyId:   sid,
    enabled:      r.enabled !== false,
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
    rule1:        form.rule1 ?? tc?.rule1,
    rule2:        form.rule2 ?? tc?.rule2,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

function resolveStrategyId(body) {
  const raw = body.strategyId ?? body.strategy_id ?? 'amap-15m';
  if (raw === 'flex') return 'amap-15m';
  return raw;
}

function bodyToMultitradeRow(userId, body) {
  const sym = body.symbol?.toUpperCase();
  if (!sym) return null;
  const sid = resolveStrategyId(body);
  const maCrossSave = isMaCrossStrategy(sid) || body.kind === 'ma_cross';

  if (maCrossSave) {
    const strategy_id = isMaCrossStrategy(sid) ? sid : 'ma-cross';
    const normalized = normalizeMaCrossConfig(body);
    const trade_config = buildMaCrossTradeConfig(body);
    const maConds = (normalized.maFilters ?? []).filter(f => f.enabled && f.mode !== 'off');
    return {
      user_id:         userId,
      symbol:          sym,
      exchange:        body.exchange ?? 'binance',
      strategy_id,
      enabled:         body.enabled !== false,
      capital:         Number(body.capital ?? 100),
      entry_rsi:       { interval: normalized.entry.ma1.interval, period: 14, operator: '<', value: 30 },
      exit_rsi:        { interval: normalized.exit.maCross.ma1.interval, period: 14, operator: '>', value: 70 },
      ma_conditions:   maConds.map(f => ({
        mode: f.mode, period: f.period, interval: f.interval, fixedDipPct: f.fixedDipPct,
      })),
      rule_3_candles:  false,
      rule_4_candles:  false,
      trade_config,
    };
  }

  if (isSwingStrategy(sid)) {
    const normalized = normalizeSwingConfig(body);
    const trade_config = buildSwingTradeConfig(body);
    return {
      user_id:         userId,
      symbol:          sym,
      exchange:        body.exchange ?? 'binance',
      strategy_id:     sid,
      enabled:         body.enabled !== false,
      capital:         Number(body.capital ?? 100),
      entry_rsi:       normalized.entryRsi,
      exit_rsi:        normalized.exitRsi,
      ma_conditions:   normalized.entryMaFilter?.enabled
        ? [{ mode: normalized.entryMaFilter.mode, period: normalized.entryMaFilter.period, interval: normalized.entryMaFilter.interval }]
        : [],
      rule_3_candles:  false,
      rule_4_candles:  false,
      trade_config,
    };
  }

  if (isVwapBandsStrategy(sid)) {
    const normalized = normalizeVwapBandsConfig(body);
    const trade_config = buildVwapBandsTradeConfig(body);
    return {
      user_id:         userId,
      symbol:          sym,
      exchange:        body.exchange ?? 'binance',
      strategy_id:     sid,
      enabled:         body.enabled !== false,
      capital:         Number(body.capital ?? 100),
      entry_rsi:       { interval: normalized.entry.interval, period: 14, operator: '<', value: 30 },
      exit_rsi:        { interval: normalized.entry.interval, period: 14, operator: '>', value: 70 },
      ma_conditions:   [],
      rule_3_candles:  false,
      rule_4_candles:  false,
      trade_config,
    };
  }

  if (isBollingerBandsStrategy(sid)) {
    const normalized = normalizeBollingerBandsConfig(body);
    const trade_config = buildBollingerBandsTradeConfig(body);
    return {
      user_id:         userId,
      symbol:          sym,
      exchange:        body.exchange ?? 'binance',
      strategy_id:     sid,
      enabled:         body.enabled !== false,
      capital:         Number(body.capital ?? 100),
      entry_rsi:       { interval: normalized.entry.interval, period: 14, operator: '<', value: 30 },
      exit_rsi:        { interval: normalized.entry.interval, period: 14, operator: '>', value: 70 },
      ma_conditions:   [],
      rule_3_candles:  false,
      rule_4_candles:  false,
      trade_config,
    };
  }

  if (isRsiMomentumStrategy(sid)) {
    const normalized = normalizeRsiMomentumConfig(body);
    const trade_config = buildRsiMomentumTradeConfig(body);
    return {
      user_id:         userId,
      symbol:          sym,
      exchange:        body.exchange ?? 'binance',
      strategy_id:     sid,
      enabled:         body.enabled !== false,
      capital:         Number(body.capital ?? 100),
      entry_rsi:       { interval: normalized.entry.interval, period: 14, operator: '>', value: normalized.entry.rsiThreshold },
      exit_rsi:        { interval: normalized.entry.interval, period: 14, operator: '>', value: normalized.entry.rsiThreshold },
      ma_conditions:   [],
      rule_3_candles:  false,
      rule_4_candles:  false,
      trade_config,
    };
  }

  const normalized = normalizeTradeConfig(body);
  const trade_config = buildTradeConfig(body);
  return {
    user_id:         userId,
    symbol:          sym,
    exchange:        body.exchange ?? 'binance',
    strategy_id:     resolveStrategyId(body),
    enabled:         body.enabled !== false,
    capital:         Number(body.capital ?? 100),
    entry_rsi:       normalized.entryRsi,
    exit_rsi:        normalized.exitRsi,
    ma_conditions:   normalized.maConditions,
    rule_3_candles:  !!normalized.extension.threeCandles,
    rule_4_candles:  !!normalized.extension.fourCandles,
    trade_config,
  };
}

async function syncBotState({ symbol, exchange, strategy_id, capital, trade_config, enabled }) {
  if (enabled === false) {
    const { error } = await supabase
      .from('rsi_multi_bot_state')
      .delete()
      .eq('symbol', symbol)
      .eq('strategy_id', strategy_id)
      .eq('phase', 'WATCHING');
    if (error) console.warn('[supabase] syncBotState disable:', error.message);
    return;
  }
  const { data: existing } = await supabase
    .from('rsi_multi_bot_state')
    .select('id')
    .eq('symbol', symbol)
    .eq('strategy_id', strategy_id)
    .maybeSingle();
  const row = {
    symbol, exchange, strategy_id, initial_capital: capital, capital, trade_config,
  };
  if (existing?.id) {
    const { error } = await supabase
      .from('rsi_multi_bot_state')
      .update({ exchange, capital, trade_config })
      .eq('id', existing.id);
    if (error) console.warn('[supabase] syncBotState update:', error.message);
    return;
  }
  const { error } = await supabase.from('rsi_multi_bot_state').insert({ ...row, phase: 'WATCHING' });
  if (error) console.warn('[supabase] syncBotState insert:', error.message);
}

/** rules_state vem como JSON (ou string JSON) do Supabase — ver parseRulesState em
 *  backend/bot/shared/tradeExecution.js. Só nos interessa activeSetup aqui (degrau
 *  vwap-bands que gerou a compra: touchLevel = nível do stop estrutural, targetLevel =
 *  nível de venda), pra mostrar os quadrados de compra→alvo/stoploss no gráfico com o
 *  nível real da escada em vez de um % genérico do ma-cross. */
function parseActiveSetup(rulesState) {
  let rs = rulesState;
  if (typeof rs === 'string') {
    try { rs = JSON.parse(rs); } catch { return null; }
  }
  return rs?.activeSetup ?? null;
}

/** Bracket TP/SL REAL colocado na corretora (ver placeExitBracket em buildAdapter.js —
 *  OCO atômico na Binance, duas price_orders na Gate.io), gravado em rules_state.exitBracket
 *  por vwap-bands-bot.js/bollinger-bands-bot.js. Exposto pro frontend desenhar os quadrados
 *  verde/vermelho do gráfico com o preço REAL da ordem resting, em vez de só recalcular a
 *  banda/degrau ao vivo (que diverge do preço travado na corretora até o bot substituir a
 *  ordem — ver maybeReplaceBracket). */
function parseExitBracket(rulesState) {
  let rs = rulesState;
  if (typeof rs === 'string') {
    try { rs = JSON.parse(rs); } catch { return null; }
  }
  const eb = rs?.exitBracket;
  if (!eb || !Number.isFinite(Number(eb.targetPrice)) || !Number.isFinite(Number(eb.stopPrice))) return null;
  return { targetPrice: Number(eb.targetPrice), stopPrice: Number(eb.stopPrice) };
}

/** Ordem limite GTC armada aguardando reteste (bollinger-bands-bot.js placeRestingLimitBuy),
 *  gravada em rules_state.entryLimit. Esse bot não tem fase PENDING (só WATCHING → BOUGHT —
 *  ver comentário no topo de bollinger-bands-bot.js), então sem isso o toque na banda que já
 *  armou a compra ficava sem seta de sinal no gráfico (só ma-cross/vwap-bands, que usam
 *  PENDING, ganhavam a seta antes de comprar — ver buildMarkersFromLiveTrades). */
function parseEntryLimit(rulesState) {
  let rs = rulesState;
  if (typeof rs === 'string') {
    try { rs = JSON.parse(rs); } catch { return null; }
  }
  const el = rs?.entryLimit;
  if (!el || !Number.isFinite(Number(el.signalOpenTime))) return null;
  return {
    signalOpenTime: Number(el.signalOpenTime),
    signalPrice: el.signalPrice != null ? Number(el.signalPrice) : null,
    price: el.price != null ? Number(el.price) : null,
    entryDesc: el.entryDesc ?? null,
  };
}

async function enrichMultitradeEntriesWithState(entries) {
  if (!entries?.length) return entries ?? [];
  const symbols = [...new Set(entries.map(e => e.symbol))];
  const { data: states, error } = await supabase
    .from('rsi_multi_bot_state')
    .select('symbol, strategy_id, phase, buy_time, buy_price, buy_qty, entry_signal_time, entry_signal_price, rules_state')
    .in('symbol', symbols);
  if (error) {
    console.warn('[supabase] enrichMultitradeEntriesWithState:', error.message);
    return entries;
  }
  const stateByKey = new Map(
    (states ?? []).map(s => [`${s.symbol}|${normStrategyId(s.strategy_id)}`, s]),
  );
  return entries.map(e => {
    const st = stateByKey.get(`${e.symbol}|${e.strategyId}`);
    return {
      ...e,
      phase:      st?.phase ?? 'WATCHING',
      buyTime:    st?.buy_time ?? null,
      buyPrice:   st?.buy_price != null ? Number(st.buy_price) : null,
      buyQty:     st?.buy_qty != null ? Number(st.buy_qty) : null,
      buyUsdt:    st?.buy_usdt != null ? Number(st.buy_usdt) : null,
      entrySignalTime:  st?.entry_signal_time ?? null,
      entrySignalPrice: st?.entry_signal_price != null ? Number(st.entry_signal_price) : null,
      activeSetup: parseActiveSetup(st?.rules_state),
      exitBracket: parseExitBracket(st?.rules_state),
      entryLimit: parseEntryLimit(st?.rules_state),
    };
  });
}

async function enrichSingleMultitradeEntry(entry) {
  const [enriched] = await enrichMultitradeEntriesWithState([entry]);
  return enriched ?? entry;
}

function buildBotStatePatch(phase, { buyPrice, buyQty, buyTime, buyUsdt } = {}) {
  const update = { phase, updated_at: new Date().toISOString() };
  if (phase === 'WATCHING') {
    Object.assign(update, {
      buy_price: null, buy_qty: null, buy_usdt: null, buy_time: null, rsi_entry: null,
      trigger_price: null, trigger_rsi: null, limit_price: null, pending_since: null,
    });
    return update;
  }
  if (phase === 'BOUGHT') {
    const price = Number(buyPrice);
    const qty   = Number(buyQty);
    if (!Number.isFinite(price) || price <= 0) throw new Error('buyPrice inválido');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('buyQty inválido');
    if (!buyTime) throw new Error('buyTime obrigatório para BOUGHT');
    const usdt = buyUsdt != null ? Number(buyUsdt) : price * qty;
    Object.assign(update, {
      buy_price: price, buy_qty: qty, buy_time: buyTime, buy_usdt: usdt,
      trigger_price: null, trigger_rsi: null, limit_price: null, pending_since: null,
    });
    return update;
  }
  throw new Error('phase deve ser WATCHING ou BOUGHT');
}

// Fecha em rsi_multi_bot_trades o trade que uma venda MANUAL (botão "Vender" do painel —
// ver MultitradeSellModal/MultitradePanel) está prestes a apagar de rsi_multi_bot_state.
// Sem isso, `buildBotStatePatch('WATCHING')` zera buy_price/buy_qty e o trade desaparece
// do histórico/PnL do favorito, mesmo tendo sido executado de verdade na corretora — mesmo
// bug que faz o bot achar "posição órfã" quando a venda acontece fora do tick dele.
// `sell` vem da resposta real da ordem (ver extractSellFill em MultitradePanel.jsx).
async function recordManualSellTrade({ existing, fav, symbol, strategyId, sell, exitTime }) {
  const buyPrice = existing.buy_price != null ? Number(existing.buy_price) : null;
  const buyQty   = existing.buy_qty   != null ? Number(existing.buy_qty)   : null;
  if (buyPrice == null || buyQty == null) return null;
  const buyUsdt = existing.buy_usdt != null ? Number(existing.buy_usdt) : buyPrice * buyQty;

  const exitPrice = Number(sell?.exitPrice);
  const soldQty    = Number(sell?.soldQty);
  const usdtOut    = Number.isFinite(Number(sell?.usdtOut)) ? Number(sell.usdtOut) : exitPrice * soldQty;
  if (!Number.isFinite(exitPrice) || exitPrice <= 0 || !Number.isFinite(soldQty) || soldQty <= 0 || !Number.isFinite(usdtOut) || usdtOut <= 0) {
    return null;
  }

  const capitalBefore = Number(existing.capital ?? fav.capital ?? 0);
  const pnlUsdt  = usdtOut - buyUsdt;
  const pnlPct   = capitalBefore > 0 ? (pnlUsdt / capitalBefore) * 100 : null;
  const capitalAfter = capitalBefore + pnlUsdt;

  const { error } = await supabase.from('rsi_multi_bot_trades').insert({
    symbol, exchange: fav.exchange, strategy_id: strategyId,
    entry_time: existing.buy_time, exit_time: exitTime,
    entry_price: buyPrice, exit_price: exitPrice,
    qty: soldQty, usdt_in: buyUsdt, usdt_out: usdtOut,
    pnl_usdt: pnlUsdt, pnl_pct: pnlPct != null ? Number(pnlPct.toFixed(2)) : null,
    capital_before: capitalBefore, capital_after: capitalAfter,
    rsi_entry: existing.rsi_entry != null ? Number(existing.rsi_entry) : null,
    exit_reason: 'MANUAL_SELL',
  });
  if (error) throw new Error(`falha ao gravar trade manual em rsi_multi_bot_trades: ${error.message}`);
  return { capitalAfter };
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
  const entries = await enrichMultitradeEntriesWithState((data ?? []).map(multitradeToEntry));
  res.json(entries);
});

// GET /services/sb/bot-state?symbol= — estado ao vivo do bot (rsi_multi_bot_state) pra
// QUALQUER símbolo que o bot esteja operando, mesmo sem favorito ativo em
// multitrade_favorites. Precisa existir separado do /multitrade-favorites acima porque um
// símbolo pode ter sido desfavoritado no meio de um ciclo PENDING/BOUGHT — o DELETE
// /multitrade-favorites/:id só apaga o rsi_multi_bot_state quando phase é WATCHING (linha
// ~830), então o bot segue rodando o ciclo até fechar mesmo sem favorito. Sem isso, o
// gráfico de uma "moeda comum" (fora da lista de favoritos, ver CurrencyTable.jsx) não tinha
// como saber a fase/sinal ao vivo pra desenhar a seta de PENDING/compra (ver conversa com o
// usuário sobre EPICUSDT/LAUSDT — vwap-bands, PENDING, sem linha em multitrade_favorites).
// Sem filtro de user_id: rsi_multi_bot_state não tem essa coluna (é estado do bot, não de
// favorito por usuário) — mesmo padrão de /multitrade-trades e /multitrade-timeline abaixo.
router.get('/bot-state', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const { data, error } = await supabase
    .from('rsi_multi_bot_state')
    .select('symbol, strategy_id, phase, buy_time, buy_price, buy_qty, entry_signal_time, entry_signal_price, rules_state')
    .eq('symbol', symbol);
  if (error) return sbError(res, error, 'GET bot-state');

  const entries = (data ?? []).map(st => ({
    symbol: st.symbol,
    strategyId: normStrategyId(st.strategy_id),
    phase: st.phase ?? 'WATCHING',
    buyTime: st.buy_time ?? null,
    buyPrice: st.buy_price != null ? Number(st.buy_price) : null,
    buyQty: st.buy_qty != null ? Number(st.buy_qty) : null,
    entrySignalTime: st.entry_signal_time ?? null,
    entrySignalPrice: st.entry_signal_price != null ? Number(st.entry_signal_price) : null,
    entryLimit: parseEntryLimit(st.rules_state),
  }));
  res.json(entries);
});

// POST /services/sb/multitrade-favorites
router.post('/multitrade-favorites', getUserId, async (req, res) => {
  const row = bodyToMultitradeRow(req.userId, req.body);
  if (!row) return res.status(400).json({ error: 'symbol obrigatório' });

  const { data, error } = await supabase
    .from('multitrade_favorites')
    .upsert(row, { onConflict: 'user_id,symbol,strategy_id' })
    .select()
    .single();
  if (error) return sbError(res, error, 'POST multitrade-favorites');

  await syncBotState({
    symbol:       data.symbol,
    exchange:     data.exchange,
    strategy_id:  data.strategy_id,
    capital:      Number(data.capital),
    trade_config: data.trade_config,
    enabled:      data.enabled !== false,
  });

  res.json(await enrichSingleMultitradeEntry(multitradeToEntry(data)));
});

// ── Bot exclusivo (watchlist curada) do RSI Momentum ─────────────────────────
//
// A tela Estatísticas → Momentum RSI manda a config da última pesquisa de UMA moeda; o backend
// a converte pro schema do bot (tradeConfigSchema.js) e cria/atualiza a moeda como CURADA
// (rsi_multi_bot_state.curated = true) — o bot passa a vigiá-la indefinidamente numa sessão
// dedicada, mesmo que o scanner de mercado (só Binance) nunca a sinalize (ex.: SKYAI/Gate), e
// depois de cada trade volta pra WATCHING em vez de sair do pool. Ver retireAutoFavorite em
// backend/bot/rsi-momentum/rsi-momentum-bot.js e supabase/add-rsi-momentum-curated-column.sql.

/** Converte a config do backtest das Estatísticas (mesmo shape gravado em
 *  rsi-momentum-stats-searches.json) no "body" que normalizeRsiMomentumConfig entende.
 *  Filtros que o motor do backtest NÃO aplica (anti-repique, confirmação adiantada) e os que o
 *  bot não suporta (adxFilter, newHighFilter) ficam de fora — devolve também a lista do que foi
 *  ignorado, pra avisar o usuário. */
function statsConfigToRsiMomentumBody({ symbol, interval, config = {}, priorRsiFilter = null }) {
  const c = config;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const ignored = [];
  if (c.adxFilter?.enabled) ignored.push('filtro ADX');
  if (c.newHighFilter?.enabled) ignored.push('filtro novo topo');
  if (c.reinforceOnStop?.enabled && Number(c.reinforceOnStop.waitCandles) > 0) {
    ignored.push(`espera de ${c.reinforceOnStop.waitCandles} candles no reforço (bot ainda reforça no ato)`);
  }

  const body = {
    label: `RSI Momentum · ${symbol} (curada)`,
    kind: 'rsi_momentum',
    capitalUsdt: Math.max(5, num(c.positionSizeUsd, 20)),
    entry: {
      enabled: true,
      interval: interval || c.interval || '15m',
      rsiThreshold: num(c.rsiThreshold, 70),
      // Anti-repique: o backtest das Estatísticas usa o valor da config GLOBAL (ver
      // fetchRsiThresholdBacktest.js#priorRsiFilter) — repassa o mesmo pro bot. Confirmação
      // adiantada (earlyConfirm) é só do bot ao vivo, o backtest não aplica → desligada.
      priorRsiFilter: priorRsiFilter && typeof priorRsiFilter === 'object'
        ? { enabled: priorRsiFilter.enabled !== false, count: num(priorRsiFilter.count, 3) }
        : { enabled: true, count: 3 },
      earlyConfirm: { enabled: false },
      pullback: num(c.pullbackPct, 0) > 0
        ? { enabled: true, belowPct: num(c.pullbackPct, 0.5) }
        : { enabled: false },
      reentryCooldownCandles: 3,
      bandWidth: c.bandWidth?.enabled
        ? { enabled: true, interval: c.bandWidth.interval ?? '5m',
            lookback: num(c.bandWidth.lookback, 300), minPct: num(c.bandWidth.minPct, 2) }
        : { enabled: false },
      rsi5mFilter: c.rsi5mFilter?.enabled
        ? { enabled: true, threshold: num(c.rsi5mFilter.threshold, 70) }
        : { enabled: false },
      spikeGuard: { enabled: false },
      macdFilter: c.macdFilter?.enabled
        ? { enabled: true, interval: c.macdFilter.interval ?? '1h' }
        : { enabled: false },
      higherRsiFilter: c.higherRsiFilter?.enabled
        ? { enabled: true, minRsi: num(c.higherRsiFilter.minRsi, 60) }
        : { enabled: false },
      supportResistance: c.supportResistance?.enabled
        ? { enabled: true,
            interval: c.supportResistance.interval ?? '4h',
            candleCount: num(c.supportResistance.candleCount, 50),
            entrySupportRank: num(c.supportResistance.entrySupportRank, 1),
            exitResistanceRank: num(c.supportResistance.exitResistanceRank, 3),
            entryMaxPct: num(c.supportResistance.entryMaxPct, 5) }
        : { enabled: false },
    },
    exit: {
      targetMode: ['fixed', 'continuous', 'off'].includes(c.targetMode) ? c.targetMode : 'off',
      restingBracket: { enabled: true, targetPct: Math.max(0.1, num(c.targetPct, 10)) },
      trailingTarget: c.trailingTarget
        ? { coinStepPct: num(c.trailingTarget.coinStepPct, 3), stepPct: num(c.trailingTarget.stepPct, 3) }
        : undefined,
      trailingStop: c.trailingStop?.enabled
        ? { enabled: true, mode: c.trailingStop.mode ?? 'continuous',
            startPct: num(c.trailingStop.startPct, num(c.stopLossPct, 5)),
            coinStepPct: num(c.trailingStop.coinStepPct, 3),
            stopStepPct: num(c.trailingStop.stopStepPct, 2),
            pivotPct: num(c.trailingStop.pivotPct, 1),
            aCoinStepPct: num(c.trailingStop.aCoinStepPct, 3),
            aStopStepPct: num(c.trailingStop.aStopStepPct, 2.5),
            bCoinStepPct: num(c.trailingStop.bCoinStepPct, 3),
            bStopStepPct: num(c.trailingStop.bStopStepPct, 1),
            pivotGainPct: num(c.trailingStop.pivotGainPct, 5),
            wNearPct: num(c.trailingStop.wNearPct, 4),
            wFarPct: num(c.trailingStop.wFarPct, 9),
            atrMult: num(c.trailingStop.atrMult, 2),
            atrMaxPct: num(c.trailingStop.atrMaxPct, 12) }
        : { enabled: false },
      hardTakeProfit: c.hardTakeProfit?.enabled
        ? { enabled: true, pct: num(c.hardTakeProfit.pct, 15) }
        : { enabled: false },
      reinforceOnStop: c.reinforceOnStop?.enabled
        ? { enabled: true, addDropPct: num(c.reinforceOnStop.addDropPct, 10),
            exitRisePct: num(c.reinforceOnStop.exitRisePct, 15),
            buyUsd: num(c.reinforceOnStop.buyUsd, 40) }
        : { enabled: false },
    },
    stopLoss: { enabled: true, maxLossPct: Math.max(0.5, num(c.stopLossPct, 3)) },
    polling: { pollMs: 60_000, fastPollMs: 20_000 },
    entryCooldownHours: 0,
    volume: { minVolumeUsdt: num(c.minVolumeUsdt, 0) },
  };
  return { body, ignored };
}

// POST /services/sb/rsi-momentum-curated — { symbol, interval, exchange, config }
router.post('/rsi-momentum-curated', getUserId, async (req, res) => {
  const symbol = String(req.body?.symbol ?? '').trim().toUpperCase();
  const interval = String(req.body?.interval ?? '').trim() || null;
  const exchange = req.body?.exchange === 'gate' ? 'gate' : 'binance';
  const config = req.body?.config ?? null;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  if (!config) return res.status(400).json({ error: 'config obrigatória (rode uma pesquisa antes)' });

  // Anti-repique da config global do bot — o backtest das Estatísticas usa esse mesmo valor.
  const { data: gcRow } = await supabase
    .from('rsi_momentum_global_config').select('trade_config').eq('user_id', req.userId).maybeSingle();
  const priorRsiFilter = normalizeRsiMomentumConfig(gcRow?.trade_config ?? {}).entry.priorRsiFilter;

  const { body, ignored } = statsConfigToRsiMomentumBody({ symbol, interval, config, priorRsiFilter });
  const trade_config = buildRsiMomentumTradeConfig(body);
  const capital = Number(body.capitalUsdt);

  // 1. Favorito no painel (obrigatório: multitradeWatch encerra a sessão de qualquer moeda sem
  //    linha enabled=true aqui).
  const { error: favErr } = await supabase
    .from('multitrade_favorites')
    .upsert({
      user_id: req.userId, symbol, exchange, strategy_id: 'rsi-momentum',
      enabled: true, capital, trade_config,
    }, { onConflict: 'user_id,symbol,strategy_id' });
  if (favErr) return sbError(res, favErr, 'POST rsi-momentum-curated (favorite)');

  // 2. Estado runtime — curated=true. Se já existe linha, preserva a fase (pode estar comprada);
  //    senão cria em WATCHING.
  const { data: existing } = await supabase
    .from('rsi_multi_bot_state')
    .select('id, phase')
    .eq('symbol', symbol)
    .eq('strategy_id', 'rsi-momentum')
    .maybeSingle();

  let stateErr;
  if (existing?.id) {
    ({ error: stateErr } = await supabase
      .from('rsi_multi_bot_state')
      .update({ exchange, capital, trade_config, curated: true })
      .eq('id', existing.id));
  } else {
    ({ error: stateErr } = await supabase
      .from('rsi_multi_bot_state')
      .insert({
        symbol, exchange, strategy_id: 'rsi-momentum',
        initial_capital: capital, capital, trade_config,
        phase: 'WATCHING', curated: true,
      }));
  }
  if (stateErr) return sbError(res, stateErr, 'POST rsi-momentum-curated (state)');

  res.json({
    ok: true,
    symbol, exchange, interval: body.entry.interval,
    capitalUsdt: capital,
    phase: existing?.phase ?? 'WATCHING',
    resumed: !!existing?.id,
    ignoredFilters: ignored,
  });
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
    symbol:       data.symbol,
    exchange:     data.exchange,
    strategy_id:  data.strategy_id,
    capital:      Number(data.capital),
    trade_config: data.trade_config,
    enabled:      data.enabled !== false,
  });

  res.json(await enrichSingleMultitradeEntry(multitradeToEntry(data)));
}
router.put('/multitrade-favorites/:id', getUserId, updateMultitrade);
router.patch('/multitrade-favorites/:id', getUserId, updateMultitrade);

// Busca a linha rsi_multi_bot_state (symbol+strategy_id) e aplica patch — update se já
// existe, insert (herdando exchange/capital/trade_config do favorito) se ainda não rodou
// nenhum tick pra essa moeda. Compartilhado entre o ajuste manual de fase e a compra agora.
async function upsertBotStatePatch(fav, symbol, strategyId, patch) {
  const { data: existing } = await supabase
    .from('rsi_multi_bot_state')
    .select('id, phase')
    .eq('symbol', symbol)
    .eq('strategy_id', strategyId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from('rsi_multi_bot_state')
      .update(patch)
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('rsi_multi_bot_state').insert({
      symbol,
      exchange:        fav.exchange,
      strategy_id:     strategyId,
      initial_capital: Number(fav.capital),
      capital:         Number(fav.capital),
      trade_config:    fav.trade_config,
      ...patch,
    });
    if (error) throw error;
  }
  return existing ?? null;
}

// PATCH /services/sb/multitrade-bot-state — ajuste manual de fase (WATCHING / BOUGHT)
router.patch('/multitrade-bot-state', getUserId, async (req, res) => {
  const symbol = req.body?.symbol?.toUpperCase();
  const strategyId = normStrategyId(req.body?.strategyId ?? req.body?.strategy_id ?? 'ma-cross');
  const phase = req.body?.phase;

  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  if (!strategyId) return res.status(400).json({ error: 'strategyId obrigatório' });
  if (phase !== 'WATCHING' && phase !== 'BOUGHT') {
    return res.status(400).json({ error: 'phase deve ser WATCHING ou BOUGHT' });
  }

  const { data: fav, error: favErr } = await supabase
    .from('multitrade_favorites')
    .select('*')
    .eq('user_id', req.userId)
    .eq('symbol', symbol)
    .eq('strategy_id', strategyId)
    .single();
  if (favErr || !fav) return res.status(404).json({ error: 'favorito não encontrado' });

  let patch;
  try {
    patch = buildBotStatePatch(phase, {
      buyPrice: req.body.buyPrice ?? req.body.buy_price,
      buyQty:   req.body.buyQty ?? req.body.buy_qty,
      buyTime:  req.body.buyTime ?? req.body.buy_time,
      buyUsdt:  req.body.buyUsdt ?? req.body.buy_usdt,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    if (phase === 'WATCHING' && req.body.sell) {
      const { data: existing } = await supabase
        .from('rsi_multi_bot_state')
        .select('id, phase, buy_price, buy_qty, buy_usdt, buy_time, capital, rsi_entry')
        .eq('symbol', symbol)
        .eq('strategy_id', strategyId)
        .maybeSingle();
      if (existing?.phase === 'BOUGHT') {
        const result = await recordManualSellTrade({
          existing, fav, symbol, strategyId, sell: req.body.sell,
          exitTime: new Date().toISOString(),
        });
        if (result) patch.capital = result.capitalAfter;
      }
    }
    await upsertBotStatePatch(fav, symbol, strategyId, patch);
  } catch (error) {
    return sbError(res, error, 'PATCH multitrade-bot-state');
  }

  const entry = await enrichSingleMultitradeEntry(multitradeToEntry(fav));
  res.json(entry);
});

// POST /services/sb/multitrade-buy-now — compra a mercado imediata, no capital
// configurado no favorito, independente de qualquer sinal/fase do bot (WATCHING ou
// PENDING). Ordem real na exchange (não é só bookkeeping como o PATCH acima) — por
// isso recusa se já tiver posição BOUGHT aberta, pra não comprar em cima de novo.
router.post('/multitrade-buy-now', getUserId, async (req, res) => {
  const symbol = req.body?.symbol?.toUpperCase();
  const strategyId = normStrategyId(req.body?.strategyId ?? req.body?.strategy_id ?? 'ma-cross');
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  if (!strategyId) return res.status(400).json({ error: 'strategyId obrigatório' });

  const { data: fav, error: favErr } = await supabase
    .from('multitrade_favorites')
    .select('*')
    .eq('user_id', req.userId)
    .eq('symbol', symbol)
    .eq('strategy_id', strategyId)
    .single();
  if (favErr || !fav) return res.status(404).json({ error: 'favorito não encontrado' });

  const { data: existing } = await supabase
    .from('rsi_multi_bot_state')
    .select('id, phase')
    .eq('symbol', symbol)
    .eq('strategy_id', strategyId)
    .maybeSingle();
  if (existing?.phase === 'BOUGHT') {
    return res.status(409).json({ error: 'já tem posição aberta nessa moeda — venda antes de comprar de novo' });
  }

  const capital = Number(fav.capital);
  if (!Number.isFinite(capital) || capital <= 0) {
    return res.status(400).json({ error: 'capital configurado inválido' });
  }

  let filledQty, quoteQty, avgPrice;
  try {
    if (fav.exchange === 'gate') {
      const pair = toGateSymbol(symbol);
      ({ filledQty, quoteQty, avgPrice } = await gateMarketBuy(pair, capital));
    } else {
      const client = await getBinanceClient();
      const order = await client.order({
        symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: capital.toFixed(2),
      });
      const rawQty = parseFloat(order.executedQty);
      quoteQty = parseFloat(order.cummulativeQuoteQty);
      avgPrice = quoteQty / rawQty;
      filledQty = rawQty * (1 - GATE_FEE_RATE_BUFFER);
    }
  } catch (err) {
    return res.status(500).json({ error: `Erro na compra: ${err.message}` });
  }

  const buyTime = new Date().toISOString();
  let patch;
  try {
    patch = buildBotStatePatch('BOUGHT', { buyPrice: avgPrice, buyQty: filledQty, buyTime, buyUsdt: quoteQty });
    await upsertBotStatePatch(fav, symbol, strategyId, patch);
  } catch (error) {
    // Ordem já executou na exchange — não falha silenciosamente: devolve o resultado da
    // compra mesmo se o bookkeeping no Supabase falhar, pra não perder o registro do preço.
    return res.status(207).json({
      error: `Compra executada na exchange, mas falhou salvar o estado: ${error.message}`,
      buyPrice: avgPrice, buyQty: filledQty, buyUsdt: quoteQty, buyTime,
    });
  }

  const entry = await enrichSingleMultitradeEntry(multitradeToEntry(fav));
  res.json(entry);
});

// POST /services/sb/multitrade-buy-more — compra adicional (média de preço) numa posição já
// BOUGHT, fora do sinal do bot. Dois modos:
//  - 'market': compra a mercado imediata — preenche na hora, então já atualiza buy_price
//    (média ponderada com a posição existente) e buy_qty aqui mesmo.
//  - 'pullback': ordem LIMIT GTC resting `pullbackPct`% abaixo do preço atual — só preenche
//    depois (ou nunca), então o bookkeeping NÃO muda aqui, mesmo padrão do modo OCO do botão
//    de vender (MultitradeSellModal) que também não fecha/altera a posição até o fill ser
//    detectado depois. Preço médio/quantidade dessa ordem precisam ser corrigidos manualmente
//    (card "Corrigir dados da compra" do modal de estado) quando ela encher.
router.post('/multitrade-buy-more', getUserId, async (req, res) => {
  const symbol = req.body?.symbol?.toUpperCase();
  const strategyId = normStrategyId(req.body?.strategyId ?? req.body?.strategy_id ?? 'ma-cross');
  const amountUsdt = Number(req.body?.amountUsdt);
  const mode = req.body?.mode === 'pullback' ? 'pullback' : 'market';
  const pullbackPct = Number(req.body?.pullbackPct);

  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  if (!strategyId) return res.status(400).json({ error: 'strategyId obrigatório' });
  if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    return res.status(400).json({ error: 'amountUsdt inválido' });
  }
  if (mode === 'pullback' && (!Number.isFinite(pullbackPct) || pullbackPct <= 0)) {
    return res.status(400).json({ error: 'pullbackPct inválido' });
  }

  const { data: fav, error: favErr } = await supabase
    .from('multitrade_favorites')
    .select('*')
    .eq('user_id', req.userId)
    .eq('symbol', symbol)
    .eq('strategy_id', strategyId)
    .single();
  if (favErr || !fav) return res.status(404).json({ error: 'favorito não encontrado' });

  const { data: existing } = await supabase
    .from('rsi_multi_bot_state')
    .select('id, phase, buy_price, buy_qty, buy_usdt, buy_time, rules_state')
    .eq('symbol', symbol)
    .eq('strategy_id', strategyId)
    .maybeSingle();
  if (existing?.phase !== 'BOUGHT' || existing.buy_price == null || existing.buy_qty == null) {
    return res.status(409).json({ error: 'sem posição aberta nessa moeda — não é possível comprar mais' });
  }

  // OCO (alvo + stop) pra colocar sobre a posição JÁ atualizada (média + qty nova) assim que
  // a compra preencher — só faz sentido no modo 'market' (preenche na hora); no 'pullback' a
  // ordem fica resting e pode nunca encher, então não dá pra saber a posição final agora.
  const ocoReq = req.body?.oco;
  const ocoTargetPct = Number(ocoReq?.targetPct);
  const ocoStopPct = Number(ocoReq?.stopPct);
  const wantsOco = mode === 'market' && !!ocoReq && Number.isFinite(ocoTargetPct) && ocoTargetPct > 0
    && Number.isFinite(ocoStopPct) && ocoStopPct > 0;

  const pair = fav.exchange === 'gate' ? toGateSymbol(symbol) : symbol;

  if (mode === 'pullback') {
    let currentPrice;
    try {
      currentPrice = fav.exchange === 'gate' ? await gateLastPrice(pair) : await getAvgPrice(symbol);
    } catch (err) {
      return res.status(500).json({ error: `Falha ao buscar preço atual: ${err.message}` });
    }
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return res.status(500).json({ error: 'preço atual inválido' });
    }
    const limitPrice = currentPrice * (1 - pullbackPct / 100);

    let handle;
    try {
      handle = fav.exchange === 'gate'
        ? await gatePlaceRestingLimitBuy(pair, amountUsdt, limitPrice)
        : await binancePlaceRestingLimitBuy(symbol, amountUsdt, limitPrice);
    } catch (err) {
      return res.status(500).json({ error: `Erro ao colocar ordem limite: ${err.message}` });
    }

    const entry = await enrichSingleMultitradeEntry(multitradeToEntry(fav));
    return res.json({
      entry,
      order: { mode: 'pullback', ...handle, referencePrice: currentPrice, pullbackPct },
      note: 'Ordem LIMIT colocada na corretora, ainda não preenchida — o preço médio/quantidade só serão atualizados quando a ordem encher (corrija manualmente em "Corrigir dados da compra" se necessário).',
    });
  }

  let filledQty, quoteQty, avgPrice;
  try {
    if (fav.exchange === 'gate') {
      ({ filledQty, quoteQty, avgPrice } = await gateMarketBuy(pair, amountUsdt));
    } else {
      const client = await getBinanceClient();
      const order = await client.order({
        symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: amountUsdt.toFixed(2),
      });
      const rawQty = parseFloat(order.executedQty);
      quoteQty = parseFloat(order.cummulativeQuoteQty);
      avgPrice = quoteQty / rawQty;
      filledQty = rawQty * (1 - GATE_FEE_RATE_BUFFER);
    }
  } catch (err) {
    return res.status(500).json({ error: `Erro na compra: ${err.message}` });
  }

  const prevQty      = Number(existing.buy_qty);
  const prevPrice    = Number(existing.buy_price);
  const prevUsdt     = existing.buy_usdt != null ? Number(existing.buy_usdt) : prevQty * prevPrice;
  const newQty       = prevQty + filledQty;
  const newUsdt       = prevUsdt + quoteQty;
  const newAvgPrice  = newUsdt / newQty;

  let patch;
  try {
    patch = buildBotStatePatch('BOUGHT', {
      buyPrice: newAvgPrice, buyQty: newQty, buyTime: existing.buy_time, buyUsdt: newUsdt,
    });
    await upsertBotStatePatch(fav, symbol, strategyId, patch);
  } catch (error) {
    // Ordem já executou na exchange — devolve o resultado da compra mesmo se o bookkeeping
    // no Supabase falhar, pra não perder o registro do preço (mesmo padrão do buy-now acima).
    return res.status(207).json({
      error: `Compra executada na exchange, mas falhou salvar o estado: ${error.message}`,
      buyPrice: newAvgPrice, buyQty: newQty, buyUsdt: newUsdt,
    });
  }

  let oco = null;
  let ocoError = null;
  if (wantsOco) {
    try {
      if (fav.exchange !== 'gate') await syncExchangeClocks();
      const adapter = buildTradeAdapter(fav.exchange, symbol);
      const targetPrice = newAvgPrice * (1 + ocoTargetPct / 100);
      const stopPrice = newAvgPrice * (1 - ocoStopPct / 100);
      const bracket = await adapter.placeExitBracket(newQty, targetPrice, stopPrice);
      oco = { ...bracket, targetPct: ocoTargetPct, stopPct: ocoStopPct };
      // manual:true — mesmo motivo do /binance-bracket-sell e /gate-bracket-sell: o bot não
      // deve substituir essa bracket por deriva no próximo tick (maybeReplaceBracket em
      // bollinger-bands-bot.js/vwap-bands-bot.js pula brackets manuais).
      await supabase.from('rsi_multi_bot_state')
        .update({
          rules_state: { ...(existing.rules_state ?? {}), exitBracket: { ...bracket, manual: true, placedAt: new Date().toISOString() } },
        })
        .eq('id', existing.id);
    } catch (err) {
      // Compra já executou e o estado já foi salvo — não falha a resposta por causa da OCO,
      // só avisa o front pra o usuário colocar manualmente (Vender > OCO) se precisar.
      ocoError = `Compra feita, mas falha ao colocar OCO: ${err.message}`;
    }
  }

  const entry = await enrichSingleMultitradeEntry(multitradeToEntry(fav));
  res.json({ entry, order: { mode: 'market', filledQty, quoteQty, avgPrice }, oco, ocoError });
});

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

  // WATCHING: sem posição/ordem, sempre seguro apagar. FAILED (só existe hoje no
  // rsi-momentum): tentativa de compra/ordem rejeitada pela corretora — também sem nada
  // pendente na exchange, mesma segurança pra apagar. PENDING/BOUGHT ficam de fora de
  // propósito: têm ordem/posição real na corretora que este endpoint não cancela nem vende.
  await supabase
    .from('rsi_multi_bot_state')
    .delete()
    .eq('symbol', existing.symbol)
    .eq('strategy_id', existing.strategy_id)
    .in('phase', ['WATCHING', 'FAILED']);

  res.json({ deleted: req.params.id });
});

// ============================================================
//  5m TRADE FAVORITES  (five_min_bot_state — bot RSI 5m + DCA)
// ============================================================

const {
  normalizeMaFilters, getRequiredIntervals, candleLimitForInterval,
} = require('../bot/5min-trade-bot/maFilter');
const { normalizeStopLoss } = require('../bot/5min-trade-bot/stopLossConfig');
const { normalizeRecoveryPattern } = require('../bot/5min-trade-bot/recoveryPatternConfig');
const { normalizeSellScope } = require('../bot/5min-trade-bot/sellScopeConfig');
const { normalizeEntryPrice } = require('../bot/5min-trade-bot/entryPriceConfig');
const { normalizeEntryPaths } = require('../bot/5min-trade-bot/entryPathsConfig');

function fiveMTradeToEntry(r) {
  return {
    id:             r.id,
    symbol:         r.symbol,
    exchange:       r.exchange ?? 'binance',
    capital:        Number(r.capital),
    initialCapital: Number(r.initial_capital ?? r.capital),
    rsiBuy:         Number(r.rsi_buy  ?? 30),
    rsiSell:        Number(r.rsi_sell ?? 70),
    maFilters:      normalizeMaFilters(r.ma_filters),
    stopLoss:       normalizeStopLoss(r.stop_loss),
    recoveryPattern: normalizeRecoveryPattern(r.recovery_pattern),
    sellScope:      normalizeSellScope(r.sell_scope).scope,
    entryPrice:     normalizeEntryPrice(r.entry_price),
    entryPaths:     normalizeEntryPaths(r.entry_paths),
    rsiSellMa5m:    r.rsi_sell_ma5m != null ? Number(r.rsi_sell_ma5m) : null,
    entryPath:      r.entry_path ?? null,
    phase:          r.phase ?? 'WATCHING',
    buyCount:       r.buy_count ?? 0,
    lastBuyTime:    r.last_buy_time ?? r.buy_time ?? null,
    lastExitReason: r.last_exit_reason ?? null,
    lastExitTime:   r.last_exit_time ?? null,
  };
}

// GET /services/sb/five-m-trade-favorites
router.get('/five-m-trade-favorites', getUserId, async (req, res) => {
  const { data, error } = await supabase
    .from('five_min_bot_state')
    .select('*')
    .order('symbol');
  if (error) return sbError(res, error, 'GET five-m-trade-favorites');
  res.json((data ?? []).map(fiveMTradeToEntry));
});

// POST /services/sb/five-m-trade-favorites  { symbol, exchange?, capital?, rsiBuy?, rsiSell?, maFilters? }
router.post('/five-m-trade-favorites', getUserId, async (req, res) => {
  const {
    symbol, exchange = 'binance', capital = 40, rsiBuy = 30, rsiSell = 70, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths, rsiSellMa5m,
  } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });
  const sym = symbol.toUpperCase();
  const cap = Number(capital);
  const buy  = Number(rsiBuy);
  const sell = Number(rsiSell);
  if (!Number.isFinite(cap) || cap <= 0) return res.status(400).json({ error: 'capital inválido' });
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy >= sell) {
    return res.status(400).json({ error: 'rsiBuy deve ser menor que rsiSell' });
  }

  const maCfg = maFilters !== undefined ? normalizeMaFilters(maFilters) : undefined;
  const slCfg = stopLoss !== undefined
    ? normalizeStopLoss(stopLoss)
    : undefined;
  const rpCfg = recoveryPattern !== undefined
    ? normalizeRecoveryPattern(recoveryPattern)
    : undefined;
  const sellScopeCfg = sellScope !== undefined ? normalizeSellScope(sellScope).scope : undefined;
  const entryPriceCfg = entryPrice !== undefined ? normalizeEntryPrice(entryPrice) : undefined;
  const entryPathsCfg = entryPaths !== undefined ? normalizeEntryPaths(entryPaths) : undefined;
  const rsiSellMa5mNum = rsiSellMa5m !== undefined && rsiSellMa5m !== null
    ? Number(rsiSellMa5m)
    : undefined;
  if (stopLoss !== undefined && stopLoss !== null && slCfg?.types?.length === 0 && stopLoss.types?.length) {
    return res.status(400).json({ error: 'stopLoss.types inválido' });
  }
  const { data: existing } = await supabase
    .from('five_min_bot_state')
    .select('id, phase')
    .eq('symbol', sym)
    .maybeSingle();

  let data, error;
  if (existing) {
    const updates = { exchange, capital: cap, rsi_buy: buy, rsi_sell: sell, updated_at: new Date().toISOString() };
    if (maCfg !== undefined) updates.ma_filters = maCfg;
    if (slCfg  !== undefined) updates.stop_loss  = slCfg;
    if (rpCfg  !== undefined) updates.recovery_pattern = rpCfg;
    if (sellScopeCfg !== undefined) updates.sell_scope = sellScopeCfg;
    if (entryPriceCfg !== undefined) updates.entry_price = entryPriceCfg;
    if (entryPathsCfg !== undefined) updates.entry_paths = entryPathsCfg;
    if (rsiSellMa5mNum !== undefined) updates.rsi_sell_ma5m = rsiSellMa5mNum;
    if (existing.phase === 'WATCHING') updates.initial_capital = cap;
    ({ data, error } = await supabase
      .from('five_min_bot_state')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single());
  } else {
    ({ data, error } = await supabase
      .from('five_min_bot_state')
      .insert({
        symbol:          sym,
        exchange,
        capital:         cap,
        initial_capital: cap,
        rsi_buy:         buy,
        rsi_sell:        sell,
        ma_filters:      maCfg ?? normalizeMaFilters(null),
        stop_loss:       slCfg ?? normalizeStopLoss(null),
        recovery_pattern: rpCfg ?? normalizeRecoveryPattern(null),
        sell_scope:      sellScopeCfg ?? 'bot_only',
        entry_price:     entryPriceCfg ?? normalizeEntryPrice(null),
        entry_paths:     entryPathsCfg ?? normalizeEntryPaths(null),
        rsi_sell_ma5m:   rsiSellMa5mNum ?? null,
        phase:           'WATCHING',
        buy_count:       0,
      })
      .select()
      .single());
  }

  if (error) return sbError(res, error, 'POST five-m-trade-favorites');
  res.json(fiveMTradeToEntry(data));
});

// PATCH /services/sb/five-m-trade-favorites/:id
router.patch('/five-m-trade-favorites/:id', getUserId, async (req, res) => {
  const { exchange, capital, rsiBuy, rsiSell, maFilters, stopLoss, recoveryPattern, sellScope, entryPrice, entryPaths, rsiSellMa5m } = req.body;
  const { data: existing, error: findErr } = await supabase
    .from('five_min_bot_state')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (findErr || !existing) return res.status(404).json({ error: 'not found' });

  const updates = { updated_at: new Date().toISOString() };
  if (exchange !== undefined) updates.exchange = exchange;
  if (capital !== undefined) {
    const cap = Number(capital);
    if (!Number.isFinite(cap) || cap <= 0) return res.status(400).json({ error: 'capital inválido' });
    updates.capital = cap;
    if (existing.phase === 'WATCHING') updates.initial_capital = cap;
  }
  if (rsiBuy !== undefined)  updates.rsi_buy  = Number(rsiBuy);
  if (rsiSell !== undefined) updates.rsi_sell = Number(rsiSell);
  if (maFilters !== undefined) updates.ma_filters = normalizeMaFilters(maFilters);
  if (stopLoss !== undefined) {
    updates.stop_loss = normalizeStopLoss(stopLoss);
  }
  if (recoveryPattern !== undefined) {
    updates.recovery_pattern = normalizeRecoveryPattern(recoveryPattern);
  }
  if (sellScope !== undefined) {
    updates.sell_scope = normalizeSellScope(sellScope).scope;
  }
  if (entryPrice !== undefined) {
    updates.entry_price = normalizeEntryPrice(entryPrice);
  }
  if (entryPaths !== undefined) {
    updates.entry_paths = normalizeEntryPaths(entryPaths);
  }
  if (rsiSellMa5m !== undefined) {
    updates.rsi_sell_ma5m = rsiSellMa5m === null ? null : Number(rsiSellMa5m);
  }
  const nextBuy  = updates.rsi_buy  ?? Number(existing.rsi_buy  ?? 30);
  const nextSell = updates.rsi_sell ?? Number(existing.rsi_sell ?? 70);
  if (nextBuy >= nextSell) return res.status(400).json({ error: 'rsiBuy deve ser menor que rsiSell' });

  const { data, error } = await supabase
    .from('five_min_bot_state')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return sbError(res, error, 'PATCH five-m-trade-favorites');
  res.json(fiveMTradeToEntry(data));
});

// DELETE /services/sb/five-m-trade-favorites/:id
router.delete('/five-m-trade-favorites/:id', getUserId, async (req, res) => {
  const { data: existing, error: findErr } = await supabase
    .from('five_min_bot_state')
    .select('phase')
    .eq('id', req.params.id)
    .single();
  if (findErr || !existing) return res.status(404).json({ error: 'not found' });

  const { error } = await supabase
    .from('five_min_bot_state')
    .delete()
    .eq('id', req.params.id);
  if (error) return sbError(res, error, 'DELETE five-m-trade-favorites');
  res.json({ deleted: req.params.id });
});

// GET /services/sb/five-m-trade-signals?symbol=&limit=50&event_type=
router.get('/five-m-trade-signals', getUserId, async (req, res) => {
  let q = supabase
    .from('five_min_bot_signals')
    .select('*')
    .order('event_time', { ascending: false });
  if (req.query.symbol) q = q.eq('symbol', req.query.symbol.toUpperCase());
  if (req.query.event_type) q = q.eq('event_type', req.query.event_type);
  q = q.limit(Math.min(parseInt(req.query.limit ?? '50', 10), 200));
  const { data, error } = await q;
  if (error) return sbError(res, error, 'GET five-m-trade-signals');
  res.json(data ?? []);
});

// GET /services/sb/five-m-trade-suggest-rsi?symbol=&exchange=&entryValue=30&exitValue=70&maFilters={json}
router.get('/five-m-trade-suggest-rsi', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange   = req.query.exchange ?? 'binance';
  const entryValue = Number(req.query.entryValue ?? req.query.entry_value ?? 30);
  const exitValue  = Number(req.query.exitValue  ?? req.query.exit_value  ?? 70);

  let maFilters = null;
  if (req.query.maFilters) {
    try {
      maFilters = JSON.parse(req.query.maFilters);
    } catch {
      return res.status(400).json({ error: 'maFilters JSON inválido' });
    }
  }
  const maCfg = normalizeMaFilters(maFilters);

  const { build5mRsiReport, DEFAULT_OPTS } = require('../bot/5min-trade-bot/suggest5mRsi');

  try {
    const intervals = getRequiredIntervals(maCfg);
    const cMap = {};
    const maxPeriod = maCfg.enabled
      ? Math.max(0, ...maCfg.filters.filter(f => f.enabled).map(f => f.period))
      : 0;

    for (const interval of intervals) {
      const base = interval === '5m' ? DEFAULT_OPTS.candleLimit : candleLimitForInterval(interval);
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, base + maxPeriod + 10);
    }

    const report = build5mRsiReport(
      cMap['5m'],
      { anchorEntry: entryValue, anchorExit: exitValue, maFilters: maCfg },
      cMap,
    );

    res.json({
      symbol,
      exchange,
      evaluatedAt: new Date().toISOString(),
      entryRsiValue: report.entry?.suggestedEntryRsi ?? entryValue,
      exitRsiValue:  report.exit?.suggestedExitRsi  ?? exitValue,
      entrySweepSummary: report.entry?.sweep?.map(s => ({
        value: s.value, episodes: s.episodes, tradeCount: s.tradeCount,
        avgPnl: s.avgPnl, winRate: s.winRate,
      })),
      exitSweepSummary: report.exit?.sweep?.map(s => ({
        value: s.value, tradeCount: s.tradeCount, hitRatePct: s.hitRatePct,
        avgPnl: s.avgPnl, winRate: s.winRate,
      })),
      ...report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/five-m-trade-suggest-ma-adaptation?symbol=&exchange=&rsiBuy=&rsiSell=&maFilters={json}
router.get('/five-m-trade-suggest-ma-adaptation', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const rsiBuy   = Number(req.query.rsiBuy ?? req.query.rsi_buy ?? 30);
  const rsiSell  = Number(req.query.rsiSell ?? req.query.rsi_sell ?? 70);

  let maFilters = null;
  if (req.query.maFilters) {
    try {
      maFilters = JSON.parse(req.query.maFilters);
    } catch {
      return res.status(400).json({ error: 'maFilters JSON inválido' });
    }
  }
  const maCfg = normalizeMaFilters(maFilters);

  if (!Number.isFinite(rsiBuy) || !Number.isFinite(rsiSell) || rsiBuy >= rsiSell) {
    return res.status(400).json({ error: 'rsiBuy deve ser menor que rsiSell' });
  }

  const { buildMaAdaptationReport } = require('../bot/5min-trade-bot/suggestMaAdaptation');
  const { DEFAULT_OPTS } = require('../bot/5min-trade-bot/suggest5mRsi');

  try {
    const intervals = getRequiredIntervals(maCfg);
    const cMap = {};
    const maxPeriod = maCfg.enabled
      ? Math.max(0, ...maCfg.filters.filter(f => f.enabled).map(f => f.period))
      : 0;

    for (const interval of intervals) {
      const base = interval === '5m' ? DEFAULT_OPTS.candleLimit : candleLimitForInterval(interval);
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, base + maxPeriod + 10);
    }

    const report = buildMaAdaptationReport(cMap, {
      maFilters: maCfg,
      rsiBuy,
      rsiSell,
    });

    res.json({ symbol, exchange, rsiBuy, rsiSell, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/five-m-trade-suggest-recovery?symbol=&exchange=&rsiBuy=&rsiSell=&maFilters=
router.get('/five-m-trade-suggest-recovery', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const rsiBuy   = Number(req.query.rsiBuy ?? 30);
  const rsiSell  = Number(req.query.rsiSell ?? req.query.rsi_sell ?? 70);

  let maFilters = null;
  if (req.query.maFilters) {
    try { maFilters = JSON.parse(req.query.maFilters); } catch {
      return res.status(400).json({ error: 'maFilters JSON inválido' });
    }
  }
  const maCfg = normalizeMaFilters(maFilters);

  const { buildRecoverySuggestPayload } = require('../bot/5min-trade-bot/suggestRecoveryAnalysis');

  try {
    const payload = await buildRecoverySuggestPayload(
      fetchCandlesForEval, exchange, symbol, rsiBuy, rsiSell, maCfg,
    );
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/five-m-trade-suggest-entry-below?symbol=&exchange=&rsiBuy=
router.get('/five-m-trade-suggest-entry-below', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const rsiBuy   = Number(req.query.rsiBuy ?? 30);

  const { suggestEntryBelowPct } = require('../bot/5min-trade-bot/suggestEntryBelowPct');
  const { CANDLES_5M } = require('../bot/5min-trade-bot/suggestRecoveryAnalysis');

  try {
    const candles5m    = await fetchCandlesForEval(exchange, symbol, '5m', CANDLES_5M);
    const currentPrice = candles5m.length ? candles5m[candles5m.length - 1].close : 0;
    const entryBelow   = suggestEntryBelowPct(candles5m, 14, rsiBuy, currentPrice);
    res.json({
      symbol, exchange, rsiBuy, currentPrice, entryBelow,
      suggestedBelowPct: entryBelow.suggestedBelowPct ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/five-m-trade-suggest-stop — legado (stop loss); preferir suggest-recovery no painel
router.get('/five-m-trade-suggest-stop', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const rsiBuy   = Number(req.query.rsiBuy ?? 30);
  const rsiSell  = Number(req.query.rsiSell ?? req.query.rsi_sell ?? 70);

  let maFilters = null;
  if (req.query.maFilters) {
    try { maFilters = JSON.parse(req.query.maFilters); } catch {
      return res.status(400).json({ error: 'maFilters JSON inválido' });
    }
  }
  const maCfg = normalizeMaFilters(maFilters);

  const { historicalStopLoss, fixedStopLoss, compareStopLossOptions, maStopFromCandles } = require('../bot/5min-trade-bot/suggestStopLoss');
  const { analyzeRecoveryPatterns } = require('../bot/5min-trade-bot/suggestRecoveryPattern');
  const { suggestAbovePctFor5m } = require('../bot/5min-trade-bot/suggestRecoveryMaZone');
  const { checkRecoveryPatternsLive } = require('../bot/5min-trade-bot/recoveryPattern');
  const { resolveMaStopFilter } = require('../bot/5min-trade-bot/maFilter');
  const { buildExtensionAboveReport } = require('../bot/amap/suggestExtensionAbovePct');
  const { buildTradeConfig } = require('../bot/amap/strategyEngine');

  try {
    const candles5m    = await fetchCandlesForEval(exchange, symbol, '5m', 1000);
    const currentPrice = candles5m.length ? candles5m[candles5m.length - 1].close : 0;
    const hist         = historicalStopLoss(candles5m, 14, rsiBuy, currentPrice);
    const fixed2       = fixedStopLoss(currentPrice, 2);
    const fixed5       = fixedStopLoss(currentPrice, 5);

    let ma = { ok: false, reason: 'ma_indisponivel' };
    let candles1h = null;
    const maStopFilter = resolveMaStopFilter(maCfg);
    const candlesMa = await fetchCandlesForEval(exchange, symbol, maStopFilter.interval, maStopFilter.period + 500);
    if (maStopFilter.interval === '1h') candles1h = candlesMa;
    ma = maStopFromCandles(candlesMa, maStopFilter, currentPrice);

    if (!candles1h) {
      candles1h = await fetchCandlesForEval(exchange, symbol, '1h', 520);
    }
    const stopCompare      = compareStopLossOptions({ hist, ma, fixed2, fixed5 });
    const recoveryAnalysis = analyzeRecoveryPatterns(candles5m, candles1h, rsiBuy, rsiSell);
    const localMaZone      = suggestAbovePctFor5m(candles5m, candles1h, maCfg, rsiBuy, rsiSell);
    const mtReport = buildExtensionAboveReport(
      { '5m': candles5m, '1h': candles1h },
      buildTradeConfig({
        entryRsi: { interval: '5m', period: 14, operator: '<', value: rsiBuy },
        exitRsi:  { interval: '5m', period: 14, operator: '>', value: rsiSell },
        extension: {
          enabled:       true,
          maPeriod:      maStopFilter.period,
          maInterval:    maStopFilter.interval,
          abovePct:      localMaZone.suggestedAbovePct ?? 5,
          threeCandles:  true,
          fourCandles:   true,
          threeInterval: '1h',
          fourInterval:  '1h',
          confirmLogic:  'any',
        },
      }),
    );
    const suggestedAbovePct = mtReport.suggestedAbovePct ?? localMaZone.suggestedAbovePct ?? 5;
    const maZone = {
      ok:                mtReport.signalCount > 0 || localMaZone.ok,
      suggestedAbovePct,
      maPeriod:          maStopFilter.period,
      maInterval:        maStopFilter.interval,
      signalCount:       mtReport.signalCount ?? localMaZone.signalCount ?? 0,
      medianStretchPct:  mtReport.medianStretchPct ?? localMaZone.medianStretchPct,
      aboveNowPct:       mtReport.aboveNowPct ?? localMaZone.aboveNowPct,
      extendedNow:       mtReport.extendedNow ?? localMaZone.extendedNow,
      usedDefault:       mtReport.usedDefault,
      sweepSavedPct:     mtReport.sweepSavedPct,
      sweepMissedPct:    mtReport.sweepMissedPct,
      rsiBuy,
      localSuggested:    localMaZone.suggestedAbovePct,
      description:
        `Sugerido +${suggestedAbovePct}% acima MA${maStopFilter.period} ${maStopFilter.interval} ` +
        `(Multi-Trade · ${mtReport.signalCount ?? 0} sinais RSI<${rsiBuy} 5m)`,
    };
    const candlePatterns   = checkRecoveryPatternsLive(candles1h);

    res.json({
      symbol, exchange, rsiBuy, rsiSell, currentPrice,
      fixed2, fixed5, hist, ma,
      stopCompare,
      recommended: stopCompare.recommended,
      recoveryAnalysis,
      recoveryRecommended: recoveryAnalysis.recommended ?? null,
      maZone,
      candlePatterns,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/five-m-trade-suggest-ma5m-exit?symbol=&exchange=&maFilters=&trigger=touch&anchorExit=73
router.get('/five-m-trade-suggest-ma5m-exit', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange   = req.query.exchange ?? 'binance';
  const anchorExit = Number(req.query.anchorExit ?? req.query.anchor_exit ?? 73);
  const trigger    = req.query.trigger === 'cross_up' ? 'cross_up' : 'touch';

  let maFilters = null;
  if (req.query.maFilters) {
    try { maFilters = JSON.parse(req.query.maFilters); } catch {
      return res.status(400).json({ error: 'maFilters JSON inválido' });
    }
  }
  const maCfg = normalizeMaFilters(maFilters);

  const { suggestMa5mExitRsi } = require('../bot/5min-trade-bot/ma5mEntryEngine');
  const { CANDLES_5M } = require('../bot/5min-trade-bot/suggestRecoveryAnalysis');

  try {
    const candles5m = await fetchCandlesForEval(exchange, symbol, '5m', CANDLES_5M);
    const candles1h = await fetchCandlesForEval(exchange, symbol, '1h', 1000);
    const report = suggestMa5mExitRsi(candles5m, candles1h, maCfg, trigger, anchorExit);
    res.json({
      symbol,
      exchange,
      trigger,
      anchorExit,
      exitRsiValue: report.suggestedExitRsi ?? anchorExit,
      ...report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/five-m-trade-suggest-path-cooldown
router.get('/five-m-trade-suggest-path-cooldown', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const rsiBuy   = Number(req.query.rsiBuy ?? 30);
  const trigger  = req.query.trigger === 'cross_up' ? 'cross_up' : 'touch';
  const tolerancePct = Number(req.query.tolerancePct ?? req.query.tolerance_pct ?? 0.5);

  let maFilters = null;
  if (req.query.maFilters) {
    try { maFilters = JSON.parse(req.query.maFilters); } catch {
      return res.status(400).json({ error: 'maFilters JSON inválido' });
    }
  }
  const maCfg = normalizeMaFilters(maFilters);
  const { suggestEntryPathTiming } = require('../bot/5min-trade-bot/suggestEntryPathTiming');
  const { CANDLES_5M } = require('../bot/5min-trade-bot/suggestRecoveryAnalysis');

  try {
    const candles5m = await fetchCandlesForEval(exchange, symbol, '5m', CANDLES_5M);
    const candles1h = await fetchCandlesForEval(exchange, symbol, '1h', 1000);
    const report = suggestEntryPathTiming(candles5m, candles1h, maCfg, rsiBuy, trigger, tolerancePct);
    res.json({
      symbol,
      exchange,
      rsiBuy,
      trigger,
      ...report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /services/sb/five-m-trade-evaluate — snapshot ao vivo com parâmetros do usuário
router.post('/five-m-trade-evaluate', getUserId, async (req, res) => {
  const symbol = req.body?.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange    = req.body.exchange ?? 'binance';
  const rsiBuy      = Number(req.body.rsiBuy ?? 30);
  const rsiSell     = Number(req.body.rsiSell ?? 70);
  const maCfg       = normalizeMaFilters(req.body.maFilters);
  const phase       = req.body.phase === 'BOUGHT' ? 'BOUGHT' : 'WATCHING';
  const lastBuyTime = req.body.lastBuyTime ?? null;
  const lastExitReason = req.body.lastExitReason ?? null;
  const lastExitTime = req.body.lastExitTime ?? null;
  const buyCount    = Number(req.body.buyCount ?? 0);

  if (!Number.isFinite(rsiBuy) || !Number.isFinite(rsiSell) || rsiBuy >= rsiSell) {
    return res.status(400).json({ error: 'rsiBuy deve ser menor que rsiSell' });
  }

  const { evaluate5mTradeLive } = require('../bot/5min-trade-bot/evaluate5mTrade');

  try {
    const intervals = getRequiredIntervals(maCfg);
    // Sempre inclui 1h para verificação dos padrões 3/4 candles
    const allIntervals = intervals.includes('1h') ? intervals : [...intervals, '1h'];
    const cMap = {};
    const maxPeriod = maCfg.enabled
      ? Math.max(0, ...maCfg.filters.filter(f => f.enabled).map(f => f.period))
      : 0;

    for (const interval of allIntervals) {
      const liveLimit = interval === '5m' ? 80 : Math.min(candleLimitForInterval(interval), 120);
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, liveLimit + maxPeriod + 10);
    }

    let livePrice = null;
    try {
      if (exchange === 'gate') {
        const { fetchGateCurrentPrice } = require('../bot/prices');
        livePrice = await fetchGateCurrentPrice(toGateSymbol(symbol));
      } else {
        const { fetchBinanceCurrentPrice } = require('../bot/prices');
        livePrice = await fetchBinanceCurrentPrice(symbol);
      }
    } catch { /* fallback: close da vela 5m */ }

    const report = evaluate5mTradeLive(cMap, {
      symbol,
      exchange,
      rsiBuy,
      rsiSell,
      entryPaths: normalizeEntryPaths(req.body.entryPaths),
      entryPath: req.body.entryPath ?? 'rsi',
      maFilters: maCfg,
      recoveryPattern: normalizeRecoveryPattern(req.body.recoveryPattern),
      sellScope: normalizeSellScope(req.body.sellScope).scope,
      phase,
      lastBuyTime,
      lastExitReason,
      lastExitTime,
      buyCount,
      livePrice,
    });

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /services/sb/multitrade-trades?symbol=&strategy_id=&limit=50
router.get('/multitrade-trades', getUserId, async (req, res) => {
  const { displayExitReason } = require('../bot/amap/exitReasonFormat');
  let q = supabase.from('rsi_multi_bot_trades').select('*').order('exit_time', { ascending: false });
  if (req.query.symbol)       q = q.eq('symbol', req.query.symbol.toUpperCase());
  if (req.query.strategy_id)  q = q.eq('strategy_id', req.query.strategy_id);
  q = q.limit(Math.min(parseInt(req.query.limit ?? '50', 10), 200));

  const { data, error } = await q;
  if (error) return sbError(res, error, 'GET multitrade-trades');
  const rows = (data ?? []).map(t => ({
    ...t,
    exit_reason_label: displayExitReason(t.exit_reason),
  }));
  res.json(rows);
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

// GET /chart-adaptive-bands?symbol=&exchange=&period=50&interval=1h&limit=&maxDipPct=4&maxAbovePct=4
router.get('/chart-adaptive-bands', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  const period = Number(req.query.period ?? 50);
  const interval = req.query.interval ?? '1h';
  const limit = Math.min(Math.max(Number(req.query.limit ?? period + 300), period + 20), 1000);
  const maxDipPct = Number(req.query.maxDipPct ?? 4);
  const maxAbovePct = Number(req.query.maxAbovePct ?? 4);
  const fixedDipPct = req.query.fixedDipPct != null && req.query.fixedDipPct !== ''
    ? Number(req.query.fixedDipPct) : null;
  const fixedAbovePct = req.query.fixedAbovePct != null && req.query.fixedAbovePct !== ''
    ? Number(req.query.fixedAbovePct) : null;

  const dipOpts = {
    defaultPct: Number(req.query.defaultPct ?? 3),
    maxPct: maxDipPct,
    minPct: Number(req.query.minPct ?? 0.5),
    minEpisodes: Number(req.query.minEpisodes ?? 3),
  };
  const stretchOpts = {
    defaultPct: Number(req.query.defaultAbovePct ?? 4),
    maxPct: maxAbovePct,
    minPct: Number(req.query.minAbovePct ?? 0.5),
    minEpisodes: Number(req.query.minEpisodes ?? 3),
  };

  try {
    const candles = await fetchCandlesForEval(exchange, symbol, interval, limit);
    const dipResult = analyzeAdaptiveDip(candles, period, dipOpts);
    const stretchResult = analyzeAdaptiveStretch(candles, period, stretchOpts);
    const dipPct = fixedDipPct ?? Math.min(dipResult.dipPct, maxDipPct);
    const stretchPct = fixedAbovePct ?? Math.min(stretchResult.stretchPct, maxAbovePct);
    res.json({
      symbol, exchange, period, interval,
      dipPct,
      stretchPct,
      dipUsedDefault: dipResult.usedDefault,
      stretchUsedDefault: stretchResult.usedDefault,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /multitrade-suggest-ma-cross-bounds?symbol=&exchange=&tradeConfig={...}&filterId=1
router.get('/multitrade-suggest-ma-cross-bounds', getUserId, async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol obrigatório' });

  const exchange = req.query.exchange ?? 'binance';
  let body = {};
  if (req.query.tradeConfig) {
    try { body = JSON.parse(req.query.tradeConfig); } catch {
      return res.status(400).json({ error: 'tradeConfig JSON inválido' });
    }
  } else {
    body = normalizeMaCrossConfig({});
  }

  const normalized = normalizeMaCrossConfig(body);
  const filterId = Number(req.query.filterId ?? normalized.maFilters?.[0]?.id ?? 1);
  const filterIdx = Math.max(0, (normalized.maFilters ?? []).findIndex(f => f.id === filterId));

  const config = normalized;
  const specs = getMaCrossRequiredSpecs(config);

  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, Math.max(limit, 500));
    }));

    const report = buildMaCrossBoundsReport(cMap, config, filterIdx >= 0 ? filterIdx : 0);
    if (report.error) return res.status(400).json(report);
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
  const tradeConfig = parseMultitradeSuggestQuery(req.query);
  const entryPath = req.query.entryPath === 'ma'
    || (tradeConfig.entryMa?.enabled && tradeConfig.entryRsiPath?.enabled === false)
    ? 'ma'
    : 'rsi';

  const specs = getRequiredSpecs(tradeConfig);
  try {
    const cMap = {};
    await Promise.all(specs.map(async ({ interval, limit }) => {
      cMap[interval] = await fetchCandlesForEval(exchange, symbol, interval, Math.max(limit, 500));
    }));

    const report = buildExitRsiReport(cMap, tradeConfig, { entryPath });
    res.json({
      symbol,
      exchange,
      exitRsiValue: report.suggestedExitRsi,
      entryPath,
      ...report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseMultitradeSuggestQuery(query) {
  const sid = query.strategyId ?? query.strategy_id ?? null;
  if (isSwingStrategy(sid) || query.kind === 'rsi' || query.kind === 'ma') {
    const swingBody = {
      kind: query.kind ?? (sid === 'swing-ma50-8h' ? 'ma' : 'rsi'),
      entryRsi: {
        interval: query.entryInterval ?? '1h',
        period:   Number(query.entryPeriod ?? 14),
        operator: query.entryOperator ?? '<',
        value:    Number(query.entryValue ?? 30),
      },
      exitRsi: {
        interval: query.exitInterval ?? '1h',
        period:   Number(query.exitPeriod ?? 14),
        operator: query.exitOperator ?? '>',
        value:    Number(query.exitValue ?? 70),
      },
      entryMaFilter: query.entryMaFilter ? JSON.parse(query.entryMaFilter) : {
        enabled: true, period: 50, interval: '8h', mode: 'strict_above',
      },
      entryMa: query.entryMa ? JSON.parse(query.entryMa) : undefined,
      stopLoss: { enabled: query.stopLossEnabled !== 'false', maxLossPct: 5 },
    };
    return toAmapSuggestConfig(normalizeSwingConfig(swingBody));
  }

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
    return fetchGateCandles(pair, Math.min(limit, 1000), interval);
  }
  if (limit <= 1000) return fetchBinanceCandles(symbol, limit, interval);
  const raw = await fetchKlines(symbol, interval, limit);
  return raw.map(k => ({
    openTime: Number(k.openTime),
    open:     parseFloat(k.open),
    high:     parseFloat(k.high),
    low:      parseFloat(k.low),
    close:    parseFloat(k.close),
  }));
}

// GET /services/sb/multitrade-backtest?symbol=ARUSDT&exchange=binance&capital=40
// Aceita tradeConfig ad-hoc (estudo sem favorito MC) — preferencialmente strategy ma-cross.
router.get('/multitrade-backtest', getUserId, async (req, res) => {
  const sym = req.query.symbol?.toUpperCase();
  if (!sym) return res.status(400).json({ error: 'symbol obrigatório' });

  const strategyIdRaw = req.query.strategy_id ?? req.query.strategyId ?? null;
  const strategyId = strategyIdRaw === 'flex' ? 'amap-15m' : strategyIdRaw;

  let parsedOverride = null;
  if (req.query.tradeConfig) {
    try {
      parsedOverride = JSON.parse(req.query.tradeConfig);
    } catch {
      return res.status(400).json({ error: 'tradeConfig JSON inválido' });
    }
  }

  // "since": inicio da janela de conferencia (ISO ou epoch ms) — so ma-cross usa.
  let sinceMs = null;
  if (req.query.since) {
    const parsed = /^\d+$/.test(req.query.since) ? Number(req.query.since) : Date.parse(req.query.since);
    if (Number.isFinite(parsed)) sinceMs = parsed;
  }

  let q = supabase
    .from('multitrade_favorites')
    .select('*')
    .eq('user_id', req.userId)
    .eq('symbol', sym);
  if (strategyId) q = q.eq('strategy_id', strategyId);
  else q = q.eq('enabled', true).order('created_at').limit(1);

  const { data, error } = await q.maybeSingle();
  if (error) return sbError(res, error, 'GET multitrade-backtest');

  // Estudo ad-hoc: sem favorito, mas com tradeConfig (preset ou override da UI)
  if (!data) {
    const sid = strategyId ?? 'ma-cross';
    if (!isMaCrossStrategy(sid) && !isVwapBandsStrategy(sid)) {
      return res.status(404).json({ error: 'Moeda não está no Multi-Trade' });
    }
    if (!parsedOverride) {
      return res.status(400).json({
        error: 'tradeConfig obrigatório para estudo sem favorito',
      });
    }
    const exchange = req.query.exchange ?? 'binance';
    const capital  = Number(req.query.capital ?? 40);
    try {
      const result = isVwapBandsStrategy(sid)
        ? await runVwapBandsBacktest({ symbol: sym, config: buildVwapBandsTradeConfig(parsedOverride), exchange, capital, sinceMs })
        : await runMaCrossBacktest({ symbol: sym, config: buildMaCrossTradeConfig(parsedOverride), exchange, capital, sinceMs });
      if (result.error) return res.status(502).json(result);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const entry    = multitradeToEntry(data);
  let config   = entry.tradeConfig ?? toEngineConfig(normalizeTradeConfig(resolveConfigBody(data)));
  const exchange = req.query.exchange ?? entry.exchange ?? 'binance';
  const capital  = Number(req.query.capital ?? entry.capital ?? 40);

  if (parsedOverride) {
    if (isMaCrossStrategy(entry.strategyId)) {
      config = buildMaCrossTradeConfig(parsedOverride);
    } else if (isVwapBandsStrategy(entry.strategyId)) {
      config = buildVwapBandsTradeConfig(parsedOverride);
    }
  }

  try {
    const result = isMaCrossStrategy(entry.strategyId)
      ? await runMaCrossBacktest({ symbol: sym, config, exchange, capital, sinceMs })
      : isVwapBandsStrategy(entry.strategyId)
        ? await runVwapBandsBacktest({ symbol: sym, config, exchange, capital, sinceMs })
        : await runAmapBacktest({ symbol: sym, config, exchange, capital });
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

// ── Config do screener automático BB+VWAP (4h) do ma-cross ──────────────────────
// enabled:false até o usuário salvar pelo menos uma vez no painel — ver mesma
// decisão em backend/bot/ma-cross/exhaustionScreener.js.
const SCREENER_CONFIG_DEFAULTS = {
  enabled: false, minVolume24h: 5_000_000, blacklist: [], maxNewPerCycle: 5, capitalPerSymbol: 40,
};

function screenerConfigRowToBody(row) {
  if (!row) return { ...SCREENER_CONFIG_DEFAULTS };
  return {
    enabled:          row.enabled !== false,
    minVolume24h:     Number(row.min_volume_24h) || SCREENER_CONFIG_DEFAULTS.minVolume24h,
    blacklist:        Array.isArray(row.blacklist) ? row.blacklist : [],
    maxNewPerCycle:   Number(row.max_new_per_cycle) || SCREENER_CONFIG_DEFAULTS.maxNewPerCycle,
    capitalPerSymbol: Number(row.capital_per_symbol) || SCREENER_CONFIG_DEFAULTS.capitalPerSymbol,
  };
}

// GET /services/sb/ma-cross-screener-config
router.get('/ma-cross-screener-config', getUserId, async (req, res) => {
  const { data, error } = await supabase
    .from('ma_cross_screener_config').select('*').eq('user_id', req.userId).maybeSingle();
  if (error) return sbError(res, error, 'GET ma-cross-screener-config');
  res.json(screenerConfigRowToBody(data));
});

// PUT /services/sb/ma-cross-screener-config
router.put('/ma-cross-screener-config', getUserId, async (req, res) => {
  const body = req.body ?? {};
  const row = {
    user_id:            req.userId,
    enabled:            body.enabled !== false,
    min_volume_24h:     Math.max(0, Number(body.minVolume24h ?? SCREENER_CONFIG_DEFAULTS.minVolume24h)),
    blacklist:          Array.isArray(body.blacklist)
      ? [...new Set(body.blacklist.map(s => String(s).toUpperCase().trim()).filter(Boolean))]
      : [],
    max_new_per_cycle:  Math.max(1, Math.round(Number(body.maxNewPerCycle ?? SCREENER_CONFIG_DEFAULTS.maxNewPerCycle))),
    capital_per_symbol: Math.max(0, Number(body.capitalPerSymbol ?? SCREENER_CONFIG_DEFAULTS.capitalPerSymbol)),
    updated_at:         new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('ma_cross_screener_config').upsert(row, { onConflict: 'user_id' }).select().single();
  if (error) return sbError(res, error, 'PUT ma-cross-screener-config');
  res.json(screenerConfigRowToBody(data));
});

// ── Config global do filtro de tendência da mediana da Bollinger (bollinger-bands) ──────────
// Valor único (não por moeda) — ver checkMedianTrendFilter em
// backend/bot/bollinger-bands/strategyEngine.js. Relido pelo bot a cada 5min.
const BOLLINGER_MEDIAN_TREND_DEFAULTS = { minAvgDiffPct: 0.2 };

function bollingerMedianTrendRowToBody(row) {
  if (!row) return { ...BOLLINGER_MEDIAN_TREND_DEFAULTS };
  const n = Number(row.min_avg_diff_pct);
  return {
    minAvgDiffPct: Number.isFinite(n) ? n : BOLLINGER_MEDIAN_TREND_DEFAULTS.minAvgDiffPct,
  };
}

// GET /services/sb/bollinger-median-trend-config
router.get('/bollinger-median-trend-config', getUserId, async (req, res) => {
  const { data, error } = await supabase
    .from('bollinger_median_trend_config').select('*').eq('user_id', req.userId).maybeSingle();
  if (error) return sbError(res, error, 'GET bollinger-median-trend-config');
  res.json(bollingerMedianTrendRowToBody(data));
});

// PUT /services/sb/bollinger-median-trend-config
router.put('/bollinger-median-trend-config', getUserId, async (req, res) => {
  const body = req.body ?? {};
  const row = {
    user_id:          req.userId,
    min_avg_diff_pct: (() => {
      const n = Number(body.minAvgDiffPct);
      return Number.isFinite(n) ? n : BOLLINGER_MEDIAN_TREND_DEFAULTS.minAvgDiffPct;
    })(),
    updated_at:       new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('bollinger_median_trend_config').upsert(row, { onConflict: 'user_id' }).select().single();
  if (error) return sbError(res, error, 'PUT bollinger-median-trend-config');
  res.json(bollingerMedianTrendRowToBody(data));
});

// ── Config global do RSI Momentum (entry/exit/stopLoss/polling/volume) ──────────────────────
// Valor único (não por moeda, não há form por favorito — ver rsi-momentum-bot.js). Relido pelo
// bot a cada ciclo do scanner (ver strategyPresets.js#loadGlobalConfigBody), então uma mudança
// salva aqui vale sem precisar reiniciar o processo.

// GET /services/sb/rsi-momentum-config
router.get('/rsi-momentum-config', getUserId, async (req, res) => {
  const { data, error } = await supabase
    .from('rsi_momentum_global_config').select('*').eq('user_id', req.userId).maybeSingle();
  if (error) return sbError(res, error, 'GET rsi-momentum-config');
  res.json(normalizeRsiMomentumConfig(data?.trade_config ?? {}));
});

// PUT /services/sb/rsi-momentum-config
router.put('/rsi-momentum-config', getUserId, async (req, res) => {
  const normalized = normalizeRsiMomentumConfig(req.body ?? {});
  const row = {
    user_id: req.userId,
    trade_config: normalized,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('rsi_momentum_global_config').upsert(row, { onConflict: 'user_id' }).select().single();
  if (error) return sbError(res, error, 'PUT rsi-momentum-config');
  res.json(normalizeRsiMomentumConfig(data.trade_config));
});

// Captura erros assíncronos que escapam dos handlers (Express 4 não faz isso automaticamente).
// Sem este handler, um throw dentro de um async route crasharia o processo inteiro.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[supabase] erro não tratado:', err.message);
  res.status(500).json({ error: err.message });
});

module.exports = router;
