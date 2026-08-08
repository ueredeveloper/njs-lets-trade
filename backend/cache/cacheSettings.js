'use strict';

// Registro central de liga/desliga por cache — consultado pelos módulos de cache (na leitura
// dos presets/entradas) e pelos ciclos de warmup em background do server.js. Desligar um cache
// aqui não quebra o filtro correspondente: cada endpoint já tem um caminho de cálculo ao vivo
// (usado hoje em qualquer combinação fora do preset padrão) — só passa a ser sempre usado.

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'cache-settings.json');

/** Ids usados tanto pelos módulos de cache (gate interno) quanto pelo seletor no frontend. */
const CACHE_IDS = [
  'rsi',
  'maTimeAbove',
  'maCross',
  'maCompare',
  'maDistance',
  'bbPosition',
  'vwapPosition',
  'vwapBandWidth',
  'bbBandWidth4h',
  'bbBandWidth1m',
  'bbBandWidth5m',
  'vwapBandExpansion',
  'indicatorGrowth',
  'mcFavoritesStats',
  'vwapFavoritesStats',
];

/**
 * Ids que nascem desligados: escanear os ~500 pares USDT em 1min não cabe no orçamento da
 * fila global de candles (~24 req/min, protegendo contra ban da Binance — 1min fica stale
 * de novo antes de uma volta completa terminar). Fica disponível pra quem quiser ligar
 * manualmente em Configurações, ciente do trade-off.
 */
const DEFAULT_OFF = new Set(['bbBandWidth1m']);

let settings = null;

function defaults() {
  return Object.fromEntries(CACHE_IDS.map((id) => [id, !DEFAULT_OFF.has(id)]));
}

function loadSync() {
  try {
    const raw = fsSync.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    settings = { ...defaults(), ...data };
  } catch {
    settings = defaults();
  }
  return settings;
}

function get() {
  if (!settings) loadSync();
  return settings;
}

function isEnabled(id) {
  const s = get();
  return s[id] !== false;
}

async function save(next) {
  const merged = { ...defaults(), ...get(), ...next };
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  settings = merged;
  return settings;
}

module.exports = { CACHE_IDS, get, isEnabled, save, loadSync };
