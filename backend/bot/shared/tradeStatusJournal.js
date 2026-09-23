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

module.exports = { writeTradeStatus, readTradeStatus, readAllTradeStatus, removeTradeStatus };
