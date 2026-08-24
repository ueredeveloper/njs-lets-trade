/** Schema RSI Momentum — espelho de backend/bot/rsi-momentum/tradeConfigSchema.js */

export const RSI_MOMENTUM_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const RSI_MOMENTUM_BB_PERIODS = [10, 20, 30];
export const RSI_MOMENTUM_BB_STD_DEVS = [1, 2, 3];

export const RSI_MOMENTUM_DEFAULTS = {
  kind: 'rsi_momentum',
  label: 'RSI Momentum',
  entry: {
    enabled: true,
    interval: '15m',
    rsiThreshold: 69,
    priorRsiFilter: { enabled: true, count: 3 },
    pullback: { enabled: true, belowPct: 0.5 },
    limitWaitCandles: 20,
    reentryCooldownCandles: 3,
    bandWidth: {
      enabled: true, interval: '5m', period: 20, stdDev: 2, lookback: 300, minPct: 2,
    },
    rsi5mFilter: { enabled: false, threshold: 70 },
  },
  exit: {
    restingBracket: { enabled: true, targetPct: 5 },
  },
  stopLoss: { enabled: true, maxLossPct: 5 },
  polling: { pollMs: 60_000, fastPollMs: 20_000 },
  volume: { minVolumeUsdt: 1_000_000 },
  entryCooldownHours: 0,
};
