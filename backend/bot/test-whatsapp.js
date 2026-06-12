'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');

const rawNumber = process.env.WHATSAPP_NOTIFY_NUMBER || '5561999171222';
const JID       = rawNumber.includes('@') ? rawNumber : `${rawNumber}@s.whatsapp.net`;
const USE_PAIRING = process.env.WHATSAPP_PAIRING_CODE !== 'false';
const AUTH_DIR  = path.join(__dirname, '../../.baileys_auth');

console.log('🔄 Iniciando cliente WhatsApp (Baileys)...');
console.log(`   Número destino : ${rawNumber}`);
console.log(`   Modo           : ${USE_PAIRING ? 'código de pareamento' : 'QR code'}`);
console.log(`   Sessão salva   : ${AUTH_DIR}\n`);

const logger = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {},
  warn:  () => {}, error: () => {}, fatal: () => {},
  child: function () { return this; },
};

(async () => {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
  } = await import('@whiskeysockets/baileys');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({ version, auth: state, printQRInTerminal: !USE_PAIRING, logger });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && USE_PAIRING && !sock.authState.creds.registered) {
      try {
        const code = await sock.requestPairingCode(rawNumber);
        console.log(`📱 Código de pareamento: ${code}`);
        console.log('   WhatsApp → Configurações → Dispositivos conectados → Conectar → Número de telefone\n');
      } catch (err) {
        console.warn(`⚠️  requestPairingCode falhou: ${err.message}`);
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp conectado! Enviando mensagem de teste...');
      try {
        await sock.sendMessage(JID, { text: '✅ Teste do bot RSI Trade\nWhatsApp (Baileys) conectado e funcionando!' });
        console.log('✅ Mensagem enviada com sucesso!');
      } catch (err) {
        console.error(`❌ Erro ao enviar: ${err.message}`);
      }
      setTimeout(() => process.exit(0), 3000);
    }

    if (connection === 'close') {
      const code      = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      if (loggedOut) {
        console.error('❌ Sessão encerrada — apague .baileys_auth e rode novamente.');
        process.exit(1);
      }
    }
  });
})().catch(err => {
  console.error(`❌ Erro ao inicializar: ${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  console.error('\n❌ Timeout: cliente não ficou pronto em 2 minutos.');
  process.exit(1);
}, 120_000);
