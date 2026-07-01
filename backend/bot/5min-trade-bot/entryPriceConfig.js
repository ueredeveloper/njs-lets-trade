'use strict';

const ENTRY_MODES = ['market', 'below'];
const MA_ENTRY_MODES = ['market', 'ma_limit'];

function clampMaBelowPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, parseFloat(n.toFixed(2)));
}

function normalizeEntryPrice(raw) {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'market', belowPct: 0, maMode: 'market', maBelowPct: 0 };
  }
  const mode = raw.mode === 'below' ? 'below' : 'market';
  const belowPct = mode === 'below'
    ? Math.min(10, Math.max(0.1, Number(raw.belowPct ?? raw.pct ?? 0) || 0.5))
    : 0;
  const maMode = raw.maMode === 'ma_limit' ? 'ma_limit' : 'market';
  return {
    mode,
    belowPct: mode === 'below' ? belowPct : 0,
    maMode,
    maBelowPct: maMode === 'ma_limit' ? clampMaBelowPct(raw.maBelowPct) : 0,
  };
}

function entryPriceLabel(cfg) {
  const n = normalizeEntryPrice(cfg);
  const rsi = n.mode === 'below' && n.belowPct > 0
    ? `RSI limit −${n.belowPct}%`
    : 'RSI mercado';
  let ma = 'MA mercado';
  if (n.maMode === 'ma_limit') {
    ma = n.maBelowPct > 0 ? `MA limit@MA−${n.maBelowPct}% GTC` : 'MA limit@MA GTC';
  }
  return `${rsi} · ${ma}`;
}

function maLimitPriceFromMa(maPrice, entryCfg) {
  const n = normalizeEntryPrice(entryCfg);
  const ma = Number(maPrice);
  if (!Number.isFinite(ma) || ma <= 0) return null;
  const pct = n.maBelowPct ?? 0;
  return ma * (1 - pct / 100);
}

module.exports = {
  ENTRY_MODES,
  MA_ENTRY_MODES,
  normalizeEntryPrice,
  entryPriceLabel,
  maLimitPriceFromMa,
  clampMaBelowPct,
};
