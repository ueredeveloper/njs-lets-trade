'use strict';

/**
 * Ações de controle dos bots (restart / update / stop / pull / sync-lock) disparadas
 * pela API interna (`POST /internal/*`) e executadas pelo supervisor (`bots-supervisor.js`).
 *
 * DECISÃO DE ARQUITETURA (muda os invariantes antigos do README):
 *   - A API interna agora aceita `POST` para restart/update/stop/pull/sync-lock, MAS
 *     só com `X-Internal-Token` E `INTERNAL_ADMIN_ALLOW_CONTROL=true`.
 *   - A API NUNCA executa git/npm/shell. Ela só grava a intenção e mata o launcher
 *     com um exit code sentinela. Quem faz `git`/`npm`/respawn é o supervisor
 *     (processo pai, que fica vivo enquanto o launcher reinicia).
 *   - Sequências FIXAS, sem comando arbitrário, sem `reset --hard`, sem build (o
 *     `frontend-react/dist` é versionado, então o pull já traz o bundle):
 *       update    → fetch → merge --ff-only → npm ci condicional
 *       sync-lock → npm install --package-lock-only → git add package-lock.json →
 *                   git commit → git push (best-effort)
 *
 * O `pull` (dry-run) é o único que roda no próprio processo do launcher: é só
 * `git fetch` + `git log HEAD..origin/branch`, não toca working tree nem reinicia.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { internalConfig } = require('./internalConfig');

// Lido "ao vivo" (não capturado em const no load) pra os testes conseguirem
// apontar o botControl pra um repo git temporário via internalConfig.repoRoot.
const repoRoot = () => internalConfig.repoRoot;
const STATE_FILE = process.env.INTERNAL_ADMIN_STATE_FILE
  || path.join(internalConfig.repoRoot, 'backend/data/bot/control-action.json');

// Exit codes que o launcher usa pra falar com o supervisor.
// RESTART_SUPERVISOR: diferente do RESTART normal (só o launcher/bots), este reinicia o
// PRÓPRIO PROCESSO SUPERVISOR — necessário depois de um /update que mexeu em
// backend/admin/* ou bots-supervisor.js, já que esse código só é recarregado quando o
// supervisor (não só o launcher) sobe de novo (ver comentário em bots-supervisor.js).
const EXIT = { STOP: 0, RESTART: 10, UPDATE: 11, SYNC_LOCK: 12, RESTART_SUPERVISOR: 13 };

// Ações que viram exit code (o `pull` não — roda inline).
const CONTROL_ACTIONS = {
  stop: EXIT.STOP,
  restart: EXIT.RESTART,
  update: EXIT.UPDATE,
  'sync-lock': EXIT.SYNC_LOCK,
  'restart-supervisor': EXIT.RESTART_SUPERVISOR,
};

function git(args, { timeout = 15000 } = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot(),
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Roda `npm <args>` no repoRoot(). `shell:true` no Windows porque desde o Node
 * 20.12 `execFileSync('npm.cmd', …)` sem shell dá `EINVAL` (correção do
 * CVE-2024-27980). Todos os args aqui são literais fixos — sem superfície de
 * injeção. `stdio` herda stderr só o buffer (pega no catch).
 */
function npm(args, { timeout = 600000 } = {}) {
  const win = process.platform === 'win32';
  return execFileSync(win ? 'npm.cmd' : 'npm', args, {
    cwd: repoRoot(),
    encoding: 'utf8',
    timeout,
    shell: win,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fileHash(rel) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(repoRoot(), rel))).digest('hex');
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
 * @param {{ npmMode?: 'auto'|'always'|'never' }} opts
 * @returns {Promise<{ ok, fromCommit?, toCommit?, updated?, npmRan?, error?, log: string[] }>}
 */
async function runUpdate({ npmMode = internalConfig.npmOnUpdate } = {}) {
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

    // Local à frente do remoto (ex.: commit do /sync-lock que não deu push num device
    // pull-only) → `merge --ff-only` vai falhar. Aborta com mensagem clara em vez do
    // "Not possible to fast-forward" cru.
    const ahead = parseInt(git(['rev-list', '--count', `${remote}/${branch}..HEAD`]) || '0', 10);
    if (ahead > 0) {
      return {
        ok: false,
        fromCommit,
        error: `checkout local está ${ahead} commit(s) À FRENTE de ${remote}/${branch} (provável commit de /sync-lock sem push). Faça o push desse commit da máquina de dev — ou, no device pull-only, \`git reset --hard ${remote}/${branch}\` no Termux antes de atualizar.`,
        log,
      };
    }

    const lockBefore = fileHash('package-lock.json');
    step(`git merge --ff-only ${remote}/${branch} (${behind} commit(s))`);
    git(['merge', '--ff-only', `${remote}/${branch}`], { timeout: 60000 });
    toCommit = git(['rev-parse', '--short', 'HEAD']);
    const lockAfter = fileHash('package-lock.json');

    const wantNpm = npmMode === 'always' || (npmMode === 'auto' && lockBefore !== lockAfter);
    let npmRan = false;
    if (wantNpm) {
      step('package-lock.json mudou → npm ci --omit=dev (pode levar minutos no Termux)');
      try {
        npm(['ci', '--omit=dev', '--no-audit', '--no-fund']);
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

// ---------------------------------------------------------------------------
// sync-lock — roda no SUPERVISOR, com o launcher já derrubado
// ---------------------------------------------------------------------------

/**
 * `npm install --package-lock-only` + commit do `package-lock.json`. Serve pra
 * consertar o lock quando ele fica fora de sincronia com o `package.json` (ex.:
 * `@whiskeysockets/baileys` puxa `sharp` como peerDependency e a árvore `@img/*`
 * nunca foi gravada no lock → `npm ci` do `/update` quebra com "Missing: ... from
 * lock file"). O `--package-lock-only` só reescreve o lock, NÃO toca `node_modules`
 * — zero risco pros bots que já estão rodando.
 *
 * Sequência FIXA (igual `runUpdate`, sem comando arbitrário):
 *   1. recusa se a árvore tiver arquivo sujo além do próprio `package-lock.json`
 *   2. `npm install --package-lock-only --no-audit --no-fund`
 *   3. se o lock não mudou → nada a commitar
 *   4. `git add package-lock.json` + `git commit`
 *   5. `git push` best-effort (device pode ser pull-only → commit fica local)
 *
 * @returns {Promise<{ ok, fromCommit?, toCommit?, changed?, committed?, pushed?, pushError?, diffStat?, error?, log: string[] }>}
 */
async function runSyncLock() {
  const log = [];
  const step = (m) => log.push(m);
  let fromCommit;
  try {
    fromCommit = git(['rev-parse', '--short', 'HEAD']);

    // Pathspec de exclusão faz o git filtrar — nada de fatiar `--porcelain` na mão
    // (o `.trim()` do helper `git()` come o espaço da 1ª linha e bagunça o parse).
    const others = git(['status', '--porcelain', '--', ':(exclude)package-lock.json']);
    if (others) {
      return {
        ok: false,
        fromCommit,
        error: `working tree sujo — resolva no Termux antes (arquivos além do package-lock.json):\n${others}`,
        log,
      };
    }

    const lockBefore = fileHash('package-lock.json');
    step('npm install --package-lock-only (regenera o lock, não toca node_modules)');
    npm(['install', '--package-lock-only', '--no-audit', '--no-fund']);
    const lockAfter = fileHash('package-lock.json');

    if (lockBefore === lockAfter) {
      step('package-lock.json já estava sincronizado — nada a commitar');
      return { ok: true, fromCommit, toCommit: fromCommit, changed: false, committed: false, log };
    }

    const diffStat = (git(['diff', '--shortstat', '--', 'package-lock.json']) || '').trim();
    step(`package-lock.json mudou (${diffStat || 'diff'})`);

    git(['add', 'package-lock.json']);
    if (!git(['diff', '--cached', '--name-only']).split('\n').includes('package-lock.json')) {
      return { ok: false, fromCommit, changed: true, committed: false, error: 'package-lock.json não entrou no stage (ignorado no .gitignore?)', diffStat, log };
    }

    git(['commit', '-m', 'chore: sincroniza package-lock.json via /sync-lock [automático]']);
    const toCommit = git(['rev-parse', '--short', 'HEAD']);
    step(`commit ${toCommit}`);

    let pushed = false;
    let pushError = null;
    try {
      git(['push', internalConfig.gitRemote, 'HEAD'], { timeout: 120000 });
      pushed = true;
      step(`git push ${internalConfig.gitRemote} OK`);
    } catch (e) {
      pushError = (e.stderr || e.message || '').toString().trim().slice(0, 200);
      step(`git push falhou — commit ficou LOCAL (device pull-only?): ${pushError}`);
    }

    return { ok: true, fromCommit, toCommit, changed: true, committed: true, pushed, pushError, diffStat, log };
  } catch (err) {
    return {
      ok: false,
      fromCommit,
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
  runSyncLock,
};
