const router = require('express').Router();
const { gateRequest } = require('../gate/getGateClient');
const getClient = require('../binance/getClient');

const STABLE = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'BNB']);
const CACHE_TTL_MS = 60_000;
const BINANCE_CONCURRENCY = 4;
const TRADE_LIMIT = 200;

let cache = null;
let cacheAt = 0;
let cacheKey = '';

const SP_OFFSET = '-03:00';

function startOfTodaySP(now = Date.now()) {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
  return new Date(`${dateStr}T00:00:00${SP_OFFSET}`).getTime();
}

function startOfWeekSP(now = Date.now()) {
  const startToday = startOfTodaySP(now);
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  }).format(new Date(now));
  const idx = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[dayName] ?? 0;
  return startToday - idx * 86_400_000;
}

function fromGatePair(pair) {
  return String(pair || '').replace('_', '').toUpperCase();
}

function normalizeTrade(t) {
  return {
    time: Number(t.time),
    price: parseFloat(t.price),
    qty: parseFloat(t.qty),
    isBuyer: !!t.isBuyer,
  };
}

/** FIFO: realiza PnL de vendas contra compras anteriores. */
function summarizeTrades(rawTrades, now = Date.now()) {
  const trades = (rawTrades ?? [])
    .map(normalizeTrade)
    .filter(t => Number.isFinite(t.time) && Number.isFinite(t.price) && Number.isFinite(t.qty) && t.qty > 0)
    .sort((a, b) => a.time - b.time);

  if (!trades.length) return null;

  const dayStart = startOfTodaySP(now);
  const weekStart = startOfWeekSP(now);
  const inventory = [];
  let pnlToday = 0;
  let pnlWeek = 0;
  let pnlTotal = 0;
  let buysToday = 0;
  let buysWeek = 0;
  let sellsToday = 0;
  let sellsWeek = 0;
  let lastBuyTime = null;
  let lastSellTime = null;
  let lastTradeTime = null;
  let buyCount = 0;
  let sellCount = 0;

  for (const t of trades) {
    lastTradeTime = t.time;
    if (t.isBuyer) {
      buyCount += 1;
      lastBuyTime = t.time;
      if (t.time >= dayStart) buysToday += 1;
      if (t.time >= weekStart) buysWeek += 1;
      inventory.push({ qty: t.qty, price: t.price, time: t.time });
      continue;
    }

    sellCount += 1;
    lastSellTime = t.time;
    if (t.time >= dayStart) sellsToday += 1;
    if (t.time >= weekStart) sellsWeek += 1;

    let remain = t.qty;
    let cost = 0;
    let matched = 0;
    while (remain > 1e-12 && inventory.length) {
      const lot = inventory[0];
      const take = Math.min(lot.qty, remain);
      cost += take * lot.price;
      matched += take;
      lot.qty -= take;
      remain -= take;
      if (lot.qty <= 1e-12) inventory.shift();
    }
    if (matched <= 0) continue;

    const pnlUsdt = matched * t.price - cost;
    pnlTotal += pnlUsdt;
    if (t.time >= dayStart) pnlToday += pnlUsdt;
    if (t.time >= weekStart) pnlWeek += pnlUsdt;
  }

  const openQty = inventory.reduce((s, l) => s + l.qty, 0);
  const openCost = inventory.reduce((s, l) => s + l.qty * l.price, 0);

  return {
    lastBuyTime,
    lastSellTime,
    lastTradeTime,
    buysToday,
    buysWeek,
    sellsToday,
    sellsWeek,
    buyCount,
    sellCount,
    pnlToday: Math.round(pnlToday * 100) / 100,
    pnlWeek: Math.round(pnlWeek * 100) / 100,
    pnlTotal: Math.round(pnlTotal * 100) / 100,
    openQty: openQty > 1e-12 ? openQty : 0,
    openCost: Math.round(openCost * 100) / 100,
    hasOpen: openQty > 1e-12,
  };
}

async function fetchGateAllTrades() {
  const bySymbol = new Map();
  try {
    // Sem from/to a Gate limita a ~7 dias; pedimos 30 dias (máx. da API).
    const from = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
    // currency_pair omitido → trades de todos os pares
    for (let page = 1; page <= 5; page += 1) {
      const trades = await gateRequest('GET', '/spot/my_trades', {
        limit: '1000',
        page: String(page),
        from: String(from),
      });
      if (!Array.isArray(trades) || !trades.length) break;
      for (const t of trades) {
        const symbol = fromGatePair(t.currency_pair);
        if (!symbol.endsWith('USDT')) continue;
        if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
        bySymbol.get(symbol).push({
          time: t.create_time_ms
            ? Number(t.create_time_ms)
            : Math.round(parseFloat(t.create_time) * 1000),
          price: t.price,
          qty: t.amount,
          isBuyer: t.side === 'buy',
        });
      }
      if (trades.length < 1000) break;
    }
  } catch (err) {
    console.warn('[trade-favorites] Gate trades:', err.message);
  }
  return bySymbol;
}

async function fetchBinanceSymbols(extraSymbols = []) {
  const symbols = new Set(
    (extraSymbols ?? []).map(s => String(s).toUpperCase()).filter(s => s.endsWith('USDT')),
  );
  try {
    const client = await getClient();
    const info = await client.accountInfo();
    for (const b of info.balances || []) {
      const free = parseFloat(b.free || 0);
      const locked = parseFloat(b.locked || 0);
      if (free + locked <= 0) continue;
      const asset = String(b.asset || '').toUpperCase();
      if (STABLE.has(asset)) continue;
      symbols.add(`${asset}USDT`);
    }
  } catch (err) {
    console.warn('[trade-favorites] Binance account:', err.message);
  }
  return [...symbols];
}

async function mapPool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function fetchBinanceTradesMap(symbols) {
  const bySymbol = new Map();
  if (!symbols.length) return bySymbol;
  let client;
  try {
    client = await getClient();
  } catch (err) {
    console.warn('[trade-favorites] Binance client:', err.message);
    return bySymbol;
  }

  await mapPool(symbols, BINANCE_CONCURRENCY, async (symbol) => {
    try {
      const trades = await client.myTrades({ symbol, limit: TRADE_LIMIT });
      if (!trades?.length) return;
      bySymbol.set(symbol, trades.map(t => ({
        time: Number(t.time),
        price: t.price,
        qty: t.qty,
        isBuyer: !!t.isBuyer,
      })));
    } catch {
      // par sem histórico / inválido
    }
  });
  return bySymbol;
}

function mergeExchange(gateMap, binanceMap) {
  const symbols = new Set([...gateMap.keys(), ...binanceMap.keys()]);
  const list = [];
  const now = Date.now();

  for (const symbol of symbols) {
    const gateTrades = gateMap.get(symbol) ?? [];
    const binanceTrades = binanceMap.get(symbol) ?? [];
    const hasGate = gateTrades.length > 0;
    const hasBinance = binanceTrades.length > 0;
    if (!hasGate && !hasBinance) continue;

    // Preferir exchange com trade mais recente; se empate, unir ambos
    let trades;
    let exchange;
    if (hasGate && hasBinance) {
      const lastG = Math.max(...gateTrades.map(t => Number(t.time)));
      const lastB = Math.max(...binanceTrades.map(t => Number(t.time)));
      if (Math.abs(lastG - lastB) < 60_000) {
        trades = [...gateTrades, ...binanceTrades];
        exchange = 'both';
      } else if (lastG >= lastB) {
        trades = gateTrades;
        exchange = 'gate';
      } else {
        trades = binanceTrades;
        exchange = 'binance';
      }
    } else if (hasGate) {
      trades = gateTrades;
      exchange = 'gate';
    } else {
      trades = binanceTrades;
      exchange = 'binance';
    }

    const stats = summarizeTrades(trades, now);
    if (!stats) continue;
    list.push({ symbol, exchange, ...stats });
  }

  list.sort((a, b) => (b.lastTradeTime ?? 0) - (a.lastTradeTime ?? 0));
  return list;
}

// GET /services/trade-favorites?symbols=BTCUSDT,ETHUSDT
router.get('/trade-favorites', async (req, res) => {
  try {
    const extra = String(req.query.symbols || '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    const key = extra.slice().sort().join(',');
    if (cache && cacheKey === key && Date.now() - cacheAt < CACHE_TTL_MS) {
      return res.json(cache);
    }

    const [gateMap, binanceSymbols] = await Promise.all([
      fetchGateAllTrades(),
      fetchBinanceSymbols(extra),
    ]);
    // Também buscar na Binance símbolos que só aparecem na Gate (vendidos lá)
    // e extras (favoritos) — já em binanceSymbols via extra
    const binanceMap = await fetchBinanceTradesMap(binanceSymbols);
    const list = mergeExchange(gateMap, binanceMap);

    cache = list;
    cacheAt = Date.now();
    cacheKey = key;
    res.json(list);
  } catch (err) {
    console.error('[trade-favorites]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
