'use strict';

/**
 * GET /services/dedicated-bot/state?symbol=STGUSDT   → estado atual + capital
 * GET /services/dedicated-bot/trades?symbol=STGUSDT  → histórico de operações
 * GET /services/dedicated-bot/summary?symbol=STGUSDT → resumo estatístico
 *
 * Aliases antigos (para não quebrar clientes existentes):
 * GET /services/stg-bot/state|trades|summary  → redireciona para STGUSDT
 */

const router = require('express').Router();

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbGet(table, query = '') {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status}`);
  return res.json();
}

function resolveSymbol(req) {
  return ((req.query.symbol || 'STGUSDT')).toUpperCase();
}

// ── Estado atual ──────────────────────────────────────────────────────────────
async function handleState(req, res) {
  try {
    const symbol = resolveSymbol(req);
    const rows   = await sbGet('dedicated_bot_state', `?symbol=eq.${symbol}&limit=1`);
    if (!rows?.length) return res.status(404).json({ error: `Estado não encontrado para ${symbol}. Execute a migration SQL.` });
    const s = rows[0];
    res.json({
      symbol:          s.symbol,
      initialCapital:  parseFloat(s.initial_capital),
      capital:         parseFloat(s.capital),
      phase:           s.phase,
      position:   s.phase === 'BOUGHT' ? {
        buyPrice:  parseFloat(s.buy_price),
        buyQty:    parseFloat(s.buy_qty),
        buyUsdt:   parseFloat(s.buy_usdt),
        buyTime:   s.buy_time,
        rsiEntry:  s.rsi_entry  !== null ? parseFloat(s.rsi_entry)  : null,
        ema200:    s.ema200_entry !== null ? parseFloat(s.ema200_entry) : null,
      } : null,
      updatedAt: s.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Histórico de trades ────────────────────────────────────────────────────────
async function handleTrades(req, res) {
  try {
    const symbol = resolveSymbol(req);
    const limit  = Math.min(parseInt(req.query.limit  ?? '50'), 200);
    const offset = parseInt(req.query.offset ?? '0');
    const rows   = await sbGet(
      'dedicated_bot_trades',
      `?symbol=eq.${symbol}&order=exit_time.desc&limit=${limit}&offset=${offset}`,
    );
    res.json((rows ?? []).map(t => ({
      id:            t.id,
      symbol:        t.symbol,
      entryTime:     t.entry_time,
      exitTime:      t.exit_time,
      entryPrice:    parseFloat(t.entry_price),
      exitPrice:     parseFloat(t.exit_price),
      qty:           parseFloat(t.qty),
      usdtIn:        parseFloat(t.usdt_in),
      usdtOut:       parseFloat(t.usdt_out),
      pnlUsdt:       parseFloat(t.pnl_usdt),
      pnlPct:        parseFloat(t.pnl_pct),
      capitalBefore: parseFloat(t.capital_before),
      capitalAfter:  parseFloat(t.capital_after),
      rsiEntry:      t.rsi_entry   !== null ? parseFloat(t.rsi_entry)   : null,
      rsiExit:       t.rsi_exit    !== null ? parseFloat(t.rsi_exit)    : null,
      ema200:        t.ema200      !== null ? parseFloat(t.ema200)       : null,
      trendBullish:  t.trend_bullish,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Resumo estatístico ────────────────────────────────────────────────────────
async function handleSummary(req, res) {
  try {
    const symbol = resolveSymbol(req);
    const [stateRows, tradeRows] = await Promise.all([
      sbGet('dedicated_bot_state',  `?symbol=eq.${symbol}&limit=1`),
      sbGet('dedicated_bot_trades', `?symbol=eq.${symbol}&order=exit_time.asc`),
    ]);

    if (!stateRows?.length) return res.status(404).json({ error: `Estado não encontrado para ${symbol}.` });

    const state         = stateRows[0];
    const trades        = tradeRows ?? [];
    const initialCap    = parseFloat(state.initial_capital);
    const currentCap    = parseFloat(state.capital);
    const wins          = trades.filter(t => parseFloat(t.pnl_usdt) > 0);
    const losses        = trades.filter(t => parseFloat(t.pnl_usdt) <= 0);
    const totalPnl      = trades.reduce((s, t) => s + parseFloat(t.pnl_usdt), 0);

    res.json({
      symbol,
      currentCapital:  currentCap,
      initialCapital:  initialCap,
      totalReturn:     currentCap - initialCap,
      totalReturnPct:  initialCap ? ((currentCap - initialCap) / initialCap) * 100 : 0,
      phase:           state.phase,
      totalTrades:     trades.length,
      wins:            wins.length,
      losses:          losses.length,
      winRate:         trades.length ? (wins.length / trades.length) * 100 : 0,
      totalPnlUsdt:    totalPnl,
      avgPnlPct:       trades.length
        ? trades.reduce((s, t) => s + parseFloat(t.pnl_pct), 0) / trades.length
        : 0,
      bestTrade:  trades.length ? Math.max(...trades.map(t => parseFloat(t.pnl_pct))) : 0,
      worstTrade: trades.length ? Math.min(...trades.map(t => parseFloat(t.pnl_pct))) : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Rotas genéricas ───────────────────────────────────────────────────────────
router.get('/dedicated-bot/state',   handleState);
router.get('/dedicated-bot/trades',  handleTrades);
router.get('/dedicated-bot/summary', handleSummary);

// ── Aliases legados (backward-compat) ─────────────────────────────────────────
router.get('/stg-bot/state',   (req, res, next) => { req.query.symbol = req.query.symbol || 'STGUSDT'; return handleState(req, res, next); });
router.get('/stg-bot/trades',  (req, res, next) => { req.query.symbol = req.query.symbol || 'STGUSDT'; return handleTrades(req, res, next); });
router.get('/stg-bot/summary', (req, res, next) => { req.query.symbol = req.query.symbol || 'STGUSDT'; return handleSummary(req, res, next); });

module.exports = router;
