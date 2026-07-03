'use strict';

/**
 * Filtros de média móvel para entrada do bot 5m.
 * Modos: above (preço > MA), below (preço < MA).
 */

const { analyzeAdaptiveDip, lastMa } = require('../amap/adaptiveMaDip');
const { calculateMa } = require('../../utils/movingAverage');

const MA_INTERVALS = ['1h', '2h', '4h', '8h', '1d'];
const MA_PERIODS   = [20, 50, 100, 200];

/** Teto da calibragem % abaixo da MA (modo acima) — piso adaptativo de entrada. */
const MA_TOLERANCE_MAX_PCT = 4;

const TOLERANCE_OPTS = {
  defaultPct:  3,
  maxPct:      MA_TOLERANCE_MAX_PCT,
  minPct:      0.5,
  minEpisodes: 3,
};

const DEFAULT_MA_FILTERS = {
  enabled: false,
  filters: [
    { id: 'ma50-1h', enabled: true, period: 50, interval: '1h', mode: 'above', tolerancePct: 0 },
  ],
};

function maKey(period, interval) {
  return `${period}_${interval}`;
}

function normalizeMaFilters(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MA_FILTERS, filters: DEFAULT_MA_FILTERS.filters.map(f => ({ ...f })) };
  const filters = Array.isArray(raw.filters)
    ? raw.filters.map((f, i) => ({
      id:       f.id ?? `ma${f.period}-${f.interval}-${i}`,
      enabled:  f.enabled !== false,
      period:   Number(f.period ?? 50),
      interval: MA_INTERVALS.includes(f.interval) ? f.interval : '1h',
      mode:     f.mode === 'below' ? 'below' : 'above',
      tolerancePct: Math.max(0, Math.min(MA_TOLERANCE_MAX_PCT, Number(f.tolerancePct ?? 0))),
    }))
    : DEFAULT_MA_FILTERS.filters.map(f => ({ ...f }));
  return {
    enabled: raw.enabled === true,
    filters,
  };
}

function buildMaSeries(candles, period) {
  if (!candles?.length || candles.length < period) return [];
  const closes = candles.map(c => c.close);
  const maArr  = calculateMa(closes, period);
  return maArr.map((ma, i) => ({
    openTime: candles[period - 1 + i].openTime,
    ma,
  }));
}

function maAt(series, openTime) {
  if (!series?.length) return null;
  let best = null;
  for (const pt of series) {
    if (pt.openTime <= openTime) best = pt.ma;
    else break;
  }
  return best;
}

function maThreshold(ma, mode, tolerancePct = 0) {
  const tol = Math.max(0, Number(tolerancePct) || 0);
  if (mode === 'below') return ma * (1 + tol / 100);
  return ma * (1 - tol / 100);
}

function checkPriceVsMa(price, ma, mode, tolerancePct = 0) {
  if (ma == null || price == null) return false;
  const tol = Math.max(0, Number(tolerancePct) || 0);
  if (tol > 0) {
    const threshold = maThreshold(ma, mode, tol);
    return mode === 'below' ? price <= threshold : price >= threshold;
  }
  if (mode === 'below') return price < ma;
  return price > ma;
}

function buildMaLookupMap(cMap, maFilters) {
  const lookup = {};
  if (!maFilters?.enabled) return lookup;
  for (const f of maFilters.filters) {
    if (!f.enabled) continue;
    const key = maKey(f.period, f.interval);
    if (lookup[key]) continue;
    const candles = cMap[f.interval];
    if (!candles?.length) continue;
    lookup[key] = buildMaSeries(candles, f.period);
  }
  return lookup;
}

function passesMaFilters(price, openTime, maLookup, maFilters) {
  if (!maFilters?.enabled) return { ok: true };
  const active = maFilters.filters.filter(f => f.enabled);
  if (!active.length) return { ok: true };

  for (const f of active) {
    const key = maKey(f.period, f.interval);
    const ma  = maAt(maLookup[key], openTime);
    const tol = f.tolerancePct ?? 0;
    if (!checkPriceVsMa(price, ma, f.mode, tol)) {
      const distPct = ma != null ? parseFloat(((price - ma) / ma * 100).toFixed(2)) : null;
      const threshold = ma != null ? maThreshold(ma, f.mode, tol) : null;
      return {
        ok:       false,
        filter:   f,
        ma,
        price,
        threshold,
        tolerancePct: tol,
        distPct,
        label:    `MA${f.period}(${f.interval})`,
      };
    }
  }
  return { ok: true };
}

/** Detalhe por filtro MA (para painel de teste ao vivo). */
function detailMaFilters(price, openTime, maLookup, maFilters) {
  const cfg = normalizeMaFilters(maFilters);
  if (!cfg.enabled) return [];
  return cfg.filters.filter(f => f.enabled).map(f => {
    const key = maKey(f.period, f.interval);
    const ma  = maAt(maLookup[key], openTime);
    const tol = f.tolerancePct ?? 0;
    const threshold = ma != null ? maThreshold(ma, f.mode, tol) : null;
    const ok  = checkPriceVsMa(price, ma, f.mode, tol);
    const distPct = ma != null ? parseFloat(((price - ma) / ma * 100).toFixed(2)) : null;
    return {
      id: f.id,
      label: formatMaFilterLabel(f),
      period: f.period,
      interval: f.interval,
      mode: f.mode,
      tolerancePct: tol,
      ma: ma != null ? parseFloat(ma.toFixed(8)) : null,
      threshold: threshold != null ? parseFloat(threshold.toFixed(8)) : null,
      distPct,
      ok,
      status: ok ? 'OK' : 'bloqueado',
    };
  });
}

function formatMaFilterLabel(f) {
  const modePt = f.mode === 'below' ? '<' : '>';
  const tol = f.tolerancePct > 0 ? ` (−${f.tolerancePct}%)` : '';
  return `${modePt} MA${f.period} ${f.interval}${tol}`;
}

function describeMaFilters(maFilters) {
  const cfg = normalizeMaFilters(maFilters);
  if (!cfg.enabled) return 'MA: desligado';
  const active = cfg.filters.filter(f => f.enabled);
  if (!active.length) return 'MA: ligado (nenhum filtro ativo)';
  return `MA: ${active.map(formatMaFilterLabel).join(' · ')}`;
}

function getRequiredIntervals(maFilters) {
  const ivs = new Set(['5m']);
  const cfg = normalizeMaFilters(maFilters);
  if (cfg.enabled) {
    for (const f of cfg.filters) {
      if (f.enabled) ivs.add(f.interval);
    }
  }
  return [...ivs];
}

function candleLimitForInterval(interval) {
  if (interval === '5m') return 2500;
  if (interval === '1h') return 1000;
  if (interval === '4h') return 500;
  return 350;
}

/** Verificação ao vivo (bot) — busca candles e checa filtros ativos. */
async function checkMaFiltersLive(adapter, maFilters, log) {
  const cfg = normalizeMaFilters(maFilters);
  if (!cfg.enabled) return { ok: true };

  const active = cfg.filters.filter(f => f.enabled);
  if (!active.length) return { ok: true };

  for (const f of active) {
    const limit   = candleLimitForInterval(f.interval) + f.period + 10;
    const candles = await adapter.fetchCandles(limit, f.interval);
    if (candles.length < f.period) {
      log?.(`⚠️  MA${f.period}(${f.interval}): dados insuficientes — entrada bloqueada`);
      return { ok: false, reason: `dados MA${f.period}(${f.interval}) insuficientes`, filter: f };
    }
    const series = buildMaSeries(candles, f.period);
    const price  = candles[candles.length - 1].close;
    const openTime = candles[candles.length - 1].openTime;
    const ma     = maAt(series, openTime);
    const tol    = f.tolerancePct ?? 0;
    const threshold = ma != null ? maThreshold(ma, f.mode, tol) : null;
    if (!checkPriceVsMa(price, ma, f.mode, tol)) {
      const distPct = ma != null ? ((price - ma) / ma * 100).toFixed(2) : '?';
      const modePt  = f.mode === 'below' ? '<' : '>';
      const tolLbl  = tol > 0 ? ` (piso −${tol}%)` : '';
      log?.(`🔍 Filtro MA: preço=${price.toFixed(6)} ${modePt} MA${f.period}(${f.interval})=${ma?.toFixed(6) ?? '?'}${tolLbl} piso=${threshold?.toFixed(6) ?? '?'} (dist ${distPct}%) — ❌ entrada bloqueada`);
      return { ok: false, reason: `${formatMaFilterLabel(f)} não atendido`, filter: f, ma, price, threshold, tolerancePct: tol, distPct };
    }
    const tolLbl = tol > 0 ? ` tolerância −${tol}%` : '';
    log?.(`🔍 Filtro MA${f.period}(${f.interval}): preço=${price.toFixed(6)} OK (${f.mode}${tolLbl})`);
  }
  return { ok: true };
}

/** Detalhe por filtro MA (para painel de teste ao vivo). */
function detailMaFilters(price, openTime, maLookup, maFilters) {
  const cfg = normalizeMaFilters(maFilters);
  if (!cfg.enabled) return [];
  return cfg.filters.filter(f => f.enabled).map(f => {
    const key = maKey(f.period, f.interval);
    const ma  = maAt(maLookup[key], openTime);
    const tol = f.tolerancePct ?? 0;
    const threshold = ma != null ? maThreshold(ma, f.mode, tol) : null;
    const ok  = checkPriceVsMa(price, ma, f.mode, tol);
    const distPct = ma != null ? parseFloat(((price - ma) / ma * 100).toFixed(2)) : null;
    return {
      id: f.id,
      label: formatMaFilterLabel(f),
      period: f.period,
      interval: f.interval,
      mode: f.mode,
      tolerancePct: tol,
      ma: ma != null ? parseFloat(ma.toFixed(8)) : null,
      threshold: threshold != null ? parseFloat(threshold.toFixed(8)) : null,
      distPct,
      ok,
      status: ok ? 'OK' : 'bloqueado',
    };
  });
}

/**
 * Sugere tolerância % abaixo da MA (mesma lógica do Multi-Trade adaptativo).
 * Mede quanto a moeda costuma cair abaixo da MA antes de retomar a alta.
 */
function suggestMaTolerance(candles, period, interval, opts = {}) {
  const o        = { ...TOLERANCE_OPTS, ...opts };
  const analysis = analyzeAdaptiveDip(candles, period, o);
  const currentMa  = lastMa(candles, period);
  const close      = candles?.length ? candles[candles.length - 1].close : null;
  const suggested  = analysis.dipPct;
  const floor      = currentMa != null ? maThreshold(currentMa, 'above', suggested) : null;
  const dipNow     = currentMa != null && close != null
    ? (currentMa - close) / currentMa * 100
    : null;
  return {
    interval,
    period,
    suggestedTolerancePct: suggested,
    currentMa,
    currentPrice: close,
    floor,
    dipNowPct: dipNow != null ? parseFloat(dipNow.toFixed(2)) : null,
    entryOk: floor != null && close != null && close >= floor,
    ...analysis,
  };
}

/** MA usada no stop adaptativo — não exige filtro de entrada ligado (padrão MA50 1h). */
const DEFAULT_MA_STOP_FILTER = { period: 50, interval: '1h', tolerancePct: 3 };

function resolveMaStopFilter(maFilters) {
  const cfg = normalizeMaFilters(maFilters);
  if (cfg.enabled) {
    const f = cfg.filters.find(fi => fi.enabled && fi.mode === 'above');
    if (f) {
      return {
        period: f.period,
        interval: f.interval,
        tolerancePct: Math.max(0, Number(f.tolerancePct ?? 3)),
      };
    }
  }
  return { ...DEFAULT_MA_STOP_FILTER };
}

function buildMaToleranceSuggestions(cMap, maFilters) {
  const cfg = normalizeMaFilters(maFilters);
  if (!cfg.enabled) return [];
  return cfg.filters
    .filter(f => f.enabled && f.mode === 'above')
    .map(f => {
      const candles = cMap[f.interval];
      const sug = suggestMaTolerance(candles, f.period, f.interval);
      return {
        filterId: f.id,
        period: f.period,
        interval: f.interval,
        mode: f.mode,
        currentTolerancePct: f.tolerancePct ?? 0,
        ...sug,
      };
    });
}

module.exports = {
  DEFAULT_MA_FILTERS,
  MA_INTERVALS,
  MA_PERIODS,
  MA_TOLERANCE_MAX_PCT,
  TOLERANCE_OPTS,
  normalizeMaFilters,
  buildMaSeries,
  maAt,
  buildMaLookupMap,
  passesMaFilters,
  detailMaFilters,
  checkMaFiltersLive,
  describeMaFilters,
  getRequiredIntervals,
  candleLimitForInterval,
  formatMaFilterLabel,
  suggestMaTolerance,
  DEFAULT_MA_STOP_FILTER,
  resolveMaStopFilter,
  buildMaToleranceSuggestions,
  maThreshold,
  maKey,
};
