-- Config GLOBAL do bot RSI Momentum = a combinacao VENCEDORA do painel de estatisticas
-- (registro #1787853954071 do log backend/data/rsi-momentum-stats-searches.json):
--
--   ALVO:  CONTINUO, base +5%, sobe 3 p.p. a cada +3% de novo pico  (exit.targetMode='continuous'
--          + exit.trailingTarget {coinStepPct:3, stepPct:3})
--   STOP:  CONTINUO, -5% inicial, sobe 1 p.p. a cada +3% de novo pico  (exit.trailingStop
--          {startPct:5, coinStepPct:3, stopStepPct:1})  -- o degrau mais LENTO testado
--   Nuvem D-1: 90% do envelope, 1d x5 candles, corpo (abertura/fechamento, useHighLow=false)
--   Largura de banda: min 2.5% em 5m, lookback 200
--   MACD 1h ligado | volume 24h min $1M
--   rsi5mFilter DESLIGADO de proposito -- o backtest nao modela esse filtro, entao pra o bot
--   bater com os ~63 sinais / +3.06% P&L medio observados ele fica off. Se quiser mais rigor,
--   religue no painel (Configuracoes -> RSI Momentum).
--
-- Backtest: janela de ~11 dias, mercado inteiro (187 moedas apos filtros), aporte $100 ->
--   63 sinais, acerto 39.7%, P&L medio +3.06%/trade, P&L total +$193. Poucos acertos mas
--   grandes (alvo continuo deixa correr); perdas presas perto de -5%. ATENCAO: e UMA janela
--   -- rodar de novo daqui 1-2 semanas antes de confiar de vez.
--
-- Uma linha por usuario (single-user). O bot rele esta tabela a cada ciclo (marketScanner.js
-- e rsi-momentum-bot.js) -- salvar aqui vale sem reiniciar, mas com pull no Termux reinicie o
-- processo pra pegar tambem o codigo novo (alvo/stop independentes).
--
-- Rodar no SQL Editor do Supabase depois do deploy do codigo de hoje.

BEGIN;

INSERT INTO rsi_momentum_global_config (user_id, trade_config, updated_at)
VALUES (
  'ueredeveloper',
  '{"label":"RSI Momentum","kind":"rsi_momentum","entry":{"enabled":true,"interval":"15m","rsiThreshold":69,"priorRsiFilter":{"enabled":true,"count":3},"pullback":{"enabled":false,"belowPct":0.5},"earlyConfirm":{"enabled":true,"interval":"5m"},"limitWaitCandles":20,"reentryCooldownCandles":3,"bandWidth":{"enabled":true,"interval":"5m","period":20,"stdDev":2,"lookback":200,"minPct":2.5},"rsi5mFilter":{"enabled":false,"threshold":70},"spikeGuard":{"enabled":false,"maxMovePct":5},"prevDayCloud":{"enabled":true,"maxPct":90,"interval":"1d","candleCount":5,"useHighLow":false},"macdFilter":{"enabled":true,"interval":"1h"}},"exit":{"targetMode":"continuous","restingBracket":{"enabled":true,"targetPct":5},"trailingTarget":{"coinStepPct":3,"stepPct":3},"trailingStop":{"enabled":true,"startPct":5,"coinStepPct":3,"stopStepPct":1}},"stopLoss":{"enabled":true,"maxLossPct":5},"polling":{"pollMs":60000,"fastPollMs":20000},"volume":{"minVolumeUsdt":1000000},"entryCooldownHours":0}'::jsonb,
  now()
)
ON CONFLICT (user_id) DO UPDATE
  SET trade_config = EXCLUDED.trade_config,
      updated_at   = now();

COMMIT;

-- Verificacao:
-- SELECT user_id,
--        trade_config->'exit'->>'targetMode'                 AS alvo_modo,
--        trade_config->'exit'->'trailingTarget'              AS alvo_degraus,
--        trade_config->'exit'->'trailingStop'                AS stop_continuo,
--        trade_config->'entry'->'prevDayCloud'               AS nuvem_d1,
--        trade_config->'entry'->'bandWidth'                  AS largura_banda,
--        trade_config->'entry'->'rsi5mFilter'->>'enabled'    AS rsi5m,
--        updated_at
-- FROM rsi_momentum_global_config
-- WHERE user_id = 'ueredeveloper';
