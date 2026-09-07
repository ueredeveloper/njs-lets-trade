'use strict';

/**
 * Log combinado do launcher dos bots (start-bands-bots.js).
 *
 * Os bots rodam em processos filhos; sem isto o stdout deles só existe no terminal
 * que rodou `npm run bots:bands`. Aqui a saída dos filhos é espelhada no console E
 * gravada num arquivo com rotação simples por tamanho — é esse arquivo que o
 * `/admin/log` do njs-whatsapp vai ler.
 */

const fs = require('fs');
const path = require('path');
const { internalConfig } = require('./internalConfig');

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB → rotaciona
const KEEP_OLD = 1;                // mantém launcher.log.1

const LOG_FILE = internalConfig.logFile;

let stream = null;

// Os bots colorem o stdout com ANSI (cor por símbolo). No console fica bonito, mas
// no arquivo — que o /admin/log serve como texto puro pro WhatsApp — vira lixo
// (`[94m...`). Tira o escape só na gravação em disco; o console segue colorido.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;
function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '');
}

function ensureDir() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function rotateIfNeeded() {
  let size = 0;
  try { size = fs.statSync(LOG_FILE).size; } catch { return; }
  if (size < MAX_BYTES) return;

  if (stream) { stream.end(); stream = null; }
  for (let i = KEEP_OLD; i >= 1; i--) {
    const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
    const dst = `${LOG_FILE}.${i}`;
    try { fs.rmSync(dst, { force: true }); } catch {}
    try { fs.renameSync(src, dst); } catch {}
  }
}

function getStream() {
  if (stream) return stream;
  ensureDir();
  rotateIfNeeded();
  stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  stream.on('error', () => { stream = null; });
  return stream;
}

/** Grava uma linha no arquivo (sem afetar o console). ANSI é removido só aqui. */
function writeLine(line) {
  try {
    const clean = stripAnsi(line.endsWith('\n') ? line : line + '\n');
    getStream().write(clean);
    rotateIfNeeded();
  } catch { /* log não pode derrubar o launcher */ }
}

/**
 * Encaminha um readable stream (stdout/stderr de um filho) para o console e o arquivo,
 * prefixando cada linha com o label do bot.
 */
function pipeChildOutput(readable, { label, target }) {
  const out = target === 'stderr' ? process.stderr : process.stdout;
  let buf = '';
  readable.setEncoding('utf8');
  readable.on('data', (chunk) => {
    out.write(chunk);
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      writeLine(`[${label}] ${line}`);
    }
  });
  readable.on('end', () => { if (buf) writeLine(`[${label}] ${buf}`); buf = ''; });
}

/** Últimas `lines` linhas do log (arquivo atual + rotacionado, se preciso). */
function tail(lines = 100) {
  const wanted = Math.max(1, Math.min(lines, 2000));
  const parts = [];
  for (const f of [`${LOG_FILE}.1`, LOG_FILE]) {
    try { parts.push(fs.readFileSync(f, 'utf8')); } catch { /* pode não existir */ }
  }
  const all = parts.join('').split('\n').filter(Boolean);
  return all.slice(-wanted);
}

function close() {
  if (stream) { try { stream.end(); } catch {} stream = null; }
}

module.exports = { writeLine, pipeChildOutput, tail, close, LOG_FILE };
