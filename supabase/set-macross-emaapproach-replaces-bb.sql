-- Troca o filtro de entrada secundario do ma-cross: desliga o Bollinger Bands
-- 4h (%B <= 0.3) e liga no lugar a regra nova entryEmaApproach (EMA9(4h)
-- forma fundo perto da EMA21(4h) e sobe), em todas as moedas com
-- strategy_id = 'ma-cross'.
--
-- Motivo: o funil real (analyze-entry-funnel.js, 45 dias / 45 moedas) mostrou
-- quase zero sobreposicao entre BB e aproximacao — empilhar as duas junto com
-- a tendencia 4h deixava so ~13 entradas/mes em toda a carteira (1% dos
-- cruzamentos que passam a tendencia). Por isso a aproximacao substitui o BB
-- em vez de somar com ele.
--
-- Nao altera entrada (EMA9 x EMA21 cross_up 15m), tendencia 4h (entryTrendMa,
-- ja em EMA9/EMA21 4h tol 2%), saida por EMA (30m), MA adaptativa 1h, saida
-- por Bollinger Bands (bbUpper / bbTakeProfit) nem stop-loss.

BEGIN;

UPDATE multitrade_favorites
SET trade_config = trade_config
  || jsonb_build_object(
       'entryBbFilter', jsonb_build_object(
         'enabled', false,
         'interval', '4h',
         'period', 20,
         'stdDev', 2.0,
         'maxPctB', 0.3
       ),
       'entryEmaApproach', jsonb_build_object(
         'enabled', true,
         'ma1', jsonb_build_object('period', 9, 'interval', '4h'),
         'ma2', jsonb_build_object('period', 21, 'interval', '4h'),
         'approachPct', 1.5
       )
     ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

UPDATE rsi_multi_bot_state
SET trade_config = trade_config
  || jsonb_build_object(
       'entryBbFilter', jsonb_build_object(
         'enabled', false,
         'interval', '4h',
         'period', 20,
         'stdDev', 2.0,
         'maxPctB', 0.3
       ),
       'entryEmaApproach', jsonb_build_object(
         'enabled', true,
         'ma1', jsonb_build_object('period', 9, 'interval', '4h'),
         'ma2', jsonb_build_object('period', 21, 'interval', '4h'),
         'approachPct', 1.5
       )
     ),
    updated_at = now()
WHERE strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'entryBbFilter'->'enabled' AS bb_on,
--        trade_config->'entryEmaApproach' AS ema_approach
-- FROM multitrade_favorites WHERE strategy_id = 'ma-cross' ORDER BY symbol;
