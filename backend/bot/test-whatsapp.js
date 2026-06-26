'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getWhatsAppEnvConfig, isWhatsAppApiConfigured } = require('./whatsappEnv');
const { sendText, getStatus } = require('./whatsappApiClient');

if (isWhatsAppApiConfigured()) {
  const cfg = getWhatsAppEnvConfig();
  console.log('🔄 Teste WhatsApp — cliente HTTP (serviço externo)');
  console.log(`   Serviço : ${cfg.baseUrl}`);
  console.log(`   API_KEY : ${cfg.apiKey.slice(0, 2)}*** (do .env)`);
  console.log(`   Para    : ${cfg.to} (WA_OWNER_NUMBER)\n`);

  (async () => {
    try {
      const status = await getStatus();
      console.log('📡 Status do serviço:', JSON.stringify(status, null, 2));
    } catch (err) {
      console.warn(`⚠️  /status indisponível: ${err.message}`);
    }

    await sendText(
      '✅ Teste 5m Trade / RSI Bot\nWhatsApp API conectado e funcionando!',
    );
    console.log('✅ Mensagem enviada via POST /messages/send');
    process.exit(0);
  })().catch(err => {
    console.error(`❌ Erro: ${err.message}`);
    process.exit(1);
  });
} else {
  const path    = require('path');
  const qrcode  = require('qrcode-terminal');
  const { getWhatsAppNotifyNumber } = require('./whatsappEnv');

  const rawNumber   = getWhatsAppNotifyNumber() || '5561999171222';
  const JID         = rawNumber.includes('@') ? rawNumber : `${rawNumber}@s.whatsapp.net`;
  const USE_PAIRING = process.env.WHATSAPP_PAIRING_CODE !== 'false';
  const AUTH_DIR    = path.join(__dirname, '../../.baileys_auth');

  console.log('🔄 Iniciando cliente WhatsApp (Baileys)...');
  console.log(`   Número destino : ${rawNumber}`);
  console.log(`   Modo           : ${USE_PAIRING ? 'código de pareamento' : 'QR code'}`);
  console.log(`   Sessão salva   : ${AUTH_DIR}`);
  console.log('   Dica: defina WHATSAPP_API_URL para usar o serviço HTTP\n');

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

    const sock = makeWASocket({ version, auth: state, logger });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (USE_PAIRING && !sock.authState.creds.registered) {
          try {
            const code = await sock.requestPairingCode(rawNumber);
            console.log(`📱 Código de pareamento: ${code}`);
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
        console.log('✅ WhatsApp conectado! Enviando mensagem de teste...');
        try {
          await sock.sendMessage(JID, { text: '✅ Teste do bot\nWhatsApp (Baileys) conectado e funcionando!' });
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
}
