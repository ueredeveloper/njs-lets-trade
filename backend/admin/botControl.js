'use strict';

/**
 * Ações de controle dos bots (restart / update / stop / pull) disparadas pela API
 * interna (`POST /internal/*`) e executadas pelo supervisor (`bots-supervisor.js`).
 *
 * DECISÃO DE ARQUITETURA (muda os invariantes antigos do README):
 *   - A API interna agora aceita `POST` para restart/update/stop/pull, MAS só com
 *     `X-Internal-Token` E `INTERNAL_ADMIN_ALLOW_CONTROL=true`.
 *   - A API NUNCA executa git/npm/shell. Ela só grava a intenção e mata o launcher
 *     com um exit code sentinela. Quem faz `git pull` / `npm ci` / respawn é o
 *     supervisor (processo pai, que fica vivo enquanto o launcher reinicia).
 *   - Sequência fixa (fetch → merge --ff-only → npm ci condicional). Sem comando
 *     arbitrário, sem `reset --hard`, sem build (o `frontend-react/dist` é
 *     versionado, então o pull já traz o bundle).
 *
 * O `pull` (dry-run) é o único que roda no próprio processo do launcher: é só
 * `git fetch` + `git log HEAD..origin/branch`, não toca working tree nem reinicia.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { internalConfig } = require('./internalConfig');

const REPO_ROOT = internalConfig.repoRoot;
const STATE_FILE = process.env.INTERNAL_ADMIN_STATE_FILE
  || path.join(REPO_ROOT, 'backend/data/bot/control-action.json');

// Exit codes que o launcher usa pra falar com o supervisor.
const EXIT = { STOP: 0, RESTART: 10, UPDATE: 11 };

// Ações que viram exit code (o `pull` não — roda inline).
const CONTROL_ACTIONS = { stop: EXIT.STOP, restart: EXIT.RESTART, update: EXIT.UPDATE };

function git(args, { timeout = 15000 } = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function fileHash(rel) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(REPO_ROOT, rel))).digest('hex');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Estado persistido (pra /internal/info mostrar pendência e último resultado)
// ---------------------------------------------------------------------------

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { pending: null, last: null };
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* estado é best-effort — nunca derruba o processo */ }
}

function setPending(action, by) {
  const state = readState();
  state.pending = { action, at: new Date().toISOString(), by: by || null };
  writeState(state);
}

function recordResult(action, result) {
  const state = readState();
  state.pending = null;
  state.last = { action, at: new Date().toISOString(), ...(result || {}) };
  writeState(state);
}

/**
 * Chamado no boot do launcher. Numa reinicialização controlada o supervisor já
 * limpou o `pending` antes do respawn — então qualquer `pending` visto aqui é
 * resquício de um crash no meio de uma ação. Descarta pra não travar o /status.
 */
function clearStalePending() {
  const state = readState();
  if (!state.pending) return;
  state.last = {
    action: state.pending.action,
    at: new Date().toISOString(),
    ok: false,
    error: 'ação interrompida por reinício inesperado do processo',
  };
  state.pending = null;
  writeState(state);
}

// ---------------------------------------------------------------------------
// pull (dry-run) — roda no processo do launcher, não reinicia nada
// ---------------------------------------------------------------------------

function currentBranch() {
  return internalConfig.gitBranch || git(['rev-parse', '--abbrev-ref', 'HEAD']);
}

async function dryRunPull() {
  const remote = internalConfig.gitRemote;
  const branch = currentBranch();
  git(['fetch', '--prune', remote], { timeout: 120000 });
  const range = `HEAD..${remote}/${branch}`;
  const behind = parseInt(git(['rev-list', '--count', range]) || '0', 10);
  const ahead = parseInt(git(['rev-list', '--count', `${remote}/${branch}..HEAD`]) || '0', 10);
  const commits = behind
    ? git(['log', '--format=%h %s', range]).split('\n').filter(Boolean)
    : [];
  return {
    ok: true,
    remote,
    branch,
    current: git(['rev-parse', '--short', 'HEAD']),
    behind,
    ahead,
    dirty: git(['status', '--porcelain']).length > 0,
    commits,
  };
}

// ---------------------------------------------------------------------------
// update — roda no SUPERVISOR, com o launcher já derrubado
// ---------------------------------------------------------------------------

/**
 * @param {{ npm?: 'auto'|'always'|'never' }} opts
 * @returns {Promise<{ ok, fromCommit?, toCommit?, updated?, npmRan?, error?, log: string[] }>}
 */
async function runUpdate({ npm = internalConfig.npmOnUpdate } = {}) {
  const log = [];
  const step = (m) => log.push(m);
  let fromCommit;
  let toCommit;
  try {
    fromCommit = git(['rev-parse', '--short', 'HEAD']);
    const remote = internalConfig.gitRemote;
    const branch = currentBranch();

    if (git(['status', '--porcelain']).length > 0) {
      return {
        ok: false,
        fromCommit,
        error: 'working tree sujo — resolva no Termux antes de atualizar (o dist é versionado, não builde local)',
        log,
      };
    }

    step(`git fetch --prune ${remote}`);
    git(['fetch', '--prune', remote], { timeout: 120000 });

    const range = `HEAD..${remote}/${branch}`;
    const behind = parseInt(git(['rev-list', '--count', range]) || '0', 10);
    if (behind === 0) {
      step('já está atualizado — nada a fazer');
      return { ok: true, fromCommit, toCommit: fromCommit, updated: false, npmRan: false, log };
    }

    const lockBefore = fileHash('package-lock.json');
    step(`git merge --ff-only ${remote}/${branch} (${behind} commit(s))`);
    git(['merge', '--ff-only', `${remote}/${branch}`], { timeout: 60000 });
    toCommit = git(['rev-parse', '--short', 'HEAD']);
    const lockAfter = fileHash('package-lock.json');

    const wantNpm = npm === 'always' || (npm === 'auto' && lockBefore !== lockAfter);
    let npmRan = false;
    if (wantNpm) {
      step('package-lock.json mudou → npm ci --omit=dev (pode levar minutos no Termux)');
      try {
        execFileSync(npmBin(), ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: 600000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        npmRan = true;
      } catch (e) {
        step('⚠️ npm ci FALHOU — pode faltar dependência; rode manualmente no Termux');
        return {
          ok: false,
          fromCommit,
          toCommit,
          updated: true,
          npmRan: false,
          error: `npm ci: ${(e.stderr || e.message || '').toString().trim().slice(0, 400)}`,
          log,
        };
      }
    }

    step(`ok: ${fromCommit} → ${toCommit}${npmRan ? ' (deps reinstaladas)' : ''}`);
    return { ok: true, fromCommit, toCommit, updated: true, npmRan, log };
  } catch (err) {
    return {
      ok: false,
      fromCommit,
      toCommit,
      error: (err.stderr || err.message || String(err)).toString().trim().slice(0, 400),
      log,
    };
  }
}

module.exports = {
  EXIT,
  CONTROL_ACTIONS,
  readState,
  setPending,
  recordResult,
  clearStalePending,
  dryRunPull,
  runUpdate,
};
