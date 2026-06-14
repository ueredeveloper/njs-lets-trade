-- ── net_bot_state ─────────────────────────────────────────────────────────────
-- Estado por símbolo para o Name Every Trading bot
-- RSI(14,1h) < 30 → compra -3%, stop loss 3%, saída RSI > 70
CREATE TABLE IF NOT EXISTS net_bot_state (
  id              BIGSERIAL     PRIMARY KEY,
  symbol          TEXT          NOT NULL UNIQUE,
  exchange        TEXT          NOT NULL DEFAULT 'binance',
  initial_capital NUMERIC(12,4) NOT NULL DEFAULT 40,
  capital         NUMERIC(12,4) NOT NULL DEFAULT 40,
  phase           TEXT          NOT NULL DEFAULT 'WATCHING',  -- WATCHING | PENDING | BOUGHT

  -- PENDING: aguardando queda de 3% para comprar
  trigger_price   NUMERIC(20,8),   -- close quando RSI < 30 foi detectado
  trigger_rsi     NUMERIC(8,2),    -- RSI no momento do gatilho
  limit_price     NUMERIC(20,8),   -- trigger_price * 0.97 — alvo de compra
  pending_since   TIMESTAMPTZ,     -- quando entrou em PENDING

  -- BOUGHT
  buy_price       NUMERIC(20,8),
  buy_qty         NUMERIC(20,8),
  buy_usdt        NUMERIC(12,4),
  buy_time        TIMESTAMPTZ,
  stop_loss       NUMERIC(20,8),   -- buy_price * 0.97
  rsi_entry       NUMERIC(8,2),

  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Mesmas moedas do hourly_bot_state
INSERT INTO net_bot_state (symbol, exchange, initial_capital, capital) VALUES
  ('LINKUSDT',  'binance', 40, 40),
  ('TONUSDT',   'binance', 40, 40),
  ('NIGHTUSDT', 'binance', 40, 40),
  ('STGUSDT',   'binance', 40, 40)
ON CONFLICT (symbol) DO NOTHING;

-- ── net_bot_trades ─────────────────────────────────────────────────────────────
-- Histórico imutável de trades fechados
CREATE TABLE IF NOT EXISTS net_bot_trades (
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
  exit_reason    TEXT,           -- 'RSI_SELL' | 'STOP_LOSS'
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
