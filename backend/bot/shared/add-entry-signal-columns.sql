-- Colunas de diagnóstico do sinal de ENTRADA em rsi_multi_bot_state / rsi_multi_bot_trades.
-- Motivo: no ma-cross com pullback (execution.pullbackEntry / entry.ema50Proximity), o bot
-- detecta o cruzamento EMA num candle e só compra alguns candles depois, quando o preço faz
-- o pullback esperado — buy_time/entry_price já são o candle da COMPRA, não o do SINAL que
-- motivou a entrada. Sem essas colunas não dá pra saber, depois, onde o cruzamento realmente
-- aconteceu (o frontend mostra isso como um triângulo acima do candle do sinal).
--
-- Populado pelos bots que têm espera de pullback entre sinal e compra — ma-cross
-- (execution.pullbackEntry/ema50Proximity) e vwap-bands (entry.pullback, retorno à banda
-- tocada). ma-cross-bot.js/vwap-bands-bot.js passam entryMeta.signalOpenTime/signalPrice pro
-- executeBuy compartilhado (tradeExecution.js), que grava em rsi_multi_bot_state e depois
-- finalizeSell copia pra rsi_multi_bot_trades antes de resetar o estado. Os bots que compram
-- na hora, sem espera (amap, swing) ficam com essas colunas null — lá o candle da compra já É
-- o candle do sinal, não tem o que diferenciar. tradeExecution.js usa optional chaining, não
-- quebra pra quem não preenche.
--
-- Execute no SQL Editor do Supabase.

ALTER TABLE rsi_multi_bot_state
  ADD COLUMN IF NOT EXISTS entry_signal_time  timestamptz,
  ADD COLUMN IF NOT EXISTS entry_signal_price numeric;

ALTER TABLE rsi_multi_bot_trades
  ADD COLUMN IF NOT EXISTS entry_signal_time  timestamptz,
  ADD COLUMN IF NOT EXISTS entry_signal_price numeric;

COMMENT ON COLUMN rsi_multi_bot_state.entry_signal_time IS
  'Quando o candle de cruzamento/gatilho que motivou a compra fechou — pode ser bem antes de buy_time quando há pullback (execution.pullbackEntry/ema50Proximity): o bot espera até N candles depois do sinal pra comprar no fundo. Null se o bot não preencher (só ma-cross hoje).';
COMMENT ON COLUMN rsi_multi_bot_state.entry_signal_price IS
  'Preço de fechamento do candle de sinal (ver entry_signal_time) — não é o preço de compra (buy_price), que só sai depois do pullback.';
COMMENT ON COLUMN rsi_multi_bot_trades.entry_signal_time IS
  'Cópia de rsi_multi_bot_state.entry_signal_time no momento da venda, pra manter o dado no histórico do trade já fechado.';
COMMENT ON COLUMN rsi_multi_bot_trades.entry_signal_price IS
  'Cópia de rsi_multi_bot_state.entry_signal_price no momento da venda.';

-- Verificação pós-alter:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name IN ('rsi_multi_bot_state', 'rsi_multi_bot_trades') ORDER BY table_name, ordinal_position;
