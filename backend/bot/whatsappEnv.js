'use strict';

/**
 * Variáveis WhatsApp lidas do .env (raiz do projeto).
 * Serviço externo em http://localhost:3005 (outro projeto) — este repo só é cliente HTTP.
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = '3005';

function normalizePhone(raw) {
  return String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');
}

/** Chave X-Api-Key — .env: WHATSAPP_API_KEY */
function getWhatsAppApiKey() {
  const key = process.env.WHATSAPP_API_KEY || process.env.API_KEY || '';
  return String(key).trim() || null;
}

/** Número destino { to } — .env: WA_OWNER_NUMBER */
function getWhatsAppNotifyNumber() {
  const raw = process.env.WA_OWNER_NUMBER
    || process.env.WHATSAPP_NOTIFY_NUMBER
    || '';
  const to = normalizePhone(raw);
  return to || null;
}

/** URL do serviço WhatsApp — .env: WHATSAPP_API_URL ou http://host:PORT */
function getWhatsAppServiceUrl() {
  const explicit = process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const apiKey = getWhatsAppApiKey();
  const notify = getWhatsAppNotifyNumber();
  if (!apiKey && !notify) return null;

  const host = process.env.WHATSAPP_API_HOST || DEFAULT_HOST;
  const port = process.env.WHATSAPP_PORT || DEFAULT_PORT;
  return `http://${host}:${port}`;
}

function getWhatsAppEnvConfig() {
  const baseUrl = getWhatsAppServiceUrl();
  const apiKey  = getWhatsAppApiKey();
  const to      = getWhatsAppNotifyNumber();
  if (!baseUrl || !apiKey || !to) return null;
  return { baseUrl, apiKey, to };
}

function isWhatsAppApiConfigured() {
  return !!getWhatsAppEnvConfig();
}

module.exports = {
  getWhatsAppApiKey,
  getWhatsAppNotifyNumber,
  getWhatsAppServiceUrl,
  getWhatsAppEnvConfig,
  isWhatsAppApiConfigured,
  normalizePhone,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
