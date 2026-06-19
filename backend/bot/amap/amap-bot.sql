-- ── AMAP Multi-Trade — schema Supabase ───────────────────────────────────────
-- Execute no SQL Editor do Supabase.
-- Tabelas rsi_multi_* mantêm o nome histórico (compatibilidade).
CREATE TABLE IF NOT EXISTS rsi_multi_bot_state (
  id              BIGSERIAL      PRIMARY KEY,
  symbol          TEXT           NOT NULL,
  exchange        TEXT           NOT NULL DEFAULT 'binance',
  strategy_id     TEXT           NOT NULL,
  initial_capital NUMERIC(12,4)  NOT NULL DEFAULT 100,
  capital         NUMERIC(12,4)  NOT NULL DEFAULT 100,
  phase           TEXT           NOT NULL DEFAULT 'WATCHING',

  trigger_price   NUMERIC(20,8),
  trigger_rsi     NUMERIC(8,2),
  limit_price     NUMERIC(20,8),
  pending_since   TIMESTAMPTZ,

  buy_price       NUMERIC(20,8),
  buy_qty         NUMERIC(20,8),
  buy_usdt        NUMERIC(12,4),
  buy_time        TIMESTAMPTZ,
  rsi_entry       NUMERIC(8,2),

  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (symbol, strategy_id)
);

-- ── multitrade_favorites (UI — user_id TEXT após migration-simplify) ───────
CREATE TABLE IF NOT EXISTS multitrade_favorites (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         TEXT           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  symbol          TEXT           NOT NULL,
  exchange        TEXT           NOT NULL DEFAULT 'binance',
  strategy_id     TEXT           NOT NULL,
  capital         NUMERIC(12,4)  NOT NULL DEFAULT 100,
  entry_rsi       JSONB          NOT NULL DEFAULT '{"interval":"15m","operator":"<","value":30}',
  exit_rsi        JSONB          NOT NULL DEFAULT '{"interval":"15m","operator":">","value":70}',
  ma_conditions   JSONB          NOT NULL DEFAULT '[]',
  rule_3_candles  BOOLEAN        NOT NULL DEFAULT FALSE,
  rule_4_candles  BOOLEAN        NOT NULL DEFAULT FALSE,
  position        INTEGER        NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

-- ── rsi_multi_entry_signals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rsi_multi_entry_signals (
  id                BIGSERIAL      PRIMARY KEY,
  symbol            TEXT           NOT NULL,
  exchange          TEXT           NOT NULL DEFAULT 'binance',
  strategy_id       TEXT           NOT NULL,
  state_id          BIGINT         REFERENCES rsi_multi_bot_state(id) ON DELETE SET NULL,
  detected_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  candle_open_time  TIMESTAMPTZ,
  price             NUMERIC(20,8)  NOT NULL,
  rsi_entry         NUMERIC(8,2)   NOT NULL,
  rsi_exit          NUMERIC(8,2),
  ma50              NUMERIC(20,8),
  ma2               NUMERIC(20,8),
  above_ma_pct      NUMERIC(8,4),
  status            TEXT           NOT NULL DEFAULT 'detected',
  block_reason      TEXT,
  trigger_price     NUMERIC(20,8),
  limit_price       NUMERIC(20,8),
  pending_since     TIMESTAMPTZ,
  pending_until     TIMESTAMPTZ,
  executed_at       TIMESTAMPTZ,
  executed_price    NUMERIC(20,8),
  executed_qty      NUMERIC(20,8),
  executed_usdt     NUMERIC(12,4),
  immediate_entry   BOOLEAN        NOT NULL DEFAULT FALSE,
  trade_id          BIGINT,
  metadata          JSONB          NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── rsi_multi_exit_signals ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rsi_multi_exit_signals (
  id                 BIGSERIAL      PRIMARY KEY,
  symbol             TEXT           NOT NULL,
  exchange           TEXT           NOT NULL DEFAULT 'binance',
  strategy_id        TEXT           NOT NULL,
  state_id           BIGINT         REFERENCES rsi_multi_bot_state(id) ON DELETE SET NULL,
  entry_signal_id    BIGINT         REFERENCES rsi_multi_entry_signals(id) ON DELETE SET NULL,
  detected_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  candle_open_time   TIMESTAMPTZ,
  signal_type        TEXT           NOT NULL,
  price              NUMERIC(20,8)  NOT NULL,
  rsi_exit           NUMERIC(8,2),
  stop_loss_ma       NUMERIC(20,8),
  buy_price          NUMERIC(20,8),
  unrealized_pnl_pct NUMERIC(8,4),
  status             TEXT           NOT NULL DEFAULT 'detected',
  executed_at        TIMESTAMPTZ,
  executed_price     NUMERIC(20,8),
  executed_qty       NUMERIC(20,8),
  executed_usdt      NUMERIC(12,4),
  trade_id           BIGINT,
  metadata           JSONB          NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── rsi_multi_bot_trades ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rsi_multi_bot_trades (
  id              BIGSERIAL      PRIMARY KEY,
  symbol          TEXT           NOT NULL,
  exchange        TEXT,
  strategy_id     TEXT,
  entry_time      TIMESTAMPTZ,
  exit_time       TIMESTAMPTZ,
  entry_price     NUMERIC(20,8),
  exit_price      NUMERIC(20,8),
  qty             NUMERIC(20,8),
  usdt_in         NUMERIC(12,4),
  usdt_out        NUMERIC(12,4),
  pnl_usdt        NUMERIC(12,4),
  pnl_pct         NUMERIC(8,4),
  capital_before  NUMERIC(12,4),
  capital_after   NUMERIC(12,4),
  rsi_entry       NUMERIC(8,2),
  rsi_exit        NUMERIC(8,2),
  exit_reason     TEXT,
  duration_ms     BIGINT,
  fee_usdt        NUMERIC(12,4),
  entry_signal_id BIGINT,
  exit_signal_id  BIGINT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Views: rsi_multi_summary, rsi_multi_entry_funnel, rsi_multi_exit_funnel, rsi_multi_timeline
-- (criar via script de migração no Supabase — ver conversa / drop + create views)
