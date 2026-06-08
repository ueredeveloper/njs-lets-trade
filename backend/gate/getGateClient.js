const crypto = require('crypto');
require('dotenv').config();

const API_KEY    = process.env.GATEIO_API_KEY;
const SECRET_KEY = process.env.GATEIO_SECRET_KEY;
const BASE_URL   = 'https://api.gateio.ws/api/v4';

if (!API_KEY || !SECRET_KEY) {
  console.error('[getGateClient] GATEIO_API_KEY ou GATEIO_SECRET_KEY não definidos no .env');
}

// ── Sincronização de relógio ──────────────────────────────────────────────────
// A Gate.io rejeita requisições com timestamp > 60s de diferença do servidor.
// Windows com NTP desatualizado causa erro 403: "gap between request Timestamp
// and server time exceeds 60". O offset é calculado uma vez e aplicado a todas
// as assinaturas. Renovado a cada hora via syncGateClock().
let clockOffsetSec = 0;

async function syncGateClock() {
  try {
    // /api/v4/spot/time retorna server_time em milissegundos
    const res  = await fetch(`${BASE_URL}/spot/time`);
    const data = await res.json();
    clockOffsetSec = Math.floor(data.server_time / 1000) - Math.floor(Date.now() / 1000);
    if (Math.abs(clockOffsetSec) > 2)
      console.log(`[getGateClient] ⏱️  Clock offset: ${clockOffsetSec > 0 ? '+' : ''}${clockOffsetSec}s`);
  } catch {
    clockOffsetSec = 0;
  }
}

// Sincroniza ao carregar o módulo e renova a cada hora
syncGateClock();
setInterval(syncGateClock, 60 * 60_000);

/**
 * Gera os headers de autenticação Gate.io API v4 (HMAC-SHA512).
 * Ref: https://www.gate.io/docs/developers/apiv4/en/#authentication
 */
function buildAuthHeaders(method, path, queryString = '', body = '') {
  // Aplica offset para compensar dessincronização do relógio local com o servidor Gate.io
  const timestamp  = (Math.floor(Date.now() / 1000) + clockOffsetSec).toString();
  const hashedBody = crypto.createHash('sha512').update(body).digest('hex');
  // Ordem correta: method → path → query → hashed_body → timestamp
  const message    = [method.toUpperCase(), path, queryString, hashedBody, timestamp].join('\n');
  const signature  = crypto.createHmac('sha512', SECRET_KEY).update(message).digest('hex');

  return {
    KEY:            API_KEY,
    Timestamp:      timestamp,
    SIGN:           signature,
    'Content-Type': 'application/json',
  };
}

/**
 * Faz uma requisição autenticada à Gate.io API v4.
 * @param {'GET'|'POST'|'DELETE'} method
 * @param {string} endpointPath  ex: '/spot/my_trades'
 * @param {Record<string,string>} [params]  query params (GET) ou campos do body (POST)
 */
async function gateRequest(method, endpointPath, params = {}, _retry = false) {

  const apiPath = `/api/v4${endpointPath}`;

  let url         = `${BASE_URL}${endpointPath}`;
  let queryString = '';
  let bodyStr     = '';

  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    queryString = qs;
    if (qs) url += `?${qs}`;
  } else {
    bodyStr = JSON.stringify(params);
  }

  const headers = buildAuthHeaders(method, apiPath, queryString, bodyStr);

  const options = { method, headers };
  if (method !== 'GET') options.body = bodyStr;

  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = data?.message || data?.label || text;
    // Clock drift detectado: extrai current_time do erro e corrige o offset na hora
    if (res.status === 403 && !_retry) {
      const match = /current_time:(\d+)/.exec(String(msg));
      if (match) {
        clockOffsetSec = parseInt(match[1], 10) - Math.floor(Date.now() / 1000);
        console.log(`[getGateClient] clock corrigido: offset=${clockOffsetSec}s`);
        return gateRequest(method, endpointPath, params, true);
      }
    }
    throw new Error(`Gate.io ${method} ${endpointPath} → ${res.status}: ${msg}`);
  }

  return data;
}

module.exports = { gateRequest };
