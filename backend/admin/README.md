# backend/admin — API interna de administração dos bots

> Subsistema criado para o `njs-lets-trade` ser administrado remotamente pelo
> projeto **`njs-whatsapp`** (repositório separado, HTTP na porta 3005).
> Este documento é a referência para quem for editar `backend/admin/` ou o
> launcher `backend/bot/start-trade-bots.js`.

---

## 1. Para que serve

O `njs-whatsapp` recebe comandos no WhatsApp (`/status`, `/log`, ...) e precisa
saber o estado do bot do `njs-lets-trade`. Em vez de o `njs-whatsapp` ficar
"olhando por cima" (PM2, ler arquivos), o `njs-lets-trade` **coopera**: expõe uma
API HTTP local só de leitura com o que ele sabe de si mesmo.

```
WhatsApp
  │  "/status"  "/restart"  "/update"
  ▼
njs-whatsapp (porta 3005)   ── GET/POST /admin/* ──┐
  │  src/admin/*                                   │  HTTP + X-Internal-Token
  ▼                                                ▼
  └──────────────────────────────►  njs-lets-trade — backend/admin (porta 4100, 127.0.0.1)
                                      │
                                      ├─ gitInfo.js        → branch / commit / dirty
                                      ├─ botLog.js          → launcher.log (stdout dos bots)
                                      ├─ botControl.js      → intenção restart/update + git pull
                                      └─ estado dos filhos  → pid / uptime / restarts
                                          (bollinger-bands-bot.js, rsi-momentum-bot.js)
```

### Mapeamento de endpoints

| `njs-whatsapp`        | `njs-lets-trade` (aqui)       | Estado |
|-----------------------|------------------------------|--------|
| `GET  /admin/health`  | `GET /internal/health` (+ `/internal/info` no sub-campo) | ✅ |
| `GET  /admin/status`  | `GET /internal/info`         | ✅ |
| `GET  /admin/log`     | `GET /internal/log?lines=`   | ✅ |
| `POST /admin/restart` | `POST /internal/restart`     | ✅ (exige token + `ALLOW_CONTROL`) |
| `POST /admin/update`  | `POST /internal/update`      | ✅ (exige token + `ALLOW_CONTROL`) |
| `POST /admin/stop`    | `POST /internal/stop`        | ✅ (exige token + `ALLOW_CONTROL`) |
| `POST /admin/pull`    | `POST /internal/pull` (dry-run) | ✅ (exige token + `ALLOW_CONTROL`) |

> O lado `njs-whatsapp` consome esta API (`src/admin/letsTrade.js` faz `fetch` com
> `X-Internal-Token`, degradação limpa se o launcher estiver fora).
>
> **restart/update NÃO são mais "por fora".** A API grava a intenção e mata o
> launcher com um exit code sentinela; o **supervisor** (`bots-supervisor.js`,
> processo pai) faz `git pull` / `npm ci` / respawn. A API em si nunca roda
> git/npm/shell — ver "Controle" na seção 4 e os invariantes revisados na seção 5.

---

## 2. Onde roda

`npm run bots` agora sobe **dois** processos:

```
npm run bots
  └─ bots-supervisor.js          ← fica sempre vivo; faz git pull + respawn; avisa no WhatsApp
       └─ start-trade-bots.js    ← launcher: spawn dos bots + http.Server :4100
            └─ rsi-momentum-bot.js   (Bollinger saiu em v1.135.6 — reative na lista BOTS)
```

A API interna é um `http.Server` dentro do **launcher**. Restart/update funcionam
porque o launcher sai com um exit code sentinela (`10` restart, `11` update, `0`
stop) e o **supervisor** reage:

| exit | supervisor faz |
|------|----------------|
| `0`  | encerra também (parada intencional) |
| `10` | respawn do launcher, sem tocar no código |
| `11` | `git fetch` + `merge --ff-only` + `npm ci` (se o lock mudou) → respawn |
| outro | crash → respawn com backoff de 5s |

```
$ npm run bots
[supervisor] iniciando — launcher: backend/bot/start-trade-bots.js
[admin] API interna em http://127.0.0.1:4100 (health|info|log · token)
...saída dos bots...
```

Rodar o launcher sozinho (sem supervisor, sem restart/update): `npm run bots:nosup`.

Se nada disso estiver rodando, a API não existe — e é isso mesmo: o que é
administrado é **o bot**. O `npm start` (frontend + `backend/server.js`) não tem
e não precisa dessa API.

---

## 3. Arquivos

| Arquivo | Responsabilidade | Cuidado ao editar |
|---|---|---|
| `internalConfig.js` | Lê `INTERNAL_ADMIN_*` do `.env` da raiz. Exporta `internalConfig` (`enabled`, `host`, `port`, `token`, `repoRoot`, `logFile`). | `host` deve continuar com default `127.0.0.1`. Não trocar para `0.0.0.0`. |
| `gitInfo.js` | `getGitInfo()` → `{ available, branch, commit, commitFull, commitDate, subject, dirty }`. Roda `git` via `execFileSync` com `cwd = repoRoot`, cache de 15s, timeout 4s. Erro → `{ available:false, error }`. | Manter tolerante a falha (git ausente do PATH, não é repo). Nunca deixar lançar. |
| `botLog.js` | Espelha stdout/stderr dos bots filhos → console **+** `backend/data/bot/launcher.log`. Rotação por tamanho (2 MB, mantém `launcher.log.1`). `tail(n)` lê `.1` + atual. `pipeChildOutput(stream, {label, target})`, `writeLine`, `close`. | Log nunca pode derrubar o launcher — tudo em `try/catch`. Não aumentar `MAX_BYTES` sem pensar em disco no Termux. |
| `internalServer.js` | `startInternalAdminServer(getState, { onControl })` → `http.Server`. GET `/internal/health\|info\|log` + POST `/internal/restart\|update\|stop\|pull`. Auth: loopback obrigatório + `X-Internal-Token` se `token` setado; POST exige também `INTERNAL_ADMIN_ALLOW_CONTROL=true`. `server.on('error')` só loga (não derruba). | Ver invariantes de segurança abaixo. POST NUNCA roda git/npm/shell — só `botControl.setPending()` + `onControl()`. |
| `botControl.js` | Estado da intenção de controle (`backend/data/bot/control-action.json`: `pending` / `last`), exit codes sentinela (`EXIT = {STOP:0, RESTART:10, UPDATE:11}`), `dryRunPull()` (roda no launcher, não reinicia) e `runUpdate()` (roda no **supervisor**: `git fetch` → `merge --ff-only` → `npm ci` condicional). | Sequência de update é FIXA. Nada de `reset --hard`, build, comando arbitrário. `runUpdate` recusa working tree sujo. |
| `README.md` | Este arquivo. | — |

### `bots-supervisor.js` (novo — `backend/bot/`)

Processo pai, entrypoint do `npm run bots`. Spawn do launcher; no `exit`
interpreta o code sentinela (ver tabela na seção 2). `runUpdate()` roda aqui, com
os bots já parados. Encaminha `SIGINT`/`SIGTERM` pro launcher. Loga tudo com
prefixo `[supervisor]` no `launcher.log` (aparece no `/admin/log`). Grava o
resultado do update em `botControl.recordResult()`.
Override de teste: `BOTS_LAUNCHER_SCRIPT` troca o script do launcher.

**Avisos no WhatsApp** (`require('./whatsapp').sendWhatsApp`, best-effort, nunca
derruba o supervisor): resultado do `/update` (OK `X → Y` / FALHOU + motivo /
já-atualizado), `/stop`, e crash-loop do launcher (`CRASH_ALERT_AFTER = 3` quedas
com < 60s de vida cada; depois a cada 12). O `/stop` espera o envio (timeout 4s)
antes do `process.exit`.

### linha de status no prompt (launcher)

Todo start do `start-trade-bots.js` imprime **uma** linha dizendo o que foi —
lê `botControl.readState().last` (só se a ação foi há < 120s):
`>> njs-lets-trade launcher vX` (start normal) · `>> ATUALIZADO via /update A -> B` ·
`>> /update FALHOU (...)` · `>> REINICIADO via /restart`. Sem emoji (Termux não
renderiza alguns). Se **todos** os bots desistirem (`MAX_RESTARTS`), o launcher
sai `1` pro supervisor tentar do zero (e alertar no crash-loop).

### `start-trade-bots.js` (launcher — modificado)

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
- `onControl(action)` passado pro `startInternalAdminServer`: em `restart`/`update`/
  `stop` faz `shutdown()` e `process.exit(EXIT[action])` (com 1,2s de folga pro
  SIGTERM chegar nos filhos). É só isso — o trabalho pesado é do supervisor.

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
  "lines": ["[RSI Momentum] 12:20:01 sinal BTCUSDT ...", "[supervisor] ..."]
}
```
- `lines` default 100, teto 2000.
- Cada linha vem prefixada com `[<label do bot>]` (ou `[supervisor]` / `[launcher]`).

Novos campos no `/internal/info`:
- `controlEnabled` — `true` se `token` setado E `INTERNAL_ADMIN_ALLOW_CONTROL=true`.
- `pendingAction` — `{ action, at, by }` enquanto um restart/update está em curso, senão `null`.
- `lastAction` — resultado do último controle: `{ action, at, ok, fromCommit?, toCommit?, updated?, npmRan?, error? }`.

### Controle — `POST /internal/{restart,update,stop,pull}`

Só respondem `202`/`200` se **`token` configurado + `X-Internal-Token` correto +
`INTERNAL_ADMIN_ALLOW_CONTROL=true`**. Senão `403`. Header opcional
`X-Requested-By` (ex.: número do WhatsApp) vai pro `pendingAction.by`.

| rota | efeito | resposta |
|---|---|---|
| `POST /internal/restart` | launcher sai com `10` → supervisor respawn | `202 { ok, action:"restart" }` |
| `POST /internal/update`  | launcher sai com `11` → supervisor `git pull` + `npm ci` (auto) + respawn | `202 { ok, action:"update", message }` |
| `POST /internal/stop`    | launcher sai com `0` → supervisor encerra também | `202 { ok, action:"stop" }` |
| `POST /internal/pull`    | dry-run: `git fetch` + diff, **não** reinicia | `200 { ok, behind, ahead, dirty, commits:[...] }` |

Sem supervisor (`bots:nosup`), restart/update respondem `503` (o exit code
não teria quem reagir). `pull` funciona sempre.

---

## 5. Invariantes de segurança — NÃO QUEBRAR

1. **Bind só em loopback.** `internalConfig.host` default `127.0.0.1`. A API não
   pode escutar em `0.0.0.0` / IP de rede.
2. **`authorized(req)` roda em TODA request** — checa IP loopback e, se houver
   `token`, o header `X-Internal-Token`.
3. **GET é sempre leitura.** Mutação só via os 4 `POST /internal/*` de controle,
   e cada um exige `token` + `INTERNAL_ADMIN_ALLOW_CONTROL=true` (loopback sozinho
   NÃO basta pra mutação).
4. **A API não executa nada.** Nenhum `git`/`npm`/`exec`/`spawn`/`shell` dentro de
   `internalServer.js`. O `POST` só grava a intenção (`botControl.setPending`) e
   chama `onControl` (que faz `process.exit(code)`). Quem roda `git pull`/`npm ci`
   é o supervisor, e **só a sequência fixa** de `botControl.runUpdate` — sem
   `reset --hard`, sem build, sem comando vindo do request. `runUpdate` recusa
   working tree sujo.
5. **Nunca vazar segredo** no `/internal/info` (`.env`, chave de corretora,
   token, dados de carteira).
6. Falha de git, disco ou porta ocupada **não pode derrubar o launcher, o
   supervisor nem os bots** — sempre `try/catch` / `on('error')`. Update que
   falha → supervisor sobe os bots com o código atual e reporta em `lastAction`.

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

**Adicionar uma ação de controle nova:** o padrão é sempre "API grava intenção →
launcher sai com code → supervisor executa". Nunca rode o comando dentro de
`internalServer.js`. Se a ação não precisa reiniciar (tipo o `pull`), pode rodar
no launcher, mas então tem que ser leitura pura (nada que altere working tree ou
`node_modules`).

**O que NÃO adicionar:** `POST /internal/exec`, `/internal/shell`, update que
aceite branch/ref/comando do request, `git reset --hard`, build no Termux.
A sequência de `runUpdate` é fixa por segurança.

---

## 7. Configuração (`.env` na raiz do `njs-lets-trade`)

```
INTERNAL_ADMIN_ENABLED=true          # false desliga a API (bots continuam)
INTERNAL_ADMIN_HOST=127.0.0.1
INTERNAL_ADMIN_PORT=4100
INTERNAL_ADMIN_TOKEN=<segredo>       # igual ao LETS_TRADE_INTERNAL_TOKEN do njs-whatsapp
INTERNAL_ADMIN_ALLOW_CONTROL=true    # libera POST restart/update/stop/pull (precisa do TOKEN)
INTERNAL_ADMIN_UPDATE_NPM=auto       # auto (npm ci só se o lock mudou) | always | never
# INTERNAL_ADMIN_GIT_REMOTE=origin
# INTERNAL_ADMIN_GIT_BRANCH=         # default: branch atual do checkout
# INTERNAL_ADMIN_LOG_FILE=           # opcional, default backend/data/bot/launcher.log
```

Lado `njs-whatsapp` (`.env` dele) — tem que casar:
```
LETS_TRADE_INTERNAL_URL=http://127.0.0.1:4100
LETS_TRADE_INTERNAL_TOKEN=<mesmo segredo>
```

`INTERNAL_ADMIN_ALLOW_CONTROL` é opt-in: com ele `false` (ou sem token) a API
volta a ser 100% leitura e os `POST` dão `403`.

`launcher.log` fica em `backend/data/`, que já é ignorado pelo `.gitignore`.

---

## 8. Testar

```bash
# terminal 1
npm run bots

# terminal 2  (com token configurado, TODA rota exige o header)
curl -s -H "X-Internal-Token: <token>" http://127.0.0.1:4100/internal/health
curl -s -H "X-Internal-Token: <token>" http://127.0.0.1:4100/internal/info
curl -s -H "X-Internal-Token: <token>" "http://127.0.0.1:4100/internal/log?lines=20"
curl -s http://127.0.0.1:4100/internal/health    # deve dar 403 (sem token)
curl -s -H "X-Internal-Token: errado" http://127.0.0.1:4100/internal/info   # 403

# controle (precisa ALLOW_CONTROL=true)
curl -s -X POST -H "X-Internal-Token: <token>" http://127.0.0.1:4100/internal/pull      # dry-run
curl -s -X POST -H "X-Internal-Token: <token>" -H "X-Requested-By: 5561..." \
     http://127.0.0.1:4100/internal/restart
curl -s -X POST -H "X-Internal-Token: <token>" http://127.0.0.1:4100/internal/update
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
- **`/internal/update` responde `working tree sujo`**: no Termux o repo tem que
  ser pull-only. `frontend-react/dist` é versionado — NÃO rode `npm run build`
  lá. Se sujou, `git stash` / `git checkout -- .` antes de tentar de novo.
- **`npm ci` no update trava/demora**: é normal no Termux quando o
  `package-lock.json` muda. `INTERNAL_ADMIN_UPDATE_NPM=never` pula (aí você roda
  `npm ci` na mão quando precisar). Timeout interno de 10 min.
- **update falhou no meio**: o merge é `--ff-only` (nunca deixa a árvore num
  estado meio-mergeado); se o `npm ci` falhar, o código já é o novo mas pode
  faltar dependência — `lastAction.error` diz, e os bots podem entrar em loop de
  restart até você rodar `npm ci` no Termux.
- **restart/update sem supervisor**: `bots:nosup` não tem quem reaja ao
  exit code — os POST respondem `503`. Use `npm run bots` (com supervisor).
