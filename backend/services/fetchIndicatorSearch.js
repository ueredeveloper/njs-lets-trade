const router = require("express").Router();
const { RSI } = require('technicalindicators');
const getClandles = require('../binance/getClandles');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const fs = require('node:fs/promises');
const path = require('path');

const INDICATORS_DIR = path.join(__dirname, '..', 'data', 'indicators');
const CANDLES_LIMIT = 200;
const CONCURRENCY = 30;

/**
 * Parse query string like "8h|rsi|above|70|below|99" or short form "8h|r|a|70|b|99".
 * Returns { interval, indicator, conditions, nome }.
 */
function parseQuery(query) {
  const parts = query.trim().split('|');
  if (parts.length < 4) {
    throw new Error('Formato inválido. Use: interval|indicator|condition|value[|condition|value]');
  }

  console.log('Parsing query:', query);

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
  const values = candles.map(c => parseFloat(c.close));
  return RSI.calculate({ values, period: 14 });
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

    const { list: symbols } = await getActiveUsdtPairs();
    const timestamp = Date.now();

    console.log(`indicator-search: "${nome}" — ${symbols.length} símbolos`);

    const results = await runWithConcurrency(symbols, async (symbol) => {
      try {
        const candles = await getClandles(symbol, interval, CANDLES_LIMIT);
        if (!candles || candles.length < 15) return null;

        let indicatorValues;
        if (indicator === 'rsi') {
          indicatorValues = calcRSI(candles);
        } else {
          return null;
        }

        if (!indicatorValues || indicatorValues.length === 0) return null;

        const lastValue = indicatorValues[indicatorValues.length - 1];
        if (!satisfiesConditions(lastValue, conditions)) return null;

        console.log(`[backend] match: ${symbol} | último ${indicator.toUpperCase()}=${lastValue.toFixed(2)}`);
        const lastCandle = candles[candles.length - 1];
        return {
          nome,
          data: timestamp,
          coin: {
            symbol: symbol.replace('USDT', '/USDT'),
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
          },
          values: indicatorValues.slice(-20),
        };
      } catch {
        return null;
      }
    }, CONCURRENCY);

    await fs.mkdir(INDICATORS_DIR, { recursive: true });
    const safeNome = nome.replace(/\|/g, '-');
    const filePath = path.join(INDICATORS_DIR, `${safeNome}-${timestamp}.json`);
    await fs.writeFile(filePath, JSON.stringify(results, null, 2));

    console.log(`indicator-search: ${results.length} moedas encontradas → ${path.basename(filePath)}`);
    res.json(results);
  } catch (err) {
    console.error('indicator-search error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
