# Setups Matadores para Day Trade — leitura, adaptação e plano

Livro: *SETUPS Matadores para Day Trade — Facilitando a forma de operar Day Trade em Mini Índice e Mini Dólar* (vol. 1), de João Victor Haro Chagas. Arquivo: `setups-matadores-para-day-trade-joao-victor-haro.epub` (mesma pasta).

**Decisões do projeto:** só compra (spot), 15m por padrão, e **estatística primeiro** (backtest na aba Estatísticas → "Setups"), bot depois — só dos setups que sobreviverem.

---

## 1. O que o livro traz

É um mini-ebook curto, com 6 setups, feito para **Mini Índice e Mini Dólar (B3)**, em gráfico de 10 min e Renko 6R. O autor afirma "eficiência comprovada", mas **não mostra nenhum dado ou backtest** — trate todos os percentuais de acerto como não verificados.

Todos os setups seguem o mesmo esqueleto:

1. **Filtro de contexto** (na maioria, a tendência).
2. **Candle-sinal**: o candle que define a entrada.
3. **Entrada** no rompimento da máxima (compra) ou da mínima (venda) do candle-sinal, com 1 tick de folga.
4. **Stop** no extremo oposto do mesmo candle-sinal.
5. **Alvos em múltiplos do risco (R)**: geralmente 50% da posição em 1R e o resto em 2R, ou 1,618R.

| Setup | Contexto | Candle-sinal | Alvo | Acerto citado |
|---|---|---|---|---|
| **Tendência** (base) | SMA20 acima da EMA80, preço acima da SMA20, topos e fundos ascendentes | topo/fundo = candle com máxima/mínima maior/menor que o anterior **e** o seguinte | (filtro) | (filtro) |
| **One Punch** | barra grande de abertura que rompe a congestão de ontem (de preferência com gap); 2ª barra ≤ 50% da 1ª | 2ª barra pequena | 161,8% da barra grande, medido a partir da mínima da pequena; entrar até o 4º candle e sair em ~45 min | não informado |
| **Ponto Contínuo** | tendência + recuo até a SMA21 | candle que toca a média | 50% em 1R, 50% em 2R | não informado |
| **Fechou Fora, Fechou Dentro** | Bollinger (20, 2); box fecha fora da banda | box seguinte que fecha de volta dentro | 50% em 1R, resto em 2R ou na banda oposta | ~75% (alvo na média de 20) |
| **PFR** | preço > EMA8 > EMA80 | mínima menor que a dos 2 candles anteriores e fechamento acima do anterior | 1,618R | 65–70% |
| **Martelinho** | preço em nível de pivô (fibonacci) | martelo no nível | 50% em 1R, resto em 2R ou mais | "interessante" |

## 2. O que precisa de atenção antes de automatizar

**Definições ambíguas ou ausentes** (viraram parâmetro):

- A SMA é de 20 no capítulo de tendência e de 21 no Ponto Contínuo.
- PFR: "fechamento acima do candle prévio" pode ser acima do *fechamento* ou da *máxima* do anterior (`pfrCloseAbove`).
- PFR: "161,8% do ponto de entrada" no texto, mas o exemplo usa 161,8% do **risco**.
- Fechou Fora: o texto põe o stop na "máxima do candle que fechou fora", o exemplo usa "mínima dos dois candles" (`ffStopMode`).
- "Martelo" e os níveis do "Método LeandroStormer" não têm definição numérica.
- One Punch: "barra ampla", "bom volume" e "zona de congestão" não têm número.

**Contradição do autor:** diz "não procure topos e fundos" e opera só a favor da tendência, mas o Fechou Fora é reversão à média e o Martelinho compra em nível de suporte.

**Custos.** Os stops têm o tamanho de um candle. Com taxa spot de 0,1% por lado (~0,2% ida e volta) mais slippage, um R de 0,4% perde metade dele só em custo. Regra prática: R mínimo de 5–10× o custo (~1–2%) — favorece altcoins em 15m–1h e descarta BTC em 5m.

**Pontos de equilíbrio (antes de custos):**

- Alvo único de 1,618R só se paga com **38,2%** de acerto (1 / (1 + 1,618)). O acerto de 65–70% citado no PFR daria +0,7R por trade — bom demais para ser verdade.
- Parcial 50% em 1R + 50% em 2R, **stop original mantido**: −1R se o stop vem antes de 1R; **0** se bate 1R e volta ao stop; +1,5R se bate 2R. Logo `EV = 1,5·P(2R) − P(stop) − custos`. É o que o livro chama de "sem risco": a metade que sai em 1R paga a metade estopada — por isso o stop **não** é movido.

**Só compra:** o adaptador (`buildAdapter.js`) só tem compra a mercado e OCO de venda, ou seja, é spot. Metade dos sinais do livro (vendas) não se aplica.

**Intervalos:** nem Binance nem Gate têm 10m. Renko não existe no projeto (começar com candles de tempo; depois testar Renko com caixa baseada em ATR).

**Abertura/gap:** cripto não tem. O One Punch usa como substituto a virada UTC (21:00 BRT) e a abertura de NY (10:30 BRT no horário de verão dos EUA).

## 3. Estatística implementada (fase 0)

Aba **Estatísticas → Setups** (mesmo formato do Momentum RSI: uma moeda ou mercado inteiro). Só compra, 15m por padrão, candle **fechado**, um trade por vez por moeda/setup.

### Arquivos

| Arquivo | Papel |
|---|---|
| `backend/bot/candle-setups/setupDetectors.js` | detectores puros (candles → sinal); serão os mesmos do bot |
| `backend/bot/candle-setups/setupSimulator.js` | simula 1 trade: rompimento, stop, alvos em R, parcial, tempo, custos |
| `backend/bot/candle-setups/tradeConfigSchema.js` | defaults e validação de todos os parâmetros |
| `backend/utils/analyseCandleSetupsBacktest.js` | uma moeda ou mercado USDT; agregados por setup |
| `backend/services/fetchCandleSetupsBacktest.js` | `GET /services/candle-setups-backtest` |
| `frontend-react/src/components/CandleSetupsStats.jsx` | a aba (comparativo, faixa de risco, por moeda, trades, clique abre no gráfico) |
| `backend/tests/candle-setups.test.js` | 24 testes (simulador, detectores, "sem olhar o futuro") |

### Regras exatas de cada setup (como implementadas)

Comum: gatilho = máxima do candle-sinal + `entryOffsetPct` (0,02%); stop = mínima do candle-sinal − `stopOffsetPct` (0,02%); a folga em % faz o papel do "1 tick" (o bot ao vivo usará o `tickSize` real).

- **PFR:** EMA8 > EMA80, fechamento > EMA80 e > EMA8; mínima < mínimas dos 2 candles anteriores; fechamento > fechamento (ou máxima) do anterior. Alvo único 1,618R.
- **Ponto Contínuo:** no candle anterior: SMA20 > EMA80, fechamento > SMA20 e topos/fundos ascendentes; fechamento anterior > SMA21; o candle-sinal toca a SMA21 (mínima ≤ SMA21 ≤ máxima). 50% em 1R, 50% em 2R.
- **Fechou Fora, Fechou Dentro (compra):** candle anterior fecha abaixo da banda inferior (20, 2) e o atual fecha ≥ banda inferior. Stop na mínima dos dois candles. 50% em 1R; resto em 2R, banda média ou banda superior (níveis fixados no candle-sinal).
- **Martelinho:** pivôs Fibonacci do dia UTC anterior completo — P=(H+L+C)/3, S1/S2/S3 = P − 0,382/0,618/1,0·(H−L) (**aproximação**, o livro não detalha o método). Martelo = pavio inferior ≥ 2× o corpo e ≥ 50% da amplitude, pavio superior ≤ 25%; mínima a ≤ 0,3% do nível e fechamento acima dele. 50%/50% em 1R/2R.
- **One Punch:** 1ª barra da sessão (00:00 e 13:30 UTC): altista, corpo ≥ 60%, amplitude ≥ 1,5× ATR14, volume ≥ 1,5× média 20, fechando acima da máxima do último dia; 2ª barra (o sinal) com amplitude ≤ 50% da 1ª. Entra até o 4º candle; alvo = mínima da 2ª + 161,8% da amplitude da 1ª; sai por tempo em 45 min.

### Premissas do simulador (conservadoras)

- Se o mesmo candle toca stop e alvo, **conta o stop** (inclusive no candle do fill).
- Gap acima do gatilho preenche na abertura (o R muda); gap abaixo do stop sai na abertura.
- A ordem de rompimento vale `validCandles` (2); se o preço perde o stop antes de romper, é cancelada.
- Taxa 0,1% por lado + slippage 0,05% (entrada e saídas a mercado); alvos são ordens limite.
- Filtro de R: descarta sinais com risco fora de 1%–3% (chute meu — calibrável no painel).
- Tempo máximo: 48 candles (12h em 15m).
- Sinais são detectados só com candles ≤ i (teste automático garante "sem olhar o futuro"); o fractal de topo/fundo só vale um candle depois.

### Limitações conhecidas

- O cache de candles retém **3000 por intervalo** → em 15m são ~31 dias, **um único regime de mercado**.
- O gráfico mostra compra/venda por perna (marcadores), mas **não desenha as linhas de stop/alvo** ainda.
- Varredura do mercado inteiro pela 1ª vez busca ~3 páginas de candles por moeda na Binance; falhas pontuais por moeda são ignoradas (mesmo comportamento do Momentum RSI).

## 4. Primeiro resultado (mercado USDT, ≥ $5M/24h, 15m)

Rodada em 21/09/2026: **109 moedas** (volume 24h ≥ $5M, de 493 pares USDT), 15m, ~3000 candles (21/08 → 21/09), posição de $40, filtro de R 1–3%.

**Com custos** (taxa 0,1%/lado + slippage 0,05%):

| Setup | Sinais | Trades | Acerto | Média/trade | R médio | PF | Chegou no 1º alvo | Chegou no alvo final |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PFR | 5367 | 1162 | 41,3% | **−0,14%** | −0,09 | 0,87 | 39,0% | 39,0% |
| Ponto Contínuo | 6060 | 450 | 34,6% | **−0,24%** | −0,16 | 0,74 | 49,2% | 30,8% |
| Fechou Fora, Fechou Dentro | 8297 | 1906 | 37,8% | **−0,23%** | −0,14 | 0,75 | 48,9% | 26,9% |
| Martelinho | 7400 | 279 | 36,8% | **−0,15%** | −0,14 | 0,82 | 50,5% | 27,8% |
| One Punch | 23 | 3 | — | — | — | — | — | — |

**Sem custos** (taxa 0, slippage 0), mesmo filtro de R:

| Setup | Trades | Média/trade | PF |
|---|---:|---:|---:|
| PFR | 1171 | +0,14% | 1,16 |
| Ponto Contínuo | 450 | +0,01% | 1,01 |
| Fechou Fora, Fechou Dentro | 1908 | +0,05% | 1,07 |
| Martelinho | 279 | +0,13% | 1,21 |

**Custo real, sem filtro de R** (R de qualquer tamanho): piora tudo — PFR passa a −0,29R/trade, Martelinho −0,62R. O filtro de R mínimo de 1% ajuda, mas não basta.

### Leitura (com as ressalvas da seção 3)

- **Nenhum setup sobrevive aos custos** nesta amostra. Antes dos custos o resultado é positivo, mas minúsculo (+0,01% a +0,14% por trade); a taxa + slippage (~0,3% ida e volta) engole tudo.
- **O acerto do PFR ficou em ~40%, não 65–70%.** Sem custos, 40,2% contra 38,2% de equilíbrio (1,618R).
- **Perto de um passeio aleatório.** Num passeio aleatório, com stop de 1R: chegar em 1R antes do stop ≈ 50%; em 1,618R ≈ 38,2%; em 2R ≈ 33,3%. Observado (sem custos): PFR 40,2% (1,618R); Ponto Contínuo 50,6% / 30,8% (1R / 2R); Fechou Fora 50,6% / 28,1%; Martelinho 51,3% / 30,0%. Ou seja, estatisticamente indistinguível de entrada aleatória com o mesmo stop e alvo — para este período. (Comparação aproximada: o tempo máximo e a validade da ordem também mexem nos números.)
- **One Punch** só teve 23 sinais e 3 trades em 109 moedas × 1 mês: amostra sem valor (as janelas de sessão são só 2 por dia, e o filtro de R corta a maioria).
- **Não conclui nada sobre o livro em si:** é um mês de 15m em cripto (um único regime), sem a abertura/gap do mini índice, sem os níveis exatos do Stormer e sem Renko. Serve para dizer que **as regras literais, no 15m de cripto e com custo de corretora, não mostram vantagem** — não que elas não funcionem no mercado do autor.
- Uma mesma varredura com 36 moedas de volume ≥ $30M deu PFR **+0,13%/trade** (PF 1,14, 357 trades): o sinal do resultado muda com a amostra. Não use nenhum número isolado para decidir.

## 5. Próximos passos

1. **Calibrar e validar** na aba Setups: comparar setups, ligar/desligar o filtro de R, testar 30m/1h e outras janelas de tempo. Só o que mostrar média/trade positiva **depois dos custos**, com amostra grande, avança.
2. **Bot** (só dos setups que sobreviverem): pasta `backend/bot/candle-setups/` já tem detectores/simulador/schema; falta `candle-setups-bot.js` (modelo: `swing-bot.js`/`ma-cross-bot.js`, com `buildAdapter.js`, `tradeExecution.js` e o registro Multi-Trade). Pontos novos: entrada por rompimento com validade de N candles; **duas pernas de saída** (2 OCOs de 50%, mesmo stop, sem re-armar); **tamanho por risco fixo** (`riskUsd / distância do stop`, com teto de nocional); modo só-sinal antes de operar de verdade; níveis do sinal gravados na ocorrência para o gráfico.
3. **Gráfico = trade:** desenhar linhas de gatilho/stop/alvos no gráfico ao abrir uma ocorrência.

Configuração base (defaults reais, em `tradeConfigSchema.js`):

```json
{
  "interval": "15m",
  "candleCount": 3000,
  "positionSizeUsd": 40,
  "setups": ["pfr", "pontoContinuo", "fechouForaDentro"],
  "common": {
    "entryOffsetPct": 0.02, "stopOffsetPct": 0.02,
    "validCandles": 2, "cancelOnStopBreak": true,
    "minRiskPct": 1.0, "maxRiskPct": 3.0,
    "maxHoldCandles": 48, "cooldownCandles": 0
  },
  "costs": { "feePct": 0.1, "slippagePct": 0.05 }
}
```

`validCandles`, `minRiskPct`, `maxRiskPct`, `maxHoldCandles` e os custos são valores meus — o livro não os define.
