# Economia de tokens do Agent (Cursor) — análise de 02/07/2026

> **Nota:** o Cursor não expõe aqui o billing exato por dia. Este documento usa **transcripts locais** (`~/.cursor/projects/.../agent-transcripts/`) como proxy: tamanho de texto, número de mensagens e chamadas de ferramentas. Os números reais cobrados pelo Cursor tendem a ser **maiores**, porque a cada turno o modelo recebe de novo regras, contexto do projeto, histórico e resultados de tools.

---

## Resumo do dia

| Métrica | Valor (estimado) |
|--------|-------------------|
| Sessões principais hoje | **2** |
| Subagentes hoje | **4** |
| Mensagens do usuário | **54** |
| Respostas do agente | **442** |
| Chamadas de tools | **~1.164** |
| Texto acumulado nos logs | **~1,0 MB** (~**250k tokens** só de conteúdo gravado) |
| Consumo real provável | **muito acima** do log (contexto reenviado a cada turno) |

### Sessões que mais consumiram

| Sessão | Tema | Tamanho log | Tools | Observação |
|--------|------|-------------|-------|------------|
| `13cbbe1a…` | Filtro MA Cross + bugs BTTC/QUICK/AI + push | **~570 KB** | **696** | Uma conversa longa com muitos assuntos |
| `2c2f3bd3…` | Trade 3 MAs + cores no print | **~340 KB** | **307** | Segunda sessão grande no mesmo dia |
| 4 subagentes | Exploração de código | **~75 KB** | **161** | Cada um carrega prompt + contexto próprio |

---

## O que mais gastou tokens hoje

### 1. Conversas muito longas (principal vilão)

A sessão MA Cross (`13cbbe1a`) concentrou **tudo** num único fio:

- Implementação do filtro macross
- Correção de 172 falsos positivos
- MA9/MA21 no gráfico
- Integração Multi-Trade
- Debug de **3 moedas** (BTTC, QUICK, AI) com scripts repetidos
- Build + push
- Este próprio relatório

**Cada nova mensagem reenvia** grande parte do histórico. Com 343 linhas de transcript e 696 tools, o custo cresce de forma **não linear**.

### 2. Muitas chamadas de ferramenta

Distribuição na sessão MA Cross:

| Tool | Vezes | Impacto |
|------|------:|---------|
| `StrReplace` | 258 | Edições incrementais; cada uma gera diff + contexto |
| `Read` | 207 | Arquivos inteiros ou trechos grandes |
| `Grep` | 99 | Moderado |
| `Shell` | 78 | Saídas longas (jest, node diagnostics, curl API) |
| `Write` | 24 | Arquivos novos |
| `Task` (subagent) | 4 | **Sessão paralela completa** por chamada |

### 3. Diagnósticos repetitivos por moeda

BTTC, QUICK e AI foram investigadas com padrão similar:

- Ler JSON de candles no disco
- Rodar `node -e` com SMA/cruzamento
- Comparar API vs disco
- Conferir cache

Cada símbolo ≈ **5–10 tools + saída de terminal**. Três moedas ≈ **~30% do debug duplicado**.

### 4. Contexto fixo em todo turno

Enviado repetidamente (aprox.):

| Fonte | Tamanho |
|-------|--------:|
| `CLAUDE.md` | ~8 KB |
| `.cursor/rules/` | ~6 KB |
| Regras de commit/push do usuário | ~4–6 KB |
| Git status, arquivos abertos, etc. | variável |

Isso parece pouco, mas multiplicado por **centenas de turnos** pesa.

### 5. Subagentes de exploração

O `Task` com `subagent_type: explore` no início do MA Cross foi útil, mas duplica leitura de arquitetura que depois foi relida com `Read`/`Grep` de qualquer forma.

### 6. Resumos de conversa

Quando o contexto estoura, o Cursor resume o chat. Isso **não elimina** o custo — só comprime. Continuar na mesma sessão após resumo ainda acumula tokens.

---

## Estimativa de ordem de grandeza (hoje)

Modelo mental conservador:

```
tokens_billed ≈ Σ (por cada turno do agente) [
  system + rules + skills
  + histórico recente (ou resumo)
  + arquivos lidos / outputs de tools
  + sua mensagem
]
```

Com **442 respostas do agente** só nas sessões principais de hoje, mesmo **~15k–40k tokens de input médio por turno** já daria **~6M–18M tokens de input no dia** (faixa ampla, não é fatura oficial).

O log de **~250k tokens** de texto gravado é apenas o “filme”; o “replay” a cada turno é o que custa.

---

## Recomendações — o que fazer na prática

### Prioridade alta (maior economia)

#### 1. Nova conversa por assunto

| Em vez de… | Faça… |
|------------|--------|
| MA Cross + debug BTTC + push na mesma chat | Chat 1: feature · Chat 2: bug moeda X · Chat 3: `faça push` |
| Perguntar “examine A, B e C” em sequência | Uma mensagem: “compare BTTC, QUICK, AI — mesmo bug de idade” |
| Continuar após resumo automático | Abrir chat novo com 3 bullets de contexto |

**Economia estimada:** 40–70% em dias como hoje.

#### 2. Mensagens mais curtas e ancoradas

Exemplo **caro:**
> examine a quick, no site ela cruzou a 45 min

Exemplo **barato:**
> QUICKUSDT · filtro `15m|macross|9|15m|21|15m|xup|age|30` · badge 31m vs gráfico ~45m · `@backend/bot/ma-cross/strategyEngine.js`

Use `@arquivo` e `@pasta` para evitar exploração ampla.

#### 3. Modo Ask para dúvidas sem código

- “Como funciona o filtro macross?” → **Ask** (read-only)
- “Corrija o badge” → **Agent**

#### 4. Evitar subagente quando der

Preferir `Grep`/`Read` direto em 1–2 arquivos conhecidos. Reservar `Task explore` para codebases desconhecidas.

#### 5. Push em chat mínima

Mensagem ideal: `faça push` (com a rule de build já no repo). Sem reler bugs anteriores.

---

### Prioridade média (projeto njs-lets-trade)

#### 6. Criar `.cursorignore`

Ignorar arquivos grandes que o agent não precisa indexar:

```gitignore
frontend-react/dist/
backend/data/candlestick/
backend/data/rsi-cache.json
backend/data/ma-cross-cache.json
backend/data/ma-time-above-cache.json
node_modules/
*.jsonl
```

**Cuidado:** não ignore arquivos que você quer que o agent edite.

#### 7. Enxugar `CLAUDE.md`

Hoje ~8 KB, sempre presente. Mover para o arquivo:

- Documentação longa de bots (`amap-bot`, `rsiTradeBot`) → `backend/bot/README.md`
- Manter em `CLAUDE.md` só: comandos, arquitetura resumida, convenções de filtro

Meta: **≤ 4 KB**.

#### 8. Rule específica para MA Cross

Criar `.cursor/rules/ma-cross.mdc` com:

- Onde está `strategyEngine.js`, `fetchMaCrossoverFilter.js`
- Convenção de nome `15m|macross|…`
- Bugs conhecidos (gaps no disco, idade no fechamento do candle)

Evita reexplorar o repo em cada bug de moeda.

#### 9. Scripts de diagnóstico reutilizáveis

Em vez de `node -e` ad hoc no chat, um script versionado:

```bash
node backend/scripts/diagnose-macross.js QUICKUSDT 15m
```

O agent roda **1 tool** com saída curta, em vez de 5–8 tools montando o script inline.

#### 10. Batch de símbolos

Pedir: “diagnostique QUICKUSDT, BTTCUSDT, AIUSDT num único script” — uma execução, uma saída.

---

### Prioridade baixa (hábitos gerais)

| Hábito | Por quê |
|--------|---------|
| Modelo mais rápido/barato para push, grep, docs | Tarefas mecânicas não precisam do modelo mais capaz |
| Não pedir build + push + review na mesma mensagem | São fases separadas |
| `Read` com `limit` / `offset` | Evita ler arquivos de 500+ linhas inteiros |
| Preferir `StrReplace` a reescrever arquivo inteiro | Menos diff no contexto |
| Fechar terminais/logs grandes do contexto | Saída de jest/curl entra no histórico |

---

## Checklist rápido antes de abrir o Agent

- [ ] Isso **precisa** alterar código? Se não → **Ask**
- [ ] É assunto **novo**? → **Nova conversa**
- [ ] Sei os **arquivos** envolvidos? → usar `@path`
- [ ] São **várias moedas/casos**? → pedir batch numa mensagem
- [ ] Só quero **push**? → chat limpa, uma linha
- [ ] Debug recorrente? → script no repo, não inline no chat

---

## Meta de uso saudável (sugestão pessoal)

Para um dia de feature + debug como hoje:

| Cenário | Chats | Tools (alvo) |
|---------|------:|-------------:|
| Feature média | 1–2 | 80–150 |
| Debug pontual | 1 | 10–25 |
| Push | 1 | 5–10 |
| **Total dia produtivo** | **3–4** | **~150–250** |

Hoje ficou em **~1.164 tools** — cerca de **4–8×** acima de um dia enxuto, principalmente por **2 megachats** e **debug triplicado**.

---

## Como acompanhar daqui pra frente

1. **Cursor Settings → Usage / Billing** — única fonte oficial de tokens/custo.
2. **Tamanho dos transcripts** — pasta:
   `C:\Users\fabricio.barrozo\.cursor\projects\c-Users-fabricio-barrozo-Desktop-workspace-njs-lets-trade\agent-transcripts\`
   Arquivo `.jsonl` > **200 KB** no mesmo dia = sinal para abrir chat nova.
3. **Contagem de tools** — se passar de ~150 tools numa sessão, finalize e comece outra.

---

## Conclusão

O uso de hoje foi **alto**, mas **previsível**: duas sessões longas, centenas de edições/leituras, subagentes de exploração e três investigações de moeda quase iguais na mesma conversa MA Cross.

**Maior ganho imediato:** quebrar assuntos em chats menores + mensagens com `@arquivo` + `.cursorignore` nos caches/candles + script único de diagnóstico macross.

**Segundo ganho:** enxugar `CLAUDE.md` e rule local de MA Cross para não pagar o mesmo contexto estático centenas de vezes.

---

*Gerado em 02/07/2026 a partir dos transcripts locais do projeto njs-lets-trade.*
