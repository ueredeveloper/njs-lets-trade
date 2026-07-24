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

/** Posição EMA vs EMA: 15m|macmp|9|21|acim — proximidade: 1h|macmp|9|21|nearup|prox|0.5 */
export function buildMaCompareFilterName(interval, p1, p2, compare, lang = 'en', opts = {}) {
  if (compare === 'near_up' || compare === 'near_down') {
    const modeToken = MA_CROSS_MODE_TOKENS[compare] ?? compare;
    let name = `${interval}|macmp|${p1}|${p2}|${modeToken}`;
    const prox = opts.proximityPct ?? opts.tolerancePct;
    if (prox != null && Number(prox) > 0) name += `|prox|${prox}`;
    return name;
  }
  const cmp = parseCompareToken(compare) === 'above' ? compareAboveToken(lang) : compareBelowToken(lang);
  let name = `${interval}|macmp|${p1}|${p2}|${cmp}`;
  const tol = opts.tolerancePct;
  if (tol != null && Number(tol) > 0) name += `|tol|${tol}`;
  return name;
}

/** Distância do preço vs uma única EMA: 4h|madist|21|acim */
export function buildMaDistanceFilterName(interval, period, compare, lang = 'en') {
  const cmp = parseCompareToken(compare) === 'above' ? compareAboveToken(lang) : compareBelowToken(lang);
  return `${interval}|madist|${period}|${cmp}`;
}

export function parseMaDistanceFilterName(name) {
  const parts = String(name).split('|');
  if (parts[1] !== 'madist' || parts.length < 4) return null;

  const posCmp = parseCompareToken(parts[3]);
  return {
    interval: parts[0],
    period: parseInt(parts[2], 10),
    compare: posCmp === 'below' ? 'below' : 'above',
  };
}

export function parseMaCompareFilterName(name) {
  const parts = String(name).split('|');
  if (parts[1] !== 'macmp' || parts.length < 5) return null;

  const mode = parseMaCrossModeToken(parts[4]);
  const posCmp = parseCompareToken(parts[4]);
  const out = {
    interval: parts[0],
    period1: parseInt(parts[2], 10),
    period2: parseInt(parts[3], 10),
    compare: mode ?? (posCmp === 'below' ? 'below' : 'above'),
    tolerancePct: 0,
    proximityPct: 0.5,
  };

  for (let i = 5; i + 1 < parts.length; i += 2) {
    const key = parts[i];
    const val = parts[i + 1];
    if (key === 'prox') out.proximityPct = parseFloat(val) || 0.5;
    else if (key === 'tol') out.tolerancePct = parseFloat(val) || 0;
  }

  return out;
}

/** Intervalos de candle reconhecidos no prefixo do nome do filtro. */
const FILTER_CHART_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w',
]);

/**
 * Intervalo de gráfico sugerido pelo filtro (primeiro token: 1h|macmp|…, 15m|macross|…).
 * Filtros sem prefixo de intervalo (ex. Favoritos|Alta|…) retornam null.
 */
export function parseFilterChartInterval(filterName) {
  if (!filterName || typeof filterName !== 'string') return null;
  const head = filterName.split('|')[0];
  if (FILTER_CHART_INTERVALS.has(head)) return head;
  const macross = parseMaCrossFilterName(filterName);
  if (macross?.sigInterval && FILTER_CHART_INTERVALS.has(macross.sigInterval)) {
    return macross.sigInterval;
  }
  return null;
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

const GROWTH_ENGINE_TOKENS = { bollinger: 'bb', rsi: 'rsi', maCross: 'macross' };
const GROWTH_ENGINE_FROM_TOKEN = { bb: 'bollinger', rsi: 'rsi', macross: 'maCross' };

/**
 * Filtro de crescimento por ciclo (fundo→topo): 4h|growth|bb|20|2|10
 *   bb:      interval|growth|bb|period|stdDev|thresholdPct
 *   rsi:     interval|growth|rsi|oversold|overbought|thresholdPct
 *   maCross: interval|growth|macross|period1|period2|thresholdPct
 */
export function buildIndicatorGrowthFilterName(engine, interval, params, thresholdPct) {
  const token = GROWTH_ENGINE_TOKENS[engine] ?? engine;
  let paramsPart;
  if (engine === 'bollinger') paramsPart = `${params.period}|${params.stdDev}`;
  else if (engine === 'rsi') paramsPart = `${params.oversold}|${params.overbought}`;
  else if (engine === 'maCross') paramsPart = `${params.period1}|${params.period2}`;
  else paramsPart = '';
  return `${interval}|growth|${token}|${paramsPart}|${thresholdPct}`;
}

export function parseIndicatorGrowthFilterName(name) {
  const parts = String(name).split('|');
  if (parts[1] !== 'growth' || parts.length < 6) return null;

  const engine = GROWTH_ENGINE_FROM_TOKEN[parts[2]];
  if (!engine) return null;

  const out = {
    interval: parts[0],
    engine,
    thresholdPct: parseFloat(parts[5]),
  };
  if (engine === 'bollinger') {
    out.period = parseInt(parts[3], 10);
    out.stdDev = parseFloat(parts[4]);
  } else if (engine === 'rsi') {
    out.oversold = parseInt(parts[3], 10);
    out.overbought = parseInt(parts[4], 10);
  } else if (engine === 'maCross') {
    out.period1 = parseInt(parts[3], 10);
    out.period2 = parseInt(parts[4], 10);
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
