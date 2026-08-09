'use strict';

const router = require('express').Router();
const monitor = require('../market/volumeIgnitionMonitor');

// GET /services/volume-ignition — pares que dispararam o alerta de volume nos últimos 15min
router.get('/volume-ignition', (req, res) => {
  res.json({ list: monitor.getFlagged(), status: monitor.getStatus() });
});

module.exports = router;
