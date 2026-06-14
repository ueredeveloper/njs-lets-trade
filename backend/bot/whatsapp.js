'use strict';

const path   = require('path');
const qrcode = require('qrcode-terminal');

// Suprime console.log internos do Baileys (Signal Protocol session noise)
const _origLog = console.log;
console.log = (...args) => {
  const first = args[0];
  if (typeof first === 'string' && (
    first.startsWith('Closing session') ||
    first.startsWith('Removing old closed session')
  )) return;
  _origLog(...args);
};

const rawNumber = process.env.WHATSAPP_NOTIFY_NUMBER || '5561999171222';
// Baileys usa @s.whatsapp.net (diferente do @c.us do whatsapp-web.js)
const JID = rawNumber.includes('@') ? rawNumber : `${rawNumber}@s.whatsapp.net`;

// false = mostra QR no terminal; true = código de pareamento (padrão — funciona no Termux)
const USE_PAIRING = process.env.WHATSAPP_PAIRING_CODE !== 'false';

const AUTH_DIR = path.join(__dirname, '../../.baileys_auth');

let sock  = null;
let ready = false;
const pendingQueue = [];
const MAX_QUEUE    = 50; // descarta mensagens antigas se WhatsApp ficar offline muito tempo

// Logger silencioso — usa pino se disponível (dependência do Baileys), senão stub
let logger;
try {
  const pino = require('pino');
  logger = pino({ level: 'silent' });
} catch {
  logger = {
    level: 'silent',
    trace: () => {}, debug: () => {}, info: () => {},
    warn:  () => {}, error: () => {}, fatal: () => {},
    child: function () { return this; },
  };
}

async function connect() {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
  } = await import('@whiskeysockets/baileys');

  const { state, saveCreds }  = await useMultiFileAuthState(AUTH_DIR);
  const { version }           = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, logger });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (USE_PAIRING && !sock.authState.creds.registered) {
        try {
          const code = await sock.requestPairingCode(rawNumber);
          console.log(`\n📱 Código de pareamento WhatsApp: ${code}`);
          console.log('   WhatsApp → Dispositivos conectados → Conectar → Número de telefone\n');
        } catch (err) {
          console.warn(`⚠️  requestPairingCode falhou: ${err.message}`);
        }
      } else {
        console.log('\n📷 Escaneie o QR code abaixo com o WhatsApp:\n');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'open') {
      ready = true;
      console.log('✅ WhatsApp conectado.');
      const allMsgs = [`🤖 Bot RSI Trade iniciado`, ...pendingQueue.splice(0)];
      for (const msg of allMsgs) {
        try {
          await sock.sendMessage(JID, { text: msg });
          console.log(`📤 WhatsApp enviado: ${msg.split('\n')[0]}`);
        } catch (err) {
          console.warn(`⚠️  WhatsApp send falhou: ${err.message}`);
        }
      }
    }

    if (connection === 'close') {
      ready = false;
      const code      = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.warn(`⚠️  WhatsApp desconectado (${code}). ${loggedOut ? 'Sessão encerrada — apague .baileys_auth e reinicie.' : 'Reconectando...'}`);
      if (!loggedOut) setTimeout(connect, 5000);
    }
  });
}

async function connectWithRetry() {
  try {
    await connect();
  } catch (err) {
    console.warn(`⚠️  WhatsApp init falhou: ${err.message} — tentando novamente em 30s`);
    setTimeout(connectWithRetry, 30_000);
  }
}

connectWithRetry();

async function sendWhatsApp(message) {
  if (!ready || !sock) {
    if (pendingQueue.length < MAX_QUEUE) pendingQueue.push(message);
    console.warn('⏳ WhatsApp offline — mensagem em fila:', message.split('\n')[0]);
    return;
  }
  try {
    await sock.sendMessage(JID, { text: message });
  } catch (err) {
    console.warn(`⚠️  WhatsApp send falhou: ${err.message}`);
  }
}

module.exports = { sendWhatsApp };
