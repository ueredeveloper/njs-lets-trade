'use strict';

const fs = require('node:fs/promises');
const path = require('path');

const LOCK_DIR = path.join(__dirname, '..', 'data', 'candlestick');
const STALE_MS = 10_000; // lock mais velho que isso é de processo morto sem ter liberado
const RETRY_MS = 25;
const MAX_WAIT_MS = 5_000; // não trava o caller pra sempre — pior caso, segue sem lock

/**
 * Lock exclusivo ENTRE PROCESSOS pro ciclo leitura->mescla->escrita de um arquivo de candles
 * (getCandles.js, getGateCandles.js, fetchGateCandles em prices.js) — todos usam
 * readCandles/writeCandles sobre o mesmo arquivo em disco (`data/candlestick/<key>.json`),
 * e são chamados tanto pelos bots de trade quanto pelo backend Express, cada um como
 * processo Node separado (memória não compartilhada, então um lock em memória não adianta).
 *
 * Sem isso, dois processos lendo o mesmo JSON ao mesmo tempo (ex.: o bot num tick e o
 * backend atendendo o gráfico do frontend) fazem merges independentes e um sobrescreve o
 * outro — pode até apagar um candle inteiro do meio do histórico (caso real: TUTUSDT-15m.json
 * perdeu o candle das 15:30 UTC em 12/08/2026, o que fez o bollinger-bands-bot calcular a
 * banda superior errada e vender cedo demais).
 *
 * Implementado via criação exclusiva de arquivo (`wx`) como mutex — sem dependência nova.
 */
async function withFileLock(key, fn) {
  const lockPath = path.join(LOCK_DIR, `${key}.lock`);
  await fs.mkdir(LOCK_DIR, { recursive: true });

  const start = Date.now();
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.close();
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > STALE_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch { /* lock liberado entre o EEXIST e o stat — tenta de novo */ }
      if (Date.now() - start > MAX_WAIT_MS) break;
      await new Promise(r => setTimeout(r, RETRY_MS));
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

module.exports = { withFileLock };
