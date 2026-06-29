/** Escopo de venda 5m — espelha backend/bot/5min-trade-bot/sellScopeConfig.js */

export const SELL_SCOPE_OPTIONS = [
  {
    id: 'bot_only',
    label: 'Só o que o bot comprou',
    summary: 'Vende apenas a qty rastreada (buy_qty) — não mexe no restante da carteira',
    tooltip:
      'Recomendado se você já tem a moeda na corretora fora do bot. ' +
      'Ex.: $50 manuais + $20 do bot → na saída vende só os $20 equivalentes em qty.',
  },
  {
    id: 'wallet',
    label: 'Saldo inteiro na corretora',
    summary: 'Vende todo o saldo livre da moeda na exchange (inclui compras manuais)',
    tooltip:
      'Na saída (RSI ou stop), o bot envia ordem de venda do saldo livre total da moeda. ' +
      'O PnL e o capital do bot são calculados só sobre a parte proporcional à qty que o bot comprou.',
  },
];

export function sellScopeLabel(scope) {
  return SELL_SCOPE_OPTIONS.find(o => o.id === scope)?.label ?? scope;
}
