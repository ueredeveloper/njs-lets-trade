# WhatsApp — cliente HTTP (serviço externo na porta 3005)

**Este repositório não roda o serviço WhatsApp.** Outro processo deve estar ativo em `http://localhost:3005` (pareamento, sessão, `AUTH_FOLDER`, etc.). Os bots só enviam mensagens via HTTP.

Fluxo: `5min-trade-bot` → `sendWhatsApp()` → `POST http://localhost:3005/messages/send`

---

## `.env` do bot (cliente)

Copie do serviço WhatsApp apenas o que o bot precisa:

```env
API_KEY=udveobdc
WA_OWNER_NUMBER=5561999171222
```

| Variável | Uso neste projeto |
|----------|-------------------|
| `API_KEY` (ou `WHATSAPP_API_KEY`) | Header `X-Api-Key` |
| `WA_OWNER_NUMBER` (ou `WHATSAPP_NOTIFY_NUMBER`) | Campo `{ to }` |
| `WHATSAPP_API_URL` | Opcional — padrão `http://localhost:3005` |
| `WHATSAPP_PORT` | Porta do serviço externo — padrão `3005` |

**Não use `PORT` neste `.env`** — essa variável era do outro projeto e conflitava com o Express. Backend usa `BACKEND_PORT` (padrão `3000`).

Variáveis **ignoradas** aqui (só no serviço WhatsApp): `AUTH_FOLDER`, `AUTO_RECONNECT`, `WEBHOOK_URL`, `LOG_LEVEL`.

---

## Endpoints chamados pelo bot (serviço já rodando)

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/status` | Teste de conexão (`test-whatsapp.js`) |
| POST | `/messages/send` | Compra, venda, PnL (`X-Api-Key` + `{ to, text }`) |

### Testar (serviço WhatsApp já em execução na 3005)

```cmd
node backend/bot/test-whatsapp.js
```

### Exemplo manual

```js
fetch('http://localhost:3005/messages/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': 'minha-chave-secreta',
  },
  body: JSON.stringify({ to: '5561999171222', text: 'Olá!' }),
});
```

---

## Modo Baileys (legado)

Sem `WHATSAPP_API_URL`, o bot conecta direto via `@whiskeysockets/baileys`.
A sessão é salva em `.baileys_auth/` na raiz do projeto.

### Configuração no `.env`

```env
WHATSAPP_NOTIFY_NUMBER=5561999171222   # número SEM + e SEM espaços (com DDD e DDI)
WHATSAPP_PAIRING_CODE=true             # true = código numérico | false = QR code no terminal
```

---

## Primeira conexão Baileys (ou reconexão após logout)

### 1. Apagar sessão anterior

```cmd
rmdir /s /q .baileys_auth
```

> Se a pasta não existir, pule este passo.

### 2. Rodar o script de teste

```cmd
node backend/bot/test-whatsapp.js
```

### 3. Parear o celular

O terminal exibe um código no formato `ABCD-1234`:

```
📱 Código de pareamento: ABCD-1234
   WhatsApp → Configurações → Dispositivos conectados → Conectar → Número de telefone
```

No celular (com o número definido em `WHATSAPP_NOTIFY_NUMBER`):

```
WhatsApp → ⋮ (três pontos) → Dispositivos conectados
→ Conectar um dispositivo → Conectar com número de telefone
→ Digitar o código exibido no terminal
```

### 4. Confirmação

```
✅ WhatsApp conectado! Enviando mensagem de teste...
✅ Mensagem enviada com sucesso!
```

A mensagem de teste chega no próprio celular pareado.

---

## Alternativa: QR code

Para usar QR code em vez de código numérico, defina no `.env`:

```env
WHATSAPP_PAIRING_CODE=false
```

Um QR aparece diretamente no terminal — escaneie com o WhatsApp:

```
WhatsApp → ⋮ → Dispositivos conectados → Conectar um dispositivo → Escanear QR
```

---

## Arquivos relevantes

| Arquivo | Descrição |
|---|---|
| `backend/bot/whatsapp.js` | Módulo principal — conecta, reconecta e expõe `sendWhatsApp()` |
| `backend/bot/test-whatsapp.js` | Script isolado para testar pareamento e envio |
| `.baileys_auth/` | Sessão salva (gerada automaticamente após parear) |

---

## Erros comuns

### Sessão expirada / desconectado após reinício

```
⚠️  WhatsApp desconectado (401). Sessão encerrada — apague .baileys_auth e reinicie.
```

**Solução:** apague `.baileys_auth/` e refaça o pareamento (passos acima).

---

### Pacote não instalado

```
Cannot find package '@whiskeysockets/baileys'
```

**Solução:**

```cmd
npm install
```

---

### Código de pareamento não aparece

Ocorre quando a sessão anterior ainda está em `.baileys_auth/` e o Baileys tenta
reutilizá-la sem sucesso. Apague a pasta e rode novamente.

---

## Uso no bot

O `rsiTradeBot.js` importa `sendWhatsApp` de `whatsapp.js`. A conexão é iniciada
automaticamente quando o bot sobe. Mensagens enviadas antes da conexão ficar pronta
entram em fila (até 50 mensagens) e são disparadas assim que o WhatsApp conectar.
