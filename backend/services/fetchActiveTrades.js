const router          = require('express').Router();
const { gateRequest } = require('../gate/getGateClient');
const getTickers      = require('../binance/cachedTicker24hr');
const crypto          = require('crypto');
const path            = require('path');
const fs              = require('fs');

const MIN_HOLDING_USDT = 3;
const BINANCE_BASE     = 'https://api.binance.com';
const BALANCE_TTL_MS   = 30_000;
const CLOCK_TTL_MS     = 60 * 60_000;

/** Stablecoins USD-pegged exibidas como caixa (preço = 1). */
const STABLE_USD = new Set(['USDT', 'USDC']);

/** Outras stablecoins ignoradas (não listar como holding). */
const STABLE_IGNORE = new Set(['BUSD', 'TUSD', 'DAI', 'FDUSD']);

/**
 * Fiats spot sem par {ASSET}USDT — preço = 1 / USDT{FIAT} (ex.: USDTBRL).
 * Inclui os mais comuns na Binance/Gate.
 */
const FIAT_ASSETS = new Set([
  'BRL', 'EUR', 'TRY', 'GBP', 'ARS', 'AUD', 'BIDR',
  'NGN', 'PLN', 'RON', 'RUB', 'UAH', 'ZAR', 'JPY', 'MXN',
]);

const IGNORE_FILE = path.join(__dirname, '../data/active-trades-ignore.json');

function readIgnoreList() {
  try { return new Set(JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf8'))); }
  catch { return new Set(); }
}

function writeIgnoreList(set) {
  fs.writeFileSync(IGNORE_FILE, JSON.stringify([...set], null, 2));
}

let binanceClockOffset = 0;
let binanceClockSyncAt = 0;

async function syncBinanceClock() {
  if (Date.now() - binanceClockSyncAt < CLOCK_TTL_MS) return;
  try {
    const res  = await fetch(`${BINANCE_BASE}/api/v3/time`);
    const data = await res.json();
    binanceClockOffset = Math.floor(data.serverTime / 1000) - Math.floor(Date.now() / 1000);
    binanceClockSyncAt = Date.now();
  } catch {
    binanceClockOffset = 0;
  }
}

let balanceCache    = null;
let balanceCachedAt = 0;

/** Soma available + locked (+ freeze legado Gate). */
function qtyTotal(parts) {
  return parts.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
}

async function getGateBalances() {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts');
    const map = new Map();
    for (const a of accounts) {
      // available = livre; locked/freeze = em ordens abertas / processamento
      const qty = qtyTotal([a.available, a.locked, a.freeze]);
      if (qty > 0) map.set(String(a.currency).toUpperCase(), qty);
    }
    return { ok: true, map };
  } catch (err) {
    console.error('[active-trades] Gate.io balance error:', err.message);
    return { ok: false, map: new Map() };
  }
}

async function getBinanceBalances() {
  try {
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_SECRET_KEY;
    if (!apiKey || !secret) return { ok: false, map: new Map() };

    await syncBinanceClock();
    const timestamp = Math.floor(Date.now() / 1000 + binanceClockOffset) * 1000;
    const qs  = `timestamp=${timestamp}&recvWindow=10000`;
    const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex');
    const res = await fetch(`${BINANCE_BASE}/api/v3/account?${qs}&signature=${sig}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('[active-trades] Binance balance error:', res.status, body.msg ?? '');
      return { ok: false, map: new Map() };
    }
    const data = await res.json();
    const map = new Map();
    for (const b of data.balances || []) {
      const qty = qtyTotal([b.free, b.locked]);
      if (qty > 0) map.set(String(b.asset).toUpperCase(), qty);
    }
    return { ok: true, map };
  } catch (err) {
    console.error('[active-trades] Binance balance error:', err.message);
    return { ok: false, map: new Map() };
  }
}

/** Preço em USDT por unidade do fiat via par USDT{FIAT} (inverse). */
function fiatPriceFromTickers(asset, tickerBySymbol) {
  const pair = `USDT${asset}`;
  const t = tickerBySymbol.get(pair);
  if (!t) return 0;
  const usdtPerFiat = parseFloat(t.lastPrice ?? t.price ?? 0);
  if (!usdtPerFiat || usdtPerFiat <= 0) return 0;
  return 1 / usdtPerFiat;
}

// GET /services/active-trades/debug  → saldos brutos de cada exchange
router.get('/active-trades/debug', async (req, res) => {
  balanceCache = null; // sempre fresco no debug
  const [gate, binance] = await Promise.all([getGateBalances(), getBinanceBalances()]);
  res.json({
    gate:    { ok: gate.ok,    balances: Object.fromEntries(gate.map) },
    binance: { ok: binance.ok, balances: Object.fromEntries(binance.map) },
  });
});

// GET /services/active-trades
router.get('/active-trades', async (req, res) => {
  try {
    if (!balanceCache || Date.now() - balanceCachedAt > BALANCE_TTL_MS) {
      const [gate, binance] = await Promise.all([getGateBalances(), getBinanceBalances()]);
      balanceCache    = { gate, binance };
      balanceCachedAt = Date.now();
    }
    const { ok: gateOk, map: gateBalances }      = balanceCache.gate;
    const { ok: binanceOk, map: binanceBalances } = balanceCache.binance;

    if (!gateOk && !binanceOk) return res.json([]);

    const ignoreList = readIgnoreList();

    // Preços Binance (pares *USDT + mapa bruto para fiats USDT*)
    const priceMap = new Map();
    const tickerBySymbol = new Map();
    try {
      const tickers = await getTickers();
      for (const t of tickers) {
        tickerBySymbol.set(t.symbol, t);
        if (t.symbol.endsWith('USDT'))
          priceMap.set(t.symbol.slice(0, -4).toUpperCase(), parseFloat(t.lastPrice));
      }
    } catch (err) {
      console.error('[active-trades] Binance ticker error:', err.message);
    }

    // Preços Gate.io como fallback para tokens sem par na Binance
    try {
      const gateRes = await fetch('https://api.gateio.ws/api/v4/spot/tickers');
      const data = await gateRes.json();
      for (const t of data) {
        if (!t.currency_pair.endsWith('_USDT')) continue;
        const base = t.currency_pair.replace('_USDT', '').toUpperCase();
        if (!priceMap.has(base)) priceMap.set(base, parseFloat(t.last));
      }
    } catch (err) {
      console.error('[active-trades] Gate ticker error:', err.message);
    }

    // Fiats: preço USDT por unidade via USDT{FIAT}
    for (const fiat of FIAT_ASSETS) {
      if (priceMap.has(fiat)) continue;
      const p = fiatPriceFromTickers(fiat, tickerBySymbol);
      if (p > 0) priceMap.set(fiat, p);
    }

    const currencies = new Set([
      ...(gateOk    ? gateBalances.keys()    : []),
      ...(binanceOk ? binanceBalances.keys() : []),
    ]);

    const result = [];
    for (const asset of currencies) {
      if (STABLE_IGNORE.has(asset)) continue;
      if (ignoreList.has(asset))   continue;

      const gateQty    = gateBalances.get(asset)    ?? 0;
      const binanceQty = binanceBalances.get(asset) ?? 0;
      const totalQty   = gateQty + binanceQty;
      if (totalQty <= 0) continue;

      const exchange = binanceQty > 0 && gateQty === 0 ? 'binance'
                     : gateQty > 0 && binanceQty === 0 ? 'gate'
                     : 'both';

      // Caixa USD (USDT/USDC) e fiat (BRL…): uma linha por exchange, chave sintética
      if (STABLE_USD.has(asset) || FIAT_ASSETS.has(asset)) {
        const price = STABLE_USD.has(asset) ? 1 : (priceMap.get(asset) ?? 0);
        if (price <= 0) continue;

        const pushCash = (qty, exch, suffix) => {
          if (qty * price < MIN_HOLDING_USDT) return;
          result.push({
            symbol: `${asset}_${suffix}`,
            exchange: exch,
            buyQty: qty,
            buyPrice: price,
          });
        };
        pushCash(gateQty, 'gate', 'GATE');
        pushCash(binanceQty, 'binance', 'BNB');
        continue;
      }

      const price = priceMap.get(asset) ?? 0;
      if (price === 0) continue;

      const holdingUsdt = totalQty * price;
      if (holdingUsdt < MIN_HOLDING_USDT) continue;

      result.push({ symbol: `${asset}USDT`, exchange, buyQty: totalQty, buyPrice: price });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function toIgnoreAsset(symbol) {
  const s = String(symbol ?? '').toUpperCase();
  // Chaves sintéticas CASH_GATE / CASH_BNB → asset
  const m = s.match(/^([A-Z0-9]+)_(GATE|BNB)$/);
  if (m) return m[1];
  if (s === 'USDT' || s === 'USDC') return s;
  return s.replace(/USDT$/, '');
}

// POST /services/active-trades/ignore  { symbol: "HYPEUSDT" }  → adiciona à lista
router.post('/active-trades/ignore', (req, res) => {
  try {
    const raw = toIgnoreAsset(req.body?.symbol);
    if (!raw) return res.status(400).json({ error: 'symbol obrigatório' });
    const list = readIgnoreList();
    list.add(raw);
    writeIgnoreList(list);
    balanceCache = null;
    res.json({ ignored: [...list] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /services/active-trades/ignore/:symbol  → remove da lista
router.delete('/active-trades/ignore/:symbol', (req, res) => {
  try {
    const raw = toIgnoreAsset(req.params.symbol);
    const list = readIgnoreList();
    list.delete(raw);
    writeIgnoreList(list);
    balanceCache = null;
    res.json({ ignored: [...list] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
