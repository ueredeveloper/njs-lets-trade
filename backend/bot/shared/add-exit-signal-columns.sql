-- Colunas de diagnóstico do sinal de saída em rsi_multi_bot_trades.
-- Motivo: no vwap-bands (e em qualquer bot que venda a mercado), o
-- exit_price gravado é o preço real da venda, não o preço do nível que
-- disparou o sinal (candle já fechado quando o bot decide vender). Sem essas
-- colunas não dá pra saber, depois, se o lucro caiu porque o preço já tinha
-- recuado da banda/alvo entre o fechamento do candle e a execução da ordem
-- a mercado, ou se foi o "checagem rápida" (fastCheck no intervalo de
-- pullback, ex. 15m) que disparou primeiro.
--
-- Populado hoje só pelo vwap-bands (strategyEngine.js: targetLevel,
-- targetLevelValue, decisionTime, viaFastCheck no retorno de evaluateExit).
-- Os demais bots (ma-cross, amap, swing) ficam com essas colunas null —
-- tradeExecution.js usa optional chaining, não quebra pra quem não preenche.
--
-- Execute no SQL Editor do Supabase.

ALTER TABLE rsi_multi_bot_trades
  ADD COLUMN IF NOT EXISTS target_level       text,
  ADD COLUMN IF NOT EXISTS target_level_value numeric,
  ADD COLUMN IF NOT EXISTS signal_time        timestamptz,
  ADD COLUMN IF NOT EXISTS via_fast_check      boolean;

COMMENT ON COLUMN rsi_multi_bot_trades.target_level IS
  'Nível da escada vwap-bands que gerou a saída (vwap/upper1/upper2/lower1/lower2). Null nos outros bots.';
COMMENT ON COLUMN rsi_multi_bot_trades.target_level_value IS
  'Preço do nível-alvo no momento do sinal (candle fechado) — compare com exit_price pra medir o gap da venda a mercado.';
COMMENT ON COLUMN rsi_multi_bot_trades.signal_time IS
  'Quando o candle que disparou a saída fechou — normalmente antes de exit_time (que é quando a ordem a mercado terminou de executar).';
COMMENT ON COLUMN rsi_multi_bot_trades.via_fast_check IS
  'true = saída veio da checagem rápida no intervalo curto (entry.pullback.pollInterval, ex. 15m), depois que o candle principal já estava perto do alvo/stop. false = veio do candle principal (entry.interval, ex. 1h). Null nos bots sem fastCheck.';

-- Verificação pós-alter:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'rsi_multi_bot_trades' ORDER BY ordinal_position;
