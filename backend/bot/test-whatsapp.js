'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path   = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const rawNumber     = process.env.WHATSAPP_NOTIFY_NUMBER || '5561999171222';
const NOTIFY_NUMBER = rawNumber.includes('@') ? rawNumber : `${rawNumber}@c.us`;
const USE_PAIRING   = process.env.WHATSAPP_PAIRING_CODE === 'true';

console.log('🔄 Iniciando cliente WhatsApp...');
console.log(`   Número destino : ${NOTIFY_NUMBER}`);
console.log(`   Modo           : ${USE_PAIRING ? 'código de pareamento' : 'QR code'}`);
console.log(`   Sessão salva   : ${path.join(__dirname, '../../.wwebjs_auth')}\n`);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '../../.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('loading_screen', (percent) => {
  process.stdout.write(`\r⏳ Carregando WhatsApp Web... ${percent}%   `);
});

client.on('qr', async qr => {
  console.log('\n');
  if (USE_PAIRING) {
    try {
      const code = await client.requestPairingCode(rawNumber);
      console.log(`📱 Código de pareamento: ${code}`);
      console.log('   WhatsApp → Configurações → Dispositivos conectados → Conectar → Conectar com número de telefone\n');
    } catch (err) {
      console.warn(`⚠️  requestPairingCode falhou: ${err.message}`);
      console.log('   Exibindo QR como fallback:\n');
      qrcode.generate(qr, { small: true });
    }
  } else {
    console.log('📱 Sessão expirada — escaneie o QR code com seu celular:\n');
    qrcode.generate(qr, { small: true });
  }
});

client.on('authenticated', () => {
  console.log('\n✅ Autenticado!');
});

client.on('auth_failure', msg => {
  console.error(`\n❌ Falha na autenticação: ${msg}`);
  process.exit(1);
});

client.on('ready', async () => {
  console.log('✅ WhatsApp pronto! Enviando mensagem de teste...');
  try {
    await client.sendMessage(NOTIFY_NUMBER, '✅ Teste do bot RSI Trade\nWhatsApp conectado e funcionando!');
    console.log('✅ Mensagem enviada com sucesso!');
  } catch (err) {
    console.error(`❌ Erro ao enviar: ${err.message}`);
  }
  setTimeout(() => { client.destroy(); process.exit(0); }, 3000);
});

client.on('disconnected', reason => {
  console.warn(`\n⚠️  Desconectado: ${reason}`);
});

client.initialize().catch(err => {
  console.error(`\n❌ Erro ao inicializar: ${err.message}`);
  process.exit(1);
});

// Timeout de segurança: 2 minutos (tempo para escanear QR se necessário)
setTimeout(() => {
  console.error('\n❌ Timeout: cliente não ficou pronto em 2 minutos.');
  process.exit(1);
}, 120_000);
