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

const STABLE_COINS   = new Set(['BUSD', 'TUSD', 'DAI', 'FDUSD']);
const IGNORE_FILE    = path.join(__dirname, '../data/active-trades-ignore.json');

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

async function getGateBalances() {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts');
    const map = new Map();
    for (const a of accounts) {
      const qty = parseFloat(a.available || 0);
      if (qty > 0) map.set(a.currency.toUpperCase(), qty);
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
      const qty = parseFloat(b.free || 0);
      if (qty > 0) map.set(b.asset.toUpperCase(), qty);
    }
    return { ok: true, map };
  } catch (err) {
    console.error('[active-trades] Binance balance error:', err.message);
    return { ok: false, map: new Map() };
  }
}

// GET /services/active-trades/debug  → saldos brutos de cada exchange
router.get('/active-trades/debug', async (req, res) => {
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

    // Preços Binance
    const priceMap = new Map();
    try {
      const tickers = await getTickers();
      for (const t of tickers) {
        if (t.symbol.endsWith('USDT'))
          priceMap.set(t.symbol.slice(0, -4).toUpperCase(), parseFloat(t.lastPrice));
      }
    } catch (err) {
      console.error('[active-trades] Binance ticker error:', err.message);
    }

    // Preços Gate.io como fallback para tokens sem par na Binance (endpoint público)
    try {
      const res  = await fetch('https://api.gateio.ws/api/v4/spot/tickers');
      const data = await res.json();
      for (const t of data) {
        if (!t.currency_pair.endsWith('_USDT')) continue;
        const base = t.currency_pair.replace('_USDT', '').toUpperCase();
        if (!priceMap.has(base)) priceMap.set(base, parseFloat(t.last));
      }
    } catch (err) {
      console.error('[active-trades] Gate ticker error:', err.message);
    }

    const currencies = new Set([
      ...(gateOk    ? gateBalances.keys()    : []),
      ...(binanceOk ? binanceBalances.keys() : []),
    ]);

    const result = [];
    for (const asset of currencies) {
      if (STABLE_COINS.has(asset)) continue;
      if (ignoreList.has(asset))   continue;

      const gateQty    = gateBalances.get(asset)    ?? 0;
      const binanceQty = binanceBalances.get(asset) ?? 0;
      const totalQty   = gateQty + binanceQty;
      if (totalQty <= 0) continue;

      const exchange = binanceQty > 0 && gateQty === 0 ? 'binance'
                     : gateQty > 0 && binanceQty === 0 ? 'gate'
                     : 'both';

      if (asset === 'USDT' || asset === 'USDC') {
        // Emite uma entrada por exchange (símbolos distintos para evitar colisão no Map)
        if (gateQty >= MIN_HOLDING_USDT)
          result.push({ symbol: `${asset}_GATE`, exchange: 'gate',    buyQty: gateQty,    buyPrice: 1 });
        if (binanceQty >= MIN_HOLDING_USDT)
          result.push({ symbol: `${asset}_BNB`,  exchange: 'binance', buyQty: binanceQty, buyPrice: 1 });
        continue;
      }

      const price       = priceMap.get(asset) ?? 0;
      // Preço desconhecido em ambas exchanges → ignorar (não tem como calcular valor)
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
  if (s.startsWith('USDT_') || s === 'USDT') return 'USDT';
  if (s.startsWith('USDC_') || s === 'USDC') return 'USDC';
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
    balanceCache = null; // força refresh imediato
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
