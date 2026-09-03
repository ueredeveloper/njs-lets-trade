-- ─────────────────────────────────────────────────────────────────────────────
-- SKYAIUSDT (Gate.io) como WATCHLIST CURADA do bot RSI Momentum.
--
-- Contexto: o RSI Momentum não tem favorito manual — um scanner varre o mercado da BINANCE e
-- cria/remove o favorito sozinho. SKYAI só existe na Gate, então o scanner nunca a sinaliza.
-- Este script registra a moeda com `curated = true` (ver add-rsi-momentum-curated-column.sql):
-- o bot passa a vigiá-la numa sessão dedicada, com config EXCLUSIVA, e depois de cada trade
-- ela volta pra WATCHING (nunca é removida) — fica comprando/vendendo indefinidamente.
--
-- PRÉ-REQUISITOS:
--   1. Rode add-rsi-momentum-curated-column.sql PRIMEIRO (cria a coluna `curated`).
--   2. Suba o bot com o código que respeita `curated` (retireAutoFavorite atualizado).
--   3. Saldo USDT na conta Gate.io (o bot compra a mercado; reforço no stop compra +40 USDT
--      por degrau — pode faltar saldo e a escada segura a pilha, ver rsi-momentum-bot.js).
--
-- CONFIG (= última pesquisa validada nas Estatísticas p/ SKYAI, id 1788437400657, P&L médio
-- +9,98%/trade, 13 trades, 100% no período):
--   sinal   RSI(14) 1m cruza para cima de 70   (sem anti-repique, sem confirmação adiantada)
--   entrada a mercado (sem pullback), 20 USDT
--   filtro  S/R 15m janela 1000 — só entra até 2% acima do 1º suporte abaixo do preço
--   alvo    DESLIGADO (targetMode off) — sai pelo teto de lucro ou pela resistência do S/R
--   teto    venda forçada em +15%
--   stop    fixo -3%
--   reforço no stop LIGADO: -3% vira escada (compra +40 USDT a cada -10%, vende tudo a +15%)
--   sem filtros de banda / MACD / RSI 1h / RSI 5m
--
-- PARA DESLIGAR depois: UPDATE multitrade_favorites SET enabled = false WHERE symbol='SKYAIUSDT'
--   AND strategy_id='rsi-momentum';  → no próximo sync (3 min) o bot encerra a sessão SEM
--   vender nem cancelar ordem. Depois apague as duas linhas (ver monitor-rsi-momentum.sql).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Config compartilhada pelas duas tabelas (favorito do painel + estado runtime do bot).
-- Blocos com "enabled": false são explícitos de propósito: os defaults do schema
-- (tradeConfigSchema.js) ligam anti-repique / earlyConfirm / bandWidth / MACD / RSI 1h — aqui
-- todos ficam DESLIGADOS pra casar exatamente com o motor do backtest das Estatísticas.
WITH cfg AS (
  SELECT '{
    "label": "RSI Momentum · SKYAI (curada)",
    "kind": "rsi_momentum",
    "capitalUsdt": 20,
    "entry": {
      "enabled": true,
      "interval": "1m",
      "rsiThreshold": 70,
      "priorRsiFilter": { "enabled": false, "count": 3 },
      "pullback": { "enabled": false, "belowPct": 0.5 },
      "limitWaitCandles": 20,
      "earlyConfirm": { "enabled": false, "interval": "5m", "rsiThreshold": 70 },
      "reentryCooldownCandles": 3,
      "bandWidth": { "enabled": false, "interval": "5m", "period": 20, "stdDev": 2, "lookback": 300, "minPct": 2 },
      "rsi5mFilter": { "enabled": false, "threshold": 70 },
      "spikeGuard": { "enabled": false, "maxMovePct": 5 },
      "macdFilter": { "enabled": false, "interval": "1h" },
      "higherRsiFilter": { "enabled": false, "minRsi": 60 },
      "supportResistance": {
        "enabled": true, "interval": "15m", "candleCount": 1000,
        "entrySupportRank": 1, "exitResistanceRank": 3, "entryMaxPct": 2
      }
    },
    "exit": {
      "targetMode": "off",
      "restingBracket": { "enabled": true, "targetPct": 10 },
      "trailingTarget": { "coinStepPct": 3, "stepPct": 3 },
      "trailingStop": { "enabled": false },
      "hardTakeProfit": { "enabled": true, "pct": 15 },
      "reinforceOnStop": { "enabled": true, "addDropPct": 10, "exitRisePct": 15, "buyUsd": 40 }
    },
    "stopLoss": { "enabled": true, "maxLossPct": 3 },
    "polling": { "pollMs": 60000, "fastPollMs": 20000 },
    "entryCooldownHours": 0,
    "volume": { "minVolumeUsdt": 0 }
  }'::jsonb AS trade_config
)

-- 1. Favorito no painel — multitradeWatch encerra a sessão de qualquer moeda que NÃO tenha
--    linha enabled=true aqui, então esta linha é obrigatória mesmo sendo curada.
INSERT INTO multitrade_favorites (user_id, symbol, exchange, strategy_id, enabled, capital, trade_config)
SELECT 'ueredeveloper', 'SKYAIUSDT', 'gate', 'rsi-momentum', true, 20, trade_config FROM cfg
ON CONFLICT (user_id, symbol, strategy_id) DO UPDATE
  SET enabled = EXCLUDED.enabled, exchange = EXCLUDED.exchange,
      capital = EXCLUDED.capital, trade_config = EXCLUDED.trade_config;

-- 2. Estado runtime — curated=true + phase WATCHING (retomada no boot por loadResumableRows).
INSERT INTO rsi_multi_bot_state (symbol, exchange, strategy_id, initial_capital, capital, trade_config, phase, curated)
SELECT symbol, exchange, strategy_id, capital, capital, trade_config, 'WATCHING', true
FROM multitrade_favorites
WHERE strategy_id = 'rsi-momentum' AND symbol = 'SKYAIUSDT' AND user_id = 'ueredeveloper'
ON CONFLICT (symbol, strategy_id) DO UPDATE
  SET exchange = EXCLUDED.exchange, capital = EXCLUDED.capital,
      trade_config = EXCLUDED.trade_config, curated = true, phase = 'WATCHING';

COMMIT;

-- Verificação:
-- SELECT symbol, exchange, phase, curated, capital,
--        trade_config->'entry'->>'interval'      AS iv,
--        trade_config->'entry'->>'rsiThreshold'  AS rsi,
--        trade_config->'stopLoss'->>'maxLossPct' AS stop,
--        trade_config->'exit'->'hardTakeProfit'  AS teto
-- FROM rsi_multi_bot_state WHERE symbol = 'SKYAIUSDT' AND strategy_id = 'rsi-momentum';
