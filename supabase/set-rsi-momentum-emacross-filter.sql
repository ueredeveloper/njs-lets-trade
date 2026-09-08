-- Liga o filtro de tendencia EMA9xEMA21 (entry.emaCrossFilter) no bot RSI Momentum, no 8h.
--
-- PREFERENCIAL: faca isso pelo painel -- Configuracoes -> Filtro EMA 9/21 -> marque "Filtro ativo"
-- e escolha o intervalo (default 8h) e salve. O painel grava no mesmo trade_config. Este SQL e so
-- um atalho pra ligar sem abrir a UI.
--
-- O que o filtro faz: so libera o sinal de entrada se a EMA9 estiver ACIMA da EMA21 no intervalo
-- escolhido (8h) no candle FECHADO mais recente. EMA9 <= EMA21 = tendencia do timeframe maior
-- ainda de baixa/lateral -> bloqueia (comprar o rompimento do RSI aqui costuma ser topo de
-- exaustao, ex.: SAHARA 03/07). Periodos fixos 9/21 (a mesma dupla do indicador PERM do grafico
-- e das Estatisticas). Sem candles de 8h suficientes ainda, libera (fail-open, como MACD/RSI 1h).
--
-- Espelho exato do filtro das Estatisticas (options.emaCrossFilter em analyseRsiThresholdBacktest.js)
-- -- o motor e o mesmo, pra a simulacao bater com o bot ao vivo.
--
-- Merge JSONB: preserva todo o resto da config.
-- Rodar no SQL Editor do Supabase DEPOIS do deploy do codigo (schema + engine + scanner).
-- **Reiniciar o bot** depois (pull no Termux + restart do processo).

BEGIN;

UPDATE rsi_momentum_global_config
SET trade_config = jsonb_set(
      trade_config,
      '{entry,emaCrossFilter}',
      COALESCE(trade_config->'entry'->'emaCrossFilter', '{}'::jsonb)
        || jsonb_build_object('enabled', true, 'interval', '8h'),
      true
    ),
    updated_at = now()
WHERE user_id = 'ueredeveloper';

COMMIT;

-- Verificacao:
-- SELECT user_id, trade_config->'entry'->'emaCrossFilter' AS filtro_ema_9_21, updated_at
-- FROM rsi_momentum_global_config WHERE user_id = 'ueredeveloper';
--
-- Desligar: trocar 'enabled' pra false (ou desmarcar em Configuracoes).
