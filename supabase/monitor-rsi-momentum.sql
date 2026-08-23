-- Consultas de acompanhamento do bot RSI Momentum (strategy_id: rsi-momentum) — mesmo padrão
-- das consultas rotineiras do Multi-Trade (ver supabase/database-schema.md), filtradas pra
-- essa estratégia. Troque 'BTCUSDT' pelo símbolo que quiser acompanhar.
--
-- IMPORTANTE: diferente dos outros bots, aqui NINGUÉM favorita moeda manualmente — um scanner
-- de mercado (marketScanner.js) cria a linha sozinho quando acha um sinal, e REMOVE quando o
-- ciclo termina (comprou e vendeu, ou pullback expirou sem preencher). Por isso as consultas
-- abaixo só mostram o que está ATIVO agora — fases possíveis:
--   PENDING  — ordem limite de pullback armada na corretora, aguardando reteste
--   BOUGHT   — posição comprada, bracket TP/SL rodando
--   FAILED   — corretora rejeitou a ordem (ex.: saldo insuficiente) — NÃO tenta de novo
--              sozinho; fica visível até você remover manualmente (ver consulta 7 abaixo)
--   WATCHING — só deveria aparecer por uma fração de segundo (entre a criação da linha e a
--              1ª tentativa de entrada); se você ver isso parado, é sinal de bug

-- 1) Estado atual de UMA moeda (fase, preço/qty de compra, sinal de entrada)
SELECT symbol, exchange, phase, capital, buy_price, buy_qty, buy_usdt, buy_time,
       entry_signal_time, entry_signal_price, updated_at
FROM rsi_multi_bot_state
WHERE strategy_id = 'rsi-momentum'
  AND symbol = 'BTCUSDT';

-- 2) Detalhe do rules_state — ordem limite de pullback pendente e/ou bracket OCO ativo
SELECT symbol,
       rules_state->'entryLimit'       AS ordem_limite_pullback,
       rules_state->'exitBracket'      AS bracket_oco_ativo,
       rules_state->'exitBracketError' AS erro_ao_colocar_bracket,
       rules_state->'lastExitReason'   AS ultimo_motivo_saida,
       rules_state->'lastExitTime'     AS ultima_saida_em
FROM rsi_multi_bot_state
WHERE strategy_id = 'rsi-momentum'
  AND symbol = 'BTCUSDT';

-- 3) Todas as posições RSI Momentum compradas agora (qualquer moeda)
SELECT symbol, exchange, phase, buy_price, buy_qty, buy_time, updated_at
FROM rsi_multi_bot_state
WHERE strategy_id = 'rsi-momentum'
  AND phase = 'BOUGHT'
ORDER BY symbol;

-- 4) Últimos trades fechados (alvo/stop)
SELECT symbol, entry_time, exit_time, entry_price, exit_price,
       pnl_usdt, pnl_pct, exit_reason, capital_after
FROM rsi_multi_bot_trades
WHERE strategy_id = 'rsi-momentum'
ORDER BY exit_time DESC NULLS LAST
LIMIT 20;

-- 5) PnL total e taxa de acerto por símbolo
SELECT symbol,
       COUNT(*)                                              AS trades,
       SUM(pnl_usdt)                                          AS pnl_total,
       ROUND(AVG(pnl_pct)::numeric, 2)                        AS pnl_medio_pct,
       SUM(CASE WHEN exit_reason = 'RSI_TARGET' THEN 1 ELSE 0 END) AS alvos,
       SUM(CASE WHEN exit_reason = 'STOP_LOSS'  THEN 1 ELSE 0 END) AS stops
FROM rsi_multi_bot_trades
WHERE strategy_id = 'rsi-momentum'
GROUP BY symbol
ORDER BY pnl_total DESC;

-- 6) Config (trade_config) de todos os favoritos RSI Momentum cadastrados
SELECT symbol, exchange, enabled, capital, trade_config
FROM multitrade_favorites
WHERE strategy_id = 'rsi-momentum'
ORDER BY symbol;

-- 7) Moedas com FALHA — motivo e quando aconteceu
SELECT symbol, rules_state->'entryFailure'->>'message' AS motivo,
       rules_state->'entryFailure'->>'at'      AS quando
FROM rsi_multi_bot_state
WHERE strategy_id = 'rsi-momentum' AND phase = 'FAILED'
ORDER BY (rules_state->'entryFailure'->>'at') DESC;

-- 8) Remover manualmente uma moeda com FALHA (libera ela pro scanner tentar de novo no
-- próximo sinal) — troque 'BTCUSDT' pela moeda desejada.
-- DELETE FROM rsi_multi_bot_state WHERE symbol = 'BTCUSDT' AND strategy_id = 'rsi-momentum';
-- DELETE FROM multitrade_favorites WHERE symbol = 'BTCUSDT' AND strategy_id = 'rsi-momentum';
