# scan-variation.js

Varre todas as moedas da pasta `backend/data/candlestick` no gráfico de **5 minutos**, calcula o **RSI(14)** e a **variação das últimas 24h**, e exibe os resultados agrupados por faixa de variação.

Antes de analisar, atualiza automaticamente via Gate.io as moedas que **não existem na Binance** (nos intervalos 1m, 5m, 15m, 30m, 4h e 8h).

---

## Como usar

```bash
node backend/bot/scan-variation.js
```

### Flags opcionais

| Flag | Efeito |
|---|---|
| _(sem flag)_ | Atualiza Gate.io + exibe todas as moedas agrupadas |
| `--rsi-only` | Exibe apenas moedas com RSI < 30 ou RSI > 70 |
| `--skip-update` | Pula a atualização Gate.io (mais rápido, usa dados locais) |

### Exemplos

```bash
# Scan completo com atualização Gate.io
node backend/bot/scan-variation.js

# Apenas oportunidades de compra/venda pelo RSI
node backend/bot/scan-variation.js --rsi-only

# Scan rápido sem atualizar candles
node backend/bot/scan-variation.js --skip-update

# Combinar flags
node backend/bot/scan-variation.js --rsi-only --skip-update
```

---

## O que aparece na tela

### 1. Etapa de atualização Gate.io

```
Buscando símbolos da Binance... OK — 3600 pares Binance
  Exclusivas Gate.io: 11 de 447 moedas

Atualizando 11 moedas via Gate.io [1m, 5m, 15m, 30m, 4h, 8h] (5 simultâneas)...
  ✔ 11 atualizadas
```

Moedas exclusivas Gate.io atualmente rastreadas: `ARIAUSDT`, `BEATUSDT`, `DNUSDT`, `DNXUSDT`, `FARTCOINUSDT`, `HYPEUSDT`, `SKYAIUSDT`, `SLXUSDT`, `UNAUSDT`, `XLM3SUSDT`, `ZESTUSDT`.

### 2. Tabela por grupo de variação

As moedas são agrupadas pela faixa de variação das últimas 24h (calculada sobre as últimas 288 velas de 5m):

```
▶ +2% a +3%  (18 moedas)
────────────────────────────────────────────────────────
Símbolo             Variação 24h  RSI(14)  Sinal
────────────────────────────────────────────────────────
MASKUSDT                  +2.89%     78.8  OVERBOUGHT
MANAUSDT                  +2.41%     52.3  -
LINKUSDT                  +2.10%     29.1  OVERSOLD
────────────────────────────────────────────────────────
```

- Variação positiva → verde | negativa → vermelho
- RSI < 30 → **OVERSOLD** (verde) — possível entrada
- RSI > 70 → **OVERBOUGHT** (vermelho) — possível saída
- Os grupos aparecem do maior positivo ao maior negativo

### 3. Resumo final

```
Resumo
  Total analisado:       447 moedas
  Atualizadas Gate.io:   11 moedas
  RSI < 30 (OVERSOLD):   2 moedas
  RSI > 70 (OVERBOUGHT): 22 moedas

Oversold — RSI < 30 (oportunidade de compra)
──────────────────────────────────────────────────
  TUSDUSDT           RSI:   5.5  Var:   -0.04%
  LINKUSDT           RSI:  29.1  Var:   +2.10%

Overbought — RSI > 70 (sinal de venda)
──────────────────────────────────────────────────
  MASKUSDT           RSI:  78.8  Var:   +2.89%
  ...
```

---

## Como os dados são calculados

| Campo | Cálculo |
|---|---|
| **Variação 24h** | `(último close − primeiro close) / primeiro close × 100` nas últimas 288 velas de 5m |
| **RSI(14)** | RSI padrão de 14 períodos sobre os closes de 5m (biblioteca `technicalindicators`) |
| **Grupo** | Parte inteira da variação — ex: 2.7% → grupo `+2% a +3%` |

---

## Fonte dos dados

| Moeda | Origem dos candles |
|---|---|
| Existe na Binance | Arquivo local `backend/data/candlestick/SYMBOL-5m.json` (sem atualização automática) |
| Exclusiva Gate.io | Arquivo local atualizado via `GET api.gateio.ws` antes de cada scan |

Para atualizar os candles das moedas Binance, use o servidor Express normalmente (ele salva candles automaticamente durante o uso do frontend).
