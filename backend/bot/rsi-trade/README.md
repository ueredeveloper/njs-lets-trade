# RSI Trade Bot — Binance / Gate.io

Bot de trading automático que opera as moedas listadas na tabela `favorites_trade` do Supabase.  
Suporta **Binance** e **Gate.io** por moeda, configurado via campo `exchange`.

## Como rodar

```bash
node backend/bot/rsiTradeBot.js
```

Requer `.env` na raiz com:

```
GATEIO_API_KEY=...
GATEIO_SECRET_KEY=...
BINANCE_API_KEY=...
BINANCE_SECRET_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DEFAULT_USER_ID=...
```

---

## Estratégia

### Sinal de compra (WATCHING → PENDING_BUY)

Todas as condições abaixo devem ser verdadeiras:

| # | Condição |
|---|---|
| 1 | RSI(14, 15m) **< 30** |
| 2 | Variação do candle (high − low) **≥ 0,5%** |
| 3 | Preço dentro do intervalo MA50(1h): **[ma50_lower_pct, +3%]** |
| 4 | Nenhuma ordem aberta já existente para o par |

**Ordem de compra:** limit order 1% abaixo do fechamento do candle (`GTC`).

---

### Filtro MA50(1h) — entrada

O preço deve estar entre o limite negativo por moeda e +3% da MA50 de 50 candles de 1h.

| Distância do preço em relação à MA50(1h) | Decisão |
|---|---|
| Dentro de `[ma50_lower_pct, +3%]` | ✅ entrada permitida |
| Abaixo de `ma50_lower_pct` | ❌ queda livre — bloqueado |
| Acima de +3% | ❌ afastado demais — bloqueado |

O `ma50_lower_pct` é **por moeda**, calculado via análise histórica (ver seção abaixo).  
Exemplos dos valores atuais:

| Moeda | Limite negativo |
|---|---|
| CHZUSDT | -1% |
| ALGOUSDT, AVAXUSDT | -3% |
| ASTRUSDT | -4% |
| Maioria das moedas | -6% |

---

### Sinal de venda

O bot usa **dois intervalos separados** para entrada e saída:

- **Entrada:** RSI de 15m (sinal de compra)  
- **Saída:** RSI de 5m (venda rápida) + RSI de 15m (venda lenta)

| Situação | Ação |
|---|---|
| RSI(5m) ≥ 80 | Vende imediatamente (sobrecomprado) |
| RSI(15m) > 70 | Vai para estado `ABOVE_70` — aguarda confirmação |
| Em `ABOVE_70`: RSI(15m) ≤ 70 | Vende (retorno da zona sobrecomprada) |
| Em `ABOVE_70`: RSI(5m) ≥ 80 | Vende imediatamente |

**Ordem de venda:** limit sell 0,5% abaixo do preço live no momento da venda.

---

### Stop-loss

Preço ≤ preço de compra − **5%** → venda imediata.

---

### Cancelamento de compra pendente

Se RSI(5m) ≥ 70 antes de a ordem ser preenchida → ordem cancelada, volta a `WATCHING`.

---

## Máquina de estados

```
WATCHING
   │  RSI(15m) < 30  +  var ≥ 0.5%  +  MA50(1h) ok  +  sem ordens abertas
   ▼
PENDING_BUY ──── RSI(5m) ≥ 70 antes do fill ────► WATCHING (ordem cancelada)
   │  ordem preenchida
   ▼
BOUGHT
   │  RSI(5m) ≥ 80               → PENDING_SELL (venda imediata)
   │  RSI(15m) > 70              → ABOVE_70
   │  preço ≤ compra − 5%        → PENDING_SELL (stop-loss)
   ▼
ABOVE_70
   │  RSI(5m) ≥ 80               → PENDING_SELL (venda imediata)
   │  RSI(15m) ≤ 70              → PENDING_SELL (saída lenta)
   │  preço ≤ compra − 5%        → PENDING_SELL (stop-loss)
   ▼
PENDING_SELL
   │  ordem de venda preenchida  → WATCHING
   │  ordem cancelada externamente → ABOVE_70 (nova tentativa)
   ▼
WATCHING (ciclo completo)
```

**Detecção de posição externa:** se o bot inicia em `WATCHING` mas detecta saldo do token ≥ $3, assume posição aberta e avança direto para `BOUGHT`.

---

## Regras de capital

| Regra | Valor |
|---|---|
| Capital máximo por moeda | **$40 USDT** |
| Saldo mínimo para aceitar entrada | **$30 USDT** |
| Saldo mínimo para considerar posição aberta | **$3 USDT** |
| Margem de segurança no orçamento | 1% (`balance × 0.99`) |

O bot não divide capital entre moedas. Cada moeda opera de forma independente com até $40 do saldo disponível no momento da compra.

---

## Taxas

| Operação | Taxa | Impacto |
|---|---|---|
| Compra (limit/maker) | 0,2% | Descontado dos tokens recebidos |
| Venda (limit/maker) | 0,2% | Descontado dos USDT recebidos |

O `buyQty` salvo no estado já é o valor líquido após a taxa de entrada. O PnL exibido é líquido das duas taxas (~0,4% total por ciclo).

---

## Polling

| Intervalo | Frequência de verificação |
|---|---|
| `1m` | a cada 1 min |
| `5m` | a cada 5 min |
| `15m` | a cada **60 segundos** (para não perder cruzamento de RSI(5m)) |
| `30m`, `1h`, `4h`… | a cada 5 min (teto) |

**Atualização de configurações:** a cada 5 minutos o bot recarrega `favorites_trade` do Supabase. Mudanças em `rsiBuy`, `rsiSell`, `ma50_lower_pct` etc. entram em vigor sem reiniciar o bot.

---

## Calibração do filtro MA50 (`test-ma50.js`)

Script de análise histórica que calcula o limite negativo seguro por moeda e salva no Supabase.

```bash
# Analisa uma moeda e salva ma50_lower_pct no Supabase
node backend/bot/test-ma50.js GENIUSUSDT

# Analisa todas as moedas dos favoritos e salva todas
node backend/bot/test-ma50.js --all

# Só exibe a tabela, não salva
node backend/bot/test-ma50.js --all --dry-run

# Moeda na Gate.io
node backend/bot/test-ma50.js BEAT_USDT gate
```

**Como funciona:** busca os últimos ~1000 candles de 1h, identifica episódios em que o preço estava em cada zona abaixo da MA50 (-1%, -2%, -3%…) e verifica em quantos deles o preço voltou à MA50 nas 72h seguintes. A zona mais profunda com ≥ 80% de recuperação e ≥ 5 episódios vira o `ma50_lower_pct` da moeda. Quando não há dados suficientes em nenhuma zona, usa **-3%** como padrão conservador.

---

## Configuração de moedas (Supabase)

As moedas são gerenciadas na tabela `favorites_trade`. Campos relevantes para o bot:

| Campo | Descrição | Padrão |
|---|---|---|
| `symbol` | Par no formato Binance (ex: `GENIUSUSDT`) | obrigatório |
| `exchange` | `binance` ou `gate` | `gate` |
| `interval` | Intervalo do candle de entrada | `30m` |
| `rsi_buy` | RSI abaixo deste valor → compra | `30` |
| `rsi_sell` | RSI acima deste valor → aguarda venda | `70` |
| `sell_interval` | Intervalo do candle de saída (se diferente) | automático |
| `variation_min` | Variação mínima do candle para entrar | por intervalo |
| `ma50_lower_pct` | Limite negativo de distância da MA50(1h) | `-3` |

> **Intervalos suportados pela Gate.io:** `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `8h`, `1d`.  
> O intervalo `3m` não é suportado pela Gate.io.

---

## Persistência

O estado de cada moeda sobrevive a hibernações e reinícios:

```
backend/data/bot/
  state-GENIUSUSDT.json    ← fase + dados da posição aberta
  log-GENIUSUSDT.txt       ← histórico de todas as operações
```

---

## Sincronização de relógio

A Gate.io rejeita requisições com `Timestamp` desincronizado em mais de 60 segundos (`403`).  
O bot sincroniza automaticamente no startup e renova o offset a cada hora.

Para forçar sincronização manual no Windows (requer admin):

```powershell
w32tm /resync /force
```
