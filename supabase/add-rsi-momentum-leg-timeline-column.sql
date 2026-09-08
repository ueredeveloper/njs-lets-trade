-- Rodar no SQL Editor do Supabase.
--
-- Histórico por PERNA do ciclo "Reforço no stop" (rearm / ladder) do RSI Momentum.
--
-- Hoje, quando um ciclo com reforço fecha, o rsi_multi_bot_trades grava 1 linha AGREGADA
-- (P&L total do ciclo) e as pernas individuais (1ª compra estopada, cada recompra de
-- reforço, saída final) somem. Estas colunas guardam o ciclo inteiro:
--
--   leg_timeline    JSONB  -- [{ entryTime, entryPrice, exitTime, exitPrice, outcome }]
--                          --   outcome ∈ 'stop' | 'target' | 'open'
--                          --   mesma forma do backtest (analyseRsiThresholdBacktest.js) e
--                          --   do rules_state.rearm.legTimeline / rules_state.reinforce.legTimeline
--   reinforce_mode  TEXT   -- 'rearm' | 'ladder' | NULL (ciclo sem reforço)
--   reinforce_rungs SMALLINT -- nº de reforços disparados no ciclo (0 = nenhum)
--
-- Gravado por finalizeSell em backend/bot/shared/tradeExecution.js. Aditivo e no-op pros
-- outros bots (ma-cross, vwap-bands, bollinger) — leg_timeline fica NULL quando não houve
-- reforço.
--
-- IMPORTANTE: rodar ANTES de subir o bot novo. insertTrade falha a linha inteira se a
-- coluna não existir (ver a regressão de 08/2026 em que trades fechados sumiram).

ALTER TABLE public.rsi_multi_bot_trades
  ADD COLUMN IF NOT EXISTS leg_timeline    JSONB,
  ADD COLUMN IF NOT EXISTS reinforce_mode  TEXT,
  ADD COLUMN IF NOT EXISTS reinforce_rungs SMALLINT DEFAULT 0;
