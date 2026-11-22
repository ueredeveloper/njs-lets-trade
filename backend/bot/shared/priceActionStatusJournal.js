'use strict';

/**
 * Snapshot LOCAL do bot Price action (Explosão de Alta automática + ordens OCO do watcher), pro
 * `/log` do WhatsApp mostrar regras/versão/ordens sem a API interna (backend/admin/) falar com o
 * Supabase — mesma ideia do tradeStatusJournal.js: o bot filho grava, o admin só lê.
 *
 * Duas partes, cada uma escrita por um módulo (merge por chave, sem um apagar o outro):
 *   rules  — bullishBreakoutAuto.js a cada varredura (15 min): config efetiva + hora do scan
 *   orders — manualOcoWatcher.js a cada passe (15s): ordens vivas (aguardando / compradas)
 * Best-effort: falha de disco nunca derruba o bot.
 */

const fs = require('fs');
const path = require('path');

function journalFile() {
  return process.env.PRICE_ACTION_STATUS_FILE
    || path.join(__dirname, '..', '..', 'data', 'bot', 'price-action-status.json');
}

function readPriceActionStatus() {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writePriceActionPart(key, data) {
  try {
    const file = journalFile();
    const all = readPriceActionStatus() || {};
    all[key] = { ...data, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${key}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* best-effort */ }
}

module.exports = { readPriceActionStatus, writePriceActionPart, journalFile };
