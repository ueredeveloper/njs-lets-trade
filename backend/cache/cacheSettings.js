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
  'bbBandWidth1h',
  'bbBandWidth15m',
  'bbBandWidth5m',
  'bbMedianTrend1h',
  'bbMedianTrend15m',
  'bbMedianTrend5m',
  'vwapBandExpansion',
  'indicatorGrowth',
  'mcFavoritesStats',
  'vwapFavoritesStats',
];

/**
 * Só os caches realmente em uso agora ficam ligados por padrão: largura de Bollinger e
 * trades BB c/ tendência da mediana, em 1h, 15min e 5min. O resto nasce desligado — cada
 * endpoint já tem um caminho de cálculo ao vivo (usado hoje em qualquer combinação fora do
 * preset padrão), então desligar aqui não quebra nenhum filtro, só deixa de pré-aquecer.
 * Fica disponível pra quem quiser religar manualmente em Configurações.
 */
const DEFAULT_ON = new Set([
  'bbBandWidth1h', 'bbBandWidth15m', 'bbBandWidth5m',
  'bbMedianTrend1h', 'bbMedianTrend15m', 'bbMedianTrend5m',
]);

let settings = null;

function defaults() {
  return Object.fromEntries(CACHE_IDS.map((id) => [id, DEFAULT_ON.has(id)]));
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
