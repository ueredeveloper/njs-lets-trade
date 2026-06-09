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
  console.error(`[supabase] ${context}:`, error.message);
  res.status(500).json({ error: error.message });
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
      variationMin: r.variation_min !== null ? Number(r.variation_min) : undefined,
    })));
  }
  res.json(data.map(r => r.symbol));
});

// POST /services/sb/favorites  { symbol, type, [exchange, interval, rsiBuy, rsiSell, variationMin] }
router.post('/favorites', getUserId, async (req, res) => {
  const type = validType(req, res);
  if (!type) return;

  const { symbol, exchange = 'gate', interval = '30m', rsiBuy = 30, rsiSell = 70, variationMin } = req.body;
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
      variationMin: r.variation_min !== null ? Number(r.variation_min) : undefined,
    })));
  }
  res.json(list.map(r => r.symbol));
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
