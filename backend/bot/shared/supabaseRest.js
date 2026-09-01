'use strict';

/**
 * Cliente REST genérico pro Supabase usado pelos bots de trade (rsi_multi_bot_state,
 * rsi_multi_bot_trades, etc.) — extraído de ma-cross-bot.js (mesma função existia colada,
 * idêntica, em amap-bot.js e swing-bot.js).
 *
 * Timeout + retry: madrugada de 13→14/08/2026 teve ~3400 "Tick error: fetch failed" em
 * vários bots/símbolos (falha de rede/DNS transitória, sem status HTTP), cada uma perdendo
 * o tick inteiro sem nova tentativa — causou pelo menos 10 "posição órfã" (compra executada
 * na corretora mas o PATCH/GET em rsi_multi_bot_state falhou e o bot perdeu o rastro da
 * posição). GET/PATCH são idempotentes (PATCH sempre por `id=eq.`), então dá pra reter com
 * segurança. POST (insert de trade/sinal) NÃO é retentado — se a falha for depois do commit
 * no servidor mas antes da resposta chegar, reter duplicaria o registro. DELETE também é
 * idempotente (sempre por filtro id=eq./symbol=eq., repetir só encontra 0 linhas na 2ª vez) —
 * ver o caso real do rsi-momentum-bot: retireAutoFavorite faz 2 deletes em sequência (estado +
 * favorito) sem transação; uma falha transitória de rede no 2º delete (sem retry) deixava
 * `multitrade_favorites` órfão pra sempre, e o scanner batia 409 (duplicate key) tentando
 * recriar o sinal daquele símbolo a cada ciclo, indefinidamente.
 */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Timeout e retries são configuráveis por env — em rede móvel (Termux) o default de 10s
// estourava com frequência no sync do painel Multi-Trade (multitradeWatch.js), sobretudo
// quando o Android suspende o processo (doze) e o fetch/timer só "acordam" depois.
const TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS) || 20_000;
const MAX_RETRIES = Number.isFinite(Number(process.env.SUPABASE_MAX_RETRIES))
  ? Math.max(0, Number(process.env.SUPABASE_MAX_RETRIES))
  : 2;
const RETRY_DELAYS_MS = [500, 1500];
const RETRYABLE_METHODS = new Set(['GET', 'PATCH', 'DELETE']);

function retryDelay(attempt) {
  return RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sbReq(method, table, body, query = '') {
  const url = `${SB_URL}/rest/v1/${table}${query}`;
  const opts = {
    method,
    headers: {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  };
  const canRetry = RETRYABLE_METHODS.has(method);

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res, text;
    try {
      res = await fetch(url, { ...opts, signal: controller.signal });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (canRetry && attempt < MAX_RETRIES) {
        await sleep(retryDelay(attempt));
        continue;
      }
      throw err.name === 'AbortError'
        ? new Error(`Supabase ${method} ${table}: timeout após ${TIMEOUT_MS}ms`)
        : err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const retryableStatus = res.status >= 500 || res.status === 429;
      if (canRetry && retryableStatus && attempt < MAX_RETRIES) {
        await sleep(retryDelay(attempt));
        continue;
      }
      throw new Error(`Supabase ${method} ${table} ${res.status}: ${text}`);
    }
    return text ? JSON.parse(text) : null;
  }
}

module.exports = { sbReq };
