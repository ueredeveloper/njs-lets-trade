'use strict';

/**
 * Supervisor do launcher dos bots — fica sempre vivo enquanto o launcher
 * (`start-bands-bots.js`) reinicia. É o entrypoint do `npm run bots:bands`.
 *
 * Por que existe: o launcher não consegue se auto-atualizar com limpeza (trocaria
 * o próprio código em execução). Então ele apenas SAI com um exit code sentinela
 * e este processo pai faz o trabalho:
 *
 *   exit 0  (STOP)     → encerra o supervisor também (parada intencional)
 *   exit 10 (RESTART)  → sobe o launcher de novo, sem tocar no código
 *   exit 11 (UPDATE)   → git fetch + merge --ff-only + npm ci (se o lock mudou) → sobe de novo
 *   qualquer outro     → crash: respawn com backoff
 *
 * Os exit codes 10/11 são disparados pela API interna (`POST /internal/restart`,
 * `/internal/update`) que o njs-whatsapp chama a partir de um comando no WhatsApp.
 * Ver `backend/admin/botControl.js` e `backend/admin/internalServer.js`.
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
const { EXIT } = botControl;

const LAUNCHER = process.env.BOTS_LAUNCHER_SCRIPT || path.join(__dirname, 'start-bands-bots.js');
const EXTRA_ARGS = process.argv.slice(2);
const CRASH_BACKOFF_MS = 5000;

let current = null;
let stopping = false;

function log(line) {
  const msg = `[supervisor] ${line}`;
  console.log(msg);
  try { botLog.writeLine(msg); } catch { /* nunca derruba o supervisor */ }
}

function spawnLauncher() {
  if (stopping) return;
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
      process.exit(0);
      return;
    }

    if (code === EXIT.RESTART) {
      botControl.recordResult('restart', { ok: true });
      log('RESTART solicitado — subindo o launcher de novo...');
      spawnLauncher();
      return;
    }

    if (code === EXIT.UPDATE) {
      handleUpdate().catch((err) => {
        log(`erro inesperado no update: ${err.message} — subindo com o código atual`);
        spawnLauncher();
      });
      return;
    }

    log(`launcher caiu (code=${code}, signal=${signal}) — respawn em ${CRASH_BACKOFF_MS / 1000}s`);
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
  if (result.ok) {
    log(result.updated
      ? `update OK: ${result.fromCommit} → ${result.toCommit}${result.npmRan ? ' (deps reinstaladas)' : ''}`
      : 'update: já estava na última versão');
  } else {
    log(`update FALHOU: ${result.error} — subindo com o código atual`);
  }
  botControl.recordResult('update', result);
  spawnLauncher();
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
