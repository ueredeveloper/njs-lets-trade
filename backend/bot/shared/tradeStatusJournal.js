'use strict';

/**
 * Snapshot LOCAL do estado de cada trade (rsi-momentum-bot), pro `/internal/trade?symbol=` da
 * API interna (backend/admin/) responder sem importar o motor de trade — mesma ideia do
 * pending-state.json (backend/bot/shared/pendingState.js): o bot filho grava um JSON depois de
 * cada tick, o admin (processo separado, GET só-leitura) só lê o arquivo.
 *
 * Um documento por símbolo: `writeTradeStatus` sobrescreve inteiro (o bot sempre manda o
 * snapshot completo). `removeTradeStatus` é chamado quando o favorito automático é retirado de
 * vez (retireAutoFavorite, caminho não-curado) — moeda curada NÃO remove, só passa a registrar
 * phase WATCHING de novo no próximo tick.
 */

const fs = require('fs');
const path = require('path');

function journalFile() {
  return process.env.TRADE_STATUS_FILE
    || path.join(__dirname, '..', '..', 'data', 'bot', 'trade-status.json');
}

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  const file = journalFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, file);
}

function writeTradeStatus(symbol, snapshot) {
  const all = readAll();
  all[String(symbol).toUpperCase()] = snapshot;
  writeAll(all);
}

function readTradeStatus(symbol) {
  return readAll()[String(symbol).toUpperCase()] ?? null;
}

function readAllTradeStatus() {
  return readAll();
}

function removeTradeStatus(symbol) {
  const all = readAll();
  const key = String(symbol).toUpperCase();
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
}

// ── Trades FECHADOS recentes ──────────────────────────────────────────────────
// O journal acima só guarda o estado ATUAL por símbolo (a moeda some/volta a WATCHING ao fechar).
// Pro /internal/trade (WhatsApp) mostrar "fechou no alvo 🟢 / no stop 🔴" há pouco, cada fechamento
// vira uma linha num arquivo à parte, podado por idade e tamanho.
const CLOSED_MAX = 30;
const CLOSED_KEEP_MS = 24 * 3600 * 1000;

function closedFile() {
  return process.env.TRADE_CLOSED_FILE
    || path.join(__dirname, '..', '..', 'data', 'bot', 'trade-closed.json');
}

function readClosedAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(closedFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** entry: { symbol, outcome: 'alvo'|'stop', entryPrice, exitPrice, changePct, entryTime, closedAt, reason } */
function recordClosedTrade(entry) {
  const cutoff = Date.now() - CLOSED_KEEP_MS;
  const list = readClosedAll()
    .filter((e) => Date.parse(e.closedAt) >= cutoff)
    .concat(entry)
    .slice(-CLOSED_MAX);
  const file = closedFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file);
}

/** Fechados nas últimas `maxAgeMs` (default 6h), mais recentes primeiro. */
function readRecentClosed(maxAgeMs = 6 * 3600 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  return readClosedAll()
    .filter((e) => Date.parse(e.closedAt) >= cutoff)
    .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
}

module.exports = { writeTradeStatus, readTradeStatus, readAllTradeStatus, removeTradeStatus, recordClosedTrade, readRecentClosed };
