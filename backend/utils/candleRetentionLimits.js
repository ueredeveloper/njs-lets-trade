'use strict';

/**
 * Teto de retenção do cache de candles em disco (backend/data/candlestick/*.json) e de quanto
 * histórico faz sentido pedir pra VWAP Bands por intervalo. Usado por getCandles.js (Binance),
 * getGateCandles.js (Gate.io), analyseVwapBandsStats.js (Estatísticas) e
 * strategyEngine.js/getRequiredSpecs (bot real) — mesmo teto nos quatro lugares, senão um busca
 * mais do que o outro consegue reter e fica re-buscando à toa.
 *
 * 1m já teve um teto maior (10500) pra cobrir uma janela semanal de VWAP (7 dias = ~10080
 * candles) — voltou pro padrão de 3000 a pedido do usuário (12000 registros por símbolo era
 * considerado exagero de espaço em disco). Efeito colateral aceito conscientemente: o VWAP
 * Bands semanal (session='weekly') no bot real, em símbolos configurados com vwapInterval=1m,
 * passa a ter só ~2 dias de histórico em vez de 7 — pode voltar a ficar instável/deslocado
 * como no caso KMNOUSDT/ACEUSDT que motivou o teto maior originalmente. Se isso voltar a dar
 * problema, a correção é reverter só o '1m' aqui pra 10500 de novo.
 */
const RETENTION_LIMIT_BY_INTERVAL = {};
const DEFAULT_RETENTION_LIMIT = 3000;

function retentionLimitFor(interval) {
  return RETENTION_LIMIT_BY_INTERVAL[interval] ?? DEFAULT_RETENTION_LIMIT;
}

module.exports = { RETENTION_LIMIT_BY_INTERVAL, DEFAULT_RETENTION_LIMIT, retentionLimitFor };
