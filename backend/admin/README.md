# backend/admin — API interna de administração dos bots

> Subsistema criado para o `njs-lets-trade` ser administrado remotamente pelo
> projeto **`njs-whatsapp`** (repositório separado, HTTP na porta 3005).
> Este documento é a referência para quem for editar `backend/admin/` ou o
> launcher `backend/bot/start-bands-bots.js`.

---

## 1. Para que serve

O `njs-whatsapp` recebe comandos no WhatsApp (`/status`, `/log`, ...) e precisa
saber o estado do bot do `njs-lets-trade`. Em vez de o `njs-whatsapp` ficar
"olhando por cima" (PM2, ler arquivos), o `njs-lets-trade` **coopera**: expõe uma
API HTTP local só de leitura com o que ele sabe de si mesmo.

```
WhatsApp
  │  "/status"
  ▼
njs-whatsapp (porta 3005)   ── GET /admin/status ──┐
  │  src/admin/*                                   │  HTTP + X-Internal-Token
  ▼                                                ▼
  └──────────────────────────────►  njs-lets-trade — backend/admin (porta 4100, 127.0.0.1)
                                      │
                                      ├─ gitInfo.js        → branch / commit / dirty
                                      ├─ botLog.js          → launcher.log (stdout dos bots)
                                      └─ estado dos filhos  → pid / uptime / restarts
                                          (bollinger-bands-bot.js, rsi-momentum-bot.js)
```

### Mapeamento de endpoints

| `njs-whatsapp`       | `njs-lets-trade` (aqui)      | Etapa |
|----------------------|-----------------------------|-------|
| `GET /admin/health`  | `GET /internal/health` (+ `/internal/info` no sub-campo) | 2 ✅ |
| `GET /admin/status`  | `GET /internal/info`        | 2 ✅ |
| `GET /admin/log`     | `GET /internal/log?lines=`  | 2 ✅ |
| `POST /admin/update` | **sem contraparte** — feito por fora (git pull) | 3 |
| `POST /admin/restart`| **sem contraparte** — feito por fora (process manager) | 4 |

> O lado `njs-whatsapp` já consome esta API (etapa 2: `src/admin/letsTrade.js` faz
> `fetch` com `X-Internal-Token`, com degradação limpa se o launcher estiver fora).
> `/update` e `/restart` seguem como placeholders lá — restart/update são do
> orquestrador externo, sem contraparte aqui por decisão de arquitetura.

---

## 2. Onde roda

**Nenhum processo novo.** É um `http.Server` dentro do processo do launcher
`backend/bot/start-bands-bots.js` (ou seja, `npm run bots:bands`).

```
$ npm run bots:bands
[admin] API interna em http://127.0.0.1:4100 (health|info|log · token)
...saída dos bots...
```

Se o launcher não estiver rodando, a API não existe — e é isso mesmo: o que é
administrado é **o bot**. O `npm start` (frontend + `backend/server.js`) não tem
e não precisa dessa API.

---

## 3. Arquivos

| Arquivo | Responsabilidade | Cuidado ao editar |
|---|---|---|
| `internalConfig.js` | Lê `INTERNAL_ADMIN_*` do `.env` da raiz. Exporta `internalConfig` (`enabled`, `host`, `port`, `token`, `repoRoot`, `logFile`). | `host` deve continuar com default `127.0.0.1`. Não trocar para `0.0.0.0`. |
| `gitInfo.js` | `getGitInfo()` → `{ available, branch, commit, commitFull, commitDate, subject, dirty }`. Roda `git` via `execFileSync` com `cwd = repoRoot`, cache de 15s, timeout 4s. Erro → `{ available:false, error }`. | Manter tolerante a falha (git ausente do PATH, não é repo). Nunca deixar lançar. |
| `botLog.js` | Espelha stdout/stderr dos bots filhos → console **+** `backend/data/bot/launcher.log`. Rotação por tamanho (2 MB, mantém `launcher.log.1`). `tail(n)` lê `.1` + atual. `pipeChildOutput(stream, {label, target})`, `writeLine`, `close`. | Log nunca pode derrubar o launcher — tudo em `try/catch`. Não aumentar `MAX_BYTES` sem pensar em disco no Termux. |
| `internalServer.js` | `startInternalAdminServer(getState)` → `http.Server`. Rotas GET `/internal/health`, `/internal/info`, `/internal/log`. Auth: loopback obrigatório + `X-Internal-Token` se `token` setado. `server.on('error')` só loga (não derruba). | Ver invariantes de segurança abaixo. |
| `README.md` | Este arquivo. | — |

### `start-bands-bots.js` (launcher — modificado)

O que foi adicionado (o resto do comportamento — spawn por filho, restart com
limite `MAX_RESTARTS`, shutdown — é o original):

- `require('dotenv').config({ path: raiz/.env })` no topo (o launcher agora
  precisa do `.env` para a config da API).
- `spawn(..., { stdio: ['inherit', 'pipe', 'pipe'] })` (era `'inherit'`) +
  `botLog.pipeChildOutput()` para stdout e stderr de cada filho.
- Estado por bot no objeto de `BOTS[i]`: `pid`, `running`, `restarts`,
  `startedAt`, `lastExit` — atualizado em `startBot` e no `child.on('exit')`.
- `getLauncherState()` → snapshot `{ startedAt, bots: [...] }` passado para
  `startInternalAdminServer`.
- `shutdown()` agora também faz `adminServer.close()` e `botLog.close()`.

> **`getLauncherState()` só expõe dados de PROCESSO.** Nunca colocar aí posição
> aberta, saldo, chave de corretora, config de trade. Se precisar de estado de
> trading no `/status`, ver seção 6.

---

## 4. Endpoints — contrato

### `GET /internal/health`
```json
{ "status": "ok", "service": "njs-lets-trade-bots", "uptimeSeconds": 1234 }
```
Não consulta git nem disco e, uma vez autorizado, nunca falha. Mas o
`authorized(req)` roda **antes de toda rota** (invariante 2) — então
`/internal/health` também exige o `X-Internal-Token` quando há token configurado;
sem ele responde `403`, igual aos outros.

### `GET /internal/info`
```json
{
  "service": "njs-lets-trade-bots",
  "version": "1.132.0",
  "node": "v22.22.2",
  "pid": 12345,
  "startedAt": "2026-09-06T12:00:00.000Z",
  "uptimeSeconds": 1234,
  "memoryBytes": 84213760,
  "git": {
    "available": true,
    "branch": "main",
    "commit": "59625a9",
    "commitFull": "59625a98...",
    "commitDate": "2026-09-06T11:26:04-03:00",
    "subject": "chore: rebuild dist (v1.132.0)",
    "dirty": false
  },
  "bots": [
    { "label": "Bollinger Bands", "pid": 12346, "running": true, "restarts": 0,
      "startedAt": "2026-09-06T12:00:01.000Z", "lastExit": null },
    { "label": "RSI Momentum", "pid": 12347, "running": true, "restarts": 0,
      "startedAt": "2026-09-06T12:00:01.000Z", "lastExit": null }
  ],
  "online": true,
  "checkedAt": "2026-09-06T12:20:34.000Z"
}
```
- `online` = algum bot com `running: true`.
- `lastExit` = `{ code, signal, at }` do último encerramento não‑normal, ou `null`.

### `GET /internal/log?lines=100`
```json
{
  "file": "C:\\workspace\\njs-lets-trade\\backend\\data\\bot\\launcher.log",
  "lines": ["[RSI Momentum] 12:20:01 sinal BTCUSDT ...", "[Bollinger Bands] ..."]
}
```
- `lines` default 100, teto 2000.
- Cada linha vem prefixada com `[<label do bot>]`.

---

## 5. Invariantes de segurança — NÃO QUEBRAR

1. **Bind só em loopback.** `internalConfig.host` default `127.0.0.1`. A API não
   pode escutar em `0.0.0.0` / IP de rede.
2. **`authorized(req)` roda em TODA request** — checa IP loopback e, se houver
   `token`, o header `X-Internal-Token`.
3. **Somente `GET`.** Nenhuma rota pode alterar estado do sistema.
4. **Nada de restart / update / git pull / exec / shell** aqui. Se for preciso
   reiniciar ou atualizar, é o orquestrador externo que faz (process manager +
   git), nunca o processo administrado.
5. **Nunca vazar segredo** no `/internal/info` (`.env`, chave de corretora,
   token, dados de carteira).
6. Falha de git, disco ou porta ocupada **não pode derrubar o launcher nem os
   bots** — sempre `try/catch` / `on('error')`.

---

## 6. Como estender com segurança

**Adicionar um campo em `/internal/info`** (ex.: intervalo de scan, nº de
favoritos ativos):
- Se for dado de processo → põe em `getLauncherState()` no launcher.
- Se for dado de trading que só o bot filho sabe → o filho precisa publicar
  isso em algum lugar que o launcher/servidor leia sem acoplar (ex.: um arquivo
  JSON em `backend/data/bot/`, ou uma linha no `launcher.log` com prefixo
  parseável). **Não** importar o motor de trade dentro de `backend/admin/`.
- Nunca dado sensível (ver invariante 5).

**Adicionar um endpoint de leitura novo** (ex.: `/internal/trades-hoje`):
- GET, dentro de `authorized`, resposta JSON, tolerante a erro. Documentar aqui
  e avisar o lado `njs-whatsapp` (novo comando + rota `/admin/...`).

**O que NÃO adicionar:** `POST /internal/restart`, `/internal/update`,
`/internal/exec`, qualquer coisa que rode comando. Fora do escopo por decisão de
arquitetura.

---

## 7. Configuração (`.env` na raiz do `njs-lets-trade`)

```
INTERNAL_ADMIN_ENABLED=true          # false desliga a API (bots continuam)
INTERNAL_ADMIN_HOST=127.0.0.1
INTERNAL_ADMIN_PORT=4100
INTERNAL_ADMIN_TOKEN=<segredo>       # igual ao LETS_TRADE_INTERNAL_TOKEN do njs-whatsapp
# INTERNAL_ADMIN_LOG_FILE=           # opcional, default backend/data/bot/launcher.log
```

Lado `njs-whatsapp` (`.env` dele) — tem que casar:
```
LETS_TRADE_INTERNAL_URL=http://127.0.0.1:4100
LETS_TRADE_INTERNAL_TOKEN=<mesmo segredo>
```

`launcher.log` fica em `backend/data/`, que já é ignorado pelo `.gitignore`.

---

## 8. Testar

```bash
# terminal 1
npm run bots:bands

# terminal 2  (com token configurado, TODA rota exige o header)
curl -s -H "X-Internal-Token: <token>" http://127.0.0.1:4100/internal/health
curl -s -H "X-Internal-Token: <token>" http://127.0.0.1:4100/internal/info
curl -s -H "X-Internal-Token: <token>" "http://127.0.0.1:4100/internal/log?lines=20"
curl -s http://127.0.0.1:4100/internal/health    # deve dar 403 (sem token)
curl -s -H "X-Internal-Token: errado" http://127.0.0.1:4100/internal/info   # 403
```

Sem subir os bots (só a API, com estado falso):
```bash
node -e "require('./backend/admin/internalServer').startInternalAdminServer(()=>({startedAt:Date.now(),bots:[]}))"
```

---

## 9. Gotchas

- **Porta 4100 ocupada** (outra instância do launcher): a API loga o erro e não
  sobe; os bots seguem normalmente. Mate a instância antiga ou mude
  `INTERNAL_ADMIN_PORT`.
- **`git` fora do PATH**: `/internal/info` volta com `git.available: false` — não
  quebra nada.
- **Windows**: o `shutdown()` do launcher usa `taskkill /F` (força) nos filhos —
  encerramento abrupto. A crash‑safety dos bots (reconciliação de órfã,
  `resumeRearmPending`) cobre isso. Se um dia trocar por `SIGTERM` gracioso,
  testar bem com posição aberta.
- **Rotação de log**: em 2 MB o `launcher.log` vira `launcher.log.1` e um novo
  começa. `tail()` já lê os dois. Só mantém 1 arquivo antigo.
