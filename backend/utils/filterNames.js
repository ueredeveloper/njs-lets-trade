'use strict';

/** Tokens padronizados: abov/belw (en) · acim/abaix (pt) — RSI e MA */
function compareAboveToken(lang) {
  return lang === 'pt' ? 'acim' : 'abov';
}

function compareBelowToken(lang) {
  return lang === 'pt' ? 'abaix' : 'belw';
}

function parseCompareToken(token) {
  const t = String(token).toLowerCase();
  if (t === 'a' || t === 'ab' || t === 'ac' || t === 'abov' || t === 'acim' || t === 'above') return 'above';
  if (t === 'b' || t === 'belw' || t === 'abaix' || t === 'below' || t === 'bellow' || t === 'belo') return 'below';
  return null;
}

function isAboveCompare(compare) {
  return parseCompareToken(compare) === 'above';
}

function buildRsiFilterName(interval, conditions, lang = 'en') {
  const condStr = conditions.map((c) => {
    const token = c.type === 'above' ? compareAboveToken(lang) : compareBelowToken(lang);
    return `${token}|${c.value}`;
  }).join('|');
  return `${interval}|rsi|${condStr}`;
}

function buildMaFilterName(interval, period, compare, candle, lang = 'en') {
  const cmp = isAboveCompare(compare) ? compareAboveToken(lang) : compareBelowToken(lang);
  return `${interval}|ma|${period}|${cmp}|${candle}`;
}

/** MA tempo acima: 1h|ma|50|pct|70 */
function buildMaPctFilterName(interval, period, minPct) {
  return `${interval}|ma|${period}|pct|${minPct}`;
}

const MA_CROSS_MODE_TOKENS = {
  cross_up: 'xup',
  cross_down: 'xdwn',
  near_up: 'nearup',
  near_down: 'neardn',
};

function parseMaCrossModeToken(token) {
  const t = String(token).toLowerCase();
  if (t === 'xup' || t === 'cross_up') return 'cross_up';
  if (t === 'xdwn' || t === 'cross_down') return 'cross_down';
  if (t === 'nearup' || t === 'near_up') return 'near_up';
  if (t === 'neardn' || t === 'near_down') return 'near_down';
  return null;
}

/** MA cruzamento: 15m|macross|9|15m|21|15m|xup|age|5|tol|0.5 */
function buildMaCrossFilterName(sigInterval, p1, iv1, p2, iv2, mode, opts = {}) {
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
function parseMaCrossFilterName(name) {
  const parts = String(name).split('|');
  if (parts[1] !== 'macross' || parts.length < 7) return null;

  const mode = parseMaCrossModeToken(parts[6]);
  if (!mode) return null;

  const out = {
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

module.exports = {
  compareAboveToken,
  compareBelowToken,
  parseCompareToken,
  parseRsiConditionToken: parseCompareToken,
  parseMaCompareToken: parseCompareToken,
  buildRsiFilterName,
  buildMaFilterName,
  buildMaPctFilterName,
  MA_CROSS_MODE_TOKENS,
  parseMaCrossModeToken,
  buildMaCrossFilterName,
  parseMaCrossFilterName,
};
