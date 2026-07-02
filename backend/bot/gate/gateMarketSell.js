'use strict';

/**
 * Venda spot na Gate.io — lógica compartilhada (Multi-Trade, 5min Trade, etc.)
 *
 * Evita erros comuns: saldo > qty registrada, amount_precision, min_base_amount,
 * mercado ilíquido (IOC no bid) e ordem market sem preenchimento.
 */

const GATE_PUBLIC_BASE = 'https://api.gateio.ws/api/v4';

const pairMetaCache = new Map();

async function getGatePairMeta(pair) {
  if (pairMetaCache.has(pair)) return pairMetaCache.get(pair);
  try {
    const data = await fetch(`${GATE_PUBLIC_BASE}/spot/currency_pairs/${pair}`).then(r => r.json());
    const meta = {
      amountPrecision: Number.isFinite(data?.amount_precision) ? data.amount_precision : 8,
      pricePrecision:  Number.isFinite(data?.precision) ? data.precision : 8,
      minBaseAmount:   parseFloat(data?.min_base_amount || 0),
    };
    pairMetaCache.set(pair, meta);
    return meta;
  } catch {
    const fallback = { amountPrecision: 8, pricePrecision: 8, minBaseAmount: 0 };
    pairMetaCache.set(pair, fallback);
    return fallback;
  }
}

function floorGateAmount(qty, decimals) {
  const factor  = 10 ** decimals;
  const floored = Math.floor(parseFloat(qty) * factor + 1e-12) / factor;
  if (floored <= 0) return null;
  return floored.toFixed(decimals);
}

function formatGatePrice(price, decimals) {
  const factor  = 10 ** decimals;
  const rounded = Math.floor(parseFloat(price) * factor + 1e-12) / factor;
  if (rounded <= 0) return null;
  return rounded.toFixed(decimals);
}

function resolveGateSellAggressive(config, volumeUsdt, minVolumeUsdt = 1_000_000) {
  if (config?.allowLowVolume) return true;
  if (config?.aggressiveExitOnLowVolume === false) return false;
  if (volumeUsdt == null) return true;
  const min = config?.minVolumeUsdt ?? minVolumeUsdt;
  return volumeUsdt < min;
}

function parseFilledOrder(filled, fallbackPrice = 0) {
  const soldQty   = parseFloat(filled.amount) - parseFloat(filled.left || 0);
  const usdtOut   = parseFloat(filled.filled_total || 0);
  const exitPrice = parseFloat(filled.avg_deal_price || fallbackPrice || 0);
  return { soldQty, usdtOut: usdtOut || (soldQty > 0 ? soldQty * exitPrice : 0), exitPrice };
}

async function postGateSellOrder(gateReq, pair, { type, price, amountStr, timeInForce = 'ioc' }) {
  const body = {
    currency_pair: pair, side: 'sell', type,
    amount: amountStr, time_in_force: timeInForce,
  };
  if (price != null) body.price = String(price);
  const order = await gateReq('POST', '/spot/orders', body);
  await new Promise(r => setTimeout(r, type === 'limit' ? 1500 : 2000));
  const filled = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
  return parseFilledOrder(filled, price || 0);
}

/**
 * @param {object} deps
 * @param {Function} deps.gateReq
 * @param {Function} deps.getTokenBalance  async (pair) => number
 */
async function gateMarketSell(deps, pair, qty, log, { aggressive = true, fmtPrice = (n) => String(n) } = {}) {
  const { gateReq, getTokenBalance } = deps;
  const meta = await getGatePairMeta(pair);

  async function resolveSellAmount(requestedQty) {
    const balance     = await getTokenBalance(pair);
    const tradableBal = parseFloat(floorGateAmount(balance, meta.amountPrecision) || '0');
    const sellQty     = Math.min(parseFloat(requestedQty), tradableBal);
    if (sellQty <= 0) {
      throw new Error(`Gate.io: saldo insuficiente (disponível: ${balance}, negociável: ${tradableBal})`);
    }
    const amountStr = floorGateAmount(sellQty, meta.amountPrecision);
    if (!amountStr) throw new Error(`Gate.io: quantidade inválida após arredondamento (${sellQty})`);
    if (meta.minBaseAmount > 0 && parseFloat(amountStr) < meta.minBaseAmount) {
      throw new Error(`Gate.io: qty ${amountStr} abaixo do mínimo ${meta.minBaseAmount}`);
    }
    if (sellQty < parseFloat(requestedQty)) {
      log?.(`⚠️  Qty ajustada: ${requestedQty} → ${amountStr} (saldo negociável)`);
    }
    return amountStr;
  }

  async function trySell(amountStr) {
    if (aggressive) {
      try {
        const ticker = await fetch(`${GATE_PUBLIC_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
        const bidRaw = parseFloat(ticker[0]?.highest_bid || ticker[0]?.last);
        const bid    = bidRaw > 0 ? formatGatePrice(bidRaw, meta.pricePrecision) : null;
        if (bid) {
          log?.(`📉 Venda IOC no bid $${fmtPrice(bid)}`);
          const ioc = await postGateSellOrder(gateReq, pair, {
            type: 'limit', price: bid, amountStr, timeInForce: 'ioc',
          });
          if (ioc.soldQty > 0) return ioc;
          log?.(`⚠️  IOC zero — tentando market`);
        }
      } catch (err) { log?.(`⚠️  IOC falhou (${err.message}) — tentando market`); }
    }

    const market = await postGateSellOrder(gateReq, pair, { type: 'market', amountStr });
    if (market.soldQty > 0) return market;

    // Alguns pares rejeitam market+ioc — tenta sem time_in_force
    try {
      const order = await gateReq('POST', '/spot/orders', {
        currency_pair: pair, side: 'sell', type: 'market', amount: amountStr,
      });
      await new Promise(r => setTimeout(r, 2000));
      const filled = await gateReq('GET', `/spot/orders/${order.id}`, { currency_pair: pair });
      const retry  = parseFilledOrder(filled);
      if (retry.soldQty > 0) return retry;
    } catch {}

    return market;
  }

  let amountStr = await resolveSellAmount(qty);
  let result    = await trySell(amountStr);
  if (result.soldQty > 0) return result;

  // Retry com saldo atualizado (pode ter mudado após arredondamento ou ordem parcial)
  log?.(`⚠️  Venda não preenchida — retentando com saldo atual`);
  amountStr = await resolveSellAmount(qty);
  result    = await trySell(amountStr);
  if (result.soldQty <= 0) {
    throw new Error('Gate.io: venda não preenchida após retentativa');
  }
  return result;
}

module.exports = { gateMarketSell, resolveGateSellAggressive, floorGateAmount, getGatePairMeta };
