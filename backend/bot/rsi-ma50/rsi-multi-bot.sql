-- ── rsi_multi_bot_state ──────────────────────────────────────────────────────
-- Um registro por (symbol, strategy_id). Cada par pode rodar estratégias distintas.
CREATE TABLE IF NOT EXISTS rsi_multi_bot_state (
  id              BIGSERIAL      PRIMARY KEY,
  symbol          TEXT           NOT NULL,
  exchange        TEXT           NOT NULL DEFAULT 'binance',
  strategy_id     TEXT           NOT NULL,             -- chave em STRATEGIES no bot
  initial_capital NUMERIC(12,4)  NOT NULL DEFAULT 100,
  capital         NUMERIC(12,4)  NOT NULL DEFAULT 100,
  phase           TEXT           NOT NULL DEFAULT 'WATCHING', -- WATCHING | PENDING | BOUGHT

  -- PENDING: aguardando queda de X% para comprar
  trigger_price   NUMERIC(20,8),
  trigger_rsi     NUMERIC(8,2),
  limit_price     NUMERIC(20,8),
  pending_since   TIMESTAMPTZ,

  -- BOUGHT: posição aberta
  buy_price       NUMERIC(20,8),
  buy_qty         NUMERIC(20,8),
  buy_usdt        NUMERIC(12,4),
  buy_time        TIMESTAMPTZ,
  rsi_entry       NUMERIC(8,2),

  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (symbol, strategy_id)
);

-- Exemplos — ajuste símbolo/capital/estratégia conforme necessário
INSERT INTO rsi_multi_bot_state (symbol, exchange, strategy_id, initial_capital, capital) VALUES
  ('BTCUSDT',  'binance', 'rsi5m30_15m70',  100, 100),
  ('ETHUSDT',  'binance', 'rsi5m30_15m70',  100, 100),
  ('LINKUSDT', 'binance', 'rsi1h35_15m85',   50,  50),
  ('TONUSDT',  'binance', 'rsi1h35_15m85',   50,  50)
ON CONFLICT (symbol, strategy_id) DO NOTHING;

-- ── rsi_multi_bot_trades ─────────────────────────────────────────────────────
-- Histórico de todas as operações fechadas.
CREATE TABLE IF NOT EXISTS rsi_multi_bot_trades (
  id             BIGSERIAL      PRIMARY KEY,
  symbol         TEXT           NOT NULL,
  exchange       TEXT,
  strategy_id    TEXT,
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
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- View útil para acompanhar resultados por estratégia
CREATE OR REPLACE VIEW rsi_multi_summary AS
SELECT
  strategy_id,
  symbol,
  COUNT(*)                            AS trades,
  SUM(pnl_usdt)                       AS total_pnl,
  ROUND(AVG(pnl_pct)::NUMERIC, 2)     AS avg_pnl_pct,
  COUNT(*) FILTER (WHERE pnl_usdt>=0) AS wins,
  COUNT(*) FILTER (WHERE pnl_usdt< 0) AS losses,
  MAX(exit_time)                      AS last_trade
FROM rsi_multi_bot_trades
GROUP BY strategy_id, symbol
ORDER BY strategy_id, total_pnl DESC;
