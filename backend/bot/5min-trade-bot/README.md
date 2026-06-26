# 5min Trade Bot — RSI 5m com DCA

Bot de trade rápido em candles de **5 minutos**.

## Estratégia

| Ação | Condição |
|------|----------|
| **Compra** | RSI(14, 5m) < limiar **e** filtros MA atendidos (se ligados) |
| **Compra adicional (DCA)** | Já em posição, RSI < limiar **e** passaram ≥ 2h desde a última entrada **e** filtros MA OK |
| **Venda** | RSI(14, 5m) > 70 — vende **toda** a posição acumulada |

Cada entrada usa o `capital` configurado por símbolo. Após a venda, o capital é atualizado com o PnL do ciclo.

### Filtro MA (opcional)

No modal **5m Trade**, ligue **Filtro MA na entrada** e configure uma ou mais linhas:

- **Período:** MA20, MA50, MA100, MA200
- **Intervalo:** 1h, 2h, 4h, 8h, 1d
- **Modo:** `acima` (preço > MA) ou `abaixo` (preço < MA)
- **Calibragem %:** admite compra até X% abaixo da MA (ex.: 5% → piso em MA×0,95). Sugestão calculada pelo histórico da moeda (mesma lógica do Multi-Trade adaptativo: média dos dips abaixo da MA antes de retomar alta).

Exemplo: comprar só **acima da MA50 1h** evita entrar em oversold durante queda livre.

As simulações históricas (padrão de alta %, bot DCA, sweep RSI) respeitam os filtros MA ativos.

Persistido em `five_min_bot_state.ma_filters` (JSONB).

## Configuração

1. Execute `5min-trade-bot.sql` no Supabase.
2. Adicione moedas pelo painel **5m Trade** na tabela de moedas (botão **5M** em cada linha), ou via SQL em `five_min_bot_state`.
3. Configure as chaves da exchange no `.env` (`BINANCE_*` ou `GATEIO_*`).

### API (backend)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/services/sb/five-m-trade-favorites` | Lista favoritos |
| POST | `/services/sb/five-m-trade-favorites` | Adiciona/atualiza `{ symbol, exchange, capital }` |
| PATCH | `/services/sb/five-m-trade-favorites/:id` | Edita exchange/capital/RSI |
| DELETE | `/services/sb/five-m-trade-favorites/:id` | Remove (só se `phase=WATCHING`) |
| GET | `/services/sb/five-m-trade-suggest-rsi?symbol=&exchange=` | Sugere RSI entrada/saída pelo histórico 5m |
| GET | `/services/sb/five-m-trade-suggest-ma-adaptation?symbol=&rsiBuy=&rsiSell=&maFilters=` | Sugere calibragem % MA pelo histórico + simulação bot |
| POST | `/services/sb/five-m-trade-evaluate` | Teste ao vivo com parâmetros atuais (RSI, MA, fase) |

Se a tabela já existia, rode no Supabase:

```sql
ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS rsi_buy  NUMERIC(8,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rsi_sell NUMERIC(8,2) NOT NULL DEFAULT 70;

ALTER TABLE five_min_bot_state
  ADD COLUMN IF NOT EXISTS ma_filters JSONB DEFAULT '{"enabled":false,"filters":[{"id":"ma50-1h","enabled":true,"period":50,"interval":"1h","mode":"above"},{"id":"ma200-4h","enabled":false,"period":200,"interval":"4h","mode":"above"}]}'::jsonb;
```

## Uso

```bash
node backend/bot/5min-trade-bot/5min-trade-bot.js
```

## Polling

- Normal: a cada **1 minuto** (candle 5m).
- Rápido: a cada **30 segundos** quando RSI ≥ 68 (para não perder RSI > 70).

## Estado

Persistido em `five_min_bot_state` (Supabase). Histórico em `five_min_bot_trades`.

## WhatsApp (compra / venda / PnL)

Serviço **externo** em `http://localhost:3005` — o bot só envia HTTP. No `.env`:

```env
API_KEY=sua-chave
WA_OWNER_NUMBER=5561999171222
```

Teste (com o serviço rodando): `node backend/bot/test-whatsapp.js` — ver `backend/bot/WHATSAPP.md`.
