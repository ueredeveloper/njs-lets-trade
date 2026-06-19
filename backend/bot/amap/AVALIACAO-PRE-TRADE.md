# Avaliação pré-trade — AMAP Multi-Trade

Guia para **testar e validar uma moeda antes de ativar o bot**. Use **BTCUSDT** como referência; troque o símbolo, exchange e parâmetros conforme sua config.

---

## Pré-requisitos

1. **`.env`** na raiz do projeto com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e (opcional) `SUPABASE_DEFAULT_USER_ID`.
2. **Backend rodando** para chamadas HTTP do painel:
   ```bash
   npm start
   ```
   Express em `http://localhost:3000`.
3. **Config salva no Multi-Trade** (recomendado para backtest e testes que leem `trade_config` do Supabase):
   - Painel **Multi-Trade** → configurar BTCUSDT → **Salvar**.
   - Isso sincroniza `multitrade_favorites` → `rsi_multi_bot_state`.

---

## Ordem sugerida de avaliação

Antes de ligar o bot em BTCUSDT, percorra nesta ordem:

| # | O quê | Onde |
|---|--------|------|
| 1 | Volume 24h vs mínimo | Painel ou API |
| 2 | Snapshot ao vivo (RSI, MA, bloqueios) | API `multitrade-evaluate` |
| 3 | Desconto PENDING sugerido | Painel **Sugerir** ou API |
| 4 | MA adaptativa (dip histórico) | CLI `--adaptive-test` |
| 5 | Regras 3/4 candles (extensão) | CLI `--extension-test` |
| 6 | Backtest completo da estratégia | CLI `--backtest` |
| 7 | Testes unitários (opcional) | `npx jest` |
| 8 | Iniciar bot | `node backend/bot/amap/amap-bot.js` |

---

## Exemplo completo: BTCUSDT na Binance

Pressupõe config padrão AMAP: entrada RSI(14,15m) &lt; 30, saída RSI &gt; 70, MA adaptativa 1h/4h, extensão 3/4 candles, desconto PENDING 0,1%, capital $100.

### 0. Salvar config no painel

1. Abra o site → painel **Multi-Trade**.
2. Adicione **BTCUSDT**, exchange **binance**, capital **100**.
3. Ajuste RSI, MA, extensão, desconto, volume.
4. Clique **Salvar** (obrigatório para `--backtest` ler do Supabase).

---

### 1. Volume 24h

**Painel:** ao digitar o símbolo, o modal mostra volume atual vs mínimo configurado.

**API** (com `npm start` rodando):

```bash
curl "http://localhost:3000/services/sb/multitrade-volume?symbol=BTCUSDT&exchange=binance&minVolumeUsdt=1000000"
```

| Campo | Significado |
|-------|-------------|
| `volumeUsdt` | Volume 24h em USDT |
| `meetsMin` | `true` se passa no filtro de volume |
| `minVolumeUsdt` | Mínimo da sua config |

Se `meetsMin: false`, o bot ainda pode operar com confirmação, mas na saída tende a usar venda a mercado.

---

### 2. Snapshot ao vivo (`multitrade-evaluate`)

Simula **agora**: RSI de entrada, preço, se a entrada seria permitida (MA, extensão, volume) e relatório MA adaptativa.

```bash
curl -X POST "http://localhost:3000/services/sb/multitrade-evaluate" ^
  -H "Content-Type: application/json" ^
  -d "{\"symbol\":\"BTCUSDT\",\"exchange\":\"binance\",\"entryRsi\":{\"interval\":\"15m\",\"period\":14,\"operator\":\"<\",\"value\":30},\"exitRsi\":{\"interval\":\"15m\",\"period\":14,\"operator\":\">\",\"value\":70},\"maConditions\":[{\"period\":50,\"interval\":\"4h\",\"mode\":\"strict_above\"},{\"period\":50,\"interval\":\"1h\",\"mode\":\"adaptive\"}],\"extension\":{\"enabled\":true,\"maPeriod\":50,\"maInterval\":\"1h\",\"abovePct\":5,\"threeCandles\":true,\"fourCandles\":true,\"confirmLogic\":\"any\"},\"execution\":{\"immediateEntry\":false,\"entryDiscount\":0.001,\"pendingTimeoutMs\":1800000,\"pendingCancelPct\":0.002},\"capital\":100}"
```

*(No PowerShell use `^` para quebra de linha; no bash use `\`.)*

| Campo na resposta | Significado |
|-------------------|-------------|
| `entryRsi` | RSI atual no intervalo de entrada |
| `price` | Preço de fechamento do último candle |
| `entryAllowed` | `true` = entraria agora (sem contar fase PENDING) |
| `entryBlockReason` | Motivo do bloqueio (`MA_BLOCKED`, `THREE_CANDLES_BLOCKED`, etc.) |
| `adaptive` | Episódios de dip abaixo da MA e threshold sugerido por filtro |
| `entryDiscountSuggest` | Sugestão de desconto PENDING (ver seção 3) |

---

### 3. Desconto de entrada PENDING

Quando **Compra imediata** está desligada, o bot entra em fase **PENDING**: aguarda o preço cair **X%** abaixo do gatilho (fechamento no sinal RSI) antes de comprar.

- Config: `execution.entryDiscount` (ex.: `0.01` = **1%**).
- Persistido em Supabase no JSON `trade_config.entryDiscount`.

**Painel:** seção *Execução da compra* → campo **% abaixo do gatilho** → botão **Sugerir**.

A sugestão analisa o histórico: em cada vez que o RSI de entrada foi atingido, mede quanto o preço **ainda cai** antes de subir (saída RSI, recuperação ou timeout). Usa a **mediana** das quedas × 0,85.

**API:**

```bash
curl "http://localhost:3000/services/sb/multitrade-suggest-discount?symbol=BTCUSDT&exchange=binance&entryInterval=15m&entryPeriod=14&entryOperator=%3C&entryValue=30&exitInterval=15m&exitPeriod=14&exitOperator=%3E&exitValue=70&pendingTimeoutMs=1800000&pendingCancelPct=0.002"
```

| Campo | Significado |
|-------|-------------|
| `suggestedPct` | Desconto sugerido em % (ex.: `1.2`) |
| `entryDiscount` | Mesmo valor em decimal (ex.: `0.012`) |
| `episodeCount` | Quantos sinais RSI históricos analisados |
| `medianDipPct` | Mediana da queda extra após o sinal |
| `hitRateAtSuggested` | % dos episódios em que o alvo sugerido teria sido atingido |
| `usedDefault` | `true` se poucos dados → fallback 0,1% |

**Presets no painel:** 0,1% · 0,5% · **1%** · 2% — ou valor customizado no campo numérico.

---

### 4. Teste MA adaptativa (`--adaptive-test`)

Para cada filtro MA em modo **adaptativo**, mostra episódios históricos de dip abaixo da MA, média, threshold clamp e se o preço atual passaria no filtro.

```bash
node backend/bot/amap/amap-bot.js --adaptive-test BTCUSDT binance 1h 4h
```

| Argumento | Descrição |
|-----------|-----------|
| `BTCUSDT` | Símbolo |
| `binance` | `binance` ou `gate` |
| `1h 4h` | Intervalos das MAs adaptativas (opcional; padrão `1h 4h`) |

**API:**

```bash
curl "http://localhost:3000/services/sb/multitrade-suggest-adaptive?symbol=BTCUSDT&exchange=binance&period=50&interval=1h&defaultPct=3&maxPct=8&minPct=0.5&minEpisodes=3"
```

**Painel:** em cada filtro MA em modo *adaptativo*, botão **Sugerir** ao lado de *Dip fixo %* — analisa histórico da moeda e preenche o valor sugerido.

| Campo | Significado |
|-------|-------------|
| `suggestedDipPct` | Dip % sugerido (média dos episódios, com clamp) |
| `episodeCount` | Episódios em que o preço ficou abaixo da MA e recuperou |
| `avgRaw` | Média bruta dos dips antes do clamp |
| `dipNowPct` | Quanto o preço atual está abaixo da MA |
| `entryOk` | Se o preço atual passaria no piso adaptativo |

---

### 5. Teste extensão 3/4 candles (`--extension-test`)

Quando o preço está **muito acima da MA** (+`abovePct`%, padrão 5%), as regras de candles evitam compra no topo:

| Regra | Condição |
|-------|----------|
| **3 candles** | Últimos 3 candles fechados verdes (`close > open`) no `threeInterval` |
| **4 candles** | 3 altas + 1 queda no `fourInterval` |
| **Lógica** | `any` = basta uma regra; `all` = exige ambas |

```bash
node backend/bot/amap/amap-bot.js --extension-test BTCUSDT binance
node backend/bot/amap/amap-bot.js --extension-test BTCUSDT binance 1h
node backend/bot/amap/amap-bot.js --extension-test BTCUSDT binance 1h 4h
```

| Argumento | Descrição |
|-----------|-----------|
| `binance` | Exchange (opcional) |
| `1h` | `threeInterval` (opcional) |
| `4h` | `fourInterval` (opcional; se omitido, usa o mesmo da regra 3) |

Usa `trade_config` do Supabase se BTCUSDT estiver salvo; senão, defaults AMAP.

**Saída:** sinais esticados, entradas confirmadas vs bloqueadas, trades salvos (bloqueio evitou prejuízo) vs oportunidades perdidas.

---

### 6. Backtest completo (`--backtest`)

Simula toda a estratégia no histórico: RSI entrada/saída, MA, extensão, PENDING com desconto, stop MA, capital.

```bash
node backend/bot/amap/amap-bot.js --backtest BTCUSDT binance 100
```

| Argumento | Descrição |
|-----------|-----------|
| `binance` | Exchange (opcional) |
| `100` | Capital inicial em USDT (opcional) |

**Requer** BTCUSDT salvo no Supabase (`multitrade_favorites` / `rsi_multi_bot_state`).

**Saída:** capital final, número de trades, win rate, PnL, quantos sinais foram bloqueados por MA/extensão, stops por MA.

No painel Multi-Trade, o comando aparece em *Backtest* com botão **Copiar**:

```
node backend/bot/amap/amap-bot.js --backtest BTCUSDT binance 100
```

---

### 7. Testes unitários (Jest)

Validam a lógica sem API nem Supabase:

```bash
# Regras 3/4 candles (analyzeExtension)
npx jest backend/tests/extension-candles.test.js

# Backtest de extensão com dados locais (se existir BTCUSDT-15m.json)
npx jest backend/tests/extension-backtest.test.js

# Sugestão de desconto PENDING
npx jest backend/tests/suggest-entry-discount.test.js

# Todos os testes AMAP relacionados
npx jest backend/tests/extension-candles.test.js backend/tests/extension-backtest.test.js backend/tests/suggest-entry-discount.test.js
```

---

### 8. Iniciar o bot (após avaliação)

```bash
# Todos os símbolos salvos no Supabase
node backend/bot/amap/amap-bot.js

# Apenas BTCUSDT
node backend/bot/amap/amap-bot.js --symbol BTCUSDT
```

O bot lê `trade_config` de `rsi_multi_bot_state`, incluindo `entryDiscount`, regras 3/4, MA, etc.

**Log em PENDING** (exemplo com 1% de desconto):

```
🎯 PENDING [AMAP] alvo $97234.50
```

Alvo = preço do gatilho × (1 − `entryDiscount`).

---

## Resumo dos comandos CLI (BTCUSDT)

```bash
# 1. MA adaptativa
node backend/bot/amap/amap-bot.js --adaptive-test BTCUSDT binance 1h 4h

# 2. Extensão 3/4 candles
node backend/bot/amap/amap-bot.js --extension-test BTCUSDT binance 1h 4h

# 3. Backtest completo (config do Supabase)
node backend/bot/amap/amap-bot.js --backtest BTCUSDT binance 100

# 4. Bot ao vivo
node backend/bot/amap/amap-bot.js --symbol BTCUSDT
```

---

## Resumo das APIs HTTP

Base: `http://localhost:3000/services/sb/` (requer auth ou `SUPABASE_DEFAULT_USER_ID` no `.env`).

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/multitrade-volume` | GET | Volume 24h vs mínimo |
| `/multitrade-suggest-discount` | GET | Desconto PENDING sugerido pelo histórico |
| `/multitrade-suggest-adaptive` | GET | Dip % sugerido para MA adaptativa |
| `/multitrade-evaluate` | POST | Snapshot ao vivo + adaptive + sugestão de desconto |
| `/multitrade-favorites` | GET/POST | Ler/salvar config |

---

## Checklist rápido antes do trade

- [ ] Config BTCUSDT salva no Multi-Trade
- [ ] Volume 24h ≥ mínimo (ou aceito risco de saída a mercado)
- [ ] `multitrade-evaluate`: `entryAllowed` coerente com o momento (ou entende que é snapshot)
- [ ] Desconto PENDING definido (manual ou **Sugerir**)
- [ ] `--adaptive-test`: preço atual passa no piso MA adaptativo
- [ ] `--extension-test`: regras 3/4 não bloqueiam demais / salvam trades ruins
- [ ] `--backtest`: win rate e PnL aceitáveis no histórico
- [ ] Bot iniciado com `--symbol BTCUSDT` ou lista completa

---

## Arquivos relacionados

| Arquivo | Conteúdo |
|---------|----------|
| `backend/bot/amap/amap-bot.js` | Bot + CLI backtest/adaptive/extension |
| `backend/bot/amap/strategyEngine.js` | Motor de entrada/saída |
| `backend/bot/amap/suggestEntryDiscount.js` | Análise de desconto PENDING |
| `backend/bot/amap/extensionBacktest.js` | Backtest regras 3/4 |
| `backend/bot/amap/tradeConfigSchema.js` | Schema e defaults (`entryDiscount`, etc.) |
| `frontend-react/src/components/MultitradeModal.jsx` | Formulário + Sugerir desconto + copiar backtest |
| `supabase/database-schema.md` | Estrutura `trade_config` no Supabase |
