import { INTERVAL_MS, computeCandleLimitFromTime } from './chartView';

const CANDLES_BEFORE = 10;

export function isMaCrossEntry(entry) {
  return entry?.strategyId === 'ma-cross' || entry?.kind === 'ma_cross' || entry?.tradeConfig?.kind === 'ma_cross';
}

export function isRule2Row(row) {
  return row?.ruleId === 'rule2' || row?.entryKind === 'ma';
}

/** Intervalo principal do chart para o sinal selecionado */
export function resolveTradeChartInterval(entry, row) {
  if (isMaCrossEntry(entry)) {
    const e = entry.entry ?? entry.tradeConfig?.entry ?? {};
    const iv1 = e.ma1?.interval ?? '15m';
    const iv2 = e.ma2?.interval ?? iv1;
    const ms1 = INTERVAL_MS[iv1] ?? 900_000;
    const ms2 = INTERVAL_MS[iv2] ?? 900_000;
    return ms1 <= ms2 ? iv1 : iv2;
  }
  if (isRule2Row(row)) {
    const em = entry?.rule2?.entryMa ?? entry?.entryMa ?? {};
    return em.interval ?? '1h';
  }
  const er = entry?.rule1?.entryRsi ?? entry?.entryRsi ?? {};
  return er.interval ?? '15m';
}

/** Slots MA do painel esquerdo alinhados à config do favorito */
export function buildOverlaySlotsForEntry(entry, row) {
  if (isMaCrossEntry(entry)) {
    const e = entry.entry ?? entry.tradeConfig?.entry ?? {};
    const ma1 = e.ma1 ?? { period: 9, interval: '15m' };
    const ma2 = e.ma2 ?? { period: 21, interval: ma1.interval ?? '15m' };
    const slots = [
      { id: 'slot1', period: String(ma1.period ?? 9), interval: ma1.interval ?? '15m', enabled: true },
      { id: 'slot2', period: String(ma2.period ?? 21), interval: ma2.interval ?? '15m', enabled: true },
    ];
    const filters = (entry.maFilters ?? entry.tradeConfig?.maFilters ?? []).filter(f => f.enabled && f.mode !== 'off');
    if (filters[0]) {
      slots.push({
        id: 'slot3',
        period: String(filters[0].period ?? 50),
        interval: filters[0].interval ?? '1h',
        enabled: true,
      });
    }
    return slots.slice(0, 2);
  }
  if (isRule2Row(row)) {
    const em = entry?.rule2?.entryMa ?? entry?.entryMa ?? {};
    const period = String(em.period ?? 50);
    const interval = em.interval ?? '1h';
    return [
      { id: 'slot1', period, interval, enabled: true },
      { id: 'slot2', period: '50', interval: '4h', enabled: interval !== '4h' },
    ];
  }
  const mas = entry?.rule1?.maConditions ?? entry?.maConditions ?? [];
  const ma1h = mas.find(m => m.interval === '1h') ?? { period: 50, interval: '1h' };
  const ma4h = mas.find(m => m.interval === '4h') ?? { period: 50, interval: '4h' };
  return [
    { id: 'slot1', period: String(ma1h.period ?? 50), interval: ma1h.interval ?? '1h', enabled: true },
    { id: 'slot2', period: String(ma4h.period ?? 50), interval: ma4h.interval ?? '4h', enabled: true },
  ];
}

export function formatMaCrossEntrySummary(entry) {
  const e = entry?.entry ?? entry?.tradeConfig?.entry ?? {};
  const dir = e.direction === 'cross_down' ? '↓' : '↑';
  const p1 = e.ma1?.period ?? 9;
  const iv1 = e.ma1?.interval ?? '15m';
  const p2 = e.ma2?.period ?? 21;
  const iv2 = e.ma2?.interval ?? iv1;
  return `MA${p1}(${iv1}) cruza ${dir} MA${p2}(${iv2})`;
}

export function tradeFetchPlan(entry, row, signalMs) {
  const interval = resolveTradeChartInterval(entry, row);
  const msPerCandle = INTERVAL_MS[interval] ?? 900_000;
  const fetchFromMs = signalMs - CANDLES_BEFORE * msPerCandle;
  const candleLimit = computeCandleLimitFromTime(fetchFromMs, interval);
  return {
    interval,
    msPerCandle,
    fetchFromMs,
    candleLimit,
    overlaySlots: buildOverlaySlotsForEntry(entry, row),
  };
}

export { CANDLES_BEFORE, INTERVAL_MS, computeCandleLimitFromTime };
