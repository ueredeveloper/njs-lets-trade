'use strict';

/**
 * Launcher dos bots de trade — pensado pro Termux, pra não precisar abrir uma sessão/tela
 * por bot. Hoje sobe só o RSI Momentum (Bollinger Bands saiu em v1.135.6, VWAP Bands e
 * Ignição de Volume em v1.111.7 — usuário não usa nenhum; reative na lista BOTS se voltar).
 *
 * Cada bot roda no PRÓPRIO processo filho (spawn), não no mesmo processo Node — assim um
 * erro fatal (ex.: env do Supabase ausente, exceção não tratada) que mataria o processo só
 * derruba aquele bot; os outros continuam. Se um filho cair, o launcher tenta subir ele de
 * novo sozinho (com um limite, pra não entrar em loop de restart).
 *
 * Este launcher também sobe a API interna de administração (backend/admin/internalServer.js,
 * só loopback) — é ela que o njs-whatsapp consulta pra responder /admin/status, /admin/health
 * e /admin/log no WhatsApp. O stdout/stderr dos filhos é espelhado no console E gravado no
 * log combinado (backend/admin/botLog.js) que o /admin/log lê.
 *
 * Uso:
 *   node backend/bot/start-trade-bots.js
 *   node backend/bot/start-trade-bots.js --symbol BTCUSDT   (repassado pros bots)
 *
 * Ou via package.json:
 *   npm run bots
 */

const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const botLog = require('../admin/botLog');
const { startInternalAdminServer } = require('../admin/internalServer');
const botControl = require('../admin/botControl');
const { EXIT: CONTROL_EXIT } = botControl;

// Resquício de `pendingAction` de um crash no meio de um restart/update.
botControl.clearStalePending();

// Uma linha no prompt a cada start do launcher, dizendo O QUE aconteceu: start
// normal, ou reinício/atualização via /restart|/update recente (< 120s) — lê
// botControl.readState().last. Sem emoji (alguns não renderizam no Termux).
{
  const v = require('../../package.json').version;
  const last = botControl.readState().last;
  const ageS = last?.at ? (Date.now() - Date.parse(last.at)) / 1000 : Infinity;
  const recent = last && ageS < 120;
  let line;
  if (recent && last.action === 'update' && last.ok !== false) {
    line = `>> ATUALIZADO via /update  ${last.fromCommit} -> ${last.toCommit}  (agora na v${v})`;
  } else if (recent && last.action === 'update') {
    line = `>> /update FALHOU (${last.error}) — rodando com o codigo anterior, v${v}`;
  } else if (recent && last.action === 'sync-lock' && last.ok !== false) {
    line = last.committed
      ? `>> LOCK SINCRONIZADO via /sync-lock  commit ${last.toCommit}${last.pushed ? ' (push OK)' : ' (commit LOCAL, sem push)'}  v${v}`
      : `>> /sync-lock: package-lock.json ja estava sincronizado, v${v}`;
  } else if (recent && last.action === 'sync-lock') {
    line = `>> /sync-lock FALHOU (${last.error}) — v${v}`;
  } else if (recent && last.action === 'restart') {
    line = `>> REINICIADO via /restart  (codigo inalterado, v${v})`;
  } else {
    line = `>> njs-lets-trade launcher v${v}`;
  }
  console.log(line);
  try { botLog.writeLine(`[launcher] ${line}`); } catch { /* nunca derruba o launcher */ }
}

const LAUNCHER_STARTED_AT = Date.now();

const BOTS = [
  { label: 'RSI Momentum',     script: path.join(__dirname, 'rsi-momentum', 'rsi-momentum-bot.js') },
  // Bollinger Bands saiu da lista (v1.135.6) — usuário não usa. Reative aqui se voltar:
  // { label: 'Bollinger Bands',  script: path.join(__dirname, 'bollinger-bands', 'bollinger-bands-bot.js') },
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
      // Se NENHUM bot está mais de pé, não faz sentido o launcher virar zumbi: sai
      // não-zero pro supervisor tentar do zero (e alertar no WhatsApp se insistir).
      if (BOTS.every((b) => !b.running) && !shuttingDown) {
        console.error('❌ todos os bots desistiram — encerrando o launcher (o supervisor reinicia).');
        shutdown();
        setTimeout(() => process.exit(1), 800);
      }
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

// Controle remoto (via API interna → njs-whatsapp): restart/update/stop/sync-lock
// viram um exit code sentinela que o supervisor (bots-supervisor.js) interpreta.
// Este processo NÃO roda git/npm — só encerra os filhos com carinho e sai.
function onControl(action) {
  if (shuttingDown) return { ok: false, message: 'já encerrando' };
  // 'sync-lock' → chave EXIT.SYNC_LOCK
  const code = CONTROL_EXIT[String(action).toUpperCase().replace(/-/g, '_')];
  if (code == null) return { ok: false, message: `ação desconhecida: ${action}` };
  const label = {
    stop: 'PARAR', restart: 'REINICIAR', update: 'ATUALIZAR', 'sync-lock': 'SINCRONIZAR LOCK',
    'restart-supervisor': 'REINICIAR SUPERVISOR',
  }[action] || action;
  console.log(`\n🛰️  [launcher] controle recebido: ${label} → encerrando (exit ${code})`);
  botLog.writeLine(`[launcher] controle: ${label} (exit ${code})`);
  shutdown();
  // dá um tempo pro SIGTERM chegar nos filhos antes de matar o processo
  setTimeout(() => process.exit(code), 1200);
  return { ok: true, action, message: `'${action}' aceito` };
}

// restart/update só fazem sentido sob o supervisor (bots-supervisor.js), que é
// quem reage ao exit code. Rodando o launcher direto (`bots:nosup`), os
// POST de controle respondem 503.
const supervised = process.env.BOTS_SUPERVISED === '1';
const adminServer = startInternalAdminServer(
  getLauncherState,
  supervised ? { onControl } : {},
);

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
