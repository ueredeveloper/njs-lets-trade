'use strict';

const ENTRY_MODES = ['market', 'below'];

function normalizeEntryPrice(raw) {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'market', belowPct: 0 };
  }
  const mode = raw.mode === 'below' ? 'below' : 'market';
  const belowPct = mode === 'below'
    ? Math.min(10, Math.max(0.1, Number(raw.belowPct ?? raw.pct ?? 0) || 0.5))
    : 0;
  return { mode, belowPct: mode === 'below' ? belowPct : 0 };
}

function entryPriceLabel(cfg) {
  const n = normalizeEntryPrice(cfg);
  if (n.mode === 'below' && n.belowPct > 0) {
    return `limit −${n.belowPct}%`;
  }
  return 'mercado';
}

module.exports = {
  ENTRY_MODES,
  normalizeEntryPrice,
  entryPriceLabel,
};
