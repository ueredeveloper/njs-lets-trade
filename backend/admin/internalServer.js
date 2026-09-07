'use strict';

/**
 * API interna de administração dos bots — SÓ LEITURA, SÓ loopback.
 *
 * Consumida pelo njs-whatsapp (porta 3005) para responder no WhatsApp:
 *   GET /internal/health  → njs-whatsapp GET /admin/health
 *   GET /internal/info    → njs-whatsapp GET /admin/status
 *   GET /internal/log     → njs-whatsapp GET /admin/log
 *
 * NÃO existe endpoint de restart/update/exec aqui: reiniciar e atualizar são
 * responsabilidade do orquestrador externo (process manager + git), nunca do
 * próprio processo administrado.
 *
 * Auth: header `X-Internal-Token` == INTERNAL_ADMIN_TOKEN (se configurado).
 * Bind sempre em INTERNAL_ADMIN_HOST (default 127.0.0.1).
 */

const http = require('http');
const path = require('path');
const { internalConfig } = require('./internalConfig');
const { getGitInfo } = require('./gitInfo');
const botLog = require('./botLog');

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

/**
 * @param {() => object} getState  snapshot do launcher: { startedAt, bots: [{label,pid,running,restarts,startedAt,lastExit}] }
 */
function startInternalAdminServer(getState) {
  if (!internalConfig.enabled) {
    console.log('[admin] API interna desativada (INTERNAL_ADMIN_ENABLED=false)');
    return null;
  }

  const server = http.createServer((req, res) => {
    if (!authorized(req)) return send(res, 403, { error: 'não autorizado' });

    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

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
        checkedAt: new Date().toISOString(),
      });
    }

    if (route === 'GET /internal/log') {
      const n = parseInt(url.searchParams.get('lines') || '100', 10);
      return send(res, 200, {
        file: botLog.LOG_FILE,
        lines: botLog.tail(Number.isFinite(n) ? n : 100),
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
function uptimeS(startedAt) {
  return startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null;
}
function iso(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

module.exports = { startInternalAdminServer };
