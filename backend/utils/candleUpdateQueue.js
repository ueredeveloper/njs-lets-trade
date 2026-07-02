'use strict';

const getCandles = require('../binance/getCandles');

/** ~24 klines/min → ~48 weight/min (bem abaixo do limite de 1200) */
const REQUEST_GAP_MS = 2_500;
const FETCH_TIMEOUT_MS = 60_000;

const queue = [];
const queuedKeys = new Set();
const waiters = new Map();

let draining = false;
let banUntil = 0;
let lastRequestAt = 0;
let processed = 0;
let failed = 0;

function queueKey(symbol, interval) {
  return `${symbol}|${interval}`;
}

function parseBanUntil(err) {
  const msg = String(err?.message ?? '');
  const m = msg.match(/banned until (\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function priorityFor(item) {
  return item.priority ?? 0;
}

function insertJob(job) {
  const idx = queue.findIndex(j => priorityFor(j) < job.priority);
  if (idx === -1) queue.push(job);
  else queue.splice(idx, 0, job);
}

function enqueue(symbol, interval, limit, priority = 0) {
  const key = queueKey(symbol, interval);
  if (queuedKeys.has(key)) return false;
  queuedKeys.add(key);
  insertJob({ symbol, interval, limit, priority, key });
  kickDrain();
  return true;
}

function fetch(symbol, interval, limit, { priority = 10, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const key = queueKey(symbol, interval);
  if (waiters.has(key)) return waiters.get(key).promise;

  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const timer = setTimeout(() => {
    waiters.delete(key);
    reject(new Error(`candleUpdateQueue timeout ${symbol} ${interval}`));
  }, timeoutMs);

  waiters.set(key, {
    promise: promise.finally(() => clearTimeout(timer)),
    resolve,
    reject,
  });

  if (!queuedKeys.has(key)) {
    queuedKeys.add(key);
    insertJob({ symbol, interval, limit, priority, key, urgent: true });
  } else {
    const job = queue.find(j => j.key === key);
    if (job) {
      job.priority = Math.max(job.priority ?? 0, priority);
      job.urgent = true;
      job.limit = Math.max(job.limit ?? 0, limit);
      queue.sort((a, b) => priorityFor(b) - priorityFor(a));
    }
  }

  kickDrain();
  return waiters.get(key).promise;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  if (banUntil > now) {
    await sleep(banUntil - now + 500);
  }
  const gap = REQUEST_GAP_MS - (now - lastRequestAt);
  if (gap > 0) await sleep(gap);
  lastRequestAt = Date.now();
}

async function runJob(job) {
  await throttle();
  const candles = await getCandles(job.symbol, job.interval, job.limit);
  processed++;

  const waiter = waiters.get(job.key);
  if (waiter) {
    waiters.delete(job.key);
    waiter.resolve(candles);
  }
  return candles;
}

async function drain() {
  if (draining) return;
  draining = true;

  try {
    while (queue.length > 0) {
      if (banUntil > Date.now()) {
        await sleep(banUntil - Date.now() + 500);
      }

      const job = queue.shift();
      if (!job) break;

      try {
        await runJob(job);
      } catch (err) {
        failed++;
        const ban = parseBanUntil(err);
        if (ban > Date.now()) {
          banUntil = ban;
          console.warn(`[candleQueue] pausa até ${new Date(ban).toLocaleTimeString()} — ${err.message}`);
        } else {
          console.warn(`[candleQueue] ${job.symbol} ${job.interval}:`, err.message);
        }

        const waiter = waiters.get(job.key);
        if (waiter) {
          waiters.delete(job.key);
          waiter.reject(err);
        }
      } finally {
        queuedKeys.delete(job.key);
      }
    }
  } finally {
    draining = false;
    if (queue.length > 0) kickDrain();
  }
}

function kickDrain() {
  drain().catch(err => console.error('[candleQueue] drain:', err.message));
}

function getStats() {
  return {
    pending: queue.length,
    waiting: waiters.size,
    processed,
    failed,
    banUntil,
    draining,
  };
}

module.exports = {
  enqueue,
  fetch,
  getStats,
  REQUEST_GAP_MS,
};
