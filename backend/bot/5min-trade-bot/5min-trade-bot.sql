-- ── five_min_bot_state ───────────────────────────────────────────────────────
-- Estado e capital por símbolo para o bot RSI 5m (DCA com cooldown de 2h)
CREATE TABLE IF NOT EXISTS five_min_bot_state (
  id              BIGSERIAL       PRIMARY KEY,
  symbol          TEXT            NOT NULL UNIQUE,
  exchange        TEXT            NOT NULL DEFAULT 'binance',
  initial_capital NUMERIC(12,4)   NOT NULL DEFAULT 40,
  capital         NUMERIC(12,4)   NOT NULL DEFAULT 40,
  phase           TEXT            NOT NULL DEFAULT 'WATCHING',
  buy_price       NUMERIC(20,8),
  buy_qty         NUMERIC(20,8),
  buy_usdt        NUMERIC(12,4),
  buy_time        TIMESTAMPTZ,
  last_buy_time   TIMESTAMPTZ,
  buy_count       INTEGER         NOT NULL DEFAULT 0,
  rsi_entry       NUMERIC(8,2),
  rsi_buy         NUMERIC(8,2)    NOT NULL DEFAULT 30,
  rsi_sell        NUMERIC(8,2)    NOT NULL DEFAULT 70,
  ma_filters      JSONB           DEFAULT '{"enabled":false,"filters":[{"id":"ma50-1h","enabled":true,"period":50,"interval":"1h","mode":"above","tolerancePct":0}]}'::jsonb,
  updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

-- ── Moedas iniciais (edite conforme necessário) ─────────────────────────────
INSERT INTO five_min_bot_state (symbol, exchange, initial_capital, capital)
VALUES
  ('BTCUSDT', 'binance', 40, 40)
ON CONFLICT (symbol) DO NOTHING;

-- ── five_min_bot_trades ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS five_min_bot_trades (
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
  buy_count      INTEGER,
  rsi_entry      NUMERIC(8,2),
  rsi_exit       NUMERIC(8,2),
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

-- Se a tabela já existir sem rsi_buy/rsi_sell:
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS rsi_buy  NUMERIC(8,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rsi_sell NUMERIC(8,2) NOT NULL DEFAULT 70;

-- Filtros MA para entrada (ex.: preço > MA50 1h)
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS ma_filters JSONB DEFAULT '{"enabled":false,"filters":[{"id":"ma50-1h","enabled":true,"period":50,"interval":"1h","mode":"above","tolerancePct":0}]}'::jsonb;

-- Stop loss escolhido pelo usuário: {"type":"hist"} ou {"type":"ma"}
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS stop_loss JSONB DEFAULT '{"type":"none"}'::jsonb;

-- Escopo da venda: bot_only (só buy_qty) ou wallet (saldo livre inteiro)
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS sell_scope TEXT NOT NULL DEFAULT 'bot_only';

-- Preço de entrada: {"mode":"market","belowPct":0,"maMode":"market","maBelowPct":0}
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS entry_price JSONB DEFAULT '{"mode":"market","belowPct":0,"maMode":"market","maBelowPct":0}'::jsonb;

-- Caminhos de entrada (RSI / MA50 5m) e RSI de saída para entradas MA50 5m
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS entry_paths JSONB DEFAULT '{"rsi":{"enabled":true},"ma50_5m":{"enabled":true,"trigger":"touch"},"combine":"any","pathCooldownHours":2.2,"pathCooldownSource":"ma"}'::jsonb;

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS rsi_sell_ma5m NUMERIC(8,2);

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS entry_path TEXT;

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS last_exit_reason TEXT;

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS last_exit_time TIMESTAMPTZ;

-- ── five_min_bot_signals ─────────────────────────────────────────────────────
-- Sinais: possible_entry | entry | possible_exit | exit
CREATE TABLE IF NOT EXISTS five_min_bot_signals (
  id              BIGSERIAL       PRIMARY KEY,
  state_id        BIGINT          REFERENCES five_min_bot_state(id) ON DELETE SET NULL,
  symbol          TEXT            NOT NULL,
  exchange        TEXT            NOT NULL DEFAULT 'binance',
  event_type      TEXT            NOT NULL,
  phase           TEXT            NOT NULL,
  event_time      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  price           NUMERIC(20,8),
  rsi             NUMERIC(8,2),
  rsi_buy         NUMERIC(8,2),
  rsi_sell        NUMERIC(8,2),
  ma50_1h         NUMERIC(20,8),
  ma50_5m         NUMERIC(20,8),
  ma1h_ok         BOOLEAN,
  ma5m_triggered  BOOLEAN,
  entry_path      TEXT,
  exit_reason     TEXT,
  allowed         BOOLEAN         NOT NULL DEFAULT false,
  action_key      TEXT,
  motivation      TEXT,
  candles_5m      INTEGER,
  candles_1h      INTEGER,
  details         JSONB
);

CREATE INDEX IF NOT EXISTS five_min_bot_signals_symbol_time
  ON five_min_bot_signals(symbol, event_time DESC);
