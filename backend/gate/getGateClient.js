const crypto = require('crypto');
require('dotenv').config();

const API_KEY    = process.env.GATEIO_API_KEY;
const SECRET_KEY = process.env.GATEIO_SECRET_KEY;
const BASE_URL   = 'https://api.gateio.ws/api/v4';

if (!API_KEY || !SECRET_KEY) {
  console.error('[getGateClient] GATEIO_API_KEY ou GATEIO_SECRET_KEY não definidos no .env');
}

/**
 * Gera os headers de autenticação Gate.io API v4 (HMAC-SHA512).
 * Ref: https://www.gate.io/docs/developers/apiv4/en/#authentication
 */
function buildAuthHeaders(method, path, queryString = '', body = '') {

 

  const timestamp  = Math.floor(Date.now() / 1000).toString();
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
async function gateRequest(method, endpointPath, params = {}) {

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
    throw new Error(`Gate.io ${method} ${endpointPath} → ${res.status}: ${msg}`);
  }

  return data;
}

module.exports = { gateRequest };
