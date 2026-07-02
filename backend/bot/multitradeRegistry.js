'use strict';

/** Sessões ativas dos bots Multi-Trade (uma por rsi_multi_bot_state.id). */

const sessions = new Map();

function sessionKey(symbol, strategyId) {
  return `${String(symbol).toUpperCase()}:${strategyId}`;
}

function register(rowId, handle) {
  sessions.set(rowId, handle);
}

function unregister(rowId) {
  sessions.delete(rowId);
}

function get(rowId) {
  return sessions.get(rowId);
}

function has(rowId) {
  return sessions.has(rowId);
}

function list() {
  return [...sessions.values()];
}

function getByKey(symbol, strategyId) {
  const key = sessionKey(symbol, strategyId);
  return list().find(s => s.key === key) ?? null;
}

module.exports = {
  sessionKey,
  register,
  unregister,
  get,
  has,
  list,
  getByKey,
};
