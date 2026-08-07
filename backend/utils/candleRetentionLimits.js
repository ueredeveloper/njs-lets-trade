'use strict';

/**
 * Teto de retenção do cache de candles em disco (backend/data/candlestick/*.json) e de quanto
 * histórico faz sentido pedir pra VWAP Bands por intervalo. 1m precisa de mais espaço que o
 * padrão pra cobrir uma janela semanal de verdade (7 dias = ~10080 candles a 1m) — sem isso,
 * "VWAP semanal" em 1m nunca tinha histórico suficiente e a banda ficava instável/deslocada do
 * que o gráfico e o motor real usam pra decidir o sinal (ver conversa sobre a KMNOUSDT/ACEUSDT).
 * Usado por getCandles.js (Binance), getGateCandles.js (Gate.io), analyseVwapBandsStats.js
 * (Estatísticas) e strategyEngine.js/getRequiredSpecs (bot real) — mesmo teto nos quatro
 * lugares, senão um busca mais do que o outro consegue reter e fica re-buscando à toa.
 */
const RETENTION_LIMIT_BY_INTERVAL = { '1m': 10500 };
const DEFAULT_RETENTION_LIMIT = 3000;

function retentionLimitFor(interval) {
  return RETENTION_LIMIT_BY_INTERVAL[interval] ?? DEFAULT_RETENTION_LIMIT;
}

module.exports = { RETENTION_LIMIT_BY_INTERVAL, DEFAULT_RETENTION_LIMIT, retentionLimitFor };
