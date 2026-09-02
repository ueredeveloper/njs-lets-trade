-- Config GLOBAL do bot RSI Momentum = a combinacao validada no painel de Estatisticas
-- (ultima pesquisa do log backend/data/rsi-momentum-stats-searches.json, id 1788269191458).
--
--   INVESTIR POR TRADE: 20 USDT a mercado (capitalUsdt) -- nao afeta o reforco no stop (buyUsd 40)
--   ENTRADA: RSI(14) 15m cruza 69 | priorRsiFilter 3 | sem pullback | earlyConfirm 5m (RSI prov. >= 70)
--   FILTROS: largura de banda 5m >= 1.5% (lookback 300)
--            MACD 1h positivo
--            RSI 1h >= 60  (confirmacao multi-timeframe)
--            RSI 5m > 70   (confirmacao de curtissimo prazo)
--            volume 24h min $1M
--            SUPORTE/RESISTENCIA 4h (janela 50 candles) <-- NOVO no bot:
--              entra so ate 5% acima do 1o suporte abaixo do preco (filtro de desconto)
--              alvo = 3a resistencia acima da entrada (no lugar do modo de alvo)
--            spikeGuard DESLIGADO | nuvem D-1 REMOVIDA do projeto (substituida pelo S/R)
--   ALVO:  targetMode OFF (sem alvo %). As saidas sao o TETO DE LUCRO e a resistencia do S/R.
--   TETO DE LUCRO: venda FORCADA se o preco tocar +15%. exit.hardTakeProfit {enabled:true, pct:15}.
--   STOP:  FIXO -10% (stopLoss.maxLossPct 10; trailingStop desligado).
--   REFORCO NO STOP (MARTINGALE) <-- NOVO no bot: exit.reinforceOnStop {enabled:true, addDropPct:10, exitRisePct:15, buyUsd:40}.
--            Quando a compra inicial bate o stop, o bot NAO encerra -- recompra a mercado e
--            passa a operar SEM stop de protecao: +1 compra a cada -10% do ultimo aporte,
--            vende TODA a pilha no 1o +15%. Sem limite de reforcos. Sem saldo pra novo aporte:
--            avisa e vende a mercado depois de 1h. Estado em rsi_multi_bot_state.rules_state.reinforce
--            -- o bot retoma a escada no meio depois de um restart.
--            ATENCAO: depois de disparado, a posicao fica SEM stop (risco de martingale).
--
-- Uma linha por usuario (single-user). O bot rele esta tabela a cada ciclo (marketScanner.js
-- e rsi-momentum-bot.js) -- salvar aqui vale sem reiniciar, MAS com pull no Termux reinicie o
-- processo pra pegar tambem o codigo novo (S/R no bot + reforco no stop + persistencia).
--
-- Rodar no SQL Editor do Supabase depois do deploy do codigo de hoje.

BEGIN;

INSERT INTO rsi_momentum_global_config (user_id, trade_config, updated_at)
VALUES (
  'ueredeveloper',
  '{"label":"RSI Momentum","kind":"rsi_momentum","capitalUsdt":20,"entry":{"enabled":true,"interval":"15m","rsiThreshold":69,"priorRsiFilter":{"enabled":true,"count":3},"pullback":{"enabled":false,"belowPct":0.5},"earlyConfirm":{"enabled":true,"interval":"5m","rsiThreshold":70},"limitWaitCandles":20,"reentryCooldownCandles":3,"bandWidth":{"enabled":true,"interval":"5m","period":20,"stdDev":2,"lookback":300,"minPct":1.5},"rsi5mFilter":{"enabled":true,"threshold":70},"spikeGuard":{"enabled":false,"maxMovePct":5},"macdFilter":{"enabled":true,"interval":"1h"},"higherRsiFilter":{"enabled":true,"minRsi":60},"supportResistance":{"enabled":true,"interval":"4h","candleCount":50,"entrySupportRank":1,"exitResistanceRank":3,"entryMaxPct":5}},"exit":{"targetMode":"off","restingBracket":{"enabled":true,"targetPct":10},"trailingTarget":{"coinStepPct":3,"stepPct":3},"hardTakeProfit":{"enabled":true,"pct":15},"trailingStop":{"enabled":false,"mode":"continuous","startPct":5,"coinStepPct":3,"stopStepPct":2,"pivotPct":1,"aCoinStepPct":3,"aStopStepPct":2.5,"bCoinStepPct":3,"bStopStepPct":1,"pivotGainPct":5,"wNearPct":4,"wFarPct":9,"atrMult":2,"atrMaxPct":12},"reinforceOnStop":{"enabled":true,"addDropPct":10,"exitRisePct":15,"buyUsd":40}},"stopLoss":{"enabled":true,"maxLossPct":10},"polling":{"pollMs":60000,"fastPollMs":20000},"volume":{"minVolumeUsdt":1000000},"entryCooldownHours":0}'::jsonb,
  now()
)
ON CONFLICT (user_id) DO UPDATE
  SET trade_config = EXCLUDED.trade_config,
      updated_at   = now();

COMMIT;

-- Verificacao:
-- SELECT user_id,
--        trade_config->'entry'->'supportResistance'            AS suporte_resistencia,
--        trade_config->'exit'->'reinforceOnStop'               AS reforco_no_stop,
--        trade_config->'exit'->>'targetMode'                    AS alvo_modo,
--        trade_config->'exit'->'hardTakeProfit'                 AS teto_de_lucro,
--        trade_config->'stopLoss'                               AS stop,
--        trade_config->'entry'->'higherRsiFilter'               AS filtro_rsi_1h,
--        trade_config->'entry'->'rsi5mFilter'                   AS filtro_rsi_5m,
--        trade_config->'entry'->'bandWidth'                     AS largura_banda,
--        updated_at
-- FROM rsi_momentum_global_config
-- WHERE user_id = 'ueredeveloper';
