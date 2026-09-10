'use strict';

/**
 * Configuração da API interna de administração dos bots.
 *
 * Esta API é o lado "cooperativo" da administração remota: o njs-whatsapp
 * (projeto separado, porta 3005) consulta estes endpoints para responder
 * `/admin/status`, `/admin/health` e `/admin/log` no WhatsApp.
 *
 * GET = só leitura. Mutação só nos `POST /internal/{restart,update,stop,pull,sync-lock}`
 * e mesmo assim a API não executa git/npm: grava a intenção e sai com exit code
 * sentinela; quem age é o supervisor (`bots-supervisor.js`). Ver `botControl.js`.
 *
 * Variáveis no .env (raiz do projeto):
 *   INTERNAL_ADMIN_ENABLED        true|false   (default: true)
 *   INTERNAL_ADMIN_HOST           default 127.0.0.1  — NÃO expor à internet
 *   INTERNAL_ADMIN_PORT           default 4100
 *   INTERNAL_ADMIN_TOKEN          segredo compartilhado com o njs-whatsapp
 *                                 (header X-Internal-Token). Sem token → só loopback.
 *   INTERNAL_ADMIN_ALLOW_CONTROL  true|false   (default: false) — libera os
 *                                 `POST /internal/{restart,update,stop,pull,sync-lock}`.
 *                                 Só funciona junto com um TOKEN configurado.
 *   INTERNAL_ADMIN_UPDATE_NPM     auto|always|never (default: auto) — quando o
 *                                 update roda `npm ci` (auto = só se o lock mudou).
 *   INTERNAL_ADMIN_GIT_REMOTE     default origin
 *   INTERNAL_ADMIN_GIT_BRANCH     default: branch atual do checkout
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

function bool(v, def) {
  if (v == null || v === '') return def;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

const REPO_ROOT = path.join(__dirname, '../..');

const internalConfig = {
  enabled: bool(process.env.INTERNAL_ADMIN_ENABLED, true),
  host: process.env.INTERNAL_ADMIN_HOST || '127.0.0.1',
  port: parseInt(process.env.INTERNAL_ADMIN_PORT || '4100', 10),
  token: (process.env.INTERNAL_ADMIN_TOKEN || '').trim() || null,
  allowControl: bool(process.env.INTERNAL_ADMIN_ALLOW_CONTROL, false),
  npmOnUpdate: (process.env.INTERNAL_ADMIN_UPDATE_NPM || 'auto').trim().toLowerCase(),
  gitRemote: (process.env.INTERNAL_ADMIN_GIT_REMOTE || 'origin').trim(),
  gitBranch: (process.env.INTERNAL_ADMIN_GIT_BRANCH || '').trim(),
  repoRoot: REPO_ROOT,
  // Log combinado do launcher dos bots (ver botLog.js)
  logFile: process.env.INTERNAL_ADMIN_LOG_FILE
    || path.join(REPO_ROOT, 'backend/data/bot/launcher.log'),
};

module.exports = { internalConfig };
