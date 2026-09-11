'use strict';

/**
 * Supervisor do launcher dos bots — fica sempre vivo enquanto o launcher
 * (`start-trade-bots.js`) reinicia. É o entrypoint do `npm run bots`.
 *
 * Por que existe: o launcher não consegue se auto-atualizar com limpeza (trocaria
 * o próprio código em execução). Então ele apenas SAI com um exit code sentinela
 * e este processo pai faz o trabalho:
 *
 *   exit 0  (STOP)      → encerra o supervisor também (parada intencional)
 *   exit 10 (RESTART)   → sobe o launcher de novo, sem tocar no código
 *   exit 11 (UPDATE)    → git fetch + merge --ff-only + npm ci (se o lock mudou) → sobe de novo
 *   exit 12 (SYNC_LOCK) → npm install --package-lock-only + commit do package-lock.json → sobe de novo
 *   exit 13 (RESTART_SUPERVISOR) → sobe um PROCESSO SUPERVISOR NOVO (spawn detached) e encerra
 *                        este — único jeito de recarregar código de backend/admin (ou deste
 *                        próprio arquivo), já que um /update comum só atualiza os arquivos no
 *                        disco, não o que já está carregado em memória neste processo (ver
 *                        restartSupervisor()).
 *   qualquer outro      → crash: respawn com backoff
 *
 * Os exit codes 10/11/12/13 são disparados pela API interna (`POST /internal/restart`,
 * `/internal/update`, `/internal/sync-lock`, `/internal/restart-supervisor`) que o njs-whatsapp
 * chama a partir de um comando no WhatsApp. Ver `backend/admin/botControl.js` e
 * `backend/admin/internalServer.js`.
 *
 * Uso (idêntico ao launcher — args são repassados):
 *   node backend/bot/bots-supervisor.js
 *   node backend/bot/bots-supervisor.js --symbol BTCUSDT
 */

const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const botLog = require('../admin/botLog');
const botControl = require('../admin/botControl');
const { sendWhatsApp } = require('./whatsapp');
const { EXIT } = botControl;

const LAUNCHER = process.env.BOTS_LAUNCHER_SCRIPT || path.join(__dirname, 'start-trade-bots.js');
const EXTRA_ARGS = process.argv.slice(2);
const CRASH_BACKOFF_MS = 5000;
// Quantos crashes seguidos (< 60s de vida) antes de avisar no WhatsApp.
const CRASH_ALERT_AFTER = 3;

let current = null;
let stopping = false;
let launchedAt = 0;
let crashStreak = 0;

function log(line) {
  const msg = `[supervisor] ${line}`;
  console.log(msg);
  try { botLog.writeLine(msg); } catch { /* nunca derruba o supervisor */ }
}

/** Aviso no WhatsApp — best-effort, nunca derruba o supervisor. Retorna a promise
 *  pra quem precisa esperar o envio antes de `process.exit` (ver /stop). */
function notify(msg) {
  return Promise.resolve(sendWhatsApp(`🛰️ Bots (supervisor)\n${msg}`)).catch(() => {});
}

function spawnLauncher() {
  if (stopping) return;
  launchedAt = Date.now();
  current = spawn(process.execPath, [LAUNCHER, ...EXTRA_ARGS], {
    stdio: 'inherit',
    env: { ...process.env, BOTS_SUPERVISED: '1' },
  });
  current.on('exit', (code, signal) => {
    current = null;
    if (stopping) return;

    if (code === EXIT.STOP) {
      botControl.recordResult('stop', { ok: true });
      log('launcher pediu PARADA (exit 0) — encerrando o supervisor.');
      const done = () => process.exit(0);
      Promise.race([notify('⏹️ bots PARADOS via /stop.'), new Promise((r) => setTimeout(r, 4000))]).then(done, done);
      return;
    }

    if (code === EXIT.RESTART) {
      botControl.recordResult('restart', { ok: true });
      log('RESTART solicitado — subindo o launcher de novo...');
      crashStreak = 0;
      spawnLauncher();
      return;
    }

    if (code === EXIT.UPDATE) {
      crashStreak = 0;
      handleUpdate().catch((err) => {
        log(`erro inesperado no update: ${err.message} — subindo com o código atual`);
        notify(`⚠️ /update FALHOU (erro inesperado: ${err.message}). Subindo com o código anterior.`);
        botControl.recordResult('update', { ok: false, error: err.message, log: [] });
        spawnLauncher();
      });
      return;
    }

    if (code === EXIT.SYNC_LOCK) {
      crashStreak = 0;
      handleSyncLock().catch((err) => {
        log(`erro inesperado no sync-lock: ${err.message} — subindo com o código atual`);
        notify(`⚠️ /sync-lock FALHOU (erro inesperado: ${err.message}). Subindo os bots.`);
        botControl.recordResult('sync-lock', { ok: false, error: err.message, log: [] });
        spawnLauncher();
      });
      return;
    }

    if (code === EXIT.RESTART_SUPERVISOR) {
      crashStreak = 0;
      restartSupervisor();
      return;
    }

    // Saída não solicitada = crash. Conta os crashes rápidos (< 60s de vida) e avisa
    // no WhatsApp quando passar do limite — o launcher a essa altura já tentou o
    // próprio auto-restart dos filhos (MAX_RESTARTS) e mesmo assim caiu.
    const lifeS = (Date.now() - launchedAt) / 1000;
    if (lifeS < 60) crashStreak++; else crashStreak = 0;
    log(`launcher caiu (code=${code}, signal=${signal}, vida ${lifeS.toFixed(0)}s, seguidos ${crashStreak}) — respawn em ${CRASH_BACKOFF_MS / 1000}s`);
    // Avisa no WhatsApp ao cruzar o limite e depois a cada 12 crashes (não spammar).
    if (crashStreak === CRASH_ALERT_AFTER || (crashStreak > CRASH_ALERT_AFTER && crashStreak % 12 === 0)) {
      notify(`❌ launcher dos bots caiu ${crashStreak}x seguidas (code=${code}). Continuo tentando subir, mas veja o log — provável erro no código/ambiente.`);
    }
    setTimeout(spawnLauncher, CRASH_BACKOFF_MS);
  });
}

async function handleUpdate() {
  log('UPDATE solicitado — rodando git fetch/merge (bots parados durante isso)...');
  let result;
  try {
    result = await botControl.runUpdate();
  } catch (err) {
    result = { ok: false, error: err.message, log: [] };
  }
  for (const l of result.log || []) log(l);
  if (result.ok && result.updated) {
    log(`update OK: ${result.fromCommit} → ${result.toCommit}${result.npmRan ? ' (deps reinstaladas)' : ''}`);
    notify(`✅ /update OK: ${result.fromCommit} → ${result.toCommit}${result.npmRan ? ' (deps reinstaladas)' : ''}. Subindo os bots…`);
  } else if (result.ok) {
    log('update: já estava na última versão');
    notify(`ℹ️ /update: já estava na última versão (${result.fromCommit}). Reiniciando mesmo assim.`);
  } else {
    log(`update FALHOU: ${result.error} — subindo com o código atual`);
    notify(`⚠️ /update FALHOU: ${result.error}\nOs bots vão subir com o código ANTERIOR (${result.fromCommit || '?'}).`);
  }
  botControl.recordResult('update', result);
  spawnLauncher();
}

async function handleSyncLock() {
  log('SYNC-LOCK solicitado — npm install --package-lock-only + commit (bots parados durante isso)...');
  let result;
  try {
    result = await botControl.runSyncLock();
  } catch (err) {
    result = { ok: false, error: err.message, log: [] };
  }
  for (const l of result.log || []) log(l);

  if (result.ok && result.committed) {
    const push = result.pushed ? 'e enviado (push OK)' : 'LOCAL (push falhou — traga com git pull na máquina de dev)';
    log(`sync-lock OK: package-lock.json commitado ${result.toCommit} ${push}`);
    notify(`✅ /sync-lock OK\npackage-lock.json regenerado e commitado (${result.toCommit}) — ${push}.\n${result.diffStat || ''}\nSubindo os bots…`);
  } else if (result.ok) {
    log('sync-lock: package-lock.json já estava sincronizado');
    notify('ℹ️ /sync-lock: package-lock.json já estava sincronizado, nada a commitar. Subindo os bots.');
  } else {
    log(`sync-lock FALHOU: ${result.error} — subindo os bots mesmo assim`);
    notify(`⚠️ /sync-lock FALHOU: ${result.error}\nOs bots vão subir normalmente (o lock quebrado não derruba o bot em execução).`);
  }
  botControl.recordResult('sync-lock', result);
  spawnLauncher();
}

/**
 * RESTART_SUPERVISOR — diferente de RESTART (que só sobe o launcher de novo dentro DESTE
 * processo), aqui é o próprio SUPERVISOR que precisa trocar de processo: `require()` só lê o
 * código do disco na primeira vez, então um `/update` que mexeu em backend/admin/* ou neste
 * arquivo (bots-supervisor.js) deixa o supervisor rodando a versão ANTIGA em memória mesmo
 * depois do `git merge` já ter atualizado os arquivos — um `/update`/`/restart` comuns não
 * resolvem isso, porque ambos só reagem DENTRO deste mesmo processo já carregado.
 *
 * Sobe um supervisor NOVO (mesmo script, `spawn` detached — sobrevive independente deste
 * processo, sem depender de nenhum watchdog externo) e só DEPOIS encerra este. O novo processo
 * já nasce lendo o botControl.js/bots-supervisor.js atuais do disco.
 */
function restartSupervisor() {
  log('RESTART DO SUPERVISOR solicitado — subindo um processo supervisor novo e encerrando este...');
  botControl.recordResult('restart-supervisor', { ok: true });
  stopping = true; // este processo não deve mais reagir a nada — o novo assume a partir daqui
  const child = spawn(process.execPath, [__filename, ...EXTRA_ARGS], {
    detached: true,
    stdio: 'ignore', // sem terminal pra herdar — observabilidade é só via botLog (/internal/log)
    env: process.env,
  });
  child.unref();
  notify(`🔁 Supervisor reiniciando (PID novo: ${child.pid}) — este processo encerra agora.`)
    .finally(() => process.exit(0));
}

function stopAll(sig) {
  if (stopping) return;
  stopping = true;
  log(`recebido ${sig} — encerrando launcher e supervisor.`);
  if (current) { try { current.kill('SIGTERM'); } catch { /* já morreu */ } }
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));

log(`iniciando — launcher: ${path.relative(process.cwd(), LAUNCHER)}${EXTRA_ARGS.length ? ' ' + EXTRA_ARGS.join(' ') : ''}`);
spawnLauncher();
