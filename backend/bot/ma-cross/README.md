# MA Cross Bot

Estratégia de cruzamento entre duas médias móveis (SMA), com filtro de preço opcional.

## Parâmetros

| Bloco | Descrição |
|---|---|
| **Param1** | MA rápida — período 9/21/50/200 + intervalo |
| **Param2** | MA lenta — período 9/21/50/200 + intervalo |
| **Param3** | Filtro: preço acima/abaixo/adaptativo vs MA 50/200 |

## Exemplo padrão

- **Compra:** MA9(15m) cruza ↑ MA21(15m)
- **Filtro:** preço ≥ MA50(1h) − até 4% (adaptativo histórico)
- **Venda:** MA9(15m) cruza ↓ MA21(15m)

## Cruzamento — como detectar

Usa os **últimos 2 candles fechados** do intervalo mais fino entre param1 e param2:

```
cross_up:   MA1[−1] ≤ MA2[−1]  E  MA1[0] > MA2[0]
cross_down: MA1[−1] ≥ MA2[−1]  E  MA1[0] < MA2[0]
```

Intervalos diferentes: alinha MA1 e MA2 pelo `openTime` (último valor conhecido em cada série).

Tolerância opcional (`tolerancePct`) evita falsos negativos quando as MAs estão muito próximas.

## Rodar

```bash
node backend/bot/ma-cross/ma-cross-bot.js
node backend/bot/ma-cross/ma-cross-bot.js --symbol BTCUSDT
```

Config no painel **Multi-Trade** → aba **MA Cross** (`strategy_id: ma-cross`).

## Painel remoto (sync 5 min)

Com o bot rodando, alterações no painel Multi-Trade são detectadas **a cada 5 minutos**:

- **Moeda nova** → bot inicia monitoramento automaticamente
- **Moeda removida ou desativada** → bot **para de monitorar** (não compra nem vende; posição na corretora permanece)
- **trade_config alterado** → estratégia em memória é atualizada sem reiniciar o processo
