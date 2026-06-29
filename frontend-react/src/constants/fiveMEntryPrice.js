/** Preço de entrada do 5m Trade — espelha backend/bot/5min-trade-bot/entryPriceConfig.js */

export const ENTRY_PRICE_OPTIONS = [
  {
    id: 'market',
    label: 'Preço de mercado',
    summary: 'Compra imediata (market / IOC) quando o RSI cruzar o limiar',
    tooltip:
      'Assim que o RSI(5m) ficar abaixo do limiar de compra, o bot envia ordem a mercado ' +
      'pelo capital configurado.',
  },
  {
    id: 'below',
    label: 'Um pouco abaixo do mercado',
    summary: 'Ordem limit X% abaixo do preço atual — tenta pegar o dip',
    tooltip:
      'Quando o RSI sinaliza compra, o bot coloca ordem limit abaixo do preço atual. ' +
      'Use Sugerir para calcular X% com base nas quedas históricas após RSI<seu limiar, ' +
      'antes da recuperação. Se não preencher neste ciclo, tenta de novo no próximo.',
  },
];

export function entryPriceLabel(cfg) {
  const mode = cfg?.mode === 'below' ? 'below' : 'market';
  if (mode === 'below' && Number(cfg?.belowPct) > 0) {
    return `limit −${cfg.belowPct}%`;
  }
  return 'mercado';
}

export function initialEntryPrice(entry) {
  const ep = entry?.entryPrice;
  if (!ep || typeof ep !== 'object') return { mode: 'market', belowPct: 0.5 };
  return {
    mode: ep.mode === 'below' ? 'below' : 'market',
    belowPct: ep.mode === 'below'
      ? Math.min(10, Math.max(0.1, Number(ep.belowPct) || 0.5))
      : 0,
  };
}

export function parseBelowPctInput(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (s === '' || s === '.') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0.1, parseFloat(n.toFixed(2))));
}

export function clampBelowPct(n) {
  return Math.min(10, Math.max(0.1, parseFloat(Number(n).toFixed(2))));
}

export function normalizeEntryPriceForm(raw) {
  const mode = raw?.mode === 'below' ? 'below' : 'market';
  if (mode === 'market') return { mode: 'market', belowPct: 0 };
  return {
    mode: 'below',
    belowPct: Math.min(10, Math.max(0.1, Number(raw?.belowPct) || 0.5)),
  };
}
