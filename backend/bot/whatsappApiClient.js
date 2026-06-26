'use strict';

/**
 * Cliente HTTP — POST /messages/send no serviço WhatsApp (porta 3005, processo externo).
 */

const {
  getWhatsAppEnvConfig,
  isWhatsAppApiConfigured,
  normalizePhone,
  getWhatsAppServiceUrl,
  DEFAULT_HOST,
  DEFAULT_PORT,
} = require('./whatsappEnv');

function getApiConfig() {
  return getWhatsAppEnvConfig();
}

function isApiEnabled() {
  return isWhatsAppApiConfigured();
}

function resolveApiUrl() {
  return getWhatsAppServiceUrl();
}

async function apiFetch(path, options = {}) {
  const cfg = getApiConfig();
  if (!cfg) {
    throw new Error('WhatsApp: defina API_KEY e WA_OWNER_NUMBER no .env');
  }

  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key':    cfg.apiKey,
      ...(options.headers ?? {}),
    },
  });

  const bodyText = await res.text().catch(() => '');
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }

  if (!res.ok) {
    const msg = typeof body === 'object' && body?.error
      ? body.error
      : (bodyText || res.statusText);
    throw new Error(`WhatsApp API ${res.status}: ${msg}`);
  }
  return body;
}

async function getStatus() {
  if (!isApiEnabled()) return { mode: 'baileys' };
  return apiFetch('/status', { method: 'GET' });
}

async function sendText(text, opts = {}) {
  const cfg = getApiConfig();
  if (!cfg) return false;

  const to = opts.to ? normalizePhone(opts.to) : cfg.to;
  if (!to) throw new Error('WA_OWNER_NUMBER inválido no .env');

  await apiFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ to, text: String(text) }),
  });
  return true;
}

module.exports = {
  getApiConfig,
  isApiEnabled,
  normalizePhone,
  resolveApiUrl,
  getStatus,
  sendText,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
