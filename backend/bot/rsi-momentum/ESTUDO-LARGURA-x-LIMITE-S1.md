# Estudo — Larg% (largura de banda) × limite de entrada acima do S1 (RSI Momentum)

**Data:** 20/09/2026 (BRT) · **Status:** diagnóstico — nenhum código do bot/backtest foi alterado.

**Hipótese investigada:** moedas de Larg% alto raramente entram no trade porque o filtro de S/R exige preço de entrada
no máximo `entry.supportResistance.entryMaxPct` (padrão **10%**) acima do S1, e essas moedas, quando o RSI(15m) cruza 69,
já estariam a mais de 10% acima do S1.

---

## 1. Resumo

1. **A hipótese não se confirma como regra geral.** Nas 22 moedas largas (Larg% ≥ 3), a distância mediana ao S1 no
   sinal é **4,4%** e **79%** dos sinais ficam a ≤ 10% do S1. Só 21% passam de 10%. Em todas as 150 moedas: mediana 4,1%, 84% ≤ 10%.
2. **Larg% quase não explica a distância ao S1** (Spearman 0,20). O que explica é volatilidade e alta recente: ATR 15m
   (0,71), alta nas últimas 6h (0,69), ATR 4h (0,65), alta em 24h (0,64).
3. **O que bloqueia entradas ao vivo é o oposto da hipótese:** dos 759 near-misses registrados pelo bot, **60% são
   `BANDWIDTH_TOO_LOW`** (Larg% baixa demais), 30% repique de RSI e **só 2,5% (19) são `SR_NO_DISCOUNT`**.
4. **Por que parece que "moeda larga não entra por causa do S1":** o S/R é o **último** filtro da cadeia; moedas estreitas
   morrem antes (Larg%). Quem chega ao S/R é, por construção, majoritariamente larga — 7 das 11 moedas com `SR_NO_DISCOUNT`
   ao vivo têm Larg% ≥ 3. É efeito de seleção, não de largura causando distância.
5. **Onde o teto de 10% de fato pesa:** um punhado de moedas com S1 "velho/distante" (ONE, SYN, EPIC, ZAMA e, entre as
   estreitas, ACE, ONG, TUTU, HEMI, COTI, HOME) — ver seção 5.5.
6. **Se quiser afrouxar mesmo assim:** o caminho de melhor custo/benefício é um **teto que escala com a Larg%, com piso de
   10%** — `max(10, 3 × Larg%)`. Nas estreitas fica idêntico ao atual (verificado); nas largas dá +15 trades (93 → 108) sem
   piorar o resultado por trade. Alternativa mais simples: subir o teto para 15%. **Cuidado:** entrada longe do S1 põe o S2
   (stop por S/R) longe também — cauda de perda de −22% a −26% nos testes (ver seção 6).
7. **Nenhuma diferença entre as regras é estatisticamente firme** (amostra: 21 moedas largas, uma janela de 60 dias).
   Antes de mudar configuração: repetir em outra janela e com o motor real (rearm) — seção 7.

---

## 2. Onde ficam os JSONs de Estatísticas (resposta à dúvida)

| O quê | Onde | Observação |
|---|---|---|
| Botão **"⬇ Baixar JSON"** | Pasta de downloads **do navegador** (`rsi-momentum-stats_<moeda\|todas-moedas>_<intervalo>_<AAAA-MM-DD-HH-MM>.json`), gerado em `StatisticsPanel.jsx#handleDownloadJson` | O código não escolhe a pasta. Nenhum arquivo com esse nome foi achado no perfil do usuário (busca até 6 níveis) — o botão provavelmente nunca foi usado nesta máquina. |
| **"📁 N pesquisas salvas"** (o que aparece no frontend) | `backend/data/rsi-momentum-stats-searches.json` (gravado a cada "Buscar" por `backend/services/rsiMomentumStatsSearchLog.js`; máx. 500, FIFO; **fora do git** — `backend/data/**` no `.gitignore`) | Guarda **só o resumo** (config + agregados). **Não** guarda lista de moedas nem de ocorrências. |
| Near-misses ao vivo | Tabela Supabase `rsi_momentum_near_misses`, lida por `GET /services/rsi-momentum-near-misses` | Não guarda a distância ao S1 (só `blockers: ["sr"]`). |

Como o log salvo não tem as moedas, o estudo abaixo **recalculou por moeda** com o mesmo motor do backtest.

---

## 3. As 5 pesquisas salvas (20/09, BRT)

Todas em 15m, RSI ≥ 69, alvo por R3 / stop por S2, reforço `rearm`, S/R em 4h × 200 candles, volume ≥ 2M.

| # | Hora | Escopo | Larg mín | Teto S1 | Sinais aceitos | Bloqueados por S/R | Moedas varridas | Bloq. por Larg% | P&L (backtest) |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 10:06 | CAKEUSDT | 2% | 10% | **0** | 0 | — | — | — |
| 2 | 10:09 | Mercado | 2% | 10% | 199 | 287 | 150 | 99 | +US$ 955,84 (9,65%/trade) |
| 3 | 10:10 | Mercado | 2% | **15%** | 213 | 185 | 150 | 99 | +US$ 1.063,37 (10,34%/trade) |
| 4 | 10:12 | Mercado | 2% | 10% | 199 | 285 | 151 | 100 | +US$ 955,84 (9,65%/trade) |
| 5 | 10:15 | Mercado | **3%** | 10% | 109 | 169 | 151 | **124** | +US$ 492,48 (9,33%/trade) |

Leituras: (a) CAKEUSDT deu 0 sinais porque a Larg% dela hoje é ~1,66% — barrada por largura **baixa** (mín 2%), não por S1;
(b) subir o teto 10% → 15% (#2 → #3) rende +14 trades aceitos (+7%) e +US$ 107 — efeito pequeno;
(c) exigir Larg% ≥ 3% (#4 → #5) elimina quase metade dos trades (199 → 109): o filtro de largura pesa muito mais que o teto S1;
(d) "aceitos" são pós-exclusividade (1 trade por moeda) e "bloqueados" são sinais brutos — não são grandezas comparáveis entre si.
Todas as pesquisas de mercado mostram 100% de acerto e 0 stops: com `rearm`, a perda do stop vira uma perna do ciclo e o trade só fecha no alvo, e posições ainda abertas ficam de fora com `excludeOpenExits` — vale ler esses números com cautela.

---

## 4. Método e limitações

**Universo:** 150 pares Binance USDT com volume 24h ≥ 2M (mesmo corte das pesquisas), 60 dias de candles 15m
(≈ 21/07 → 20/09/2026, execução ~19:00–19:30 BRT). Config = a da pesquisa #5, com: Larg% mínima liberada (0,1%, só para medir),
teto S1 = 100% (para enxergar todos os sinais), `excludeOpenExits` desligado.

**Sinais brutos:** o motor do backtest foi carregado **em memória** com a exclusividade por moeda desligada (o motor descarta
sinal enquanto a moeda está em trade — com `rearm`, por dias, o que esconderia sinais). Resultado: **3.420 sinais** em
136 moedas. O repositório não foi alterado.

**Dois modelos de saída** (sem reforço/rearm), cada trade simulado nos candles 15m, empate no mesmo candle = stop primeiro:
- **Fixo:** alvo +15% / stop −10%. Cobre **todos** os sinais.
- **S/R:** alvo = min(R3, +20%), stop = S2, níveis travados no sinal. Só existe para os sinais que têm S2 **e** R3 (**44%**, 1.517 de 3.419).

Exclusividade por moeda reaplicada offline (1 trade aberto por moeda).

**Limitações — leia antes de decidir algo:**
- Uma janela (60 dias, um regime de mercado), 21 moedas largas com sinal; regras avaliadas **na mesma amostra** (sem out-of-sample).
- Sem reforço/rearm, taxas e slippage. Contagens absolutas de trades **não** são comparáveis com as pesquisas salvas (por isso
  a seção 3 não é usada como "validação numérica"); vale a comparação **relativa** entre regras.
- Larg% é um **retrato de agora** (lookback 300 candles de 5m ≈ 25h) aplicado a toda a janela — como o próprio backtest faz. Muda ao
  longo do dia: às 10:15 havia 27 moedas ≥ 3%, às ~19:00 são 22.
- Entrada = preço de fechamento do candle do sinal; o bot ao vivo pode disparar no candle em formação (earlyConfirm).
- BANKUSDT: o cache de candles descartou 602/806 candles por "spike de preço" — só 1 sinal; tratar como dado não confiável.

---

## 5. Resultados

### 5.1 Distância ao S1 × largura de banda (sinais brutos, 3.419 com S1)

| Larg% (5m) | Moedas | Com sinal | Sinais | Mediana dist. S1 | ≤ 10% | ≤ 15% | ≤ 20% | > 20% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| < 1 | 29 | 18 | 417 | 2,2% | 91% | 96% | 99% | 1% |
| 1–2 | 62 | 61 | 1.652 | 4,2% | 86% | 93% | 96% | 4% |
| 2–3 | 37 | 36 | 845 | 4,8% | 78% | 87% | 91% | 9% |
| 3–5 | 13 | 12 | 318 | 4,8% | 78% | 89% | 93% | 7% |
| ≥ 5 | 9 | 9 | 187 | 3,9% | 82% | 87% | 89% | 11% |
| **Todas** | **150** | **136** | **3.419** | **4,1%** | **84%** | **—** | **—** | **—** |

A distância cresce um pouco de "muito estreita" para "média", mas **não continua crescendo** nas mais largas (≥ 5% tem
mediana menor que 3–5%).

### 5.2 O que realmente explica a distância ao S1 (Spearman, por sinal, n = 3.419)

| Variável | ρ |
|---|---:|
| ATR 15m (%) | **0,71** |
| Alta nas últimas 6h (%) | **0,69** |
| ATR 4h (%) | **0,65** |
| Alta nas últimas 24h (%) | **0,64** |
| Distância até a 1ª resistência | 0,33 |
| **Larg% (5m, média 300 candles)** | **0,20** |
| Toques no S1 | −0,20 |

Leitura: o sinal RSI>69 já acontece **depois** de uma alta; quanto mais a moeda subiu/oscila, mais longe do S1 ela está — e
isso independe de a Larg% média ser alta. Além disso, o S1 vem de S/R em 4h × 200 candles (~33 dias): moeda que "rompeu" tudo
tem S1 antigo e distante.

### 5.3 Quanto o teto de 10% custa nas moedas largas (≥ 3%)

- 22 moedas largas → 21 com sinal → **505 sinais brutos**; **401 (79%) ≤ 10%**, 104 (21%) acima.
- **20 das 21** moedas largas têm pelo menos 1 sinal ≤ 10% do S1 (só BANKUSDT ficou sem, e é dado não confiável).
- Efeito em nº de trades (1 por moeda), conforme o modelo de saída: **modelo S/R: 111 → 115** (−3%) ·
  **modelo fixo: 93 → 146** (−36%). Com o motor real (rearm segura a moeda por dias) o efeito real fica entre esses extremos —
  **não medido**.

### 5.4 Qualidade do sinal por faixa de distância (modelo fixo +15%/−10%, expectativa por trade fechado, em %)

| Dist. ao S1 | Todas: n | alvo/stop | expectativa | Largas: n | alvo/stop | expectativa |
|---|---:|---|---:|---:|---|---:|
| 0–3% | 1.201 | 64%/22% | +8,48 | 158 | 73%/26% | +8,47 |
| 3–6% | 1.079 | 54%/36% | +4,97 | 171 | 56%/43% | +4,12 |
| 6–10% | 581 | 47%/44% | +2,88 | 72 | 43%/56% | +0,92 |
| 10–15% | 260 | 47%/47% | +2,40 | 44 | 48%/48% | +2,50 |
| 15–20% | 108 | 47%/45% | +2,75 | 16 | 31%/63% | −1,67 |
| > 20% | 190 | 39%/56% | +0,30 | 44 | 39%/45% | +1,49 |

Sinais mais perto do S1 são de fato melhores — o filtro tem base. Mas a faixa 10–20% ainda é positiva no agregado; só > 20%
é claramente ruim.

No modelo S/R, quanto mais longe do S1, mais longe o **S2 (stop)**: distância mediana até o S2 = 3,2% (0–3%), 5,5% (3–6%), 9,1%
(6–10%), **12,9% (10–15%)**, 23,5% (15–20%), 25,4% (> 20%). É o risco de cauda de afrouxar o teto (seção 6).

### 5.5 Moedas onde o teto de 10% de fato pesa

**Largas (≥ 3%) com muitos sinais > 10% do S1:**

| Moeda | Larg% | Sinais | Mediana dist. | > 10% |
|---|---:|---:|---:|---:|
| ONEUSDT | 12,71 | 6 | 19,0% | 3 (50%) |
| SYNUSDT | 5,81 | 12 | 12,7% | 8 (67%) |
| EPICUSDT | 4,24 | 23 | 11,5% | 13 (57%) |
| ZAMAUSDT | 6,47 | 24 | 8,5% | 11 (46%) |
| ENAUSDT | 3,65 | 29 | 6,5% | 10 (34%) |
| ARUSDT | 3,36 | 35 | 5,2% | 10 (29%) |

As outras 16 largas ficam, em geral, com ≤ 20% dos sinais acima de 10% (ex.: SKLUSDT 0%, JTOUSDT 0%, ZILUSDT 3%, GUSDT 8%, CUSDT 8%); exceção: AVAUSDT (27%).

**Estreitas (< 3%) onde o teto pesa** (≥ 50% dos sinais > 10%, ≥ 4 sinais): ACEUSDT (85%, mediana 21,0%), ONGUSDT (70%, 23,1%),
TUTUSDT (62%, 18,0%), HEMIUSDT (60%, 13,2%), HOMEUSDT (53%, 11,7%), COTIUSDT (51%, 10,5%). Ou seja, **o problema de "S1 distante" não é
exclusivo de moeda larga** — e as estreitas nem chegam ao S/R se falharem em Larg%.

Os sinais > 10% concentram-se em 110 moedas (558 sinais); as 10 maiores respondem por 27% (TUT, COTI, ACE, HEMI, ONG, PUMP, ZEC, EPIC, MINA, CHIP).

### 5.6 O que barra de fato ao vivo (near-misses do bot)

`GET /services/rsi-momentum-near-misses?period=tudo` (20/09 ~19:30 BRT; a linha mais recente por moeda mais antiga é de 13/09 22:04 BRT).
Cada linha = **primeiro filtro que barrou** um sinal em que o RSI já tinha cruzado; dedupe de 30 min por moeda × motivo.

| Motivo | Linhas | % |
|---|---:|---:|
| `BANDWIDTH_TOO_LOW` (Larg% baixa) | 457 | 60,2% |
| `RSI_VOLATILE_NEAR_THRESHOLD` (repique) | 225 | 29,6% |
| `RSI5M_TOO_LOW` | 34 | 4,5% |
| **`SR_NO_DISCOUNT`** (S1 > teto) | **19** | **2,5%** |
| `MACD_HISTOGRAM_NEGATIVE` | 17 | 2,2% |
| `HIGHER_RSI_TOO_LOW` | 7 | 0,9% |

Ordem real dos filtros (`strategyEngine.js#evaluateEntrySignal`): cruzamento → repique → spike → **Larg%** → RSI 5m → MACD →
RSI 1h → EMA → **S/R (último)**.

**Moedas com `SR_NO_DISCOUNT` ao vivo** (12 símbolos; horas em BRT; Larg% de hoje):

| Moeda | Último registro | RSI | Ocorr. | Larg% hoje |
|---|---|---:|---:|---:|
| GENIUSUSDT | 20/09 16:05 | 70,7 | 2 | 4,19 |
| SAGAUSDT | 20/09 14:24 | 69,4 | 4 | 4,48 |
| INJUSDT | 20/09 13:25 | 74,9 | 1 | 2,86 |
| GUSDT | 20/09 02:23 | 72,7 | 2 | 8,04 |
| STXUSDT | 19/09 22:57 | 73,7 | 1 | 2,27 |
| ALLOUSDT | 19/09 22:02 | 69,5 | 1 | 2,61 |
| ZILUSDT | 19/09 21:33 | 70,2 | 1 | 5,21 |
| STRKUSDT | 19/09 21:33 | 71,2 | 1 | 4,30 |
| EPICUSDT | 19/09 15:24 | 71,6 | 2 | 4,24 |
| FILUSDT | 19/09 14:01 | 80,1 | 1 | 1,72 |
| ONEUSDT | 17/09 19:40 | 73,3 | 2 | 12,71 |
| HIVEUSDT | 14/09 04:01 | 70,2 | 1 | n/d |

7 das 11 com Larg% conhecida são largas (≥ 3) — é o **efeito de seleção** descrito no resumo (o S/R só vê quem passou em Larg%).
Limite: o registro **não guarda a distância ao S1** — não dá para confirmar ao vivo o "mais de 10%" (ver próximos passos).

---

## 6. Caminhos alternativos para limitar a entrada

Resultado nas **moedas largas** nos dois modelos (trades / pnl médio por trade em % / pior trade no modelo S/R). Em todas as
regras `Larg%` = Larg% média da moeda; `ATR4h%` = ATR(14) de 4h em % do preço no sinal.

| Regra | Trades fixo | pnl/trade fixo | Trades S/R | pnl/trade S/R | Pior (S/R) | Veredito |
|---|---:|---:|---:|---:|---:|---|
| **R0 atual:** dist. S1 ≤ 10% | 93 | 6,08 ±1,24 | 111 | 1,89 ±0,66 | −14,2 | referência |
| R1: dist. S1 ≤ 15% | 110 | 6,05 ±1,13 | 114 | 2,16 ±0,69 | −22,2 | mais trades, mesma qualidade; **cauda pior** |
| R2: sem teto | 146 | 4,84 ±1,00 | 115 | 2,29 ±0,72 | −26,1 | mais trades, qualidade cai no modelo fixo |
| **A2: dist. S1 ≤ max(10, 3 × Larg%)** | **108** | **6,47 ±1,14** | 114 | 2,12 ±0,71 | −26,1 | **melhor no modelo fixo; só mexe nas largas** |
| A3: idem, com máx. 20% | 106 | 6,31 ±1,15 | 114 | 2,12 ±0,71 | −26,1 | ≈ A2 |
| A1: max(10, 2 × Larg%) | 98 | 6,03 ±1,21 | 109 | 1,93 ±0,69 | −22,2 | quase igual ao atual |
| A5: max(10, 2 × ATR4h%) | 96 | 6,18 ±1,22 | 110 | 2,10 ±0,70 | −22,2 | sem ganho sobre A2; mais complexa |
| A4: A2 **e** alta 6h ≤ 10% | 92 | 6,53 ±1,24 | 113 | 2,00 ±0,68 | −13,2 | corta a cauda; volta ao nº de trades do atual |
| Teto de risco: dist. até o S2 (stop) ≤ 10% | — | — | 105 | 2,23 ±0,63 | **−8,7** | melhor pior-caso; nas estreitas piora um pouco |
| Portão de R:R (upside R3 / stop S2 ≥ 1) | — | — | 75 | 3,20 ±0,99 | −26,1 | filtro de **qualidade** (−32% trades), não de volume |
| Posição no canal S1→R1 ≤ 0,7 | 75 | 6,82 ±1,33 | 65 | 3,47 ±0,94 | −13,2 | idem: qualidade, menos trades |
| Alta 6h ≤ 6% | 81 | 6,90 ±1,30 | — | — | — | idem |
| S/R em 2h ou 1h (em vez de 4h) | — | — | 103 / 71 | 2,11 / 1,98 | −20,1 / −11,2 | aproxima o S1 (mediana 4,4 → 3,9 → 3,3%) mas **não gera mais trades** — descartar |

Efeito nas **estreitas** (< 3%): A1/A2/A3 = **idênticos ao atual** (trades e pnl iguais nos dois modelos — o piso de 10% garante).
R1 (15%) afrouxa as estreitas também (+46 trades no modelo fixo, pnl/trade igual).
Todas as moedas, modelo fixo: R0 654 trades / 4,85 · R1 717 / 4,83 · A2 669 / 4,94.

**Leitura:**
- Nenhuma regra é estatisticamente distinguível do atual (erro-padrão ±0,65–1,3 pp; diferenças de 0,1–0,5 pp).
- **Regras "que deixam entrar mais"** (R1, A1–A3): ganham volume sem perder qualidade média, mas **aumentam a cauda** quando o stop é
  o S2 (pior trade −14% → −22%/−26%).
- **Regras "que melhoram a qualidade"** (R:R, canal, alta 6h, teto de risco): melhoram o pnl/trade em 0,3–1,6 pp, mas **cortam** trades — resolvem
  outro problema (não é "entrar mais").
- O modo `'adapt'` que já existe em `entryMaxPct` clampa em **2–8%** (`SR_ADAPTIVE_ENTRY_*`) — **aperta** o teto em vez de
  afrouxar; não serve para este caso.

---

## 7. Recomendação e próximos passos (nada disso foi implementado)

1. **Não atribuir a baixa entrada de moedas largas ao teto S1** — os dados (backtest e near-misses ao vivo) apontam para
   Larg% mínima e repique como os grandes bloqueios. Se a meta é mais entradas, a alavanca é `bandWidth.minPct`/`lookback`
   (3% → 2% recuperou ~90 trades nas pesquisas salvas) e o filtro de repique, não o S1.
2. **Se ainda quiser afrouxar o S1:** `max(10, 3 × Larg%)` (ou, mais simples, 15%). **Junto com** proteção de cauda quando o stop é por S2:
   cair no stop fixo (fallback) se o S2 estiver a mais de ~10–12% do preço — a avaliar.
3. **Validar ao vivo antes de mexer:** gravar em `rsi_momentum_near_misses` o detalhe do S/R (`distPct`, `supportPrice`, Larg%) — hoje só vai
   `blockers: ["sr"]`. Poucas semanas de dado respondem a pergunta original ("normalmente > 10%?") sem depender de backtest.
4. **Repetir o estudo** em outra janela (out-of-sample) e com o motor real de `rearm` (contagem de trades e cauda mudam).
5. **Se aprovado, implementar** um modo novo em `supportResistance.entryMaxPct` (ex.: `'width'` + multiplicador e piso) com **paridade**
   backtest ↔ bot ↔ schema ↔ painel (`analyseRsiThresholdBacktest.js`, `analyseRsiThresholdBacktestMarket.js`, `strategyEngine.js#checkSupportResistanceEntry`,
   `tradeConfigSchema.js`, painel de Estatísticas). O bot já calcula a Larg% no mesmo ciclo (`checkBandWidthFilter`), então o dado está disponível.
   Ao mudar default/config, perguntar se as linhas existentes no Supabase devem ser atualizadas.

---

## 8. Adendo — teto proporcional ao canal S1→R3 (proposta do usuário, 20/09)

**Ideia:** em vez de um % fixo sobre o S1, limitar a entrada a uma fração `f` do canal entrada→saída:
`preço ≤ S1 + f × (R3 − S1)`. Ex.: S1 = 10, R3 = 20, `f` = 5% → entrada até 10,50. O limite varia por moeda porque o canal varia.
Só análise — nada implementado. Mesmos 3.420 sinais e mesmos dois modelos de saída da seção 4.

**Conclusão em 4 linhas:** a ideia é conceitualmente boa (normaliza pelo "espaço para correr", parecida com um R:R), mas
(1) o R3 **não existe** em 84–94% dos sinais que estão a mais de 10% do S1 — justamente onde a regra deveria decidir;
(2) a posição no canal **não cresce com a Larg%**, então não dá "mais folga para moeda larga";
(3) com `f` na faixa que faz sentido (0,25–0,5) ela é **mais rígida** que o teto de 10% — funciona como filtro de qualidade, não de volume;
(4) nenhuma variante bateu `max(10, 3 × Larg%)` (108 trades, 6,47/trade) nem o teto simples de 15% (110 trades, 6,05/trade) como forma de "deixar entrar mais".

### 8.1 Cobertura — o R3 (e o R1) existem quando precisa?

O R3 é a 3ª resistência **acima do preço do sinal** (`exitResistanceRank = 3`). Se a moeda rompeu o topo da janela (S/R em 4h × 200 candles, ~33 dias),
não sobram 3 resistências acima e o canal fica indefinido.

| Dist. ao S1 | Sinais | Sem R1 | **Sem R3** |
|---|---:|---:|---:|
| 0–3% | 1.201 | 9% | 36% |
| 3–6% | 1.079 | 15% | 52% |
| 6–10% | 581 | 33% | 71% |
| 10–15% | 260 | 52% | **84%** |
| 15–20% | 108 | 62% | **94%** |
| > 20% | 190 | 67% | **93%** |

Dos 558 sinais > 10% do S1, só **61 têm R3** (11%) e 229 têm R1 (41%). Nas moedas largas: 104 sinais > 10%, **15 com R3**. Quando falta R3 o bot sai por % fixo do
preço (`targetPct`/`hardTakeProfit`) e, nesse caso, a posição no canal vira função só da distância ao S1 — ou seja, **a regra proporcional degenera em um teto fixo disfarçado**.
A política de fallback (bloquear / liberar / cair no teto de 10%) decide o resultado mais que a proporção.

### 8.2 A posição no canal não depende da Larg%

Posição = (preço − S1) / (R3 − S1), só sinais com R3 (n = 1.517):

| Larg% (5m) | Canal S1→R3 (mediana) | Dist. ao S1 (mediana) | Posição no canal (mediana; p25–p75) | Teto implícito f = 0,25 / f = 0,5 |
|---|---:|---:|---|---:|
| < 1 | 5,5% | 1,9% | 0,33 (0,22–0,44) | 1,4% / 2,8% |
| 1–2 | 8,9% | 2,8% | 0,33 (0,23–0,43) | 2,2% / 4,4% |
| 2–3 | 11,3% | 3,5% | 0,33 (0,23–0,46) | 2,8% / 5,7% |
| 3–5 | 9,6% | 3,0% | 0,34 (0,21–0,47) | 2,4% / 4,8% |
| ≥ 5 | 10,6% | 3,3% | 0,35 (0,24–0,43) | 2,7% / 5,3% |

Spearman posição × Larg% = **0,04**; largura do canal × Larg% = 0,28. Ou seja, moeda larga **não tem canal proporcionalmente maior** nem fica mais fundo nele.
Com o canal típico de ~10%, `f` = 0,5 vale ~5% acima do S1 — metade do teto atual; para equivaler a 10% seria preciso `f` ≈ 0,9–1,0 (na prática, sem limite).
O exemplo "5% do canal" (S1 = 10, R3 = 20) dá 10,50 — coerente lá porque o canal do exemplo é de 100%; nos dados reais o canal mediano é ~10%, então `f` = 5%
liberaria ~0,5% acima do S1 (só 4,5% dos sinais têm posição ≤ 0,10).

### 8.3 A posição no canal separa sinais bons de ruins?

| Posição | n | Dist. S1 (med.) | Fixo: alvo/stop · pnl | S/R: alvo/stop · pnl |
|---|---:|---:|---|---|
| 0–0,15 | 163 | 1,6% | 65%/26% · +7,31 | 39%/57% · +2,35 |
| 0,15–0,25 | 309 | 2,1% | 67%/25% · +7,80 | 55%/43% · +3,16 |
| 0,25–0,35 | 354 | 2,7% | 67%/25% · +8,01 | 60%/37% · +1,57 |
| 0,35–0,50 | 448 | 3,4% | 62%/28% · +7,06 | 67%/32% · +1,76 |
| 0,50–0,75 | 234 | 4,8% | 55%/38% · +4,66 | 76%/23% · +0,98 |
| > 0,75 | 9 | 13,1% | (amostra pequena) | (amostra pequena) |

No modelo fixo há degrau claro a partir de 0,5 (de ~+7–8 para +4,7). No modelo S/R a relação não é monótona (o S2 fica colado no S1 quando a entrada está perto dele,
gerando muitos stops curtos). Sinal fraco e dependente do modelo de saída.

### 8.4 Simulação das regras (só sinais com R3 — 255 largas, 1.517 no total; modelo fixo)

| Regra | Largas: trades · pnl/trade · soma | Todas: trades · pnl/trade · soma |
|---|---|---|
| **R0 atual: dist. S1 ≤ 10%** | 70 · 7,08 · 496 | 437 · 6,34 · 2.772 |
| Canal ≤ 0,25 | 36 · 8,06 · 290 | 234 · 6,95 · 1.627 |
| Canal ≤ 0,35 | 54 · 7,43 · 401 | 334 · 7,07 · 2.361 |
| Canal ≤ 0,50 | 70 · 6,01 · 421 | 424 · 6,31 · 2.675 |
| Canal ≤ 0,65 | 74 · 6,49 · 481 | 452 · 6,19 · 2.797 |
| União: (dist. S1 ≤ 10%) **OU** (canal ≤ 0,5) | 76 · 6,72 · 511 | 456 · 6,21 · 2.832 |

Erro-padrão ≈ ±1,4 (largas) e ±0,55 (todas). Leitura: `f` = 0,5 dá o **mesmo nº de trades** que o teto atual (70 = 70) com conjunto diferente e resultado igual/levemente pior;
`f` ≤ 0,35 é filtro de qualidade (menos trades). A **união** — que só *acrescenta* entradas longe do S1 com muito espaço — soma 1 a 6 trades: só 15 sinais das largas > 10% têm R3.
No modelo S/R o padrão é o mesmo (largas: 111 trades / 1,89 no atual; canal ≤ 0,5: 97 / 2,38; união ≤ 0,5: 112 / 2,34; pior trade continua −26% sem teto).

### 8.5 Universo completo com política de fallback (modelo fixo, todos os sinais)

| Regra | Largas (505 sinais) | Todas (3.419 sinais) |
|---|---|---|
| **R0 atual** | 93 · 6,08 · 566 | 654 · 4,85 · 3.169 |
| Canal S1→R3 ≤ 0,5, **sem R3 → teto 10%** | 94 · 5,38 · 506 | 653 · 4,68 · 3.057 |
| Canal S1→R3 ≤ 0,5, **sem R3 → libera** | 140 · 4,58 · 641 | 827 · 4,01 · 3.320 |
| Canal S1→**R1** ≤ 0,7, sem R1 → bloqueia | 75 · 6,82 · 511 | 490 · 5,89 · 2.885 |
| Canal S1→**R1** ≤ 0,7, sem R1 → teto 10% | 83 · 6,63 · 550 | 586 · 5,23 · 3.067 |
| Canal S1→**R1** ≤ 0,7, sem R1 → libera | 117 · 5,64 · 660 | 702 · 4,69 · 3.296 |
| *(ref.) teto que escala: max(10, 3 × Larg%)* | *108 · 6,47 · 699* | *669 · 4,94 · 3.302* |
| *(ref.) teto simples de 15%* | *110 · 6,05 · 666* | *717 · 4,83 · 3.461* |

(formato: trades · pnl médio por trade em % · soma de pnl em %.) Trocar R3 por R1 melhora a cobertura (R1 existe em 41% dos sinais > 10% do S1, 48% na faixa 10–15%) mas não resolve:
"sem nível → libera" traz mais trades **e** piora a qualidade média; "sem nível → teto 10%" quase não muda o número de entradas; "bloqueia" é filtro de qualidade.

### 8.6 Veredito

- **Como "limite para entrar mais em moeda larga":** não recomendo. Cobertura ruim justo na região que interessa, nenhuma relação com a Larg%, e fica atrás de `max(10, 3 × Larg%)` e do 15% simples.
- **Como filtro de qualidade:** tem mérito. O canal S1→**R1** ≤ 0,7 com fallback no teto de 10% melhora o resultado por trade (largas 6,08 → 6,63; todas 4,85 → 5,23) cortando ~10% dos trades — mesma família dos filtros R:R/canal da seção 6. Ainda assim dentro do ruído.
- **Se quiser explorar a ideia:** (a) medir em outra janela; (b) escolher o nível-alvo pelo que existir (R1 → R2 → R3) em vez de fixar o R3; (c) gravar `S1`, `R1/R3` e a posição no canal nos near-misses do bot para checar ao vivo.
- **Um teste que falta:** o mesmo estudo usando um "R3 virtual" (preço × (1 + `targetPct`)) quando não houver resistência — mas, como visto em 8.1, isso reduz a regra a um teto fixo em % sobre o S1.

---

## Apêndice A — As 150 moedas do estudo

Ordenadas por Larg% (5m) decrescente. "Sinais brutos" = sinais que passaram em todos os filtros menos o teto S1 (sem exclusividade).
"Trades" = modelo fixo (+15%/−10%) com 1 trade por moeda, para cada teto de S1.
**(larga)** = Larg% ≥ 3. **14 moedas sem sinal:** MARSCOINUSDT (larga, 0 sinais), 牛来USDT (listagem recente — S/R sem histórico, `SR_NO_DATA`),
e 12 estáveis/ativos tokenizados que não cruzam RSI 69 (BNCB, QQQB, XAUT, EUR, PAXG, RLUSD, FDUSD, U, BFUSD, USD1, XUSD, USDC).

| # | Moeda | Larg% (5m) | Vol 24h (M USDT) | Sinais brutos | Mediana dist. S1 | Sinais >10% do S1 | Trades teto 10% | Trades teto 15% | Trades sem teto |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | CELRUSDT **(larga)** | 12.85 | 33.0 | 32 | 3.9% | 4 (13%) | 4 | 4 | 5 |
| 2 | ONEUSDT **(larga)** | 12.71 | 66.4 | 6 | 19.0% | 3 (50%) | 2 | 2 | 5 |
| 3 | SKLUSDT **(larga)** | 8.40 | 10.3 | 17 | 2.9% | 0 (0%) | 4 | 4 | 4 |
| 4 | GUSDT **(larga)** | 8.04 | 63.6 | 25 | 3.2% | 2 (8%) | 5 | 5 | 7 |
| 5 | CUSDT **(larga)** | 6.81 | 11.6 | 25 | 3.4% | 2 (8%) | 4 | 4 | 6 |
| 6 | ZAMAUSDT **(larga)** | 6.47 | 31.9 | 24 | 8.5% | 11 (46%) | 6 | 7 | 11 |
| 7 | SYNUSDT **(larga)** | 5.81 | 8.4 | 12 | 12.7% | 8 (67%) | 1 | 4 | 7 |
| 8 | CTSIUSDT **(larga)** | 5.59 | 6.3 | 14 | 3.4% | 2 (14%) | 3 | 4 | 5 |
| 9 | ZILUSDT **(larga)** | 5.21 | 13.1 | 32 | 3.1% | 1 (3%) | 6 | 6 | 7 |
| 10 | AVAUSDT **(larga)** | 4.66 | 5.5 | 22 | 6.5% | 6 (27%) | 5 | 6 | 8 |
| 11 | SAGAUSDT **(larga)** | 4.48 | 29.2 | 31 | 4.5% | 6 (19%) | 6 | 9 | 10 |
| 12 | STRKUSDT **(larga)** | 4.30 | 20.7 | 34 | 3.3% | 4 (12%) | 6 | 7 | 8 |
| 13 | BANKUSDT **(larga)** | 4.26 | 33.2 | 1 | 10.1% | 1 (100%) | 0 | 1 | 1 |
| 14 | EPICUSDT **(larga)** | 4.24 | 8.6 | 23 | 11.5% | 13 (57%) | 7 | 10 | 13 |
| 15 | GENIUSUSDT **(larga)** | 4.19 | 6.5 | 23 | 3.0% | 3 (13%) | 4 | 4 | 6 |
| 16 | SUSDT **(larga)** | 3.87 | 8.4 | 26 | 5.0% | 5 (19%) | 6 | 5 | 6 |
| 17 | LSKUSDT **(larga)** | 3.80 | 12.2 | 42 | 4.7% | 8 (19%) | 5 | 5 | 10 |
| 18 | ENAUSDT **(larga)** | 3.65 | 105.4 | 29 | 6.5% | 10 (34%) | 6 | 8 | 10 |
| 19 | ARUSDT **(larga)** | 3.36 | 16.4 | 35 | 5.2% | 10 (29%) | 5 | 6 | 7 |
| 20 | JTOUSDT **(larga)** | 3.23 | 4.8 | 17 | 4.1% | 0 (0%) | 6 | 6 | 6 |
| 21 | MARSCOINUSDT **(larga)** | 3.05 | 16.0 | 0 | — | — | 0 | 0 | 0 |
| 22 | AVAXUSDT **(larga)** | 3.03 | 154.1 | 35 | 2.9% | 5 (14%) | 2 | 3 | 4 |
| 23 | GUNUSDT | 2.98 | 6.6 | 14 | 5.9% | 1 (7%) | 5 | 6 | 6 |
| 24 | XTZUSDT | 2.87 | 4.0 | 30 | 4.1% | 1 (3%) | 5 | 5 | 6 |
| 25 | INJUSDT | 2.86 | 24.9 | 16 | 4.1% | 1 (6%) | 7 | 7 | 8 |
| 26 | HEIUSDT | 2.85 | 3.2 | 20 | 9.4% | 7 (35%) | 6 | 6 | 8 |
| 27 | ZKUSDT | 2.78 | 6.1 | 21 | 6.2% | 1 (5%) | 6 | 6 | 6 |
| 28 | 牛来USDT | 2.77 | 13.5 | 0 | — | — | 0 | 0 | 0 |
| 29 | OPUSDT | 2.74 | 10.2 | 21 | 5.3% | 4 (19%) | 6 | 6 | 6 |
| 30 | MITOUSDT | 2.73 | 3.7 | 30 | 4.7% | 5 (17%) | 6 | 6 | 6 |
| 31 | ARKUSDT | 2.68 | 2.3 | 29 | 3.7% | 5 (17%) | 6 | 6 | 7 |
| 32 | HOMEUSDT | 2.67 | 2.9 | 17 | 11.7% | 9 (53%) | 6 | 7 | 9 |
| 33 | ARBUSDT | 2.65 | 39.0 | 22 | 7.7% | 9 (41%) | 6 | 7 | 9 |
| 34 | ALGOUSDT | 2.62 | 10.2 | 26 | 3.4% | 0 (0%) | 6 | 6 | 6 |
| 35 | STGUSDT | 2.62 | 2.3 | 24 | 3.8% | 3 (13%) | 4 | 5 | 5 |
| 36 | ALLOUSDT | 2.61 | 6.9 | 10 | 5.2% | 2 (20%) | 6 | 5 | 5 |
| 37 | IOSTUSDT | 2.58 | 3.1 | 33 | 3.6% | 11 (33%) | 4 | 6 | 10 |
| 38 | COTIUSDT | 2.57 | 4.8 | 35 | 10.5% | 18 (51%) | 6 | 7 | 14 |
| 39 | MINAUSDT | 2.56 | 2.2 | 34 | 7.4% | 12 (35%) | 5 | 7 | 8 |
| 40 | ACEUSDT | 2.52 | 7.2 | 20 | 21.0% | 17 (85%) | 2 | 6 | 14 |
| 41 | NEARUSDT | 2.47 | 327.6 | 33 | 5.2% | 6 (18%) | 10 | 10 | 10 |
| 42 | BERAUSDT | 2.45 | 2.9 | 25 | 4.0% | 1 (4%) | 6 | 6 | 6 |
| 43 | ONGUSDT | 2.44 | 4.3 | 20 | 23.1% | 14 (70%) | 4 | 5 | 11 |
| 44 | CFGUSDT | 2.32 | 3.1 | 6 | 5.2% | 1 (17%) | 3 | 4 | 4 |
| 45 | STXUSDT | 2.27 | 4.8 | 26 | 5.9% | 7 (27%) | 6 | 7 | 8 |
| 46 | NILUSDT | 2.24 | 4.7 | 27 | 5.5% | 9 (33%) | 8 | 11 | 11 |
| 47 | APTUSDT | 2.23 | 12.2 | 16 | 3.3% | 0 (0%) | 5 | 5 | 5 |
| 48 | XPLUSDT | 2.21 | 10.8 | 15 | 3.3% | 1 (7%) | 4 | 4 | 5 |
| 49 | MEGAUSDT | 2.20 | 2.8 | 15 | 4.6% | 2 (13%) | 4 | 4 | 4 |
| 50 | FFUSDT | 2.17 | 6.4 | 36 | 4.2% | 11 (31%) | 5 | 7 | 10 |
| 51 | WLDUSDT | 2.16 | 25.1 | 18 | 6.0% | 3 (17%) | 5 | 6 | 6 |
| 52 | MANTAUSDT | 2.16 | 2.2 | 14 | 2.9% | 0 (0%) | 2 | 2 | 2 |
| 53 | EIGENUSDT | 2.14 | 2.8 | 18 | 4.2% | 1 (6%) | 4 | 4 | 4 |
| 54 | GRTUSDT | 2.11 | 2.2 | 25 | 3.0% | 2 (8%) | 6 | 6 | 6 |
| 55 | AGLDUSDT | 2.09 | 2.3 | 28 | 2.5% | 0 (0%) | 4 | 4 | 4 |
| 56 | TUTUSDT | 2.08 | 4.0 | 34 | 17.9% | 21 (62%) | 4 | 5 | 18 |
| 57 | TUSDT | 2.07 | 4.1 | 24 | 3.9% | 3 (13%) | 6 | 6 | 7 |
| 58 | FUSDT | 2.05 | 4.1 | 34 | 3.8% | 2 (6%) | 4 | 4 | 5 |
| 59 | ONDOUSDT | 2.00 | 20.3 | 29 | 4.4% | 0 (0%) | 6 | 6 | 6 |
| 60 | HBARUSDT | 1.99 | 31.7 | 34 | 2.7% | 0 (0%) | 3 | 3 | 3 |
| 61 | KMNOUSDT | 1.97 | 2.5 | 33 | 3.5% | 6 (18%) | 8 | 8 | 9 |
| 62 | PROVEUSDT | 1.93 | 58.8 | 45 | 2.3% | 0 (0%) | 4 | 4 | 4 |
| 63 | FETUSDT | 1.92 | 20.1 | 25 | 5.1% | 2 (8%) | 6 | 7 | 7 |
| 64 | UNIUSDT | 1.91 | 65.6 | 38 | 6.1% | 7 (18%) | 10 | 12 | 12 |
| 65 | SUIUSDT | 1.90 | 116.2 | 17 | 4.3% | 2 (12%) | 5 | 5 | 5 |
| 66 | PUMPUSDT | 1.90 | 18.9 | 41 | 7.8% | 14 (34%) | 7 | 8 | 11 |
| 67 | SOPHUSDT | 1.87 | 2.0 | 23 | 3.3% | 3 (13%) | 5 | 5 | 6 |
| 68 | ZENUSDT | 1.84 | 6.7 | 35 | 5.3% | 8 (23%) | 5 | 6 | 7 |
| 69 | TIAUSDT | 1.83 | 5.4 | 15 | 3.8% | 0 (0%) | 4 | 4 | 4 |
| 70 | USTCUSDT | 1.77 | 2.6 | 19 | 2.6% | 0 (0%) | 2 | 2 | 2 |
| 71 | CHIPUSDT | 1.77 | 2.2 | 30 | 8.5% | 12 (40%) | 7 | 8 | 7 |
| 72 | PEPEUSDT | 1.74 | 35.2 | 19 | 3.7% | 7 (37%) | 5 | 5 | 8 |
| 73 | FILUSDT | 1.72 | 20.0 | 20 | 5.8% | 1 (5%) | 5 | 5 | 5 |
| 74 | HEMIUSDT | 1.71 | 2.9 | 25 | 13.2% | 15 (60%) | 5 | 7 | 17 |
| 75 | LDOUSDT | 1.68 | 4.2 | 28 | 4.9% | 1 (4%) | 8 | 8 | 8 |
| 76 | CAKEUSDT | 1.67 | 20.2 | 47 | 4.8% | 5 (11%) | 5 | 6 | 6 |
| 77 | ENSUSDT | 1.67 | 3.0 | 25 | 4.7% | 3 (12%) | 5 | 6 | 6 |
| 78 | ZROUSDT | 1.66 | 7.2 | 31 | 5.6% | 7 (23%) | 5 | 6 | 9 |
| 79 | ETHFIUSDT | 1.65 | 6.9 | 31 | 6.1% | 5 (16%) | 6 | 6 | 6 |
| 80 | VETUSDT | 1.65 | 2.6 | 34 | 3.8% | 6 (18%) | 6 | 7 | 7 |
| 81 | ENSOUSDT | 1.64 | 6.7 | 32 | 4.3% | 1 (3%) | 6 | 7 | 7 |
| 82 | JUPUSDT | 1.64 | 4.4 | 40 | 5.1% | 2 (5%) | 9 | 9 | 9 |
| 83 | DOTUSDT | 1.62 | 15.7 | 25 | 3.5% | 2 (8%) | 5 | 5 | 5 |
| 84 | RAYUSDT | 1.59 | 6.6 | 37 | 4.6% | 11 (30%) | 5 | 6 | 8 |
| 85 | GALAUSDT | 1.59 | 2.1 | 8 | 7.1% | 0 (0%) | 6 | 6 | 6 |
| 86 | PENGUUSDT | 1.58 | 8.0 | 23 | 5.4% | 7 (30%) | 6 | 6 | 7 |
| 87 | DASHUSDT | 1.56 | 14.2 | 27 | 6.0% | 5 (19%) | 6 | 6 | 8 |
| 88 | TAOUSDT | 1.54 | 34.7 | 24 | 4.5% | 5 (21%) | 4 | 4 | 4 |
| 89 | BONKUSDT | 1.53 | 3.8 | 16 | 5.1% | 3 (19%) | 5 | 5 | 6 |
| 90 | ETCUSDT | 1.51 | 3.8 | 25 | 3.0% | 0 (0%) | 8 | 8 | 8 |
| 91 | MORPHOUSDT | 1.50 | 5.5 | 35 | 3.8% | 2 (6%) | 6 | 6 | 6 |
| 92 | RENDERUSDT | 1.48 | 11.9 | 25 | 3.4% | 0 (0%) | 4 | 4 | 4 |
| 93 | PYTHUSDT | 1.47 | 3.2 | 22 | 5.0% | 4 (18%) | 5 | 5 | 6 |
| 94 | PLUMEUSDT | 1.47 | 3.0 | 27 | 3.9% | 0 (0%) | 6 | 6 | 6 |
| 95 | SEIUSDT | 1.45 | 11.4 | 29 | 3.5% | 0 (0%) | 4 | 4 | 4 |
| 96 | PENDLEUSDT | 1.45 | 4.7 | 32 | 5.0% | 1 (3%) | 6 | 6 | 6 |
| 97 | TRUMPUSDT | 1.44 | 16.6 | 11 | 4.0% | 4 (36%) | 3 | 3 | 5 |
| 98 | CFXUSDT | 1.44 | 2.6 | 18 | 2.9% | 1 (6%) | 4 | 4 | 4 |
| 99 | VIRTUALUSDT | 1.42 | 3.8 | 24 | 6.5% | 5 (21%) | 6 | 6 | 6 |
| 100 | WIFUSDT | 1.41 | 2.2 | 28 | 4.5% | 6 (21%) | 6 | 6 | 7 |
| 101 | CRVUSDT | 1.40 | 4.0 | 38 | 7.2% | 9 (24%) | 9 | 9 | 10 |
| 102 | GIGGLEUSDT | 1.40 | 2.7 | 25 | 5.7% | 6 (24%) | 8 | 8 | 11 |
| 103 | ATOMUSDT | 1.39 | 3.1 | 38 | 3.2% | 1 (3%) | 4 | 4 | 4 |
| 104 | FTTUSDT | 1.35 | 6.4 | 13 | 4.4% | 3 (23%) | 4 | 4 | 6 |
| 105 | AEROUSDT | 1.34 | 2.7 | 22 | 5.7% | 4 (18%) | 4 | 5 | 5 |
| 106 | KAITOUSDT | 1.33 | 2.4 | 12 | 7.1% | 2 (17%) | 5 | 6 | 7 |
| 107 | POLUSDT | 1.31 | 7.4 | 32 | 2.6% | 6 (19%) | 5 | 5 | 6 |
| 108 | ICPUSDT | 1.27 | 9.2 | 37 | 3.0% | 2 (5%) | 3 | 4 | 4 |
| 109 | AAVEUSDT | 1.26 | 16.7 | 34 | 3.6% | 5 (15%) | 4 | 5 | 4 |
| 110 | LUNAUSDT | 1.24 | 9.2 | 22 | 3.7% | 0 (0%) | 5 | 5 | 5 |
| 111 | XLMUSDT | 1.22 | 18.4 | 17 | 2.7% | 0 (0%) | 3 | 3 | 3 |
| 112 | ORDIUSDT | 1.22 | 2.5 | 24 | 4.6% | 2 (8%) | 5 | 5 | 5 |
| 113 | ADAUSDT | 1.21 | 33.5 | 21 | 3.6% | 1 (5%) | 6 | 6 | 6 |
| 114 | LUNCUSDT | 1.14 | 5.6 | 18 | 4.0% | 0 (0%) | 4 | 4 | 4 |
| 115 | LINKUSDT | 1.12 | 31.0 | 34 | 2.8% | 2 (6%) | 4 | 4 | 4 |
| 116 | LTCUSDT | 1.11 | 21.8 | 37 | 1.9% | 3 (8%) | 3 | 4 | 4 |
| 117 | MIRAUSDT | 1.10 | 2.1 | 24 | 4.0% | 0 (0%) | 6 | 6 | 6 |
| 118 | ZECUSDT | 1.07 | 323.5 | 39 | 5.0% | 13 (33%) | 6 | 7 | 8 |
| 119 | BCHUSDT | 1.03 | 9.2 | 21 | 2.1% | 2 (10%) | 4 | 4 | 4 |
| 120 | BNCBUSDT | 1.02 | 4.1 | 0 | — | — | 0 | 0 | 0 |
| 121 | SHIBUSDT | 1.00 | 4.3 | 21 | 4.4% | 1 (5%) | 4 | 5 | 5 |
| 122 | ASTERUSDT | 0.99 | 13.1 | 23 | 3.4% | 4 (17%) | 3 | 4 | 4 |
| 123 | DOGEUSDT | 0.91 | 70.4 | 18 | 3.4% | 5 (28%) | 3 | 4 | 5 |
| 124 | WLFIUSDT | 0.87 | 3.7 | 11 | 2.5% | 0 (0%) | 4 | 4 | 4 |
| 125 | JSTUSDT | 0.87 | 3.2 | 43 | 1.4% | 0 (0%) | 2 | 2 | 2 |
| 126 | DEXEUSDT | 0.86 | 2.3 | 3 | 2.6% | 1 (33%) | 1 | 2 | 2 |
| 127 | XRPUSDT | 0.77 | 175.7 | 16 | 3.6% | 3 (19%) | 4 | 4 | 5 |
| 128 | SOLUSDT | 0.74 | 258.7 | 33 | 2.4% | 9 (27%) | 3 | 3 | 3 |
| 129 | GRAMUSDT | 0.72 | 8.5 | 6 | 4.0% | 0 (0%) | 1 | 1 | 1 |
| 130 | MSTRBUSDT | 0.71 | 11.1 | 27 | 6.1% | 2 (7%) | 5 | 5 | 5 |
| 131 | BNBUSDT | 0.58 | 84.8 | 44 | 1.9% | 2 (5%) | 3 | 3 | 3 |
| 132 | CRCLBUSDT | 0.57 | 16.4 | 34 | 4.0% | 5 (15%) | 5 | 5 | 4 |
| 133 | ETHUSDT | 0.53 | 559.0 | 25 | 2.8% | 2 (8%) | 2 | 2 | 2 |
| 134 | SNXXBUSDT | 0.46 | 2.1 | 7 | 4.2% | 1 (14%) | 3 | 3 | 3 |
| 135 | BTCUSDT | 0.37 | 919.3 | 23 | 3.9% | 3 (13%) | 2 | 2 | 2 |
| 136 | WBTCUSDT | 0.36 | 3.8 | 22 | 3.9% | 2 (9%) | 2 | 2 | 2 |
| 137 | TRXUSDT | 0.25 | 36.6 | 35 | 0.7% | 0 (0%) | 1 | 1 | 1 |
| 138 | SNDKBUSDT | 0.22 | 2.5 | 25 | 3.3% | 0 (0%) | 6 | 6 | 6 |
| 139 | NVDABUSDT | 0.12 | 2.9 | 22 | 1.5% | 0 (0%) | 1 | 1 | 1 |
| 140 | QQQBUSDT | 0.07 | 2.4 | 0 | — | — | 0 | 0 | 0 |
| 141 | XAUTUSDT | 0.06 | 5.3 | 0 | — | — | 0 | 0 | 0 |
| 142 | EURUSDT | 0.04 | 6.7 | 0 | — | — | 0 | 0 | 0 |
| 143 | PAXGUSDT | 0.04 | 5.6 | 0 | — | — | 0 | 0 | 0 |
| 144 | RLUSDUSDT | 0.02 | 78.0 | 0 | — | — | 0 | 0 | 0 |
| 145 | FDUSDUSDT | 0.02 | 20.1 | 0 | — | — | 0 | 0 | 0 |
| 146 | UUSDT | 0.02 | 20.0 | 0 | — | — | 0 | 0 | 0 |
| 147 | BFUSDUSDT | 0.02 | 5.5 | 0 | — | — | 0 | 0 | 0 |
| 148 | USD1USDT | 0.01 | 113.9 | 0 | — | — | 0 | 0 | 0 |
| 149 | XUSDUSDT | 0.01 | 3.5 | 0 | — | — | 0 | 0 | 0 |
| 150 | USDCUSDT | 0.00 | 1657.2 | 0 | — | — | 0 | 0 | 0 |
