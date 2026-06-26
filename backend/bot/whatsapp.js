'use strict';

/**
 * Envio de notificações WhatsApp.
 * Com API_KEY + WA_OWNER_NUMBER no .env → cliente HTTP (serviço :3005)
 */

const path = require('path');
const {
  isWhatsAppApiConfigured,
  getWhatsAppEnvConfig,
  getWhatsAppNotifyNumber,
  normalizePhone,
} = require('./whatsappEnv');
const { sendText: sendViaApi } = require('./whatsappApiClient');

const cfg = getWhatsAppEnvConfig();
if (cfg) {
  console.log(`📱 WhatsApp cliente → ${cfg.baseUrl} → ${cfg.to}`);
}

const rawNumber = getWhatsAppNotifyNumber() || '';
const JID = rawNumber.includes('@') ? rawNumber : `${normalizePhone(rawNumber)}@s.whatsapp.net`;

// ── Modo API HTTP (serviço externo) ───────────────────────────────────────────
if (isWhatsAppApiConfigured()) {
  async function sendWhatsApp(message) {
    try {
      await sendViaApi(message);
      console.log(`📤 WhatsApp API: ${String(message).split('\n')[0]}`);
    } catch (err) {
      console.warn(`⚠️  WhatsApp API falhou: ${err.message}`);
    }
  }

  module.exports = { sendWhatsApp, mode: 'api' };
} else {
  // ── Modo Baileys (legado) ───────────────────────────────────────────────────
  const _origLog = console.log;
  console.log = (...args) => {
    const first = args[0];
    if (typeof first === 'string' && (
      first.startsWith('Closing session') ||
      first.startsWith('Removing old closed session')
    )) return;
    _origLog(...args);
  };

  const USE_PAIRING = !!process.env.TERMUX_VERSION;
  const AUTH_DIR = path.join(__dirname, '../../.baileys_auth');
  const baileysNumber = getWhatsAppNotifyNumber() || '5561999171222';

  let sock  = null;
  let ready = false;
  const pendingQueue = [];
  const MAX_QUEUE    = 50;

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
        if (USE_PAIRING) {
          if (!sock.authState.creds.registered) {
            try {
              const code = await sock.requestPairingCode(baileysNumber);
              console.log(`\n📱 Código de pareamento WhatsApp: ${code}`);
              console.log('   WhatsApp → Dispositivos conectados → Conectar → Número de telefone\n');
            } catch (err) {
              console.warn(`⚠️  requestPairingCode falhou: ${err.message}`);
            }
          }
        } else {
          try {
            const qrcode = require('qrcode-terminal');
            console.log('\n📷 Escaneie o QR code abaixo com o WhatsApp:\n');
            qrcode.generate(qr, { small: true });
          } catch {
            console.log('\n📷 QR code (instale qrcode-terminal para renderizar):', qr);
          }
        }
      }

      if (connection === 'open') {
        ready = true;
        console.log('✅ WhatsApp conectado (Baileys).');
        const allMsgs = [`🤖 Bot iniciado`, ...pendingQueue.splice(0)];
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

  module.exports = { sendWhatsApp, mode: 'baileys' };
}
