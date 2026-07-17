-- Muda o alvo de saida "Venda - Alvo % historico BB" (exit.bbTakeProfit.targetPct)
-- de qualquer valor atual para 2%, em todas as moedas com strategy_id = 'ma-cross'.
--
-- So atualiza trades que ja tem exit.bbTakeProfit configurado (nao cria a chave
-- do zero, para nao habilitar por engano um exit que nunca foi configurado).

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      trade_config,
      '{exit,bbTakeProfit,targetPct}',
      '2',
      false
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND trade_config #> '{exit,bbTakeProfit,targetPct}' IS NOT NULL;

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(
      trade_config,
      '{exit,bbTakeProfit,targetPct}',
      '2',
      false
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND trade_config #> '{exit,bbTakeProfit,targetPct}' IS NOT NULL;

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'exit'->'bbTakeProfit' AS bb_take_profit
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'ma-cross'
-- ORDER BY symbol;
