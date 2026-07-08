'use strict';

const fs = require('fs');
const path = require('path');
const getTickers = require('../binance/cachedTicker24hr');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');

const GATE_BASE = 'https://api.gateio.ws/api/v4';
const LIMIT_DEFAULT = 10;
/**
 * Folga de candidatos: o frontend aplica Exibição de ativos (bStocks etc.)
 * e corta nos 10 finais — se cortássemos no backend, a tabela NB ficaria vazia.
 */
const CANDIDATE_MULTIPLIER = 8;
const MIN_VOLUME_USDT = 1_000_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const BINANCE_LISTING_CACHE_FILE = path.join(__dirname, '../data/binance-listing-times.json');
const BINANCE_LISTING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BINANCE_KLINE_CONCURRENCY = 12;

let _cache = null;
let _cachedAt = 0;
let _inflight = null;

function isUsdtSpot(symbol) {
  return typeof symbol === 'string' && symbol.endsWith('USDT');
}

function gatePairToSymbol(pair) {
  return pair.replace('_', '');
}

function loadBinanceListingCache() {
  try {
    if (!fs.existsSync(BINANCE_LISTING_CACHE_FILE)) return { updatedAt: 0, times: {} };
    const parsed = JSON.parse(fs.readFileSync(BINANCE_LISTING_CACHE_FILE, 'utf8'));
    return {
      updatedAt: Number(parsed.updatedAt) || 0,
      times: parsed.times && typeof parsed.times === 'object' ? parsed.times : {},
    };
  } catch {
    return { updatedAt: 0, times: {} };
  }
}

function saveBinanceListingCache(cache) {
  const dir = path.dirname(BINANCE_LISTING_CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BINANCE_LISTING_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function fetchBinanceFirstKlineTime(symbol) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=1&startTime=0`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) return null;
  const openTime = Number(data[0][0]);
  return Number.isFinite(openTime) ? openTime : null;
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function getBinanceListingTimes(symbols) {
  const cache = loadBinanceListingCache();
  const stale = Date.now() - cache.updatedAt > BINANCE_LISTING_CACHE_TTL_MS;
  const times = { ...cache.times };

  const missing = symbols.filter((sym) => stale || times[sym] == null);
  if (missing.length > 0) {
    const fetched = await mapWithConcurrency(missing, BINANCE_KLINE_CONCURRENCY, async (sym) => {
      const listedAt = await fetchBinanceFirstKlineTime(sym).catch(() => null);
      return listedAt ? [sym, listedAt] : null;
    });
    for (const row of fetched) {
      if (row) times[row[0]] = row[1];
    }
    saveBinanceListingCache({ updatedAt: Date.now(), times });
  }

  return times;
}

async function fetchGateTickers() {
  const res = await fetch(`${GATE_BASE}/spot/tickers`);
  if (!res.ok) throw new Error(`Gate tickers: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Gate tickers: resposta inesperada');
  return data;
}

async function fetchGateCurrencyPairs() {
  const res = await fetch(`${GATE_BASE}/spot/currency_pairs`);
  if (!res.ok) throw new Error(`Gate currency_pairs: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Gate currency_pairs: resposta inesperada');
  return data;
}

function buildGainersFilter(name, items) {
  const list = items.map((i) => i.symbol);
  const changePct = Object.fromEntries(items.map((i) => [i.symbol, i.changePct]));
  const volume24h = Object.fromEntries(
    items.filter((i) => Number.isFinite(i.volume)).map((i) => [i.symbol, i.volume]),
  );
  // candidates = lista folgada; frontend aplica assetDisplay e corta nos 10
  return { name, list, meta: { changePct, volume24h, candidates: list } };
}

function buildNewListingsFilter(name, items) {
  const list = items.map((i) => i.symbol);
  const listedAt = Object.fromEntries(items.map((i) => [i.symbol, i.listedAt]));
  const volume24h = Object.fromEntries(
    items.filter((i) => Number.isFinite(i.volume)).map((i) => [i.symbol, i.volume]),
  );
  return { name, list, meta: { listedAt, volume24h, candidates: list } };
}

const BINANCE_MARKETING_URL = 'https://www.binance.com/bapi/composite/v1/public/marketing/symbol/list';

async function fetchBinanceMarketingSymbols() {
  const res = await fetch(BINANCE_MARKETING_URL);
  if (!res.ok) throw new Error(`Binance marketing symbols: HTTP ${res.status}`);
  const body = await res.json();
  if (body?.code !== '000000' || !Array.isArray(body.data)) {
    throw new Error('Binance marketing symbols: resposta inesperada');
  }
  return body.data;
}

/** Rankeia candidatos em alta (USDT spot ativo, vol. mínimo). */
function rankBinanceGainers(items, activeSet, candidateLimit) {
  return items
    .filter((t) => isUsdtSpot(t.symbol) && activeSet.has(t.symbol))
    .filter((t) => Number(t.volume) >= MIN_VOLUME_USDT)
    .filter((t) => Number.isFinite(t.changePct))
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, candidateLimit);
}

function buildBinanceGainersFromMarketing(marketingRows, activeSet, candidateLimit) {
  const items = marketingRows.map((m) => ({
    symbol: m.symbol,
    changePct: Number(m.dayChange),
    volume: Number(m.volume),
  }));
  return rankBinanceGainers(items, activeSet, candidateLimit);
}

function buildBinanceGainersFromTickers(binanceTickers, activeSet, candidateLimit) {
  const items = binanceTickers.map((t) => ({
    symbol: t.symbol,
    changePct: Number(t.priceChangePercent),
    volume: Number(t.quoteVolume),
  }));
  return rankBinanceGainers(items, activeSet, candidateLimit);
}

async function computeMarketHighlights(limit = LIMIT_DEFAULT) {
  const [binanceTickers, gateTickers, activeUsdt, gatePairs] = await Promise.all([
    getTickers(),
    fetchGateTickers(),
    getActiveUsdtPairs(),
    fetchGateCurrencyPairs(),
  ]);

  const activeSet = new Set(activeUsdt.list ?? []);

  const candidateLimit = limit * CANDIDATE_MULTIPLIER;

  let binanceGainers;
  try {
    const marketingRows = await fetchBinanceMarketingSymbols();
    binanceGainers = buildBinanceGainersFromMarketing(marketingRows, activeSet, candidateLimit);
  } catch (err) {
    console.warn('[market-highlights] marketing API indisponível — fallback ticker/24hr:', err.message);
    binanceGainers = buildBinanceGainersFromTickers(binanceTickers, activeSet, candidateLimit);
  }

  const gateGainers = gateTickers
    .filter((t) => t.currency_pair?.endsWith('_USDT'))
    .filter((t) => Number(t.quote_volume) >= MIN_VOLUME_USDT)
    .map((t) => ({
      symbol: gatePairToSymbol(t.currency_pair),
      changePct: Number(t.change_percentage),
      volume: Number(t.quote_volume),
    }))
    .filter((t) => Number.isFinite(t.changePct))
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, candidateLimit);

  const binanceVolumeBySymbol = Object.fromEntries(
    binanceTickers
      .filter((t) => isUsdtSpot(t.symbol))
      .map((t) => [t.symbol, Number(t.quoteVolume)]),
  );
  const gateVolumeBySymbol = Object.fromEntries(
    gateTickers
      .filter((t) => t.currency_pair?.endsWith('_USDT'))
      .map((t) => [gatePairToSymbol(t.currency_pair), Number(t.quote_volume)]),
  );

  const nowMs = Date.now();
  const listingTimes = await getBinanceListingTimes([...activeSet]);
  const binanceNew = [...activeSet]
    .map((symbol) => ({
      symbol,
      listedAt: listingTimes[symbol] ?? null,
      volume: binanceVolumeBySymbol[symbol] ?? null,
    }))
    .filter((s) => Number.isFinite(s.listedAt) && s.listedAt <= nowMs)
    .sort((a, b) => b.listedAt - a.listedAt)
    .slice(0, candidateLimit);

  const gateNew = gatePairs
    .filter((p) => p.id?.endsWith('_USDT') && p.trade_status === 'tradable')
    .map((p) => {
      const symbol = gatePairToSymbol(p.id);
      return {
        symbol,
        listedAt: Number(p.sell_start) * 1000,
        volume: gateVolumeBySymbol[symbol] ?? null,
      };
    })
    .filter((s) => Number.isFinite(s.listedAt) && s.listedAt > 0 && s.listedAt <= nowMs)
    .sort((a, b) => b.listedAt - a.listedAt)
    .slice(0, candidateLimit);

  return [
    buildGainersFilter('Favoritos|Alta|Binance', binanceGainers),
    buildGainersFilter('Favoritos|Alta|Gate', gateGainers),
    buildNewListingsFilter('Favoritos|Novas|Binance', binanceNew),
    buildNewListingsFilter('Favoritos|Novas|Gate', gateNew),
  ].filter((f) => f.list.length > 0);
}

async function getMarketHighlights(limit = LIMIT_DEFAULT) {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL_MS) return _cache;
  if (_inflight) return _inflight;

  _inflight = computeMarketHighlights(limit)
    .then((result) => {
      _cache = result;
      _cachedAt = Date.now();
      _inflight = null;
      return result;
    })
    .catch((err) => {
      _inflight = null;
      if (_cache) return _cache;
      throw err;
    });

  return _inflight;
}

module.exports = {
  getMarketHighlights,
  rankBinanceGainers,
  buildBinanceGainersFromMarketing,
  buildBinanceGainersFromTickers,
  LIMIT_DEFAULT,
  MIN_VOLUME_USDT,
};
