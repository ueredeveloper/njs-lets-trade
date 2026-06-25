/** Tokens padronizados: abov/belw (en) · acim/abaix (pt) — RSI e MA */
export function compareAboveToken(lang) {
  return lang === 'pt' ? 'acim' : 'abov';
}

export function compareBelowToken(lang) {
  return lang === 'pt' ? 'abaix' : 'belw';
}

export function parseCompareToken(token) {
  const t = String(token).toLowerCase();
  if (t === 'a' || t === 'ab' || t === 'ac' || t === 'abov' || t === 'acim' || t === 'above') return 'above';
  if (t === 'b' || t === 'belw' || t === 'abaix' || t === 'below' || t === 'bellow' || t === 'belo') return 'below';
  return null;
}

export const parseRsiConditionToken = parseCompareToken;
export const parseMaCompareToken = parseCompareToken;

export function buildRsiFilterName(interval, conditions, lang = 'en') {
  const condStr = conditions.map((c) => {
    const token = c.type === 'above' ? compareAboveToken(lang) : compareBelowToken(lang);
    return `${token}|${c.value}`;
  }).join('|');
  return `${interval}|rsi|${condStr}`;
}

export function buildMaFilterName(interval, period, compare, candle, lang = 'en') {
  const isAbove = parseCompareToken(compare) === 'above';
  const cmp = isAbove ? compareAboveToken(lang) : compareBelowToken(lang);
  return `${interval}|ma|${period}|${cmp}|${candle}`;
}

export function buildMaPctFilterName(interval, period, minPct) {
  return `${interval}|ma|${period}|pct|${minPct}`;
}

/** Constrói nome RSI a partir da query (ex: 8h|rsi|above|70|bellow|99). */
export function buildRsiNomeFromQuery(query, lang = 'en') {
  const parts = query.trim().split('|');
  const interval = parts[0];
  const conditions = [];
  for (let i = 2; i + 1 < parts.length; i += 2) {
    const type = parseCompareToken(parts[i]);
    const value = parseFloat(parts[i + 1]);
    if (type && !Number.isNaN(value)) conditions.push({ type, value });
  }
  if (conditions.length === 0) return query.trim();
  return buildRsiFilterName(interval, conditions, lang);
}
