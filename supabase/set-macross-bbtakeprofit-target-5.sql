-- Muda o alvo de saida "Venda - Alvo % historico BB" (exit.bbTakeProfit.targetPct)
-- de qualquer valor atual para 5%, em todas as moedas com strategy_id = 'ma-cross'.
--
-- So atualiza trades que ja tem exit.bbTakeProfit configurado (nao cria a chave
-- do zero, para nao habilitar por engano um exit que nunca foi configurado).
--
-- So atualiza multitrade_favorites (painel). O bot em producao le trade_config de
-- rsi_multi_bot_state, entao essa mudanca so chega ao bot rodando quando cada
-- moeda for re-salva pelo painel Multi-Trade (ou pelo sync multitradeWatch de 5min).

BEGIN;

UPDATE multitrade_favorites
SET trade_config = jsonb_set(
      trade_config,
      '{exit,bbTakeProfit,targetPct}',
      '5',
      false
    ),
    updated_at = now()
WHERE strategy_id = 'ma-cross'
  AND trade_config #> '{exit,bbTakeProfit,targetPct}' IS NOT NULL;

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, exchange, trade_config->'exit'->'bbTakeProfit' AS bb_take_profit
-- FROM multitrade_favorites
-- WHERE strategy_id = 'ma-cross'
-- ORDER BY symbol;
