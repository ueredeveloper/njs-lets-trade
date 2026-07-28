const router = require("express").Router();

const CHOP_PERIOD = 14;

/** Choppiness Index clássico: 100*log10(soma(TrueRange,n)/(máxima(n)-mínima(n)))/log10(n). */
function computeChoppiness(candles, period = CHOP_PERIOD) {
  if (!Array.isArray(candles) || candles.length < period + 1) return [];

  const highs  = candles.map(c => parseFloat(c.high));
  const lows   = candles.map(c => parseFloat(c.low));
  const closes = candles.map(c => parseFloat(c.close));

  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }

  const result = [];
  for (let i = period; i < candles.length; i++) {
    const trWindow = tr.slice(i - period, i);
    const sumTR = trWindow.reduce((a, b) => a + b, 0);
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    result.push(hh - ll > 0 ? 100 * Math.log10(sumTR / (hh - ll)) / Math.log10(period) : null);
  }
  return result;
}

router.post("/choppiness", async (req, res) => {
  const candles = req.body;
  res.send(computeChoppiness(candles));
});

module.exports = router;
