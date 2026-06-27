'use strict';

const { getWhatsAppEnvConfig } = require('./whatsappEnv');
const { sendText } = require('./whatsappApiClient');

const cfg = getWhatsAppEnvConfig();
if (cfg) {
  console.log(`📱 WhatsApp → ${cfg.baseUrl} → ${cfg.to}`);
} else {
  console.warn('⚠️  WhatsApp: defina API_KEY e WHATSAPP_NOTIFY_NUMBER no .env');
}

async function sendWhatsApp(message) {
  try {
    await sendText(message);
    console.log(`📤 WhatsApp: ${String(message).split('\n')[0]}`);
  } catch (err) {
    console.warn(`⚠️  WhatsApp falhou: ${err.message}`);
  }
}

module.exports = { sendWhatsApp };
