-- Habilita a regra de pullback por gap (discutida em sessao de analise 2 semanas)
-- em todas as moedas com strategy_id = 'ma-cross':
--   - entry.maxAboveMaPct = 3          -> gap <= 3% acima da EMA21 no cruzamento:
--                                          compra imediata.
--   - execution.pullbackEntry:
--       enabled = true                 -> gap > 3%: nao bloqueia, entra em fase
--                                          PENDING (pullback) em vez de descartar
--                                          o sinal.
--       waitCandles = 5                -> espera ate 5 candles (1h) pelo pullback.
--       approachTolerancePct = 0.5     -> dentro da janela, entra assim que a
--                                          extensao sobre a EMA21 cair a ATE 0.5%
--                                          (nao precisa tocar/cruzar abaixo, so
--                                          "chegar perto"). Se nao chegar em 5
--                                          candles, cancela (nao compra) -- e essa
--                                          a parte que evita comprar moeda que deu
--                                          um salto muito alto.
--
-- Implementacao: backend/bot/ma-cross/strategyEngine.js (evaluatePullbackCandle /
-- evaluatePullbackReady), schema: backend/bot/ma-cross/tradeConfigSchema.js
-- (execution.pullbackEntry.approachTolerancePct).
--
-- Todas as 39 moedas ma-cross atuais ja usam entry EMA9x21(1h) e saida
-- EMA9x21(1h) cross_down (conferido antes de rodar este script), entao a regra
-- vale igual pra toda a carteira sem precisar mexer em ma1/ma2/intervalo.
-- INJUSDT e SKYAIUSDT ja tinham maxAboveMaPct=3 (com pullbackEntry desligado —
-- gap > 3% simplesmente bloqueava); passam a usar o mesmo fallback de espera
-- das demais.
--
-- Atualiza multitrade_favorites (painel) E rsi_multi_bot_state (runtime do
-- bot) -- pedido explicito pra valer imediatamente ao reiniciar o bot no
-- Termux, sem depender de resave pelo painel.
--
-- Nota: aplicado via REST API (PATCH por linha) na sessao original, nao via
-- psql direto -- a conexao direta (backend/supabase/pgClient.js) nao resolveu
-- o host a partir do ambiente usado. O jsonb_set abaixo reproduz exatamente o
-- mesmo resultado, caso precise rodar de novo via SQL editor do Supabase.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(trade_config, '{entry,maxAboveMaPct}', '3'::jsonb, true),
          '{execution,pullbackEntry,enabled}', 'true'::jsonb, true
        ),
        '{execution,pullbackEntry,waitCandles}', '5'::jsonb, true
      ),
      '{execution,pullbackEntry,approachTolerancePct}', '0.5'::jsonb, true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(trade_config, '{entry,maxAboveMaPct}', '3'::jsonb, true),
          '{execution,pullbackEntry,enabled}', 'true'::jsonb, true
        ),
        '{execution,pullbackEntry,waitCandles}', '5'::jsonb, true
      ),
      '{execution,pullbackEntry,approachTolerancePct}', '0.5'::jsonb, true
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entry'->'maxAboveMaPct' AS max_above_ma2,
--        trade_config->'execution'->'pullbackEntry' AS pullback_entry
-- FROM rsi_multi_bot_state WHERE strategy_id = 'ma-cross' ORDER BY symbol;

-- Para reverter (voltar ao comportamento anterior: gap sempre bloqueia acima de 3%,
-- sem fase PENDING):
-- UPDATE multitrade_favorites
-- SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,enabled}', 'false'::jsonb, false)
-- WHERE strategy_id = 'ma-cross';
-- UPDATE rsi_multi_bot_state
-- SET trade_config = jsonb_set(trade_config, '{execution,pullbackEntry,enabled}', 'false'::jsonb, false)
-- WHERE strategy_id = 'ma-cross';
