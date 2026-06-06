const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const PREFS_FILE = path.join(__dirname, '../data/user-prefs.json');

const DEFAULTS = {
  intervals:        ['30m', '4h', '8h'],
  chartInterval:    '30m',
  recentIndicators: [],
};

function read() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

function write(prefs) {
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

router.get('/user-prefs', (req, res) => res.json(read()));

router.post('/user-prefs', (req, res) => {
  const prefs  = read();
  const { intervals, chartInterval, indicator } = req.body ?? {};

  if (Array.isArray(intervals))       prefs.intervals     = intervals;
  if (typeof chartInterval === 'string') prefs.chartInterval = chartInterval;

  if (indicator) {
    const key = JSON.stringify({ type: indicator.type, ...indicator });
    const idx = prefs.recentIndicators.findIndex(r => r.key === key);
    if (idx !== -1) {
      prefs.recentIndicators[idx].count++;
      prefs.recentIndicators[idx].lastUsed = new Date().toISOString();
    } else {
      prefs.recentIndicators.unshift({ key, config: indicator, count: 1, lastUsed: new Date().toISOString() });
    }
    prefs.recentIndicators = prefs.recentIndicators
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
  }

  write(prefs);
  res.json(prefs);
});

module.exports = router;
