-- Sinais do bot 5m: entradas/saídas reais e possíveis (avaliação por tick)
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

CREATE INDEX IF NOT EXISTS five_min_bot_signals_event_type
  ON five_min_bot_signals(event_type, event_time DESC);

NOTIFY pgrst, 'reload schema';
