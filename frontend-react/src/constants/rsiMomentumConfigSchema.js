/** Schema RSI Momentum — espelho de backend/bot/rsi-momentum/tradeConfigSchema.js */

export const RSI_MOMENTUM_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const RSI_MOMENTUM_BB_PERIODS = [10, 20, 30];
export const RSI_MOMENTUM_BB_STD_DEVS = [1, 2, 3];
/** Valores selecionáveis de entry.bandWidth.lookback — quantos candles fechados entram no
 *  cálculo da largura média dos ciclos Bollinger. Mesmo leque do select em Estatísticas. */
export const RSI_MOMENTUM_BANDWIDTH_LOOKBACK_OPTIONS = [300, 200, 100];
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
/** Modos do ALVO (exit.targetMode) — independente do stop. */
export const RSI_MOMENTUM_TARGET_MODE_OPTIONS = ['fixed', 'continuous', 'off'];
/** Modos do STOP — 'fixed' (stopLoss.maxLossPct) | 'continuous' (exit.trailingStop). */
export const RSI_MOMENTUM_STOP_MODE_OPTIONS = ['fixed', 'continuous'];
/** Valores selecionáveis de restingBracket.targetPct — alvo fixo / base do alvo contínuo (%). */
export const RSI_MOMENTUM_TARGET_PCT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
/** exit.trailingTarget.stepPct — quanto o alvo contínuo sobe (p.p.) a cada degrau. */
export const RSI_MOMENTUM_TRAILING_TARGET_STEP_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
/** exit.trailingTarget.coinStepPct e exit.trailingStop.coinStepPct — "a cada X% de alta do pico". */
export const RSI_MOMENTUM_COIN_STEP_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
/** exit.trailingStop.stopStepPct — quanto o stop contínuo sobe (p.p.) a cada degrau. */
export const RSI_MOMENTUM_STOP_STEP_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
/** exit.trailingStop.startPct e stopLoss.maxLossPct — distância do stop (%). */
export const RSI_MOMENTUM_STOP_PCT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15];

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
    prevDayCloud: { enabled: true, maxPct: 90, interval: '4h', candleCount: 3, useHighLow: true },
    macdFilter: { enabled: true, interval: '1h' },
  },
  exit: {
    targetMode: 'fixed',
    restingBracket: { enabled: true, targetPct: 5 },
    trailingTarget: { coinStepPct: 3, stepPct: 3 },
    trailingStop: { enabled: true, startPct: 5, coinStepPct: 3, stopStepPct: 2 },
  },
  stopLoss: { enabled: true, maxLossPct: 5 },
  polling: { pollMs: 60_000, fastPollMs: 20_000 },
  volume: { minVolumeUsdt: 1_000_000 },
  entryCooldownHours: 0,
};
