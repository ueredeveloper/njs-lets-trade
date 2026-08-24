-- ⚠️ OBSOLETO pro uso normal — a partir da versão com scanner de mercado (ver
-- backend/bot/rsi-momentum/marketScanner.js), o RSI Momentum NÃO é mais uma estratégia
-- favoritada manualmente: o próprio bot varre o mercado inteiro e cria/remove o favorito
-- sozinho quando encontra (e depois resolve) um sinal. Uma linha inserida por este script
-- fica "presa" — o bot nunca a apaga automaticamente (só remove o que ele mesmo criou) e o
-- scanner vai pular essa moeda pra sempre, achando que ela já está sendo rastreada.
--
-- Mantido só como referência do formato de trade_config (útil se algum dia existir edição
-- manual/config global no painel) e pra depuração manual pontual. Se você rodar isso pra
-- testar, DELETE a linha depois (ver supabase/monitor-rsi-momentum.sql).
--
-- trade_config espelha exatamente o motor do backtest (Estatísticas → Momentum RSI):
--   entry.interval          intervalo do sinal de RSI (candle onde o RSI é calculado)
--   entry.rsiThreshold      RSI cruzando pra CIMA deste valor = sinal (ex.: 70 = sobrecompra)
--   entry.pullback          desligado = compra a mercado no sinal; ligado = ordem limite
--                            signalPrice*(1-belowPct%), avaliada minuto a minuto
--   entry.limitWaitCandles  candles de 1 MINUTO de espera pro pullback preencher (não é
--                            candles do entry.interval)
--   entry.reentryCooldownCandles  candles do entry.interval de espera após QUALQUER venda
--   entry.bandWidth         filtro opcional de largura de banda (mesmo motor do "Larg%" do
--                            mercado) — só entra se a moeda estiver "andando o suficiente"
--   exit.restingBracket.targetPct  alvo de lucro fixo (%) — bracket OCO real (Binance) ou
--                            emulado (Gate.io), colocado na corretora logo após a compra
--   stopLoss.maxLossPct     stop fixo (%) — junto com o alvo, forma o bracket OCO

BEGIN;

INSERT INTO multitrade_favorites (user_id, symbol, exchange, strategy_id, enabled, capital, trade_config)
VALUES (
  'ueredeveloper',      -- SUPABASE_DEFAULT_USER_ID do .env — mesmo user_id dos outros favoritos
  'BTCUSDT',            -- símbolo (troque pela moeda desejada)
  'binance',            -- 'binance' ou 'gate'
  'rsi-momentum',
  true,
  40,                   -- capital em USDT por trade
  jsonb_build_object(
    'label', 'RSI Momentum',
    'kind', 'rsi_momentum',
    'entry', jsonb_build_object(
      'enabled', true,
      'interval', '15m',
      'rsiThreshold', 70,
      'pullback', jsonb_build_object('enabled', false, 'belowPct', 1),
      'limitWaitCandles', 20,
      'reentryCooldownCandles', 3,
      'bandWidth', jsonb_build_object(
        'enabled', false, 'interval', '5m', 'period', 20, 'stdDev', 2, 'lookback', 300, 'minPct', 2
      )
    ),
    'exit', jsonb_build_object(
      'restingBracket', jsonb_build_object('enabled', true, 'targetPct', 5)
    ),
    'stopLoss', jsonb_build_object('enabled', true, 'maxLossPct', 5),
    'polling', jsonb_build_object('pollMs', 60000, 'fastPollMs', 20000),
    'volume', jsonb_build_object('minVolumeUsdt', 1000000),
    'entryCooldownHours', 0
  )
)
ON CONFLICT (user_id, symbol, strategy_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, capital = EXCLUDED.capital, trade_config = EXCLUDED.trade_config;

-- IMPORTANTE: multitrade_favorites sozinho não é suficiente — o bot lê o estado de
-- rsi_multi_bot_state (ver loadRows em rsi-momentum-bot.js), que só é criado automaticamente
-- quando o favorito é salvo pela API do painel (POST /services/sb/multitrade-favorites →
-- syncBotState). Inserindo direto via SQL, precisamos criar essa linha também, senão o bot
-- nunca vê a moeda (nem no boot, nem no sync periódico de 3 em 3 min — ver multitradeWatch.js,
-- que só ATUALIZA linhas de rsi_multi_bot_state já existentes, nunca cria uma nova sozinho).
INSERT INTO rsi_multi_bot_state (symbol, exchange, strategy_id, initial_capital, capital, trade_config, phase)
SELECT symbol, exchange, strategy_id, capital, capital, trade_config, 'WATCHING'
FROM multitrade_favorites
WHERE strategy_id = 'rsi-momentum' AND symbol = 'BTCUSDT'
ON CONFLICT (symbol, strategy_id) DO UPDATE
  SET exchange = EXCLUDED.exchange, capital = EXCLUDED.capital, trade_config = EXCLUDED.trade_config;

COMMIT;

-- Verificação:
-- SELECT symbol, exchange, enabled, capital, trade_config
-- FROM multitrade_favorites
-- WHERE strategy_id = 'rsi-momentum';
--
-- SELECT symbol, exchange, phase, capital, trade_config
-- FROM rsi_multi_bot_state
-- WHERE strategy_id = 'rsi-momentum';
