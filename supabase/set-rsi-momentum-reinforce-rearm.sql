-- Liga o modo "re-armar bracket" (mode: 'rearm') no Reforço no stop do bot RSI Momentum.
--
-- PREFERENCIAL: faça isso pelo painel — Configuracoes -> Reforço no stop -> Modo: "Re-armar
-- bracket", ajuste "Stop do reforço" / "Alvo do reforço" / "Valor do reforço" e salve. O painel
-- grava no mesmo trade_config. Este SQL e so um atalho pra ligar o modo sem abrir a UI.
--
-- O que muda vs. o modo 'ladder' (padrao):
--   ladder = ao bater o stop NAO vende, empilha compras a cada -addDropPct% e vende toda a pilha
--            no 1o +exitRisePct%, operando SEM stop de protecao.
--   rearm  = a corretora VENDE a posicao no stop (perda REALIZADA). O bot recompra a mercado com
--            TUDO o que sobrou da venda + buyUsd e re-arma um bracket NORMAL -rearmStopPct% /
--            +rearmTargetPct%. Stopou de novo, repete indefinidamente.
--            O P&L do trade e medido sobre o caixa NOVO total (entrada + N x buyUsd) -> um alvo
--            de "+X%" atingido depois de um stop rende MENOS que X% no capital.
--
-- Persistencia / crash-safety: cada movimento e salvo em rsi_multi_bot_state antes de acontecer
-- (rules_state.rearm.pending + exitBracket zerado). Se o bot cair no meio de uma recompra, ao
-- reiniciar resumeRearmPending reconcilia pelo saldo REAL da carteira (refaz / recompra / adota).
--
-- Este SQL SO liga o modo. rearmStopPct / rearmTargetPct / buyUsd NAO sao mexidos: ficam com o
-- que ja estiver salvo (o painel e a fonte deles) ou, se nunca foram setados, o bot usa os
-- defaults do schema (10% / 10% / 40) ate voce ajustar em Configuracoes.
--
-- Merge JSONB: preserva todo o resto da config.
-- Rodar no SQL Editor do Supabase DEPOIS do deploy do codigo (schema + bot + backtest).
-- **Reiniciar o bot** depois (pull no Termux + restart do processo).

BEGIN;

UPDATE rsi_momentum_global_config
SET trade_config = jsonb_set(
      trade_config,
      '{exit,reinforceOnStop}',
      COALESCE(trade_config->'exit'->'reinforceOnStop', '{}'::jsonb)
        || jsonb_build_object('enabled', true, 'mode', 'rearm'),
      true
    ),
    updated_at = now()
WHERE user_id = 'ueredeveloper';

COMMIT;

-- Verificacao:
-- SELECT user_id, trade_config->'exit'->'reinforceOnStop' AS reforco_no_stop, updated_at
-- FROM rsi_momentum_global_config WHERE user_id = 'ueredeveloper';
--
-- Voltar pro modo escada: trocar 'mode' pra 'ladder' (ou rodar set-rsi-momentum-winning-config.sql).
