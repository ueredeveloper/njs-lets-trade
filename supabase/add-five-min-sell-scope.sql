-- Escopo da venda: só qty rastreada pelo bot ou saldo livre na corretora
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS sell_scope TEXT NOT NULL DEFAULT 'bot_only';

COMMENT ON COLUMN five_min_bot_state.sell_scope IS
  'bot_only = vende só buy_qty do bot; wallet = vende saldo livre inteiro da moeda na exchange';
