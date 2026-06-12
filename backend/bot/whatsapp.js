'use strict';

const path   = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const rawNumber  = process.env.WHATSAPP_NOTIFY_NUMBER || '5561999171222';
const NOTIFY_NUMBER = rawNumber.includes('@') ? rawNumber : `${rawNumber}@c.us`;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '../../.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

let ready = false;

client.on('qr', qr => {
  console.log('\n📱 WhatsApp — escaneie o QR code com seu celular:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  ready = true;
  console.log('✅ WhatsApp conectado.');
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
  if (!ready) return;
  try {
    await client.sendMessage(NOTIFY_NUMBER, message);
  } catch (err) {
    console.warn(`⚠️  WhatsApp send falhou: ${err.message}`);
  }
}

module.exports = { sendWhatsApp };
