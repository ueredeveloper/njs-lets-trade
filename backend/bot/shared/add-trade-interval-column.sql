-- Coluna `interval` em rsi_multi_bot_trades.
-- Motivo: quando um favorito MA-Cross/VWAP Bands/Bollinger Bands é reconfigurado pra outro
-- intervalo (ex.: 5m -> 1h), o strategy_id continua o mesmo, então os trades fechados sob a
-- config antiga ficavam misturados no mesmo histórico dos trades novos (ver
-- rsi_multi_bot_trades filtrado só por symbol+strategy_id em GET /multitrade-trades). O
-- frontend usa essa coluna pra mostrar, nos marcadores do gráfico da favorita, só os trades
-- do intervalo atualmente configurado — trades gravados antes desta coluna existir ficam com
-- interval NULL e continuam aparecendo (não dá pra saber retroativamente em qual intervalo
-- rodaram).
--
-- Populado por tradeExecution.js (resolveConfigInterval) em todo fechamento de trade.
--
-- Execute no SQL Editor do Supabase.

ALTER TABLE rsi_multi_bot_trades
  ADD COLUMN IF NOT EXISTS interval TEXT;

COMMENT ON COLUMN rsi_multi_bot_trades.interval IS
  'Intervalo de entrada da estratégia (entry.interval ou entry.ma1.interval, conforme a config) no momento do fechamento do trade. NULL em trades gravados antes desta coluna existir.';

-- Verificação pós-alter:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'rsi_multi_bot_trades' ORDER BY ordinal_position;
