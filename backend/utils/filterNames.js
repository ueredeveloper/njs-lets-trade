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

module.exports = {
  compareAboveToken,
  compareBelowToken,
  parseCompareToken,
  parseRsiConditionToken: parseCompareToken,
  parseMaCompareToken: parseCompareToken,
  buildRsiFilterName,
  buildMaFilterName,
  buildMaPctFilterName,
};
