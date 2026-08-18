'use strict';

const router = require('express').Router();
const cacheSettings = require('../cache/cacheSettings');
const bbBandWidthCache = require('../cache/bbBandWidthCache');
const bbMedianTrendCache = require('../cache/bbMedianTrendCache');

/** Módulos de cache com presets granulares (1 settingId por combinação interval/período/
 *  candles) — usado só pra enriquecer o painel de Configurações com esses detalhes por id
 *  (ver SettingsSidebar.jsx). Módulos com um único settingId compartilhado entre vários
 *  presets (ex.: vwapBandWidth, indicatorGrowth) ficam sem esse detalhe extra — não afeta
 *  liga/desliga, só a informação exibida. */
const PRESET_MODULES = [bbBandWidthCache, bbMedianTrendCache];

function buildPresetMeta() {
  const meta = {};
  for (const mod of PRESET_MODULES) {
    for (const preset of mod.CACHED_PRESETS ?? []) {
      if (!preset.settingId) continue;
      const { key, settingId, ttlMs, lookback, ...rest } = preset;
      // Um settingId pode cobrir mais de um preset (ex.: 300 e 100 candles no mesmo
      // intervalo, ligados/desligados juntos) — acumula os lookbacks em vez de sobrescrever.
      const existing = meta[settingId];
      const lookbacks = existing ? [...existing.lookbacks, lookback] : [lookback];
      meta[settingId] = { ...rest, lookbacks };
    }
  }
  return meta;
}

// GET /services/cache-settings
router.get('/cache-settings', (req, res) => {
  res.json({ ids: cacheSettings.CACHE_IDS, enabled: cacheSettings.get(), meta: buildPresetMeta() });
});

// POST /services/cache-settings  body: { enabled: { [id]: boolean } }
router.post('/cache-settings', async (req, res) => {
  try {
    const enabled = await cacheSettings.save(req.body?.enabled ?? {});
    res.json({ ids: cacheSettings.CACHE_IDS, enabled, meta: buildPresetMeta() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
