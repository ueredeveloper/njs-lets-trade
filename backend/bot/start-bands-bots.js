'use strict';

/**
 * Liga Bollinger Bands + RSI Momentum de uma vez só — pensado pro Termux, pra não precisar
 * abrir duas sessões/telas separadas (uma pra cada bot).
 *
 * VWAP Bands e Ignição de Volume saíram da lista (v1.111.7) — usuário não usa nenhum dos
 * dois no momento; tirar do launcher evita processo ocioso e sync de relógio desnecessário
 * a cada restart. Reative aqui se voltar a usar algum dos dois.
 *
 * Cada bot roda no PRÓPRIO processo filho (spawn), não no mesmo processo Node — assim um
 * erro fatal (ex.: env do Supabase ausente, exceção não tratada) que mataria o processo só
 * derruba aquele bot; o outro continua rodando normalmente. Se um filho cair, o launcher
 * tenta subir ele de novo sozinho (com um limite, pra não entrar em loop de restart).
 *
 * Este launcher também sobe a API interna de administração (backend/admin/internalServer.js,
 * só loopback) — é ela que o njs-whatsapp consulta pra responder /admin/status, /admin/health
 * e /admin/log no WhatsApp. O stdout/stderr dos filhos é espelhado no console E gravado no
 * log combinado (backend/admin/botLog.js) que o /admin/log lê.
 *
 * Uso:
 *   node backend/bot/start-bands-bots.js
 *   node backend/bot/start-bands-bots.js --symbol BTCUSDT   (repassado pros dois bots)
 *
 * Ou via package.json:
 *   npm run bots:bands
 */

const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const botLog = require('../admin/botLog');
const { startInternalAdminServer } = require('../admin/internalServer');

const LAUNCHER_STARTED_AT = Date.now();

const BOTS = [
  { label: 'Bollinger Bands',  script: path.join(__dirname, 'bollinger-bands', 'bollinger-bands-bot.js') },
  { label: 'RSI Momentum',     script: path.join(__dirname, 'rsi-momentum', 'rsi-momentum-bot.js') },
];

const MAX_RESTARTS = 3;
const extraArgs = process.argv.slice(2);

function startBot(bot, restarts = 0) {
  const child = spawn(process.execPath, [bot.script, ...extraArgs], {
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  bot.child = child;
  bot.pid = child.pid;
  bot.running = true;
  bot.restarts = restarts;
  bot.startedAt = Date.now();
  bot.lastExit = null;

  botLog.pipeChildOutput(child.stdout, { label: bot.label, target: 'stdout' });
  botLog.pipeChildOutput(child.stderr, { label: bot.label, target: 'stderr' });

  child.on('exit', (code, signal) => {
    bot.child = null;
    bot.pid = null;
    bot.running = false;
    bot.lastExit = { code, signal, at: new Date().toISOString() };
    if (shuttingDown) return;
    if (code === 0) return; // encerramento normal, não reinicia

    console.error(`⚠️  [${bot.label}] encerrou (code=${code}, signal=${signal})`);
    if (restarts >= MAX_RESTARTS) {
      console.error(`❌ [${bot.label}] atingiu o limite de ${MAX_RESTARTS} reinícios — desistindo.`);
      return;
    }
    console.error(`🔁 [${bot.label}] reiniciando (tentativa ${restarts + 1}/${MAX_RESTARTS})...`);
    setTimeout(() => startBot(bot, restarts + 1), 5000);
  });
}

// Snapshot pro internalServer — só dados de processo, nada de trading.
function getLauncherState() {
  return {
    startedAt: LAUNCHER_STARTED_AT,
    bots: BOTS.map((b) => ({
      label: b.label,
      pid: b.pid ?? null,
      running: !!b.running,
      restarts: b.restarts ?? 0,
      startedAt: b.startedAt ? new Date(b.startedAt).toISOString() : null,
      lastExit: b.lastExit ?? null,
    })),
  };
}

const adminServer = startInternalAdminServer(getLauncherState);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (adminServer) { try { adminServer.close(); } catch {} }
  botLog.close();
  for (const bot of BOTS) {
    if (!bot.child) continue;
    if (process.platform === 'win32') {
      try { require('child_process').execSync(`taskkill /PID ${bot.child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
    } else {
      bot.child.kill('SIGTERM');
    }
  }
}
process.on('SIGINT', () => { shutdown(); process.exit(); });
process.on('SIGTERM', () => { shutdown(); process.exit(); });
process.on('exit', shutdown);

for (const bot of BOTS) startBot(bot);
