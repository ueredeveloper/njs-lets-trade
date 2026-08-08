'use strict';

/**
 * Liga VWAP Bands + Bollinger Bands de uma vez só — pensado pro Termux, pra não precisar
 * abrir duas sessões/telas separadas (uma pra cada bot).
 *
 * Cada bot roda no PRÓPRIO processo filho (spawn), não no mesmo processo Node — assim um
 * erro fatal (ex.: env do Supabase ausente, exceção não tratada) que mataria o processo só
 * derruba aquele bot; o outro continua rodando normalmente. Se um filho cair, o launcher
 * tenta subir ele de novo sozinho (com um limite, pra não entrar em loop de restart).
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

const BOTS = [
  { label: 'VWAP Bands',      script: path.join(__dirname, 'vwap-bands', 'vwap-bands-bot.js') },
  { label: 'Bollinger Bands', script: path.join(__dirname, 'bollinger-bands', 'bollinger-bands-bot.js') },
];

const MAX_RESTARTS = 3;
const extraArgs = process.argv.slice(2);

function startBot(bot, restarts = 0) {
  const child = spawn(process.execPath, [bot.script, ...extraArgs], { stdio: 'inherit' });
  bot.child = child;

  child.on('exit', (code, signal) => {
    bot.child = null;
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

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
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
