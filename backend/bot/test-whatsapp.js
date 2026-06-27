'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getWhatsAppEnvConfig, isWhatsAppApiConfigured } = require('./whatsappEnv');
const { sendText, getStatus } = require('./whatsappApiClient');

if (!isWhatsAppApiConfigured()) {
  console.error('❌ WhatsApp não configurado. Defina API_KEY e WHATSAPP_NOTIFY_NUMBER no .env');
  process.exit(1);
}

const cfg = getWhatsAppEnvConfig();
console.log('🔄 Teste WhatsApp — cliente HTTP (serviço externo :3005)');
console.log(`   Serviço : ${cfg.baseUrl}`);
console.log(`   API_KEY : ${cfg.apiKey.slice(0, 2)}***`);
console.log(`   Para    : ${cfg.to}\n`);

(async () => {
  try {
    const status = await getStatus();
    console.log('📡 Status do serviço:', JSON.stringify(status, null, 2));
  } catch (err) {
    console.warn(`⚠️  /status indisponível: ${err.message}`);
  }

  await sendText('✅ Teste\nWhatsApp API conectado e funcionando!');
  console.log('✅ Mensagem enviada via POST /messages/send');
  process.exit(0);
})().catch(err => {
  console.error(`❌ Erro: ${err.message}`);
  process.exit(1);
});
