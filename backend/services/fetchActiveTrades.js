const router  = require('express').Router();
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { gateRequest } = require('../gate/getGateClient');

const BOT_DATA_DIR     = path.join(__dirname, '../data/bot');
const MIN_HOLDING_USDT = 3;
const BINANCE_BASE     = 'https://api.binance.com';
const BALANCE_TTL_MS   = 30_000; // cache de saldos por 30s

let balanceCache     = null;
let balanceCachedAt  = 0;

async function getGateBalances() {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts');
    const map = new Map();
    for (const a of accounts) {
      const total = parseFloat(a.available || 0) + parseFloat(a.locked || 0);
      if (total > 0) map.set(a.currency, total);
    }
    return { ok: true, map };
  } catch {
    return { ok: false, map: new Map() };
  }
}

async function getBinanceBalances() {
  try {
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_SECRET_KEY;
    if (!apiKey || !secret) return { ok: false, map: new Map() };
    const timestamp = Date.now();
    const qs  = `timestamp=${timestamp}&recvWindow=10000`;
    const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex');
    const res = await fetch(`${BINANCE_BASE}/api/v3/account?${qs}&signature=${sig}`, {
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    if (!res.ok) return { ok: false, map: new Map() };
    const data = await res.json();
    const map = new Map();
    for (const b of data.balances || []) {
      const total = parseFloat(b.free || 0) + parseFloat(b.locked || 0);
      if (total > 0) map.set(b.asset, total);
    }
    return { ok: true, map };
  } catch {
    return { ok: false, map: new Map() };
  }
}

// GET /services/active-trades
router.get('/active-trades', async (req, res) => {
  try {
    if (!fs.existsSync(BOT_DATA_DIR)) return res.json([]);

    const files = fs.readdirSync(BOT_DATA_DIR)
      .filter(f => f.startsWith('state-') && f.endsWith('.json'));

    // Busca saldos reais (cache de 30s para não bater nas exchanges a cada requisição)
    if (!balanceCache || Date.now() - balanceCachedAt > BALANCE_TTL_MS) {
      const [gate, binance] = await Promise.all([getGateBalances(), getBinanceBalances()]);
      balanceCache    = { gate, binance };
      balanceCachedAt = Date.now();
    }
    const { ok: gateOk, map: gateBalances }       = balanceCache.gate;
    const { ok: binanceOk, map: binanceBalances }  = balanceCache.binance;

    const exchangeAvailable = gateOk || binanceOk;

    const result = [];
    for (const file of files) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(BOT_DATA_DIR, file), 'utf8'));
        if (state.phase !== 'BOUGHT' && state.phase !== 'ABOVE_70') continue;

        const symbol       = file.replace('state-', '').replace('.json', '');
        const baseCurrency = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol.slice(0, -3);

        if (exchangeAvailable) {
          // Saldo real na exchange × preço de compra (proxy conservador de valor atual)
          const balance     = (gateBalances.get(baseCurrency) ?? 0) + (binanceBalances.get(baseCurrency) ?? 0);
          const holdingUsdt = balance * (state.buyPrice ?? 0);
          if (holdingUsdt < MIN_HOLDING_USDT) continue;
        } else {
          // Fallback se ambas as APIs falharam: filtra pelo buyUsdt histórico
          if ((state.buyUsdt ?? 0) < MIN_HOLDING_USDT) continue;
        }

        result.push({
          symbol,
          phase:    state.phase,
          buyPrice: state.buyPrice ?? null,
          buyQty:   state.buyQty   ?? null,
          buyUsdt:  state.buyUsdt  ?? null,
          buyTime:  state.buyTime  ?? null,
        });
      } catch {}
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
