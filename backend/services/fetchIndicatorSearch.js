const router = require("express").Router();
const { RSI } = require('technicalindicators');
const getCandles = require('../binance/getCandles');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { get: rsiGet, storeFromCandles } = require('../cache/rsiCache');

const CANDLES_LIMIT = 200;
const CONCURRENCY = 30;

function parseQuery(query) {
  const parts = query.trim().split('|');
  if (parts.length < 4) {
    throw new Error('Formato inválido. Use: interval|indicator|condition|value[|condition|value]');
  }

  const interval = parts[0];
  const indicatorRaw = parts[1].toLowerCase();
  const indicator = (indicatorRaw === 'rsi' || indicatorRaw === 'r') ? 'rsi' : indicatorRaw;

  const conditions = [];
  for (let i = 2; i + 1 < parts.length; i += 2) {
    const cond = parts[i].toLowerCase();
    const val = parseFloat(parts[i + 1]);
    if (isNaN(val)) continue;
    const type = (cond === 'above' || cond === 'a') ? 'above' : 'below';
    conditions.push({ type, value: val });
  }

  if (conditions.length === 0) throw new Error('Nenhuma condição válida encontrada');

  const shortIndicator = indicator === 'rsi' ? 'r' : indicator;
  const condStr = conditions.map(c => `${c.type === 'above' ? 'a' : 'b'}|${c.value}`).join('|');
  const nome = `${interval}|${shortIndicator}|${condStr}`;

  return { interval, indicator, conditions, nome };
}

function satisfiesConditions(value, conditions) {
  return conditions.every(cond =>
    cond.type === 'above' ? value >= cond.value : value <= cond.value
  );
}

function calcRSI(candles) {
  return RSI.calculate({ values: candles.map(c => parseFloat(c.close)), period: 14 });
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach(r => {
      if (r.status === 'fulfilled' && r.value !== null) results.push(r.value);
    });
  }
  return results;
}

router.get('/indicator-search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Parâmetro query obrigatório. Ex: ?query=8h|rsi|above|70|below|99' });
    }

    const { interval, indicator, conditions, nome } = parseQuery(query);

    if (indicator !== 'rsi') {
      return res.status(400).json({ error: `Indicador "${indicator}" não suportado neste endpoint` });
    }

    const { list: symbols } = await getActiveUsdtPairs();
    const timestamp = Date.now();

    const hits = [];
    const misses = [];

    // Caminho rápido: leitura do cache em memória (sem I/O)
    for (const symbol of symbols) {
      const entry = rsiGet(symbol, interval);
      if (!entry) {
        misses.push(symbol);
        continue;
      }
      if (satisfiesConditions(entry.rsi, conditions)) {
        hits.push({
          nome,
          data: timestamp,
          coin: { symbol: symbol.replace('USDT', '/USDT'), ...entry.lastCandle },
          values: entry.values,
        });
      }
    }

    // Caminho lento: símbolos sem cache (só no cold-start ou novos pares)
    if (misses.length > 0) {
      const missHits = await runWithConcurrency(misses, async (symbol) => {
        try {
          const candles = await getCandles(symbol, interval, CANDLES_LIMIT);
          if (!candles || candles.length < 15) return null;

          const indicatorValues = calcRSI(candles);
          if (!indicatorValues || indicatorValues.length === 0) return null;

          // Popula o cache com os dados já computados (sem re-buscar candles)
          storeFromCandles(symbol, interval, candles);

          const lastValue = indicatorValues[indicatorValues.length - 1];
          if (!satisfiesConditions(lastValue, conditions)) return null;

          const last = candles[candles.length - 1];
          return {
            nome,
            data: timestamp,
            coin: {
              symbol: symbol.replace('USDT', '/USDT'),
              open: last.open, high: last.high, low: last.low, close: last.close,
            },
            values: indicatorValues.slice(-20),
          };
        } catch {
          return null;
        }
      }, CONCURRENCY);

      hits.push(...missHits);
    }

    res.json(hits);
  } catch (err) {
    console.error('indicator-search error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
