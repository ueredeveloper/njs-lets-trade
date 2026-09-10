'use strict';

/**
 * Log combinado do launcher dos bots (start-trade-bots.js).
 *
 * Os bots rodam em processos filhos; sem isto o stdout deles só existe no terminal
 * que rodou `npm run bots`. Aqui a saída dos filhos é espelhada no console E
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

// ---------------------------------------------------------------------------
// Colapso das linhas de "heartbeat" para o /admin/log do WhatsApp
// ---------------------------------------------------------------------------
// O scanner do RSI Momentum loga um bloco a cada ciclo (~a cada 20-30 min) e o
// multitrade-watch loga "📋 Moedas avaliadas" a cada 3 min — quase sempre com o
// mesmo conteúdo (só os números mudam). No terminal do `npm run bots` e no
// arquivo em disco isso fica; mas o `/admin/log` só mostra ~25 linhas no
// WhatsApp e elas eram gastas repetindo o mesmo bloco. `collapseNoise()` mantém
// só a ÚLTIMA ocorrência de cada linha-ruído, anotada com "(N×)" e a janela de
// horário. É aplicado só na leitura via `tail()`.
const NOISE_PATTERNS = [
  /📋 Moedas avaliadas/,
  /🔎 Scan RSI Momentum:/,
  /\]\s+bloqueadas —/,
  /\]\s+erros:\s/,
  /falha ao buscar volume 24h/,
  /\[writeCandles\].*spike de preço/,
];

function isNoiseLine(line) {
  return NOISE_PATTERNS.some((re) => re.test(line));
}

// Assinatura da linha: o texto com timestamps removidos e números trocados por
// "#", pra "82 moeda(s)" e "81 moeda(s)" caírem no mesmo grupo. O prefixo
// `[label]` fica (separa os bots); mudar a lista de moedas muda a assinatura.
function noiseSignature(line) {
  return line
    .replace(/\[\d[\d:/ .-]*\]/g, '')
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrai só o horário (HH:MM ou HH:MM:SS) do 1º [bloco] tipo timestamp da linha —
// a data ("10-09/2026") é redundante numa janela de poucas horas.
const LINE_TS_RE = /\[[^\]]*?(\d{1,2}:\d{2}(?::\d{2})?)[^\]]*\]/;
function lineTimestamp(line) {
  const m = line.match(LINE_TS_RE);
  return m ? m[1] : null;
}

function collapseNoise(lines) {
  const groups = new Map(); // signature -> { count, lastIdx, first, last }
  lines.forEach((line, i) => {
    if (!isNoiseLine(line)) return;
    const sig = noiseSignature(line);
    const g = groups.get(sig) || { count: 0, first: null, last: null };
    g.count += 1;
    g.lastIdx = i;
    const ts = lineTimestamp(line);
    if (ts) { if (!g.first) g.first = ts; g.last = ts; }
    groups.set(sig, g);
  });

  const out = [];
  lines.forEach((line, i) => {
    if (!isNoiseLine(line)) { out.push(line); return; }
    const g = groups.get(noiseSignature(line));
    if (!g || i !== g.lastIdx) return; // só a última ocorrência de cada grupo
    if (g.count === 1) { out.push(line); return; }
    let tag = ` (${g.count}×`;
    if (g.first && g.last && g.first !== g.last) tag += `, ${g.first}→${g.last}`;
    out.push(line + tag + ')');
  });
  return out;
}

/**
 * Últimas `lines` linhas do log (arquivo atual + rotacionado, se preciso).
 * Por padrão colapsa as linhas repetitivas de heartbeat (ver `collapseNoise`);
 * passe `{ collapse: false }` pra ter o log cru.
 */
function tail(lines = 100, { collapse = true } = {}) {
  const wanted = Math.max(1, Math.min(lines, 2000));
  const parts = [];
  for (const f of [`${LOG_FILE}.1`, LOG_FILE]) {
    try { parts.push(fs.readFileSync(f, 'utf8')); } catch { /* pode não existir */ }
  }
  let all = parts.join('').split('\n').filter(Boolean);
  if (collapse) all = collapseNoise(all);
  return all.slice(-wanted);
}

function close() {
  if (stream) { try { stream.end(); } catch {} stream = null; }
}

module.exports = { writeLine, pipeChildOutput, tail, collapseNoise, close, LOG_FILE };
