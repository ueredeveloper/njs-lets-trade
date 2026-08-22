const router = require('express').Router();
const { gateRequest } = require('../gate/getGateClient');
const getClient = require('../binance/getClient');
const { toGateSymbol } = require('../utils/toGateSymbol');

const STABLE = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'BNB']);
const CACHE_TTL_MS = 60_000;
const BINANCE_CONCURRENCY = 4;
const TRADE_LIMIT = 200;

let cache = null;
let cacheAt = 0;
let cacheKey = '';

const SP_OFFSET = '-03:00';
// Lote parado há mais desse prazo quando finalmente é vendido conta como "carryover"
// (posição antiga esquecida) em vez de resultado do dia/semana — ver caso SCUSDT: 336
// unidades compradas em 29/02/2024 que só foram casadas pelo FIFO em uma venda de 2026,
// inflando o "PnL hoje" com uma perda de anos atrás.
const DUST_LOT_AGE_MS = 7 * 86_400_000;

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
    exchange: t.exchange,
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
  const weekTrades = [];
  let pnlToday = 0;
  let pnlWeek = 0;
  let pnlTotal = 0;
  let carryoverToday = 0;
  let carryoverWeek = 0;
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
      inventory.push({ qty: t.qty, price: t.price, time: t.time, exchange: t.exchange });
      continue;
    }

    sellCount += 1;
    lastSellTime = t.time;
    if (t.time >= dayStart) sellsToday += 1;
    if (t.time >= weekStart) sellsWeek += 1;

    let remain = t.qty;
    let cost = 0;
    let matched = 0;
    let staleCost = 0;
    let staleMatched = 0;
    while (remain > 1e-12 && inventory.length) {
      const lot = inventory[0];
      const take = Math.min(lot.qty, remain);
      cost += take * lot.price;
      matched += take;
      if (t.time - lot.time > DUST_LOT_AGE_MS) {
        staleCost += take * lot.price;
        staleMatched += take;
      }
      // Arredonda pra evitar arruinar de ponto flutuante acumulando a cada venda parcial
      // (ex.: 0.37 virando 0.3699999999999939) — esse qty também vai direto na ordem de
      // venda quando o lote é vendido isoladamente (ver TradeLotSellModal.jsx).
      lot.qty = Math.round((lot.qty - take) * 1e8) / 1e8;
      remain -= take;
      if (lot.qty <= 1e-12) inventory.shift();
    }
    if (matched <= 0) continue;

    const pnlUsdt = matched * t.price - cost;
    // Parte do PnL vinda de lotes "velhos" (comprados há mais de DUST_LOT_AGE_MS) —
    // não é resultado da atividade de hoje/semana, é a realização tardia de uma posição
    // antiga que o FIFO casou primeiro por ser o lote mais antigo em aberto.
    const stalePnlUsdt = staleMatched > 0 ? staleMatched * t.price - staleCost : 0;
    const freshPnlUsdt = pnlUsdt - stalePnlUsdt;
    pnlTotal += pnlUsdt;
    if (t.time >= dayStart) {
      pnlToday += freshPnlUsdt;
      carryoverToday += stalePnlUsdt;
    }
    if (t.time >= weekStart) {
      pnlWeek += freshPnlUsdt;
      carryoverWeek += stalePnlUsdt;
      // Cada venda realizada na semana vira uma entrada própria — permite listar
      // a mesma moeda mais de uma vez quando houve mais de um trade fechado.
      weekTrades.push({
        time: t.time,
        pnl: Math.round(freshPnlUsdt * 100) / 100,
        ...(stalePnlUsdt !== 0 ? { carryover: Math.round(stalePnlUsdt * 100) / 100 } : {}),
      });
    }
  }

  const openQty = inventory.reduce((s, l) => s + l.qty, 0);
  const openCost = inventory.reduce((s, l) => s + l.qty * l.price, 0);

  // Lotes de compra ainda não vendidos (FIFO) — cada um é uma compra individual
  // que ainda pode ser vendida isoladamente ("vender a compra do dia tal").
  const openLots = inventory
    .filter(l => l.qty > 1e-12)
    .map(l => ({ time: l.time, price: l.price, qty: l.qty, exchange: l.exchange }))
    .sort((a, b) => b.time - a.time);

  const oldestTradeDays = Math.min(30, Math.max(0, Math.round((now - trades[0].time) / 86_400_000)));

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
    carryoverToday: Math.round(carryoverToday * 100) / 100,
    carryoverWeek: Math.round(carryoverWeek * 100) / 100,
    weekTrades,
    openQty: openQty > 1e-12 ? openQty : 0,
    openCost: Math.round(openCost * 100) / 100,
    hasOpen: openQty > 1e-12,
    openLots,
    oldestTradeDays,
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
          exchange: 'gate',
        });
      }
      if (trades.length < 1000) break;
    }
  } catch (err) {
    console.warn('[trade-favorites] Gate trades:', err.message);
  }
  return bySymbol;
}

/**
 * Busca trades por par específico na Gate (sem `from`) — o scan de conta inteira em
 * fetchGateAllTrades() usa `from` sem `currency_pair`, combinação que na prática a Gate
 * responde com uma amostra pequena e incompleta (visto empiricamente: ~12 trades cobrindo
 * meses, ignorando trades recentes) em vez do histórico paginado esperado. Para os símbolos
 * que já sabemos ser relevantes (favoritos/bots), complementamos com uma consulta escopada
 * por par — o mesmo padrão usado por /services/gate-trades, que sempre retorna certo.
 */
async function fetchGateTradesForSymbols(symbols) {
  const bySymbol = new Map();
  if (!symbols.length) return bySymbol;

  await mapPool(symbols, BINANCE_CONCURRENCY, async (symbol) => {
    try {
      const currencyPair = toGateSymbol(symbol);
      const trades = await gateRequest('GET', '/spot/my_trades', {
        currency_pair: currencyPair,
        limit: '1000',
      });
      if (!Array.isArray(trades) || !trades.length) return;
      bySymbol.set(symbol, trades.map(t => ({
        time: t.create_time_ms
          ? Number(t.create_time_ms)
          : Math.round(parseFloat(t.create_time) * 1000),
        price: t.price,
        qty: t.amount,
        isBuyer: t.side === 'buy',
        exchange: 'gate',
      })));
    } catch (err) {
      console.warn('[trade-favorites] Gate trades', symbol, ':', err.message);
    }
  });
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
        exchange: 'binance',
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
    const fresh = req.query.fresh === '1';
    if (!fresh && cache && cacheKey === key && Date.now() - cacheAt < CACHE_TTL_MS) {
      return res.json(cache);
    }

    const [gateMap, gateExtraMap, binanceSymbols] = await Promise.all([
      fetchGateAllTrades(),
      fetchGateTradesForSymbols(extra),
      fetchBinanceSymbols(extra),
    ]);
    // Consulta escopada por par (gateExtraMap) é mais confiável que o scan de conta
    // inteira pra esses símbolos — sobrescreve em vez de só complementar.
    for (const [symbol, trades] of gateExtraMap) gateMap.set(symbol, trades);
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
