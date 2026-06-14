-- ── ma50_bot_state ────────────────────────────────────────────────────────────
-- Estado por símbolo para o trading-rsi-35-70-ma-50-1h bot
-- RSI(14,1m) < 30 + preço > MA50(1h) → entrada -0,1%, saída RSI(14,1m) > 70
CREATE TABLE IF NOT EXISTS ma50_bot_state (
  id              BIGSERIAL     PRIMARY KEY,
  symbol          TEXT          NOT NULL UNIQUE,
  exchange        TEXT          NOT NULL DEFAULT 'binance',
  initial_capital NUMERIC(12,4) NOT NULL DEFAULT 40,
  capital         NUMERIC(12,4) NOT NULL DEFAULT 40,
  phase           TEXT          NOT NULL DEFAULT 'WATCHING',  -- WATCHING | PENDING | BOUGHT

  -- PENDING: aguardando queda de 0,1% para comprar
  trigger_price   NUMERIC(20,8),   -- close quando RSI(1m) < 30 foi detectado
  trigger_rsi     NUMERIC(8,2),
  limit_price     NUMERIC(20,8),   -- trigger_price * 0.999
  pending_since   TIMESTAMPTZ,

  -- BOUGHT
  buy_price       NUMERIC(20,8),
  buy_qty         NUMERIC(20,8),
  buy_usdt        NUMERIC(12,4),
  buy_time        TIMESTAMPTZ,
  rsi_entry       NUMERIC(8,2),
  ma50_entry      NUMERIC(20,8),

  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Mesmas moedas dos outros bots
INSERT INTO ma50_bot_state (symbol, exchange, initial_capital, capital) VALUES
  ('LINKUSDT',  'binance', 40, 40),
  ('TONUSDT',   'binance', 40, 40),
  ('NIGHTUSDT', 'binance', 40, 40),
  ('STGUSDT',   'binance', 40, 40)
ON CONFLICT (symbol) DO NOTHING;

-- ── ma50_bot_trades ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ma50_bot_trades (
  id             BIGSERIAL     PRIMARY KEY,
  symbol         TEXT          NOT NULL,
  exchange       TEXT,
  entry_time     TIMESTAMPTZ,
  exit_time      TIMESTAMPTZ,
  entry_price    NUMERIC(20,8),
  exit_price     NUMERIC(20,8),
  qty            NUMERIC(20,8),
  usdt_in        NUMERIC(12,4),
  usdt_out       NUMERIC(12,4),
  pnl_usdt       NUMERIC(12,4),
  pnl_pct        NUMERIC(8,4),
  capital_before NUMERIC(12,4),
  capital_after  NUMERIC(12,4),
  rsi_entry      NUMERIC(8,2),
  rsi_exit       NUMERIC(8,2),
  ma50_entry     NUMERIC(20,8),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
