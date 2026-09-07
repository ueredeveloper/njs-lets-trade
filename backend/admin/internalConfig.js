'use strict';

/**
 * Configuração da API interna de administração dos bots.
 *
 * Esta API é o lado "cooperativo" da administração remota: o njs-whatsapp
 * (projeto separado, porta 3005) consulta estes endpoints para responder
 * `/admin/status`, `/admin/health` e `/admin/log` no WhatsApp.
 *
 * Só LEITURA. Nada aqui reinicia, atualiza ou executa comando — restart/update
 * são feitos POR FORA (process manager + git) pelo orquestrador.
 *
 * Variáveis no .env (raiz do projeto):
 *   INTERNAL_ADMIN_ENABLED   true|false   (default: true)
 *   INTERNAL_ADMIN_HOST      default 127.0.0.1  — NÃO expor à internet
 *   INTERNAL_ADMIN_PORT      default 4100
 *   INTERNAL_ADMIN_TOKEN     segredo compartilhado com o njs-whatsapp
 *                            (header X-Internal-Token). Sem token → só loopback.
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
  repoRoot: REPO_ROOT,
  // Log combinado do launcher dos bots (ver botLog.js)
  logFile: process.env.INTERNAL_ADMIN_LOG_FILE
    || path.join(REPO_ROOT, 'backend/data/bot/launcher.log'),
};

module.exports = { internalConfig };
