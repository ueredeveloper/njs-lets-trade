# Estudo de Estratégias RSI Multi-Intervalo — GENIUSUSDT

**Data:** 15/06/2026  
**Bot:** `backend/bot/rsi-ma50/trading-rsi-multi.js`  
**Par:** GENIUSUSDT (Binance)  
**Capital simulado:** $100 por estratégia  
**Dados:** arquivos locais em `backend/data/candlestick/`

---

## O que é o bot RSI Multi-Intervalo?

O bot monitora o RSI (Índice de Força Relativa) em dois intervalos de tempo distintos:

- **Intervalo de entrada:** detecta quando o mercado está sobrevendido (RSI baixo → oportunidade de compra)
- **Intervalo de saída:** detecta quando o mercado está sobrecomprado (RSI alto → hora de vender)

A ideia central é usar intervalos maiores para a saída, filtrando o ruído dos timeframes menores e esperando confirmação mais forte antes de realizar o lucro.

### Mecânica de entrada (PENDING)

Quando o RSI de entrada cai abaixo do limite de compra, o bot não compra imediatamente. Ele aguarda a execução das seguintes condições:

1. RSI detectado < limiar de compra (ex: RSI(5m) < 30)
2. Preço cai mais 0,1% do preço no momento do sinal → **compra executada**
3. Se o preço subir 0,2% antes de cair 0,1% → **sinal cancelado** (evita perseguir preço)
4. Se demorar muito sem cair → **timeout** (cancela também)

### Mecânica de saída

O bot verifica o RSI do intervalo de saída a cada tick. Quando o RSI de saída ultrapassa o limiar configurado (ex: RSI(15m) > 70), a posição é vendida.

---

## Filtro MA50(1h) — O que é e por que usar?

A MA50 é a **Média Móvel Simples de 50 períodos no gráfico de 1 hora**. Ela representa o "preço médio das últimas 50 horas" e é amplamente usada para identificar a tendência de médio prazo.

**Regras do filtro:**

| Situação | Ação |
|---|---|
| Preço **abaixo** da MA50(1h) | Bloqueado — mercado em tendência de baixa |
| Preço **até 5% acima** da MA50(1h) | Permitido — zona saudável de alta |
| Preço **mais de 5% acima** da MA50(1h) | Depende da regra dos 3 candles |

**Regra dos 3 candles (quando preço > MA50 + 5%):**
- Verifica os últimos 3 candles de 1h **já fechados**
- Todos devem ser de alta (close > open)
- Se nem um deles for de baixa → entrada **permitida** (tendência forte)
- Se algum for de baixa → entrada **bloqueada** (rally possivelmente fraco)

**Por que isso importa?** Comprar quando o preço está abaixo da MA50 significa nadar contra a maré. O filtro MA50 protege de entrar em quedas prolongadas onde o RSI fica sobrevendido por dias seguidos sem recuperação.

---

## As 3 Estratégias

---

### Estratégia A — `rsi1m30_1m70`

**Lógica:** Usar o RSI de 1 minuto tanto para entrada quanto para saída.

```
ENTRADA: RSI(1m, período 14) < 30
SAÍDA:   RSI(1m, período 14) > 70
```

**Filosofia:** Capturar oscilações ultra-curtas de mercado. Quando o RSI de 1 minuto cai abaixo de 30, o preço está em queda rápida e pode haver um repique. A saída é feita quando o RSI de 1 minuto ultrapassa 70, indicando sobrecompra.

**Problema inerente:** O RSI de 1 minuto é extremamente volátil. Ele pode ir de 30 a 70 em poucos minutos, mas também pode ficar abaixo de 30 por uma hora inteira durante uma queda forte. Isso gera:
- Muitos sinais em pouco tempo (ruído)
- Saídas prematuras antes de o preço subir de verdade
- Entradas durante quedas prolongadas sem recuperação imediata

---

### Estratégia B — `rsi5m30_15m70`

**Lógica:** Usar RSI de 5 minutos para detectar sobrevendido e RSI de 15 minutos para confirmar sobrecomprado.

```
ENTRADA: RSI(5m, período 14) < 30
SAÍDA:   RSI(15m, período 14) > 70
```

**Filosofia:** O RSI de 5 minutos é menos ruidoso que o de 1 minuto, gerando sinais de entrada com mais "peso". A saída no RSI de 15 minutos exige que a recuperação seja sustentada por mais tempo — o mercado precisa subir o suficiente para o RSI de 15 minutos cruzar 70, o que normalmente representa uma alta mais consistente.

**Vantagem sobre A:** O 15m de saída funciona como "confirmação extra" de que a alta tem força. Isso evita saídas prematuras em repiques fracos de 1-2 minutos.

---

### Estratégia C — `rsi1h35_15m85`

**Lógica:** Usar RSI de 1 hora para detectar sobrevendido e RSI de 15 minutos com limiar alto para saída.

```
ENTRADA: RSI(1h, período 14) < 35
SAÍDA:   RSI(15m, período 14) > 85
```

**Filosofia:** Operar em ondas de médio prazo. Quando o RSI de 1 hora cai abaixo de 35, é um sinal de sobrevendido significativo — isso representa horas de queda acumulada. A saída em RSI(15m) > 85 busca um movimento de recuperação robusto.

**Problema:** O RSI(15m) > 85 é **muito raro**. Em mercados normais, o RSI fica entre 40–70. Atingir 85 significa uma alta de força excepcional, que pode nunca ocorrer após uma entrada. Se o mercado se recuperar de forma gradual (RSI ficando em 60-70), a posição permanece aberta indefinidamente.

---

## Resultados dos Backtests

---

### Resultado #1 — Estratégia A sem MA50

```bash
node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest GENIUSUSDT rsi1m30_1m70 binance 100 false
```

**Período:** ~2 dias (3000 candles de 1m)  
**Capital:** $100.00 → **$96.25** (-3.75%)  
**Trades:** 7 | Wins: 3 | Losses: 4 | Win rate: **42.9%**

**O que aconteceu:** O bot entrou 7 vezes em 2 dias — uma frequência altíssima. A maioria das entradas foi durante quedas que continuaram caindo, e as saídas chegaram cedo demais em repiques fracos. 4 trades perdedores em 7 = estratégia marginal nesse contexto.

---

### Resultado #2 — Estratégia A com MA50

```bash
node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest GENIUSUSDT rsi1m30_1m70 binance 100 true
```

**Período:** ~2 dias  
**Capital:** $100.00 → **$94.06** (-5.94%)  
**Trades:** 5 | Wins: 2 | Losses: 3 | Win rate: **40.0%**  
**Sinais bloqueados pela MA50:** 38

**O que aconteceu:** Contraintuitivamente, adicionar o filtro MA50 **piorou** o resultado neste caso. O motivo: com só 2 dias de dados de 1m, os 38 sinais bloqueados incluíam alguns que teriam dado lucro. Além disso, o período de 2 dias é curto demais para o filtro MA50 mostrar seu valor (ele brilha em períodos mais longos ao evitar quedas prolongadas).

---

### Resultado #3 — Estratégia B sem MA50

```bash
node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest GENIUSUSDT rsi5m30_15m70 binance 100 false
```

**Período:** 01/06/2026 → 12/06/2026 (~11 dias)  
**Dados:** 3000 candles de 5m + 2320 candles de 15m  
**Capital:** $100.00 → **$98.37** (-1.63%)  
**Trades:** 7 | Wins: 5 | Losses: 2 | Win rate: **71.4%**

| Data/Hora        | RSI saída | PnL%     | Capital  |
|------------------|-----------|----------|----------|
| 05/06 06:00      | 71.5      | -10.92%  | $89.08   |
| 07/06 00:15      | 71.7      | -4.22%   | $85.32   |
| 07/06 18:00      | 77.0      | +6.61%   | $90.96   |
| 08/06 18:30      | 70.3      | +3.24%   | $93.91   |
| 09/06 06:45      | 73.4      | +3.09%   | $96.81   |
| 10/06 06:00      | 76.8      | +0.98%   | $97.77   |
| 11/06 20:30      | 71.4      | +0.62%   | $98.37   |

**O que aconteceu:** 71.4% de acerto é bom, mas as duas perdas (-10.92% e -4.22%) foram devastadoras porque ocorreram no início do período, quando GENIUS ainda estava em tendência de baixa. A entrada de 03/06 a $0.51 ficou presa enquanto o preço caiu até $0.39 antes de subir. As 5 vitórias posteriores não compensaram totalmente essas perdas iniciais.

---

### Resultado #4 — Estratégia B com MA50 ✅ MELHOR RESULTADO

```bash
node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest GENIUSUSDT rsi5m30_15m70 binance 100 true
```

**Período:** 01/06/2026 → 12/06/2026 (~11 dias)  
**Capital:** $100.00 → **$108.14** (+8.14%)  
**Trades:** 4 | Wins: 4 | Losses: 0 | Win rate: **100%**  
**Sinais bloqueados pela MA50:** 80

| Data/Hora        | RSI saída | PnL%    | Capital  |
|------------------|-----------|---------|----------|
| 08/06 18:30      | 70.3      | +3.24%  | $103.24  |
| 09/06 06:45      | 73.4      | +3.09%  | $106.43  |
| 10/06 06:00      | 76.8      | +0.98%  | $107.48  |
| 11/06 20:30      | 71.4      | +0.62%  | $108.14  |

**Sinais e decisões:**

| Entrada         | RSI  | Preço   | Resultado                           |
|-----------------|------|---------|-------------------------------------|
| 02/06 08:10     | 29.9 | $0.4445 | cancelado (preço subiu antes)       |
| 03/06 07:05     | 27.1 | $0.5296 | bloqueado (3 candles 1h não bullish)|
| 03/06 07:20-50  | vários | $0.51-0.52 | bloqueados (3 candles)          |
| 03/06 13:20     | 29.1 | $0.5006 | cancelado (preço subiu)             |
| 03/06–07/06     | vários | $0.39-0.45 | bloqueados (abaixo MA50)        |
| 08/06 06:05     | 29.6 | $0.4451 | ✅ vendido +3.24%                   |
| 08/06 22:20     | 30.0 | $0.4390 | cancelado (preço subiu)             |
| 08/06 22:35     | 29.1 | $0.4375 | ✅ vendido +3.09%                   |
| 09/06 18:30     | 27.8 | $0.4496 | cancelado (preço subiu)             |
| 09/06 18:40     | 27.7 | $0.4480 | ✅ vendido +0.98%                   |
| 10/06 13:55     | 29.8 | $0.4792 | bloqueado (3 candles 1h não bullish)|
| 10/06 15:40     | 28.6 | $0.4687 | ✅ vendido +0.62%                   |

**O que aconteceu:** O filtro MA50 salvou o bot de 80 entradas ruins durante a queda de GENIUS de $0.55 → $0.39 (01/06 a 07/06). Só após o preço cruzar de volta acima da MA50(1h) o bot voltou a operar — e as 4 entradas seguintes foram todas vencedoras. Isso demonstra o poder do filtro: proteger capital durante tendências de baixa e só operar quando a tendência de médio prazo é favorável.

---

### Resultado #5 — Estratégia C sem MA50

```bash
node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest GENIUSUSDT rsi1h35_15m85 binance 100 false
```

**Período:** 22/05/2026 → 15/06/2026 (~25 dias)  
**Dados:** 578 candles de 1h + 2320 candles de 15m  
**Capital:** $100.00 → **$100.00** (0% — mas há posição aberta)  
**Trades fechados:** 0  
**Posição aberta:** comprado a $0.6038 em 25/05 — **PnL latente: -25.42%**

**O que aconteceu:** O RSI(1h) < 35 ocorreu em 25/05/2026 quando o preço estava em $0.60. Depois disso, o preço caiu continuamente até $0.39. O RSI(15m) **nunca atingiu 85** — o mercado até se recuperou parcialmente, mas a recuperação foi gradual (RSI(15m) ficando na faixa de 60-75). Resultado: posição presa por 21 dias, com -25% latente.

**Lição:** RSI(15m) > 85 é extremamente raro e inadequado como saída. Em qualquer recuperação "normal", o RSI(15m) chega a 70-75 mas não a 85. O trader ficaria preso aguardando um nível que quase nunca aparece.

---

### Resultado #6 — Estratégia C com MA50

```bash
node backend/bot/rsi-ma50/trading-rsi-multi.js --backtest GENIUSUSDT rsi1h35_15m85 binance 100 true
```

**Período:** 22/05/2026 → 15/06/2026 (~25 dias)  
**Capital:** $100.00 → **$100.00** (0%)  
**Trades:** 0  
**Sinais bloqueados pela MA50:** 42

**O que aconteceu:** Neste caso, o filtro MA50 **salvou o capital**. A entrada de 25/05 a $0.60 foi bloqueada porque o preço já estava abaixo da MA50(1h). Todos os demais 41 sinais também foram bloqueados pela mesma razão. Capital preservado sem operar.

**Lição:** Aqui o filtro MA50 funcionou como proteção total — evitou a armadilha da Estratégia C #5. Porém, a estratégia ficou completamente inativa por 25 dias, o que também não é ideal.

---

## Comparativo Geral

| # | Estratégia                   | MA50 | Período   | Capital Final | PnL      | Trades | Win Rate |
|---|------------------------------|------|-----------|---------------|----------|--------|----------|
| 1 | RSI(1m)<30 → RSI(1m)>70     | ❌   | ~2 dias   | $96.25        | -3.75%   | 7      | 42.9%    |
| 2 | RSI(1m)<30 → RSI(1m)>70     | ✅   | ~2 dias   | $94.06        | -5.94%   | 5      | 40.0%    |
| 3 | RSI(5m)<30 → RSI(15m)>70    | ❌   | ~11 dias  | $98.37        | -1.63%   | 7      | 71.4%    |
| **4** | **RSI(5m)<30 → RSI(15m)>70** | **✅** | **~11 dias** | **$108.14** | **+8.14%** | **4** | **100%** |
| 5 | RSI(1h)<35 → RSI(15m)>85    | ❌   | ~25 dias  | $100.00       | 0% (-25% latente) | 0 | — |
| 6 | RSI(1h)<35 → RSI(15m)>85    | ✅   | ~25 dias  | $100.00       | 0%       | 0      | —        |

---

## Análise por Eixo

### Impacto do filtro MA50(1h)

| Estratégia | Sem MA50 | Com MA50 | Diferença |
|---|---|---|---|
| RSI(1m) | -3.75% | -5.94% | -2.19% (piorou*) |
| RSI(5m)/RSI(15m) | -1.63% | +8.14% | **+9.77%** |
| RSI(1h)/RSI(15m) | 0% (posição aberta perdendo) | 0% (capital protegido) | salva capital |

*\* O RSI(1m) piorou com MA50 neste recorte de 2 dias por limitação de dados — em períodos mais longos a MA50 tende a ajudar.*

**Conclusão:** O filtro MA50 tem impacto decisivo. Na estratégia B (5m/15m), foi a diferença entre -1.63% e +8.14%. Na estratégia C (1h), foi a diferença entre perder 25% e preservar o capital.

### Por que os intervalos de entrada/saída importam

| Entrada | Saída | Característica | Risco |
|---|---|---|---|
| 1m | 1m | Ultra-rápido, muitos sinais | Muito ruído, saída prematura |
| 5m | 15m | Equilibrado | Boa relação sinal/ruído |
| 1h | 15m (>85) | Lento, poucas entradas | Limiar de saída inatingível |

O par **5m → 15m** é o mais balanceado: entrada sensível o suficiente para pegar oportunidades, saída exigente o suficiente para esperar uma recuperação real.

---

## Conclusões

### 1. Estratégia recomendada: `rsi5m30_15m70` + MA50 ativado

É a única combinação com resultado positivo no período testado. O filtro MA50 protegeu de 80 entradas ruins e deixou passar apenas as 4 que eram sólidas — todas vencedoras.

### 2. O filtro MA50 é a peça mais importante

Em mercados em queda, o RSI pode ficar abaixo de 30 por dias seguidos criando muitos "sinais falsos". O filtro MA50 elimina esses sinais de forma objetiva: se o preço está abaixo da média de 50 horas, a tendência é de baixa e não vale comprar.

### 3. RSI(1m) é inadequado para este tipo de estratégia

A janela de 1 minuto gera ruído excessivo. O bot entra e sai rápido demais, acumulando pequenas perdas em sequência. Timeframes de 5m ou maiores são mais confiáveis.

### 4. RSI(15m)>85 como saída é impraticável

O limiar de 85 é alto demais. Recuperações normais de mercado geram RSI entre 60-75. Usar >85 significa que o bot pode ficar preso indefinidamente esperando um nível que quase nunca aparece.

### 5. Limitações deste estudo

- O período de 11 dias para estratégia B é curto — resultados podem variar em outros ciclos de mercado
- GENIUSUSDT é uma altcoin com alta volatilidade; estratégias podem se comportar diferente em BTC/ETH
- O RSI calculado pode divergir ligeiramente do da Binance por diferença no warmup histórico (Wilder's smoothing)
- 100% de win rate em 4 trades não é estatisticamente significativo — precisa de mais dados

---

## Comando para operar ao vivo

```bash
# Inserir no Supabase (rsi_multi_bot_state):
# symbol = 'GENIUSUSDT', strategy_id = 'rsi5m30_15m70', exchange = 'binance', capital = 100

# Iniciar o bot:
node backend/bot/rsi-ma50/trading-rsi-multi.js
```

Schema SQL disponível em: `backend/bot/rsi-ma50/rsi-multi-bot.sql`
