/** Preço de entrada do 5m Trade — espelha backend/bot/5min-trade-bot/entryPriceConfig.js */

export const ENTRY_PRICE_OPTIONS = [
  {
    id: 'market',
    label: 'Preço de mercado',
    summary: 'Compra imediata quando o RSI cruzar o limiar',
    tooltip:
      'Assim que o RSI(5m) ficar abaixo do limiar de compra, o bot envia ordem a mercado ' +
      'pelo capital configurado.',
  },
  {
    id: 'below',
    label: 'Um pouco abaixo do mercado',
    summary: 'Ordem limit X% abaixo do preço atual (IOC) — tenta pegar o dip',
    tooltip:
      'Quando o RSI sinaliza compra, o bot coloca ordem limit abaixo do preço atual. ' +
      'Use Sugerir para calcular X% com base nas quedas históricas.',
  },
];

export const MA_ENTRY_PRICE_OPTIONS = [
  {
    id: 'market',
    label: 'Mercado no toque',
    summary: 'Compra imediata quando o sinal MA50 5m dispara (toque ou cruzamento)',
    tooltip:
      'No toque ou cruzamento da MA50 5m, envia ordem a mercado. ' +
      'Recomendado — o preço já está na zona da MA.',
  },
  {
    id: 'ma_limit',
    label: 'Limit na MA (GTC)',
    summary: 'Ordem limit no preço da MA50 5m — aguarda reteste até 5s',
    tooltip:
      'Coloca limit GTC no preço da MA50 5m (opcionalmente um pouco abaixo). ' +
      'Aguarda até 5 segundos por reteste; se não preencher, cancela e tenta no próximo sinal.',
  },
];

export function entryPriceLabel(cfg) {
  const n = normalizeEntryPriceForm(cfg);
  const rsi = n.mode === 'below' && n.belowPct > 0
    ? `RSI −${n.belowPct}%`
    : 'RSI mercado';
  let ma = 'MA mercado';
  if (n.maMode === 'ma_limit') {
    ma = n.maBelowPct > 0 ? `MA limit−${n.maBelowPct}%` : 'MA limit@MA';
  }
  return `${rsi} · ${ma}`;
}

export function initialEntryPrice(entry) {
  const ep = entry?.entryPrice;
  if (!ep || typeof ep !== 'object') {
    return { mode: 'market', belowPct: 0, maMode: 'market', maBelowPct: 0 };
  }
  return normalizeEntryPriceForm(ep);
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

export function clampMaBelowPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(1, parseFloat(v.toFixed(2)));
}

export function normalizeEntryPriceForm(raw) {
  const mode = raw?.mode === 'below' ? 'below' : 'market';
  const maMode = raw?.maMode === 'ma_limit' ? 'ma_limit' : 'market';
  return {
    mode,
    belowPct: mode === 'below'
      ? Math.min(10, Math.max(0.1, Number(raw?.belowPct) || 0.5))
      : 0,
    maMode,
    maBelowPct: maMode === 'ma_limit' ? clampMaBelowPct(raw?.maBelowPct) : 0,
  };
}
