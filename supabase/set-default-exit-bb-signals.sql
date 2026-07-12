-- Ativa 2 novos sinais de venda (Bollinger Bands 4h) nas moedas ja cadastradas no Multi-Trade.
-- Gerado automaticamente em 2026-07-12 com base no historico de cada moeda
-- (media de valorizacao fundo->topo, BB(20,2) 4h -- ver backend/utils/analyseBollingerBandRecovery.js).
--
-- NAO altera a entrada (EMA9 x EMA21 cross_up) nem o sinal de saida ja existente
-- (cruzamento EMA9 x EMA21 descendo, 30m) -- so ADICIONA os dois novos sinais dentro de "exit":
--   1) bbUpper      -> vende quando o close fecha na/acima da banda superior BB(20,2) 4h
--   2) bbTakeProfit -> vende quando o ganho desde a entrada atinge a valorizacao media historica
--                     (fundo->topo da BB 4h) dessa moeda especificamente
--
-- exit.logic permanece "any": qualquer um dos sinais (EMA cross, BB topo, alvo %) dispara a venda.

BEGIN;

-- AVAXUSDT (binance) -- media historica BB 4h fundo->topo: +8.82% (9 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":8.82}}'::jsonb),
    updated_at = now()
WHERE symbol = 'AVAXUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":8.82}}'::jsonb),
    updated_at = now()
WHERE symbol = 'AVAXUSDT' AND strategy_id = 'ma-cross';

-- HMSTRUSDT (binance) -- media historica BB 4h fundo->topo: +12.69% (9 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":12.69}}'::jsonb),
    updated_at = now()
WHERE symbol = 'HMSTRUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":12.69}}'::jsonb),
    updated_at = now()
WHERE symbol = 'HMSTRUSDT' AND strategy_id = 'ma-cross';

-- AAVEUSDT (binance) -- media historica BB 4h fundo->topo: +9.92% (12 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":9.92}}'::jsonb),
    updated_at = now()
WHERE symbol = 'AAVEUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":9.92}}'::jsonb),
    updated_at = now()
WHERE symbol = 'AAVEUSDT' AND strategy_id = 'ma-cross';

-- SKYAIUSDT (gate) -- media historica BB 4h fundo->topo: +27.1% (8 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":27.1}}'::jsonb),
    updated_at = now()
WHERE symbol = 'SKYAIUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":27.1}}'::jsonb),
    updated_at = now()
WHERE symbol = 'SKYAIUSDT' AND strategy_id = 'ma-cross';

-- UTKUSDT (binance) -- media historica BB 4h fundo->topo: +11.96% (12 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":11.96}}'::jsonb),
    updated_at = now()
WHERE symbol = 'UTKUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":11.96}}'::jsonb),
    updated_at = now()
WHERE symbol = 'UTKUSDT' AND strategy_id = 'ma-cross';

-- VANRYUSDT (binance) -- media historica BB 4h fundo->topo: +11.62% (10 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":11.62}}'::jsonb),
    updated_at = now()
WHERE symbol = 'VANRYUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":11.62}}'::jsonb),
    updated_at = now()
WHERE symbol = 'VANRYUSDT' AND strategy_id = 'ma-cross';

-- XPLUSDT (binance) -- media historica BB 4h fundo->topo: +12.65% (13 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":12.65}}'::jsonb),
    updated_at = now()
WHERE symbol = 'XPLUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":12.65}}'::jsonb),
    updated_at = now()
WHERE symbol = 'XPLUSDT' AND strategy_id = 'ma-cross';

-- TIAUSDT (binance) -- media historica BB 4h fundo->topo: +11.27% (9 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":11.27}}'::jsonb),
    updated_at = now()
WHERE symbol = 'TIAUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":11.27}}'::jsonb),
    updated_at = now()
WHERE symbol = 'TIAUSDT' AND strategy_id = 'ma-cross';

-- NEARUSDT (binance) -- media historica BB 4h fundo->topo: +8.79% (9 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":8.79}}'::jsonb),
    updated_at = now()
WHERE symbol = 'NEARUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":8.79}}'::jsonb),
    updated_at = now()
WHERE symbol = 'NEARUSDT' AND strategy_id = 'ma-cross';

-- WLDUSDT (binance) -- media historica BB 4h fundo->topo: +10.2% (9 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":10.2}}'::jsonb),
    updated_at = now()
WHERE symbol = 'WLDUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":10.2}}'::jsonb),
    updated_at = now()
WHERE symbol = 'WLDUSDT' AND strategy_id = 'ma-cross';

-- SUIUSDT (binance) -- media historica BB 4h fundo->topo: +9.79% (9 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":9.79}}'::jsonb),
    updated_at = now()
WHERE symbol = 'SUIUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":9.79}}'::jsonb),
    updated_at = now()
WHERE symbol = 'SUIUSDT' AND strategy_id = 'ma-cross';

-- LTCUSDT (binance) -- media historica BB 4h fundo->topo: +6.66% (11 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":6.66}}'::jsonb),
    updated_at = now()
WHERE symbol = 'LTCUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":6.66}}'::jsonb),
    updated_at = now()
WHERE symbol = 'LTCUSDT' AND strategy_id = 'ma-cross';

-- SKLUSDT (binance) -- media historica BB 4h fundo->topo: +7.26% (10 ciclos)
UPDATE multitrade_favorites
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":7.26}}'::jsonb),
    updated_at = now()
WHERE symbol = 'SKLUSDT';

UPDATE rsi_multi_bot_state
SET trade_config = jsonb_set(trade_config, '{exit}', (trade_config->'exit') || '{"bbUpper":{"enabled":true,"interval":"4h","period":20,"stdDev":2},"bbTakeProfit":{"enabled":true,"targetPct":7.26}}'::jsonb),
    updated_at = now()
WHERE symbol = 'SKLUSDT' AND strategy_id = 'ma-cross';

COMMIT;

-- Verificacao pos-update:
-- SELECT symbol, trade_config->'exit'->'bbUpper' AS bb_upper, trade_config->'exit'->'bbTakeProfit' AS bb_take_profit
-- FROM multitrade_favorites ORDER BY symbol;
