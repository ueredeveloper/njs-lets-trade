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

const MA_CROSS_MODE_TOKENS = {
  cross_up: 'xup',
  cross_down: 'xdwn',
  near_up: 'nearup',
  near_down: 'neardn',
};

export function parseMaCrossModeToken(token) {
  const t = String(token).toLowerCase();
  if (t === 'xup' || t === 'cross_up') return 'cross_up';
  if (t === 'xdwn' || t === 'cross_down') return 'cross_down';
  if (t === 'nearup' || t === 'near_up') return 'near_up';
  if (t === 'neardn' || t === 'near_down') return 'near_down';
  return null;
}

/** MA cruzamento: 15m|macross|9|15m|21|15m|xup|age|5|tol|0.5 */
export function buildMaCrossFilterName(sigInterval, p1, iv1, p2, iv2, mode, opts = {}) {
  const modeToken = MA_CROSS_MODE_TOKENS[mode] ?? mode;
  let name = `${sigInterval}|macross|${p1}|${iv1}|${p2}|${iv2}|${modeToken}`;

  if (mode === 'near_up' || mode === 'near_down') {
    if (opts.proximityPct != null) name += `|prox|${opts.proximityPct}`;
  } else {
    const age = opts.maxAgeMin ?? 'last';
    name += `|age|${age}`;
    if (opts.tolerancePct != null && Number(opts.tolerancePct) > 0) {
      name += `|tol|${opts.tolerancePct}`;
    }
  }
  return name;
}

/** Parse nome macross → parâmetros para re-scan / polling. */
export function parseMaCrossFilterName(name) {
  const parts = String(name).split('|');
  if (parts[1] !== 'macross' || parts.length < 7) return null;

  const mode = parseMaCrossModeToken(parts[6]);
  if (!mode) return null;

  const out = {
    sigInterval: parts[0],
    period1: parseInt(parts[2], 10),
    interval1: parts[3],
    period2: parseInt(parts[4], 10),
    interval2: parts[5],
    mode,
    maxAgeMin: 'last',
    tolerancePct: 0,
    proximityPct: 1,
  };

  for (let i = 7; i + 1 < parts.length; i += 2) {
    const key = parts[i];
    const val = parts[i + 1];
    if (key === 'age') out.maxAgeMin = val;
    else if (key === 'tol') out.tolerancePct = parseFloat(val) || 0;
    else if (key === 'prox') out.proximityPct = parseFloat(val) || 1;
  }

  return out;
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
