-- Coluna `curated` em rsi_multi_bot_state — marca uma moeda como WATCHLIST MANUAL do RSI
-- Momentum: o bot a vigia indefinidamente mesmo que o scanner de mercado (que só varre a
-- Binance) nunca a sinalize — caso da SKYAI, que só existe na Gate.
--
-- Efeito no bot (ver retireAutoFavorite em backend/bot/rsi-momentum/rsi-momentum-bot.js):
-- linha com curated = true NUNCA é removida. Depois que um trade fecha (alvo/stop/reforço), ou
-- se o pullback expira / o sinal não se confirma, ela volta pra phase 'WATCHING' e segue
-- aguardando o próximo sinal — em vez de apagar favorito + estado e devolver a moeda pro pool.
--
-- Moedas criadas pelo scanner continuam com curated = false (default) e o comportamento
-- normal (favorito automático, removido quando o ciclo termina).

ALTER TABLE public.rsi_multi_bot_state
  ADD COLUMN IF NOT EXISTS curated BOOLEAN NOT NULL DEFAULT false;
