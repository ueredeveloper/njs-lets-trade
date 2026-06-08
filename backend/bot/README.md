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

Os thresholds de RSI e o intervalo de candle são **configurados por moeda** em `favorites-trade.json`.

### Sinal de compra
- RSI (14 períodos, candle do intervalo configurado) **< rsiBuy** (padrão 30)
- **E** variação do candle (high − low) **≥ 1%**
- Entrada: **limit order 2% abaixo do fechamento** do candle (`GTC`)

### Sinal de venda
- RSI ultrapassa **rsiSell** (padrão 70) → estado `ABOVE_70`
- Aguarda RSI **voltar para ≤ rsiSell**
- Executa **limit sell 0,3% abaixo do close** para garantir o fill

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

## Polling adaptativo por intervalo de candle

O bot verifica cada moeda com frequência proporcional ao intervalo configurado, com um teto de **5 minutos** para candles longos.

| Intervalo configurado | Frequência de verificação |
|---|---|
| `1m` | a cada **1 min** |
| `3m` | a cada **3 min** |
| `5m` | a cada **5 min** |
| `15m`, `30m`, `1h`, `4h`… | a cada **5 min** (teto) |

**Motivo do teto de 5 min:** mesmo que o candle feche a cada 30 min, o preço pode cair ou subir antes de o candle fechar. Verificar a cada 5 min evita perder sinais de saída importantes.

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

## Configuração de moedas (`favorites-trade.json`)

Cada moeda tem suas próprias configurações de intervalo e thresholds de RSI:

```json
[
  { "symbol": "ALGOUSDT",     "interval": "1m",  "rsiBuy": 30, "rsiSell": 70 },
  { "symbol": "LINKUSDT",     "interval": "30m", "rsiBuy": 28, "rsiSell": 72 },
  { "symbol": "FARTCOINUSDT", "interval": "5m",  "rsiBuy": 25, "rsiSell": 75 }
]
```

| Campo | Descrição | Padrão |
|---|---|---|
| `symbol` | Par de trading Gate.io | obrigatório |
| `interval` | Tamanho do candle para RSI | `30m` |
| `rsiBuy` | RSI abaixo deste valor → compra | `30` |
| `rsiSell` | RSI acima deste valor → aguarda venda | `70` |

> **Intervalos suportados pela Gate.io:** `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `8h`, `1d`.
> O intervalo `3m` não é suportado pela Gate.io e causará erro nos candles.

Basta editar este arquivo e reiniciar o bot para adicionar ou remover moedas. O formato antigo (lista de strings) ainda é suportado — o bot migra automaticamente usando os valores padrão.

---

## Exemplo de log

Cada símbolo aparece em uma cor diferente no terminal. O timestamp mostra `HH:MM` para intervalos de hora ou maior, e `HH:MM:SS` para intervalos em minutos (1m, 3m, 5m…):

```
[14:32] [FARTCOINUSDT] RSI=28.41  close=0.1823  fase=WATCHING
[14:32] [FARTCOINUSDT] 📍 RSI < 30 (28.41) + var 1.34% — sinal de COMPRA
[14:32] [FARTCOINUSDT] 💰 Saldo USDT: 52.30 → usando 40.00 USDT (teto: $40)
[14:32] [FARTCOINUSDT] 🟢 ORDEM DE COMPRA ABERTA
   Par    : FART_USDT
   Preço  : 0.17865  (2% abaixo de 0.18229)
   Qty    : 223.88
   USDT   : ≈40.00
   ID     : 12345

[14:33] [FARTCOINUSDT] 🟢 COMPRA PREENCHIDA | qty=223.88 − taxa 0.2% = 223.43 | preço=0.17865 | USDT≈39.91
[15:48] [FARTCOINUSDT] 📈 RSI passou de 70 (71.20) — aguardando retorno para ≤ 70…
[15:49] [FARTCOINUSDT] 🔴 ORDEM DE VENDA ABERTA
   PnL   : +3.63 USDT  (+9.10%)
```

---

## Sincronização de relógio com Gate.io

A Gate.io exige que o `Timestamp` enviado em cada requisição autenticada não difira mais de **60 segundos** do horário do servidor. Se o relógio do sistema estiver desincronizado, a API retorna:

```
403: gap between request Timestamp and server time exceeds 60
```

### Solução implementada

O bot faz `GET /api/v4/time` na Gate.io durante o startup, calcula o offset entre o relógio local e o servidor, e aplica esse offset em todas as assinaturas HMAC:

```js
clockOffsetSec = serverTime - Math.floor(Date.now() / 1000);
timestamp = Math.floor(Date.now() / 1000) + clockOffsetSec;
```

O offset é renovado automaticamente **a cada 1 hora** para compensar eventuais drifts. O mesmo mecanismo está implementado em `backend/gate/getGateClient.js` (usado pelo servidor Express para buscar trades, saldo e ordens do usuário).

### Por que isso acontece no Windows

O serviço de sincronização de horário do Windows (`w32tm`) por vezes fica sem sincronizar por horas ou dias, especialmente após hibernação. Para forçar a sincronização manualmente (requer admin):

```powershell
w32tm /resync /force
```

### Onde o timestamp é usado no código

| Arquivo | Uso |
|---|---|
| `backend/bot/rsiTradeBot.js` | Assinatura de ordens, verificação de saldo e status de ordens |
| `backend/gate/getGateClient.js` | Busca de trades (`/spot/my_trades`), saldo e ordens via Express API |

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
