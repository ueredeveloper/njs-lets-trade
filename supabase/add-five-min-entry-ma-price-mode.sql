-- Estende entry_price JSONB: maMode (market | ma_limit), maBelowPct (0–1)
-- Não obrigatório: normalizeEntryPrice preenche defaults em registros antigos.

COMMENT ON COLUMN five_min_bot_state.entry_price IS
  '{"mode":"market|below","belowPct":0,"maMode":"market|ma_limit","maBelowPct":0} — RSI: mode/belowPct; MA50 5m: maMode/maBelowPct';

NOTIFY pgrst, 'reload schema';
