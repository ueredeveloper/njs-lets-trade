const router = require('express').Router();
const { MACD } = require('technicalindicators');

// MACD 12/26/9 (períodos fixos — mesmos do bot RSI Momentum / backtest, ver
// backend/bot/rsi-momentum/strategyEngine.js). Só o intervalo dos candles é escolhido no
// painel do gráfico; aqui a rota só recebe os candles e devolve as 3 séries.
const FAST_PERIOD = 12;
const SLOW_PERIOD = 26;
const SIGNAL_PERIOD = 9;

/**
 * Rota POST para calcular o MACD (linha MACD / linha de sinal / histograma).
 * @route POST /services/macd
 * @param {Array} req.body - Array de candles com valores de fechamento (`close`)
 * @returns {Array} results - Array de { macd, signal, histogram } alinhado ao fim das velas
 */
router.post('/macd', async (req, res) => {
  const candles = Array.isArray(req.body) ? req.body : [];
  const values = candles.map(c => parseFloat(c.close)).filter(Number.isFinite);

  if (values.length < SLOW_PERIOD + SIGNAL_PERIOD) {
    return res.send([]);
  }

  const series = MACD.calculate({
    values,
    fastPeriod: FAST_PERIOD,
    slowPeriod: SLOW_PERIOD,
    signalPeriod: SIGNAL_PERIOD,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  res.send(series.map(r => ({
    macd: Number.isFinite(r.MACD) ? r.MACD : null,
    signal: Number.isFinite(r.signal) ? r.signal : null,
    histogram: Number.isFinite(r.histogram) ? r.histogram : null,
  })));
});

module.exports = router;
