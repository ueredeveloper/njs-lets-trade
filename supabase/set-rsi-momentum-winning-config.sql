-- Config GLOBAL do bot RSI Momentum = a combinacao testada no painel de Estatisticas
-- (base = registro #9 do log backend/data/rsi-momentum-stats-searches.json + Escada Dupla + RSI 1h >= 55).
--
--   ENTRADA: RSI(14) 15m cruza 69 | priorRsiFilter 3 | sem pullback | earlyConfirm 5m
--   FILTROS: largura de banda 5m >= 1.5% (lookback 100)
--            nuvem D-1 ate 90% do envelope, 8h x3 candles, corpo (useHighLow=false)
--            MACD 1h positivo
--            RSI 1h >= 55  <-- NOVO: confirmacao multi-timeframe (checkHigherRsiFilter)
--            volume 24h min $1M
--            spikeGuard DESLIGADO (o backtest nao modela; religue no painel se quiser mais rigor)
--            rsi5mFilter DESLIGADO
--   ALVO:  CONTINUO, base +5%, sobe 3 p.p. a cada +3% de novo pico
--   TETO DE LUCRO: venda FORCADA se o preco tocar +15% (garante a saida em altas que revertem
--            antes do alvo continuo preencher -- ver EDENUSDT 28/08, que fez +17% e o trailing
--            so travou +4%). exit.hardTakeProfit {enabled:true, pct:15}.
--   STOP:  ESCADA DUPLA (twoPhase) -- ancorada na entrada, 2 inclinacoes:
--            inicial -4% | fase A: sobe 2.5 p.p. a cada +3% ate travar +1% de lucro
--            fase B: sobe 1 p.p. a cada +3% dali em diante. Sempre monotonico (nunca desce).
--
-- Comparativo (mercado inteiro, 15m, ~10 dias, aporte $100, excluir em aberto):
--   Escada Dupla + RSI 1h >= 50 -> ~30% acerto, +2.8%/trade, +$324
--   Escada Dupla + RSI 1h >= 55 -> ~35% acerto, +3.2%/trade, +$228   <-- esta config
--   Escada Dupla bate Trilha do Topo e Trilha ATR em todos os cortes. ATENCAO: validar em
--   2-3 janelas independentes antes de confiar de vez (rodar de novo daqui 1-2 semanas).
--
-- Uma linha por usuario (single-user). O bot rele esta tabela a cada ciclo (marketScanner.js
-- e rsi-momentum-bot.js) -- salvar aqui vale sem reiniciar, MAS com pull no Termux reinicie o
-- processo pra pegar tambem o codigo novo (modos de stop Escada Dupla/Trilha + filtro RSI 1h).
--
-- Rodar no SQL Editor do Supabase depois do deploy do codigo de hoje.

BEGIN;

INSERT INTO rsi_momentum_global_config (user_id, trade_config, updated_at)
VALUES (
  'ueredeveloper',
  '{"label":"RSI Momentum","kind":"rsi_momentum","entry":{"enabled":true,"interval":"15m","rsiThreshold":69,"priorRsiFilter":{"enabled":true,"count":3},"pullback":{"enabled":false,"belowPct":0.5},"earlyConfirm":{"enabled":true,"interval":"5m"},"limitWaitCandles":20,"reentryCooldownCandles":3,"bandWidth":{"enabled":true,"interval":"5m","period":20,"stdDev":2,"lookback":100,"minPct":1.5},"rsi5mFilter":{"enabled":false,"threshold":70},"spikeGuard":{"enabled":false,"maxMovePct":5},"prevDayCloud":{"enabled":true,"maxPct":90,"interval":"8h","candleCount":3,"useHighLow":false},"macdFilter":{"enabled":true,"interval":"1h"},"higherRsiFilter":{"enabled":true,"minRsi":55}},"exit":{"targetMode":"continuous","restingBracket":{"enabled":true,"targetPct":5},"trailingTarget":{"coinStepPct":3,"stepPct":3},"hardTakeProfit":{"enabled":true,"pct":15},"trailingStop":{"enabled":true,"mode":"twoPhase","startPct":4,"coinStepPct":3,"stopStepPct":2,"pivotPct":1,"aCoinStepPct":3,"aStopStepPct":2.5,"bCoinStepPct":3,"bStopStepPct":1,"pivotGainPct":5,"wNearPct":4,"wFarPct":9,"atrMult":2,"atrMaxPct":12}},"stopLoss":{"enabled":true,"maxLossPct":4},"polling":{"pollMs":60000,"fastPollMs":20000},"volume":{"minVolumeUsdt":1000000},"entryCooldownHours":0}'::jsonb,
  now()
)
ON CONFLICT (user_id) DO UPDATE
  SET trade_config = EXCLUDED.trade_config,
      updated_at   = now();

COMMIT;

-- Verificacao:
-- SELECT user_id,
--        trade_config->'exit'->'trailingStop'->>'mode'         AS stop_modo,
--        trade_config->'exit'->'trailingStop'                   AS stop_params,
--        trade_config->'exit'->>'targetMode'                    AS alvo_modo,
--        trade_config->'exit'->'hardTakeProfit'                 AS teto_de_lucro,
--        trade_config->'entry'->'higherRsiFilter'               AS filtro_rsi_1h,
--        trade_config->'entry'->'prevDayCloud'                  AS nuvem_d1,
--        trade_config->'entry'->'bandWidth'                     AS largura_banda,
--        updated_at
-- FROM rsi_momentum_global_config
-- WHERE user_id = 'ueredeveloper';
