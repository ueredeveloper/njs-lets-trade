import { INTERVAL_MS, computeCandleLimitFromTime } from './chartView';

const CANDLES_BEFORE = 10;

export function isRule2Row(row) {
  return row?.ruleId === 'rule2' || row?.entryKind === 'ma';
}

/** Intervalo principal do chart para o sinal selecionado */
export function resolveTradeChartInterval(entry, row) {
  if (isRule2Row(row)) {
    const em = entry?.rule2?.entryMa ?? entry?.entryMa ?? {};
    return em.interval ?? '1h';
  }
  const er = entry?.rule1?.entryRsi ?? entry?.entryRsi ?? {};
  return er.interval ?? '15m';
}

/** Slots MA do painel esquerdo alinhados à config do favorito */
export function buildOverlaySlotsForEntry(entry, row) {
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
