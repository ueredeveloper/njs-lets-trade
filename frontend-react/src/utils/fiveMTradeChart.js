import { INTERVAL_MS, computeCandleLimitFromTime } from './chartView';

const INTERVAL = '5m';
const CANDLES_BEFORE = 15;
const CANDLES_AFTER = 30;

/** Slots MA do painel esquerdo conforme config do favorito 5m */
export function buildOverlaySlotsForFiveMEntry(entry) {
  const enabled = entry?.maFilters?.enabled !== false;
  const mas = entry?.maFilters?.filters ?? [];
  const ma1h = mas.find(m => m.enabled && m.interval === '1h')
    ?? mas.find(m => m.interval === '1h')
    ?? { period: 50, interval: '1h' };
  return [
    { id: 'slot1', period: String(ma1h.period ?? 50), interval: ma1h.interval ?? '1h', enabled },
    { id: 'slot2', period: '50', interval: '5m', enabled: true },
  ];
}

/** Plano de fetch 5m centrado no horário do sinal */
export function fiveMSignalFetchPlan(eventTimeMs) {
  const msPerCandle = INTERVAL_MS[INTERVAL] ?? 300_000;
  const fetchFromMs = eventTimeMs - CANDLES_BEFORE * msPerCandle;
  const candleLimit = computeCandleLimitFromTime(fetchFromMs, INTERVAL);
  return {
    interval: INTERVAL,
    msPerCandle,
    fetchFromMs,
    candleLimit,
    entryMs: eventTimeMs,
    exitMs: eventTimeMs + CANDLES_AFTER * msPerCandle,
    overlaySlots: null,
  };
}

export function buildMarkerForFiveMSignal(signal) {
  const eventMs = new Date(signal.event_time).getTime();
  const isPossible = signal.event_type === 'possible_entry';
  return [{
    time: eventMs,
    side: isPossible ? 'possible_entry' : 'entry',
    price: signal.price,
  }];
}

export const FIVE_M_ENTRY_EVENT_TYPES = new Set(['entry', 'possible_entry']);
