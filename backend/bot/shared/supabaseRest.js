'use strict';

/**
 * Cliente REST genérico pro Supabase usado pelos bots de trade (rsi_multi_bot_state,
 * rsi_multi_bot_trades, etc.) — extraído de ma-cross-bot.js (mesma função existia colada,
 * idêntica, em amap-bot.js e swing-bot.js).
 */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbReq(method, table, body, query = '') {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${table} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

module.exports = { sbReq };
