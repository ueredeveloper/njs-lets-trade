-- Rodar no SQL Editor do Supabase (1×).
--
-- OCO manual do gráfico com ENTRADA arrastada (linha amarela — ChartOcoTool.jsx). O painel grava
-- o pedido (POST /services/manual-oco-orders) e o bot RSI Momentum executa
-- (backend/bot/manual-oco/manualOcoWatcher.js, a cada ~15s):
--   entry_kind = 'limit'    entrada ABAIXO do preço na criação → LIMIT BUY GTC no preço da entrada
--   entry_kind = 'trigger'  entrada ACIMA do preço (rompimento) → compra a mercado quando o preço
--                           atingir a entrada
-- Ao comprar, coloca a OCO de venda (alvo/stop absolutos). Ordem avulsa: não cria favorito nem
-- linha em rsi_multi_bot_state.
--
-- status:
--   NEW               gravado pelo painel, o bot ainda não pegou
--   OPEN              limite armada na corretora (buy_handle) / gatilho de rompimento vigiando
--   CANCEL_REQUESTED  usuário pediu cancelar com a ordem já na corretora — o bot cancela
--   FILLED            comprou (fill), OCO ainda não colocada (estado de passagem / retomada)
--   BRACKETED         comprou + OCO colocada (fim)
--   OCO_FAILED        comprou mas a OCO falhou — posição SEM proteção (aviso no WhatsApp)
--   SELLING           "Vender agora" do gráfico em andamento (cancela a OCO + vende a mercado)
--   SOLD              vendida pelo "Vender agora" (exit)
--   CLOSED_TARGET / CLOSED_STOP  a OCO executou (exit) — detectado pelo bot
--   CANCELLED / CLOSED (limite sumiu da corretora sem fill) / FAILED (corretora recusou)
-- entry_kind = 'market' para o "Comprar agora" (compra a mercado + OCO direto pelo painel).

CREATE TABLE IF NOT EXISTS public.manual_oco_orders (
  id            BIGSERIAL    PRIMARY KEY,
  symbol        TEXT         NOT NULL,
  exchange      TEXT         NOT NULL DEFAULT 'binance',
  usdt          NUMERIC      NOT NULL,
  entry_price   NUMERIC      NOT NULL,
  target_price  NUMERIC      NOT NULL,
  stop_price    NUMERIC      NOT NULL,
  entry_kind    TEXT         NOT NULL DEFAULT 'limit',
  status        TEXT         NOT NULL DEFAULT 'NEW',
  buy_handle    JSONB,
  fill          JSONB,
  bracket       JSONB,
  exit          JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Quem já rodou a 1ª versão desta migração (sem `exit`):
ALTER TABLE public.manual_oco_orders ADD COLUMN IF NOT EXISTS exit JSONB;

CREATE INDEX IF NOT EXISTS idx_manual_oco_orders_status ON public.manual_oco_orders (status);
CREATE INDEX IF NOT EXISTS idx_manual_oco_orders_symbol_created ON public.manual_oco_orders (symbol, created_at DESC);
