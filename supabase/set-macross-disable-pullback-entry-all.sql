-- Desliga o pullbackEntry (fase PENDING apos o cruzamento das medias, que espera
-- ate N candles por um "fundo" antes de comprar) em todas as moedas com
-- strategy_id = 'ma-cross'. Com enabled:false, a compra acontece imediatamente
-- no cruzamento, sem passar por "aguardando pullback".
--
-- Motivacao: o commit e107d62 (24/07) so trocou o DEFAULT do schema/preset pra
-- enabled:false — vale apenas pra configs novas, nao retroage sobre moedas que ja
-- tinham o campo salvo. Conferido no JTOUSDT: trade_config.execution.pullbackEntry
-- ainda estava { enabled: true, requirePullback: true }, herdado de um resave via
-- painel em 22/07 (antes do fix de default), por isso o bot mostrava "Aguardando
-- pullback" mesmo achando que a regra tinha sido removida.
--
-- Nao mexe em requirePullback nem waitCandles (json path especifico, so
-- execution.pullbackEntry.enabled), entao se algum dia enabled voltar a true
-- esses campos continuam com o valor que estavam.
--
-- Atualiza multitrade_favorites (painel) E rsi_multi_bot_state (runtime do
-- bot) — pedido explicito pra valer imediatamente, sem depender de resave
-- pelo painel ou do sync de 5min do multitradeWatch.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,enabled}', 'false'::jsonb, false),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'execution'->'pullbackEntry' AS pullback_entry
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;

-- Para reverter (voltar a exigir pullback):
-- UPDATE multitrade_favorites SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,enabled}', 'true'::jsonb, false) WHERE strategy_id = 'ma-cross';
-- UPDATE rsi_multi_bot_state SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,enabled}', 'true'::jsonb, false) WHERE strategy_id = 'ma-cross';
