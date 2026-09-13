-- Rodar no SQL Editor do Supabase.
--
-- "Quase-compra" do RSI Momentum: moeda em que o RSI já CRUZOU o limiar de entrada
-- (entry.rsiThreshold) mas foi barrada por outro filtro (bandWidth, rsi5m, MACD, RSI 1h,
-- EMA cross, S/R, spikeGuard, anti-repique) — ver strategyEngine.js#evaluateEntrySignal.
-- NÃO registra RSI_NOT_CROSSING/ENTRY_OFF/INSUFFICIENT_DATA (a esmagadora maioria do mercado
-- a cada ciclo, sem valor de estudo — o RSI nem chegou perto).
--
-- Motivação: com a config default o bot empilha ~6 filtros além do cruzamento de RSI, e até
-- hoje o único registro do motivo de bloqueio era um console.log agregado por ciclo do scanner
-- (marketScanner.js) que se perde a cada nova varredura — sem histórico consultável não dava
-- pra saber se era sempre o mesmo filtro travando (ex.: volume, largura de banda) ou vários.
--
-- Gravado por backend/bot/rsi-momentum/nearMissLogger.js, chamado do marketScanner.js a cada
-- varredura (SCAN_INTERVAL_MS = 5min) em que uma moeda cai nesse caso. Dedupe em memória no
-- processo do bot: a mesma moeda só grava de novo se o motivo mudou ou já passou 30min desde o
-- último registro — sem isso a tabela cresceria sem necessidade (uma moeda pode ficar presa no
-- mesmo motivo por horas).
--
-- Lido por GET /services/rsi-momentum-near-misses (backend/services/fetchRsiMomentumNearMisses.js),
-- que alimenta o formulário "Momentum RSI · Quase-compra" em Analisar Indicadores (filtro de
-- moedas com separador de período: hoje / 3 dias / 7 dias / 30 dias / tudo).

CREATE TABLE IF NOT EXISTS public.rsi_momentum_near_misses (
  id            BIGSERIAL      PRIMARY KEY,
  symbol        TEXT           NOT NULL,
  exchange      TEXT           NOT NULL DEFAULT 'binance',
  interval      TEXT,
  detected_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  rsi           NUMERIC(8,2),
  threshold     NUMERIC(8,2),
  reason        TEXT           NOT NULL,
  detail        JSONB          NOT NULL DEFAULT '{}',
  blockers      TEXT[],
  filters_ok    SMALLINT,
  filters_total SMALLINT,
  readiness     JSONB,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rsi_momentum_near_misses_detected_at
  ON public.rsi_momentum_near_misses (detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_rsi_momentum_near_misses_symbol_detected_at
  ON public.rsi_momentum_near_misses (symbol, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_rsi_momentum_near_misses_reason
  ON public.rsi_momentum_near_misses (reason);
