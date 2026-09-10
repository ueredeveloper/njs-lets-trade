'use strict';

/**
 * API interna de administração dos bots — SÓ loopback.
 *
 * Consumida pelo njs-whatsapp (porta 3005) para responder no WhatsApp:
 *   GET  /internal/health   → njs-whatsapp GET  /admin/health
 *   GET  /internal/info     → njs-whatsapp GET  /admin/status
 *   GET  /internal/log      → njs-whatsapp GET  /admin/log
 *   POST /internal/restart  → njs-whatsapp POST /admin/restart
 *   POST /internal/update   → njs-whatsapp POST /admin/update
 *   POST /internal/stop     → njs-whatsapp POST /admin/stop
 *   POST /internal/pull     → njs-whatsapp POST /admin/pull   (dry-run)
 *
 * Os `POST` de controle só respondem se:
 *   - há `INTERNAL_ADMIN_TOKEN` configurado E o header `X-Internal-Token` bate;
 *   - `INTERNAL_ADMIN_ALLOW_CONTROL=true`.
 * E mesmo assim a API NÃO executa git/npm/shell — ela grava a intenção e mata o
 * launcher com um exit code sentinela; quem faz o trabalho é o supervisor
 * (`backend/bot/bots-supervisor.js`). Ver `backend/admin/botControl.js`.
 *
 * Bind sempre em INTERNAL_ADMIN_HOST (default 127.0.0.1).
 */

const http = require('http');
const path = require('path');
const { internalConfig } = require('./internalConfig');
const { getGitInfo } = require('./gitInfo');
const botLog = require('./botLog');
const botControl = require('./botControl');

const pkg = require(path.join(internalConfig.repoRoot, 'package.json'));

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function authorized(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!LOOPBACK.has(ip) && !LOOPBACK.has(req.socket.remoteAddress)) return false;
  if (internalConfig.token) {
    return req.headers['x-internal-token'] === internalConfig.token;
  }
  return true;
}

/** Controle exige token configurado + flag ligada. Loopback sozinho não basta. */
function controlAllowed() {
  return internalConfig.allowControl && !!internalConfig.token;
}

/**
 * @param {() => object} getState  snapshot do launcher: { startedAt, bots: [{label,pid,running,restarts,startedAt,lastExit}] }
 * @param {{ onControl?: (action: 'restart'|'update'|'stop') => { ok: boolean, message?: string } }} [opts]
 *        onControl: chamado quando um POST de controle é aceito. O launcher deve
 *        fazer shutdown gracioso e sair com o exit code sentinela correspondente.
 */
function startInternalAdminServer(getState, opts = {}) {
  if (!internalConfig.enabled) {
    console.log('[admin] API interna desativada (INTERNAL_ADMIN_ENABLED=false)');
    return null;
  }
  const onControl = typeof opts.onControl === 'function' ? opts.onControl : null;

  const server = http.createServer((req, res) => {
    if (!authorized(req)) return send(res, 403, { error: 'não autorizado' });

    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    // ---- controle (POST) -------------------------------------------------
    if (req.method === 'POST' && url.pathname.startsWith('/internal/')) {
      const action = url.pathname.slice('/internal/'.length);
      if (!['restart', 'update', 'stop', 'pull'].includes(action)) {
        return send(res, 404, { error: 'rota não encontrada' });
      }
      if (!controlAllowed()) {
        return send(res, 403, {
          error: 'controle desabilitado — exige INTERNAL_ADMIN_TOKEN + INTERNAL_ADMIN_ALLOW_CONTROL=true',
        });
      }
      const by = (req.headers['x-requested-by'] || '').toString().slice(0, 60) || null;

      // pull = dry-run: roda aqui mesmo, não reinicia nada.
      if (action === 'pull') {
        botControl.dryRunPull()
          .then((r) => send(res, 200, r))
          .catch((e) => send(res, 500, { ok: false, error: e.message }));
        return;
      }

      if (!onControl) {
        return send(res, 503, { ok: false, error: 'launcher não expôs onControl (rodando sem supervisor?)' });
      }
      const state = safeState(getState);
      const anyRunning = (state.bots || []).some((b) => b.running);
      botControl.setPending(action, by);
      send(res, 202, {
        ok: true,
        action,
        message: action === 'update'
          ? 'update aceito — git pull + restart em andamento (acompanhe /internal/log e /internal/info.lastAction)'
          : `${action} aceito`,
        botsRunning: anyRunning,
      });
      // dispara depois de a resposta sair (onControl mata o processo)
      setImmediate(() => {
        try { onControl(action); } catch (e) { console.error(`[admin] onControl(${action}) falhou: ${e.message}`); }
      });
      return;
    }

    if (route === 'GET /internal/health') {
      const st = safeState(getState);
      return send(res, 200, {
        status: 'ok',
        service: 'njs-lets-trade-bots',
        uptimeSeconds: uptimeS(st.startedAt),
      });
    }

    if (route === 'GET /internal/info') {
      const st = safeState(getState);
      const ctl = safeCall(() => botControl.readState()) || { pending: null, last: null };
      return send(res, 200, {
        service: 'njs-lets-trade-bots',
        version: pkg.version || null,
        node: process.version,
        pid: process.pid,
        startedAt: iso(st.startedAt),
        uptimeSeconds: uptimeS(st.startedAt),
        memoryBytes: process.memoryUsage().rss,
        git: getGitInfo(),
        bots: st.bots || [],
        online: (st.bots || []).some((b) => b.running),
        controlEnabled: controlAllowed(),
        pendingAction: ctl.pending,
        lastAction: ctl.last,
        checkedAt: new Date().toISOString(),
      });
    }

    if (route === 'GET /internal/log') {
      const n = parseInt(url.searchParams.get('lines') || '100', 10);
      // `?raw=1` desliga o colapso das linhas de heartbeat (scan/moedas avaliadas).
      const raw = ['1', 'true', 'yes'].includes((url.searchParams.get('raw') || '').toLowerCase());
      return send(res, 200, {
        file: botLog.LOG_FILE,
        lines: botLog.tail(Number.isFinite(n) ? n : 100, { collapse: !raw }),
      });
    }

    return send(res, 404, { error: 'rota não encontrada' });
  });

  server.on('error', (err) => {
    console.error(`[admin] API interna falhou: ${err.message}`);
  });

  server.listen(internalConfig.port, internalConfig.host, () => {
    const auth = internalConfig.token ? 'token' : 'somente loopback';
    console.log(
      `[admin] API interna em http://${internalConfig.host}:${internalConfig.port}`
      + ` (health|info|log · ${auth})`,
    );
  });

  return server;
}

function safeState(getState) {
  try { return getState() || {}; } catch { return {}; }
}
function safeCall(fn) {
  try { return fn(); } catch { return null; }
}
function uptimeS(startedAt) {
  return startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null;
}
function iso(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

module.exports = { startInternalAdminServer };
