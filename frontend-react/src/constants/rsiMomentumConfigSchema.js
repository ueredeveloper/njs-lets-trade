/** Schema RSI Momentum — espelho de backend/bot/rsi-momentum/tradeConfigSchema.js */

export const RSI_MOMENTUM_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const RSI_MOMENTUM_BB_PERIODS = [10, 20, 30];
export const RSI_MOMENTUM_BB_STD_DEVS = [1, 2, 3];
/** Valores selecionáveis do filtro entry.prevDayCloud.maxPct — mesmas opções do backtest
 *  (StatisticsPanel.jsx, RSI_MOM_CLOUD_PCT_OPTIONS). */
export const RSI_MOMENTUM_CLOUD_PCT_OPTIONS = [50, 60, 70, 80, 90, 100];
/** Valores selecionáveis do filtro entry.prevDayCloud.interval — mesmo leque de entry.interval
 *  (o bot só opera Binance, sem a limitação de intervalos que a Gate.io tem no gráfico/backtest). */
export const RSI_MOMENTUM_CLOUD_INTERVAL_OPTIONS = RSI_MOMENTUM_ALL_INTERVALS;
/** Valores selecionáveis do filtro entry.prevDayCloud.candleCount — mesmo seletor do gráfico e do
 *  backtest (StatisticsPanel.jsx, RSI_MOM_CLOUD_CANDLE_COUNT_OPTIONS). 1 (padrão) = só o candle
 *  anterior; N>1 = envelope [menor open/close, maior open/close] dos últimos N candles. */
export const RSI_MOMENTUM_CLOUD_CANDLE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const RSI_MOMENTUM_DEFAULTS = {
  kind: 'rsi_momentum',
  label: 'RSI Momentum',
  entry: {
    enabled: true,
    interval: '15m',
    rsiThreshold: 69,
    priorRsiFilter: { enabled: true, count: 3 },
    pullback: { enabled: false, belowPct: 0.5 },
    earlyConfirm: { enabled: true, interval: '5m' },
    limitWaitCandles: 20,
    reentryCooldownCandles: 3,
    bandWidth: {
      enabled: true, interval: '5m', period: 20, stdDev: 2, lookback: 300, minPct: 2,
    },
    rsi5mFilter: { enabled: false, threshold: 70 },
    spikeGuard: { enabled: true, maxMovePct: 5 },
    prevDayCloud: { enabled: true, maxPct: 90, interval: '4h', candleCount: 3 },
    macdFilter: { enabled: true, interval: '1h' },
  },
  exit: {
    restingBracket: { enabled: true, targetPct: 9 },
    trailingStop: { enabled: true, startPct: 5, coinStepPct: 3, stopStepPct: 2 },
  },
  stopLoss: { enabled: true, maxLossPct: 5 },
  polling: { pollMs: 60_000, fastPollMs: 20_000 },
  volume: { minVolumeUsdt: 1_000_000 },
  entryCooldownHours: 0,
};
