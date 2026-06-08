# RSI Trade Bot — Gate.io

Bot de trading automático para Gate.io. Opera as moedas listadas em `backend/data/favorites-trade.json`.

## Como rodar

```bash
# A partir da raiz do projeto
node backend/bot/rsiTradeBot.js
```

Requer `.env` na raiz com:
```
GATEIO_API_KEY=...
GATEIO_SECRET_KEY=...
```

---

## Estratégia implementada

### Sinal de compra
- RSI (14 períodos, candle 30 min) **< 30**
- **E** variação do candle (high − low) **≥ 1%**
- Entrada: **limit order 2% abaixo do fechamento** do candle (`GTC`)

### Sinal de venda
- RSI ultrapassa **70** (estado `ABOVE_70`)
- Aguarda RSI **voltar para ≤ 70**
- Executa **market order** vendendo a posição completa

---

## Regras de capital

| Regra | Valor |
|---|---|
| Capital máximo por moeda por operação | **$40 USDT** |
| Se saldo disponível < $40 | usa o saldo disponível |
| Margem de segurança no orçamento | 1% (`balance * 0.99`) |
| Venda | 100% da posição comprada |

> O bot não divide o capital entre moedas. Cada moeda opera de forma independente com até $40 do saldo USDT disponível no momento da compra.

---

## Taxas Gate.io

| Operação | Taxa | Impacto |
|---|---|---|
| Compra (limit/maker) | 0,2% | Descontado dos **tokens recebidos** |
| Venda (market/taker) | 0,2% | Descontado dos **USDT recebidos** |

**Exemplo:** compra $40 de FARTCOIN → recebe `qty * 0.998` tokens. O `buyQty` salvo no estado já é o valor líquido (após taxa de entrada). O PnL exibido no log é líquido das duas taxas (~0,4% total por ciclo).

---

## Intervalos de verificação (polling adaptativo)

| Condição | Intervalo |
|---|---|
| RSI entre 30–70, fase normal | **5 min** |
| RSI < 30 **ou** RSI > 70 (zona crítica) | **3 min** 🔶 |
| Fase `ABOVE_70` (aguardando venda) ou `PENDING_BUY` | **1 min** ⚡ |

O log mostra qual intervalo foi escolhido a cada ciclo:
```
⏱ Próxima verificação em 1 min ⚡
⏱ Próxima verificação em 3 min 🔶
⏱ Próxima verificação em 5 min
```

---

## Máquina de estados por moeda

```
WATCHING
   │  RSI < 30 + variação ≥ 1%
   ▼
PENDING_BUY  ──── RSI volta > 30 antes do fill ────► WATCHING (ordem cancelada)
   │  Order status = 'closed'
   ▼
BOUGHT
   │  RSI > 70
   ▼
ABOVE_70
   │  RSI ≤ 70
   ▼
WATCHING  (ciclo completo)
```

### Comportamento em PENDING_BUY
- Verifica o status da ordem na Gate.io a cada ciclo
- Se RSI subir de volta acima de 30 antes do fill → **cancela a ordem** e volta a `WATCHING`
- Se a ordem for preenchida (`status = 'closed'`) → avança para `BOUGHT`

---

## Persistência (sobrevive a hibernação)

O estado de cada moeda é salvo em disco:

```
backend/data/bot/
  state-LINKUSDT.json       ← fase atual + dados da posição
  state-FARTCOINUSDT.json
  log-LINKUSDT.txt          ← histórico de todas as operações
  log-FARTCOINUSDT.txt
```

Ao reiniciar o bot, o estado é restaurado automaticamente. Se havia uma limit order pendente, o bot retoma o acompanhamento pelo ID da ordem.

---

## Moedas operadas

Definidas em `backend/data/favorites-trade.json`:

```json
["LINKUSDT", "FARTCOINUSDT", "AIGENSYNUSDT", "GENIUSUSDT"]
```

Basta editar este arquivo e reiniciar o bot para adicionar ou remover moedas.

---

## Exemplo de log

```
[07/06/2026 14:32:01] [FARTCOINUSDT] RSI=28.41  close=0.1823  var=1.34%  fase=WATCHING
[07/06/2026 14:32:01] [FARTCOINUSDT] 📍 RSI < 30 (28.41) + var 1.34% — colocando limit buy a 0.17865...
[07/06/2026 14:32:01] [FARTCOINUSDT] 💰 Saldo USDT: 52.30 → usando 40.00 USDT (teto: $40)
[07/06/2026 14:32:02] [FARTCOINUSDT] ⏳ LIMIT ORDER colocada | id=12345 | preço=0.17865 | qty=223.88 | USDT≈40.00
[07/06/2026 14:32:02] [FARTCOINUSDT] ⏱ Próxima verificação em 1 min ⚡

[07/06/2026 14:33:05] [FARTCOINUSDT] 🟢 COMPRA PREENCHIDA | qty=223.88 − taxa 0.2% = 223.43 | preço=0.17865 | USDT≈39.91
[07/06/2026 15:48:22] [FARTCOINUSDT] 📈 RSI passou de 70 (71.20) — aguardando retorno para ≤ 70…
[07/06/2026 15:49:25] [FARTCOINUSDT] 📉 RSI voltou a 69.85 ≤ 70 — vendendo…
[07/06/2026 15:49:26] [FARTCOINUSDT] 🔴 VENDA | qty=223.43 | preço≈0.1951 | receita líquida≈43.54 USDT | PnL≈+9.10% (+3.63 USDT)
```

---

## Uso no Termux (Android)

O bot é autocontido — não precisa do servidor Express nem do frontend React.

```bash
# Instalar dependências mínimas
npm install

# Rodar apenas o bot
node backend/bot/rsiTradeBot.js
```

Requisitos mínimos: Node.js 18+, 50 MB RAM, conexão com internet.
