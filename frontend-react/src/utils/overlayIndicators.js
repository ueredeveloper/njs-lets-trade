import { computeCandleLimitFromTime, INTERVAL_MS } from './chartView';
import { fetchChartAdaptiveBands } from '../services/api';

function fetchCandlesRaw(symbol, interval, limit, source) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  return fetch(`/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`)
    .then(r => r.json());
}

/** Candles necessários pra cobrir [fromMs, agora] + warmup do período do indicador. */
function overlayFetchLimit(fromMs, interval, period) {
  const periodN = Math.max(1, parseInt(period, 10) || 50);
  return computeCandleLimitFromTime(fromMs, interval, { buffer: periodN + 30, max: 1000, min: periodN * 3 });
}

/**
 * Corta os pontos anteriores à janela visível (com uma folga pequena pra linha
 * não nascer cortada na borda esquerda). O histórico de warmup usado pra
 * calcular a EMA/BB corretamente NÃO deve ir pro gráfico — como o eixo X é
 * contínuo (`type: 'time'`), o ECharts expande a janela visível pra caber
 * todos os pontos de todas as séries, e um indicador com centenas de candles
 * de histórico "espremeria" a janela de conferência de regras (só algumas
 * horas) numa fatia minúscula, dando a impressão de que o resto sumiu.
 */
function trimToWindow(points, fromMs, interval) {
  const cutoff = fromMs - (INTERVAL_MS[interval] ?? 0) * 3;
  return points.filter(([t]) => t >= cutoff);
}

/** Linha de EMA(period) no intervalo dado — pares [time, value] prontos pro eixo `time` do ECharts. */
export async function fetchEmaLine(symbol, interval, period, source, fromMs) {
  const limit = overlayFetchLimit(fromMs, interval, period);
  const candles = await fetchCandlesRaw(symbol, interval, limit, source);
  if (!Array.isArray(candles) || !candles.length) return [];
  const ema = await fetch(`/services/sma?period=${period}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(ema)) return [];
  const offset = candles.length - ema.length;
  const points = ema.map((val, i) => [Number(candles[offset + i].openTime), val]);
  return trimToWindow(points, fromMs, interval);
}

/** Deriva piso/teto (± pct%) a partir de uma linha de EMA já buscada — mesma conta do bot (checkPriceFilter). */
function deriveBandPoints(emaPoints, pct, side) {
  const mult = side === 'floor' ? (1 - pct / 100) : (1 + pct / 100);
  return emaPoints.map(([t, v]) => [t, v == null ? null : v * mult]);
}

/** Linha de piso/teto adaptativo (EMA(period,interval) ± pct%) — mesma EMA do filtro, deslocada. */
export async function fetchAdaptiveBandLine(symbol, interval, period, side, pct, source, fromMs) {
  const emaPoints = await fetchEmaLine(symbol, interval, period, source, fromMs);
  return deriveBandPoints(emaPoints, pct, side);
}

/**
 * Igual fetchAdaptiveBandLine, mas com o pct calculado do histórico REAL da
 * moeda (mesma conta do botão "ADAPT" das EMAs rápidas do gráfico principal
 * e do "Sugerir histórico" do MA-Cross) em vez de uma porcentagem fixa.
 */
export async function fetchAdaptiveBandLineAuto(symbol, interval, period, side, source, fromMs) {
  const bounds = await fetchChartAdaptiveBands({
    symbol, exchange: source === 'gate' ? 'gate' : 'binance', period, interval,
  });
  const pct = side === 'floor' ? bounds.dipPct : bounds.stretchPct;
  const points = await fetchAdaptiveBandLine(symbol, interval, period, side, pct, source, fromMs);
  return { points, pct };
}

/** Bandas de Bollinger(period, stdDev) no intervalo dado — upper/middle/lower como pares [time, value]. */
export async function fetchBollingerLines(symbol, interval, period, stdDev, source, fromMs) {
  const limit = overlayFetchLimit(fromMs, interval, period);
  const candles = await fetchCandlesRaw(symbol, interval, limit, source);
  if (!Array.isArray(candles) || !candles.length) return null;
  const bb = await fetch(`/services/bollinger-bands?period=${period}&stdDev=${stdDev}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(bb)) return null;
  const offset = candles.length - bb.length;
  return {
    upper:  trimToWindow(bb.map((v, i) => [Number(candles[offset + i].openTime), v.upper]),  fromMs, interval),
    middle: trimToWindow(bb.map((v, i) => [Number(candles[offset + i].openTime), v.middle]), fromMs, interval),
    lower:  trimToWindow(bb.map((v, i) => [Number(candles[offset + i].openTime), v.lower]),  fromMs, interval),
  };
}

/**
 * Deriva as linhas de EMA usadas pelas regras de um tradeConfig ma-cross
 * (entrada, tendência, aproximação, filtros MA, cruzamento de saída),
 * deduplicadas por período+intervalo (várias regras podem apontar pra
 * mesma EMA), mais a Bollinger de saída se ligada.
 */
export function strategyLineDefsFromTradeConfig(tradeConfig) {
  if (!tradeConfig) return [];

  const emaMap = new Map();
  const addEma = (leg, purpose) => {
    if (!leg?.period || !leg?.interval) return;
    const key = `${leg.period}-${leg.interval}`;
    if (!emaMap.has(key)) emaMap.set(key, { period: leg.period, interval: leg.interval, purposes: [] });
    if (!emaMap.get(key).purposes.includes(purpose)) emaMap.get(key).purposes.push(purpose);
  };

  addEma(tradeConfig.entry?.ma1, 'entrada');
  addEma(tradeConfig.entry?.ma2, 'entrada');
  if (tradeConfig.entryTrendMa?.enabled !== false) {
    addEma(tradeConfig.entryTrendMa?.ma1, 'tendência');
    addEma(tradeConfig.entryTrendMa?.ma2, 'tendência');
  }
  if (tradeConfig.entryEmaApproach?.enabled !== false) {
    addEma(tradeConfig.entryEmaApproach?.ma1, 'aproximação');
    addEma(tradeConfig.entryEmaApproach?.ma2, 'aproximação');
  }
  (tradeConfig.maFilters ?? []).filter(f => f.enabled !== false && f.mode !== 'off').forEach(f => {
    addEma({ period: f.period, interval: f.interval }, 'filtro');
  });
  if (tradeConfig.exit?.maCross?.enabled !== false) {
    addEma(tradeConfig.exit?.maCross?.ma1, 'saída');
    addEma(tradeConfig.exit?.maCross?.ma2, 'saída');
  }

  const palette = ['#34d399', '#60a5fa', '#f472b6', '#facc15', '#c084fc', '#fb923c', '#4ade80', '#22d3ee'];
  const defs = [...emaMap.values()].map((v, i) => ({
    id: `ema-${v.period}-${v.interval}`,
    kind: 'ema',
    period: v.period,
    interval: v.interval,
    color: palette[i % palette.length],
    label: `EMA${v.period} ${v.interval}${v.purposes.length ? ` (${v.purposes.join('/')})` : ''}`,
  }));

  // Bandas de piso/teto dos filtros MA — mesma conta do bot (checkPriceFilter):
  // EMA(period,interval) deslocada ± pct%. Cores iguais às dos pontos
  // bloqueados no gráfico (maFloor/maCeiling), pra ligar visualmente a linha
  // ao motivo do bloqueio.
  const BAND_COLOR = { floor: '#2bb3a3', ceiling: '#e0653f' };
  const adaptiveDefaultPct = tradeConfig.adaptiveOpts?.defaultPct;
  (tradeConfig.maFilters ?? []).filter(f => f.enabled !== false && f.mode && f.mode !== 'off').forEach(f => {
    if (!f.period || !f.interval) return;

    const pushBand = (side, pct) => {
      if (!Number.isFinite(pct) || pct === 0) return;
      defs.push({
        id: `band-${side}-${f.period}-${f.interval}`,
        kind: 'band',
        side,
        period: f.period,
        interval: f.interval,
        pct,
        color: BAND_COLOR[side],
        label: `${side === 'floor' ? 'Piso' : 'Teto'} adapt. EMA${f.period} ${f.interval} (${side === 'floor' ? '−' : '+'}${pct}%)`,
      });
    };

    if (f.mode === 'adaptive') {
      const fixedDip = f.fixedDipPct != null && f.fixedDipPct !== '' ? Number(f.fixedDipPct) : null;
      const dipPct = Number.isFinite(fixedDip) ? fixedDip : Number(f.maxDipPct ?? adaptiveDefaultPct ?? 3);
      pushBand('floor', dipPct);

      const fixedAbove = f.fixedAbovePct != null && f.fixedAbovePct !== '' ? Number(f.fixedAbovePct) : null;
      const abovePct = Number.isFinite(fixedAbove) ? fixedAbove : Number(f.maxAbovePct ?? 0);
      if (abovePct > 0) pushBand('ceiling', abovePct);
    } else if (f.mode === 'strict_above') {
      pushBand('floor', Number(f.tolerancePct ?? 0));
    } else if (f.mode === 'below') {
      pushBand('ceiling', Number(f.tolerancePct ?? 0));
    }
  });

  const bbUpper = tradeConfig.exit?.bbUpper;
  if (bbUpper?.enabled !== false && bbUpper?.interval && bbUpper?.period) {
    defs.push({
      id: `bb-${bbUpper.period}-${bbUpper.interval}-${bbUpper.stdDev ?? 2}`,
      kind: 'bb',
      period: bbUpper.period,
      stdDev: bbUpper.stdDev ?? 2,
      interval: bbUpper.interval,
      color: '#818cf8',
      label: `BB${bbUpper.period}@${bbUpper.interval} (saída)`,
    });
  }

  return defs;
}
