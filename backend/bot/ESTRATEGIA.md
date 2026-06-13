# Estratégia do RSI Trade Bot

Bot conectado ao site — configuração por símbolo via Supabase (`favorites_trade`).

Início:
```cmd
node backend/bot/rsiTradeBot.js
```

---

## Configuração no Supabase (`favorites_trade`)

| Campo | Descrição | Exemplo |
|---|---|---|
| `symbol` | Par de negociação | `CHZUSDT` |
| `exchange` | Corretora | `gate` ou `binance` |
| `interval` | Intervalo de entrada | `15m`, `30m`, `1h` |
| `rsi_buy` | RSI mínimo para compra | `30` |
| `rsi_sell` | RSI para venda | `70` |
| `sell_interval` | Intervalo de saída (opcional) | `5m` |
| `variation_min` | Variação mínima do candle (opcional) | `0.5` |

> Para `interval=15m` o código aplica automaticamente −0,5 no `rsi_sell` (Supabase guarda 70, bot usa 69,5).

---

## Compra

| Regra | Valor |
|---|---|
| Sinal | RSI(intervalo) < `rsi_buy` |
| Variação mínima do candle | `1m`: 0% · `≤5m`: 0,1% · `≤15m`: 0,5% · `30m+`: 1% |
| Filtro MA50 (1h) | Preço dentro de **±3%** da MA50 das últimas 50 velas 1h |
| Exceção MA50 | Abaixo de −3% mas algum dos últimos 10 candles 1h cruzou a MA50 → permite entrada ("retornando à média") |
| Preço de entrada | **1% abaixo** do fechamento do candle (todos os intervalos) |

---

## Venda

| Regra | Valor |
|---|---|
| Intervalo de saída | `15m` → verifica RSI do **5m** · outros → mesmo intervalo de entrada |
| Venda imediata | RSI(saída) ≥ `rsi_sell` (efetivo 69,5 para `15m`) |
| Venda forçada | RSI ≥ **80** (sobrecomprado extremo — não espera retorno) |
| Modo ABOVE_70 | RSI passou de 70 → aguarda retornar a ≤ 70 para vender |
| Preço de venda | `15m`: −0,5% abaixo do preço live · outros: −0,2% |
| Stop-loss | **3% abaixo** do preço de compra |

---

## Polling

| Intervalo | Frequência |
|---|---|
| `1m`, `5m` | A cada candle |
| `15m` | A cada **1 minuto** (para não perder cruzamento de RSI(5m) ≥ 70) |
| `30m+` | A cada **5 minutos** (teto) |

---

## Exemplo de configuração para 15m

```json
{
  "symbol": "CHZUSDT",
  "exchange": "gate",
  "interval": "15m",
  "rsi_buy": 30,
  "rsi_sell": 70
}
```

Comportamento automático para `interval=15m`:
- Variação mínima: 0,5%
- Saída: verifica RSI do **5m**
- RSI de venda efetivo: **69,5**
- Entrada: 1% abaixo do fechamento
- Venda: 0,5% abaixo do preço live
- Stop-loss: 3% abaixo da compra
- Poll: a cada 1 minuto

---

## Fluxo de estados

```
WATCHING → PENDING_BUY → BOUGHT → ABOVE_70 → WATCHING
```

| Estado | Descrição |
|---|---|
| `WATCHING` | Aguarda sinal RSI + variação + MA50 |
| `PENDING_BUY` | Limit order colocada, aguardando fill |
| `BOUGHT` | Posição aberta, monitorando RSI de saída e stop-loss |
| `ABOVE_70` | RSI passou de 70, aguardando retorno para vender |

O estado é salvo em `backend/data/bot/<SYMBOL>.json` e sobrevive a reinicializações.

---

## Arquivos relevantes

| Arquivo | Descrição |
|---|---|
| `backend/bot/rsiTradeBot.js` | Bot principal |
| `backend/bot/README.md` | Documentação detalhada da estratégia |
| `backend/bot/WHATSAPP.md` | Conexão e pareamento WhatsApp |
| `backend/data/bot/` | Estados salvos por símbolo |
