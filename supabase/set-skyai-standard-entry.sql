-- Reverte a SKYAIUSDT (strategy_id='ma-cross') pro padrao das outras moedas
-- (ex.: OPNUSDT, LABUSDT): cruzamento EMA9x21 1h + canal EMA50 1h, sem o filtro
-- extra de %B da Bollinger Band 4h na entrada.
--
-- Duas divergencias encontradas nessa moeda em relacao ao padrao:
--   1. entryBbFilter.enabled=true -> false (filtro %B<=0.3 no 4h que barrava
--      entradas perto do teto da banda -- nao faz mais sentido pra essa moeda,
--      pedido do usuario "esse trade por banda de bollinger ja acabou")
--   2. execution.pullbackEntry.requirePullback=false -> true (as outras moedas
--      exigem um recuo de preco de verdade na janela de pullback, nao so esperar
--      candles com proximidade -- SKYAI estava com a versao mais permissiva)
--
-- Atualiza multitrade_favorites (painel) E rsi_multi_bot_state (runtime do
-- bot) -- pedido explicito do usuario pra valer imediatamente, sem depender de
-- resave pelo painel ou do sync de 5min do multitradeWatch.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{entryBbFilter,enabled}', 'false'::jsonb, false),
      '{execution,pullbackEntry,requirePullback}', 'true'::jsonb, false
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross' AND symbol = 'SKYAIUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      jsonb_set(trade_config, '{entryBbFilter,enabled}', 'false'::jsonb, false),
      '{execution,pullbackEntry,requirePullback}', 'true'::jsonb, false
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross' AND symbol = 'SKYAIUSDT';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entryBbFilter' AS bb_filter,
--        trade_config->'execution'->'pullbackEntry' AS pullback_entry
-- FROM rsi_multi_bot_state WHERE symbol = 'SKYAIUSDT' AND strategy_id = 'ma-cross';
