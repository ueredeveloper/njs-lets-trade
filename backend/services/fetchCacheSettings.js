'use strict';

const router = require('express').Router();
const cacheSettings = require('../cache/cacheSettings');

// GET /services/cache-settings
router.get('/cache-settings', (req, res) => {
  res.json({ ids: cacheSettings.CACHE_IDS, enabled: cacheSettings.get() });
});

// POST /services/cache-settings  body: { enabled: { [id]: boolean } }
router.post('/cache-settings', async (req, res) => {
  try {
    const enabled = await cacheSettings.save(req.body?.enabled ?? {});
    res.json({ ids: cacheSettings.CACHE_IDS, enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
