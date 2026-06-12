'use strict';

const path   = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const rawNumber     = process.env.WHATSAPP_NOTIFY_NUMBER || '5561999171222';
const NOTIFY_NUMBER = rawNumber.includes('@') ? rawNumber : `${rawNumber}@c.us`;

// WHATSAPP_PAIRING_CODE=true no .env → usa código de 8 dígitos (ideal para Termux)
const USE_PAIRING = process.env.WHATSAPP_PAIRING_CODE === 'true';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '../../.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

let ready    = false;
let chatId   = null; // resolvido via getNumberId no ready
// Mensagens enviadas antes do ready — entregues assim que conectar
const pendingQueue = [];

client.on('qr', async qr => {
  if (USE_PAIRING) {
    try {
      const code = await client.requestPairingCode(rawNumber);
      console.log(`\n📱 Código de pareamento WhatsApp: ${code}`);
      console.log('   No WhatsApp → Configurações → Dispositivos conectados → Conectar um dispositivo → Conectar com número de telefone\n');
    } catch (err) {
      console.warn(`⚠️  requestPairingCode falhou: ${err.message}`);
    }
  } else {
    console.log('\n📱 WhatsApp — escaneie o QR code com seu celular:\n');
    qrcode.generate(qr, { small: true });
  }
});

client.on('ready', async () => {
  ready = true;
  console.log('✅ WhatsApp conectado.');

  try {
    const numId = await client.getNumberId(rawNumber);
    chatId = numId ? numId._serialized : NOTIFY_NUMBER;
    console.log(`📱 Chat ID resolvido: ${chatId}`);
  } catch {
    chatId = NOTIFY_NUMBER;
  }

  const allMsgs = [`🤖 Bot RSI Trade iniciado`, ...pendingQueue.splice(0)];
  for (const msg of allMsgs) {
    try {
      await client.sendMessage(chatId, msg);
      console.log(`📤 WhatsApp enviado: ${msg.split('\n')[0]}`);
    } catch (err) {
      console.warn(`⚠️  WhatsApp send falhou: ${err.message}`);
    }
  }
});

client.on('auth_failure', msg => {
  console.warn(`⚠️  WhatsApp autenticação falhou: ${msg}`);
});

client.on('disconnected', reason => {
  ready = false;
  console.warn(`⚠️  WhatsApp desconectado: ${reason}`);
});

client.initialize().catch(err => {
  console.warn(`⚠️  WhatsApp init falhou: ${err.message}`);
});

async function sendWhatsApp(message) {
  if (!ready || !chatId) {
    pendingQueue.push(message);
    console.warn('⏳ WhatsApp ainda conectando — mensagem em fila:', message.split('\n')[0]);
    return;
  }
  try {
    await client.sendMessage(chatId, message);
  } catch (err) {
    console.warn(`⚠️  WhatsApp send falhou: ${err.message}`);
  }
}

module.exports = { sendWhatsApp };
