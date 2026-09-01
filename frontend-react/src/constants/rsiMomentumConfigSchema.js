/** Schema RSI Momentum — espelho de backend/bot/rsi-momentum/tradeConfigSchema.js */

export const RSI_MOMENTUM_ALL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
export const RSI_MOMENTUM_BB_PERIODS = [10, 20, 30];
export const RSI_MOMENTUM_BB_STD_DEVS = [1, 2, 3];
/** Valores selecionáveis de entry.bandWidth.lookback — quantos candles fechados entram no
 *  cálculo da largura média dos ciclos Bollinger. Mesmo leque do select em Estatísticas. */
export const RSI_MOMENTUM_BANDWIDTH_LOOKBACK_OPTIONS = [300, 200, 100];
/** volume.minVolumeUsdt — filtro de volume 24h do scan de mercado. */
export const RSI_MOMENTUM_MIN_VOLUME_OPTIONS = [1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000];
/** Modos do ALVO (exit.targetMode) — independente do stop. */
export const RSI_MOMENTUM_TARGET_MODE_OPTIONS = ['fixed', 'continuous', 'off'];
/** Modos do STOP — 'fixed' (stopLoss.maxLossPct) ou stop contínuo exit.trailingStop com
 *  exit.trailingStop.mode: 'continuous' | 'twoPhase' (Escada Dupla) | 'peakTrail' (Trilha do
 *  Topo) | 'atrTrail' (Trilha ATR). Mesmos modos do backtest/Estatísticas. */
export const RSI_MOMENTUM_STOP_MODE_OPTIONS = ['fixed', 'continuous', 'twoPhase', 'peakTrail', 'atrTrail'];
/** exit.trailingStop.pivotPct — lucro (%) travado no fim da fase A da Escada Dupla (0 = breakeven). */
export const RSI_MOMENTUM_PIVOT_PCT_OPTIONS = [-2, -1, 0, 0.5, 1, 1.5, 2, 3, 4, 5];
/** exit.trailingStop.pivotGainPct — ganho do pico (%) que troca da fase A pra B (Trilha do Topo / ATR). */
export const RSI_MOMENTUM_PIVOT_GAIN_OPTIONS = [2, 3, 4, 5, 6, 8, 10];
/** exit.trailingStop.wNearPct / wFarPct — largura (%) do stop abaixo do PICO (Trilha do Topo / ATR). */
export const RSI_MOMENTUM_WIDTH_PCT_OPTIONS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12];
/** exit.trailingStop.atrMult — multiplicador do ATR% na fase B da Trilha ATR. */
export const RSI_MOMENTUM_ATR_MULT_OPTIONS = [1, 1.5, 2, 2.5, 3, 4, 5];
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
/** exit.hardTakeProfit.pct — teto de lucro (venda forçada em +X%). */
export const RSI_MOMENTUM_HARD_TP_OPTIONS = [8, 10, 12, 15, 18, 20, 25, 30, 40, 50];
/** entry.earlyConfirm.rsiThreshold — RSI provisório mínimo pra adiantar o sinal (o motor usa
 *  max(entry.rsiThreshold, este), então nunca afrouxa o sinal). */
export const RSI_MOMENTUM_EARLY_CONFIRM_RSI_OPTIONS = [65, 68, 69, 70, 72, 75, 80];
/** entry.supportResistance — filtro/alvo por Suporte-Resistência (mesmo leque do backtest). */
export const RSI_MOMENTUM_SR_INTERVAL_OPTIONS = RSI_MOMENTUM_ALL_INTERVALS;
export const RSI_MOMENTUM_SR_CANDLE_COUNT_OPTIONS = [20, 50, 100, 200, 500];
export const RSI_MOMENTUM_SR_RANK_OPTIONS = [1, 2, 3];
export const RSI_MOMENTUM_SR_ENTRY_MAX_PCT_OPTIONS = [1, 2, 3, 5, 8, 10, 15, 20];
/** exit.reinforceOnStop — "reforço no stop" (martingale): queda % que dispara novo aporte e alta
 *  % que encerra a pilha. Mesmo leque do painel de Estatísticas. */
export const RSI_MOMENTUM_REINFORCE_DROP_OPTIONS = [5, 8, 10, 12, 15, 20];
export const RSI_MOMENTUM_REINFORCE_RISE_OPTIONS = [8, 10, 12, 15, 18, 20, 25];
/** exit.reinforceOnStop.buyUsd — valor (USDT) de cada compra de reforço (padrão = aporte da entrada). */
export const RSI_MOMENTUM_REINFORCE_USD_OPTIONS = [20, 40, 60, 80, 100, 150, 200, 300, 500];

export const RSI_MOMENTUM_DEFAULTS = {
  kind: 'rsi_momentum',
  label: 'RSI Momentum',
  entry: {
    enabled: true,
    interval: '15m',
    rsiThreshold: 69,
    priorRsiFilter: { enabled: true, count: 3 },
    pullback: { enabled: false, belowPct: 0.5 },
    earlyConfirm: { enabled: true, interval: '5m', rsiThreshold: 70 },
    limitWaitCandles: 20,
    reentryCooldownCandles: 3,
    bandWidth: {
      enabled: true, interval: '5m', period: 20, stdDev: 2, lookback: 300, minPct: 1.5,
    },
    rsi5mFilter: { enabled: true, threshold: 70 },
    macdFilter: { enabled: true, interval: '1h' },
    higherRsiFilter: { enabled: true, minRsi: 60 },
    supportResistance: {
      enabled: true, interval: '4h', candleCount: 50,
      entrySupportRank: 1, exitResistanceRank: 3, entryMaxPct: 5,
    },
  },
  exit: {
    targetMode: 'off',
    restingBracket: { enabled: true, targetPct: 10 },
    trailingTarget: { coinStepPct: 3, stepPct: 3 },
    trailingStop: {
      enabled: false, mode: 'continuous', startPct: 5, coinStepPct: 3, stopStepPct: 2,
      pivotPct: 1, aCoinStepPct: 3, aStopStepPct: 2.5, bCoinStepPct: 3, bStopStepPct: 1,
      pivotGainPct: 5, wNearPct: 4, wFarPct: 9, atrMult: 2, atrMaxPct: 12,
    },
    hardTakeProfit: { enabled: true, pct: 15 },
    reinforceOnStop: { enabled: true, addDropPct: 10, exitRisePct: 15, buyUsd: 40 },
  },
  stopLoss: { enabled: true, maxLossPct: 10 },
  polling: { pollMs: 60_000, fastPollMs: 20_000 },
  volume: { minVolumeUsdt: 1_000_000 },
  entryCooldownHours: 0,
};
