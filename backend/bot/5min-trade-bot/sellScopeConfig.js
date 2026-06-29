'use strict';

const SELL_SCOPES = ['bot_only', 'wallet'];

const SELL_SCOPE_LABELS = {
  bot_only: 'Só o que o bot comprou',
  wallet:   'Saldo inteiro na corretora',
};

function normalizeSellScope(raw) {
  if (typeof raw === 'string' && SELL_SCOPES.includes(raw)) {
    return { scope: raw };
  }
  if (raw && typeof raw === 'object' && SELL_SCOPES.includes(raw.scope)) {
    return { scope: raw.scope };
  }
  return { scope: 'bot_only' };
}

function sellScopeLabel(scope) {
  return SELL_SCOPE_LABELS[normalizeSellScope(scope).scope] ?? normalizeSellScope(scope).scope;
}

module.exports = {
  SELL_SCOPES,
  SELL_SCOPE_LABELS,
  normalizeSellScope,
  sellScopeLabel,
};
