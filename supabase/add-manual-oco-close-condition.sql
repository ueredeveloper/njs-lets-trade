-- Rodar no SQL Editor do Supabase (1×).
--
-- OCO manual do gráfico — entrada "no fechamento do candle" (entry_kind = 'candle_close'): o bot
-- espera o candle do gráfico fechar e só compra a mercado se ele NÃO fechou num padrão de baixa:
-- shooting star / inverted hammer / gravestone doji / hanging man / bearish engulfing / tweezer top
-- (alta não se manteve → CLOSED, sem compra). Depois da compra a OCO usa os % de alvo/stop
-- desenhados sobre o preço REAL comprado, como nas outras ordens do bot.
-- Ver backend/bot/manual-oco/manualOcoWatcher.js e backend/bot/shared/candleCloseCondition.js.
--
-- close_condition = { interval, candleOpenTime, closeAt }  (ms)

ALTER TABLE public.manual_oco_orders ADD COLUMN IF NOT EXISTS close_condition JSONB;
