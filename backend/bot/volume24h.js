'use strict';

const { toGateSymbol } = require('../utils/toGateSymbol');

const BINANCE_BASE = 'https://api.binance.com';
const GATE_BASE    = 'https://api.gateio.ws/api/v4';

const DEFAULT_MIN_VOLUME_USDT = 1_000_000;
const VOLUME_PRESETS_USDT     = [1_000_000, 3_000_000, 5_000_000, 10_000_000, 50_000_000];

async function fetch24hVolumeUsdt(symbol, exchange = 'binance') {
  const sym = symbol.toUpperCase();
  if (exchange === 'gate') {
    const pair = toGateSymbol(sym);
    const data = await fetch(`${GATE_BASE}/spot/tickers?currency_pair=${pair}`).then(r => r.json());
    return parseFloat(data?.[0]?.quote_volume || 0);
  }
  const data = await fetch(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${sym}`).then(r => r.json());
  return parseFloat(data?.quoteVolume || 0);
}

function fmtVolumeUsdt(vol) {
  if (vol == null || Number.isNaN(vol)) return '—';
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000)     return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

module.exports = {
  fetch24hVolumeUsdt,
  fmtVolumeUsdt,
  DEFAULT_MIN_VOLUME_USDT,
  VOLUME_PRESETS_USDT,
};
