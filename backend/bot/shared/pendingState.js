'use strict';

/**
 * Journal LOCAL de gravações de estado que ainda não chegaram ao Supabase.
 *
 * Problema: a compra já executou na corretora, mas o PATCH em rsi_multi_bot_state (phase=BOUGHT,
 * buy_price/qty, rules_state.exitBracket) falha — rede/DNS/Supabase fora por mais tempo do que os
 * 2 retries curtos de supabaseRest.js cobrem — ou o processo cai no meio. Sem registro o bot
 * "esquece" a posição (aviso de posição órfã) e, pior, perde a OCO e o histórico que o reforço no
 * stop precisa.
 *
 * Solução: ANTES de tentar gravar no Supabase o patch vai pra este arquivo (síncrono, escrita
 * atômica tmp+rename); só sai daqui depois do PATCH confirmar. Todo tick do bot chama
 * flushPendingState (tradeExecution.js), que reenvia o que sobrou — sobrevive a restart.
 *
 * Um patch por linha (rowId): updates seguintes do mesmo rowId são MESCLADOS por cima (o mais
 * novo vence campo a campo; `rules_state` é substituído inteiro, porque o bot sempre grava o
 * objeto completo).
 */

const fs = require('fs');
const path = require('path');

function journalFile() {
  return process.env.PENDING_STATE_FILE
    || path.join(__dirname, '..', '..', 'data', 'bot', 'pending-state.json');
}

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {}; // arquivo ausente ou corrompido — recomeça vazio (o pior caso vira o aviso de órfã)
  }
}

function writeAll(all) {
  const file = journalFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, file);
}

/** Registra (ou mescla) um patch pendente pro rowId. Devolve a entrada completa. */
function stashPendingState(rowId, patch, meta = {}) {
  const all = readAll();
  const key = String(rowId);
  const prev = all[key];
  all[key] = {
    rowId,
    symbol: meta.symbol ?? prev?.symbol ?? null,
    strategyId: meta.strategyId ?? prev?.strategyId ?? null,
    stashedAt: prev?.stashedAt ?? new Date().toISOString(),
    attempts: prev?.attempts ?? 0,
    patch: { ...(prev?.patch ?? {}), ...patch },
  };
  writeAll(all);
  return all[key];
}

function peekPendingState(rowId) {
  return readAll()[String(rowId)] ?? null;
}

function clearPendingState(rowId) {
  const all = readAll();
  if (!(String(rowId) in all)) return;
  delete all[String(rowId)];
  writeAll(all);
}

function markPendingAttempt(rowId) {
  const all = readAll();
  const entry = all[String(rowId)];
  if (!entry) return;
  entry.attempts = (entry.attempts ?? 0) + 1;
  entry.lastAttemptAt = new Date().toISOString();
  writeAll(all);
}

module.exports = { stashPendingState, peekPendingState, clearPendingState, markPendingAttempt };
