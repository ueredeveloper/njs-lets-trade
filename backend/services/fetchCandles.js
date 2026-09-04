const { getCandles }    = require('../binance');
const { getGateCandles } = require('../gate/getGateCandles');
const { getCandlesAroundTime } = require('../utils/getCandlesAroundTime');

const router = require('express').Router();

router.get('/candles', async (req, res) => {
  const { symbol, interval, limit, source, fromMs, toMs, pad } = req.query;
  try {
    // fromMs+toMs presentes: busca ANCORADA num período específico (ex.: abrir um trade do
    // backtest no gráfico — ver openOnChart em StatisticsPanel.jsx), não "os últimos N até
    // agora". Necessário pra trades antigos, que o cache rolante (getCandles/getGateCandles,
    // sempre relativo a "agora") não alcança de volta — ver getCandlesAroundTime.js.
    if (fromMs != null && toMs != null) {
      const slim = await getCandlesAroundTime(
        symbol, interval, source, Number(fromMs), Number(toMs),
        pad != null ? Number(pad) : undefined,
      );
      return res.send(JSON.stringify(slim));
    }
    const fn       = source === 'gate' ? getGateCandles : getCandles;
    const response = await fn(symbol, interval, limit);
    if (!Array.isArray(response)) {
      return res.status(502).json({ error: 'Candle data unavailable for this symbol' });
    }
    const slim = response.map(({ openTime, open, high, low, close, volume }) =>
      ({ openTime, open, high, low, close, volume }));
    res.send(JSON.stringify(slim));
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
