# Swing Bot — RSI 1h + MA50 8h

Bot de swing trading com duas estratégias independentes por moeda, integrado ao painel **Multi-Trade** (Supabase).

## Estratégias (`strategy_id`)

| ID | Entrada | Saída |
|---|---|---|
| `swing-rsi-1h` | RSI(1h) **< 30** + preço **acima** de MA50(8h) | RSI(1h) **> 75** |
| `swing-ma50-8h` | MA50(8h) **cross_up** (3 candles acima antes) | RSI(4h) **> 80** |

A mesma moeda pode ter **as duas estratégias ativas** — capital e estado separados em `rsi_multi_bot_state` (UNIQUE por `symbol + strategy_id`).

## Como rodar

```bash
node backend/bot/swing/swing-bot.js
node backend/bot/swing/swing-bot.js --symbol BTCUSDT
```

## Configuração (Multi-Trade)

1. No painel MT, adicione a moeda e ative `RSI 1h` e/ou `MA50 8h`
2. Salve — sincroniza `multitrade_favorites` → `rsi_multi_bot_state`
3. Inicie o bot

### Parâmetros configuráveis (`trade_config`)

| Campo | Descrição |
|---|---|
| `entryRsi` | RSI de entrada (intervalo, período, operador, valor) |
| `exitRsi` | RSI de saída |
| `entryMaFilter` | Filtro MA para estratégia RSI (período 50/200, intervalo 8h…) |
| `entryMa` | Entrada por MA (trigger: cross_up / touch / above) |
| `stopLoss.maxLossPct` | Stop-loss em % (padrão 5%) |
| `execution.entryDiscount` | Desconto em ordens limit (futuro PENDING) |
| `polling` | pollMs, fastPollMs, fastRsiThreshold |
| `volume.minVolumeUsdt` | Volume mínimo 24h |

## Sugestão histórica (RSI)

Use os botões **Sugerir** no painel Multi-Trade — os endpoints `multitrade-suggest-entry-rsi` e `multitrade-suggest-exit-rsi` funcionam com configs Swing (convertidas internamente).

## Tabelas Supabase

Reutiliza as tabelas do Multi-Trade:

- `multitrade_favorites` — config UI
- `rsi_multi_bot_state` — estado runtime
- `rsi_multi_bot_trades` — histórico

## Stop-loss

Preço ≤ compra − **5%** → venda imediata (configurável via `stopLoss.maxLossPct`).

## Logs

```
backend/data/bot/log-{SYMBOL}-{strategy_id}.txt
```
