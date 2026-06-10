'use strict';

/**
 * @file bot-prices.test.js
 * Testes manuais de simulação de ordens de compra e venda do bot RSI.
 *
 * Simula os preços que o bot usaria no momento atual, sem executar ordens reais.
 * Útil para verificar se os descontos e o ticker live estão funcionando corretamente.
 *
 * Como utilizar:
 *   npx jest backend/tests/bot-prices.test.js --verbose
 *
 * Para testar um par específico via variável de ambiente:
 *   SYMBOL=EDUUSDT EXCHANGE=binance INTERVAL=30m npx jest backend/tests/bot-prices.test.js --verbose
 *   SYMBOL=SKYAI_USDT EXCHANGE=gate INTERVAL=1m  npx jest backend/tests/bot-prices.test.js --verbose
 *
 * Pares padrão testados (sem variáveis de ambiente):
 *   - SKYAI_USDT  | Gate.io  | 1m
 *   - EDUUSDT     | Binance  | 30m
 */

const {
  fetchBinanceCurrentPrice,
  fetchGateCurrentPrice,
  fetchBinanceCandles,
  fetchGateCandles,
} = require('../bot/prices');

/** Desconto aplicado na ordem de compra (1% abaixo do preço live) */
const BUY_DISCOUNT  = 0.01;

/** Desconto aplicado na ordem de venda (0.2% abaixo do preço live) */
const SELL_DISCOUNT = 0.002;

/** Taxa de corretagem da exchange (0.2% — maker e taker) */
const FEE_RATE = 0.002;

/** Valor simulado investido por operação em USDT */
const SIMULATED_BUDGET_USDT = 10;

/**
 * Gráfico ASCII de candles (OHLC) para visualização rápida no terminal.
 * Linhas de alta (close >= open) exibidas com '█', baixa com '░', sombras com '│'.
 * @param {Array<{time:string, open:number, high:number, low:number, close:number}>} candles
 * @param {number} decimals - Casas decimais para os labels do eixo de preço
 * @returns {string} Gráfico formatado como string multilinhas
 */
function renderAsciiChart(candles, decimals) {
  const allHigh = Math.max(...candles.map(c => c.high));
  const allLow  = Math.min(...candles.map(c => c.low));
  const ROWS    = 14;
  const range   = allHigh - allLow || 1;
  const step    = range / ROWS;

  const grid = [];
  for (let r = ROWS; r >= 0; r--) {
    const label = (allLow + r * step).toFixed(decimals).padStart(10);
    let row = `${label} |`;
    candles.forEach(c => {
      const hiRow  = Math.round((c.high  - allLow) / step);
      const loRow  = Math.round((c.low   - allLow) / step);
      const opRow  = Math.round((c.open  - allLow) / step);
      const clRow  = Math.round((c.close - allLow) / step);
      const bodyHi = Math.max(opRow, clRow);
      const bodyLo = Math.min(opRow, clRow);
      const bull   = c.close >= c.open;
      if      (r > bodyHi && r <= hiRow)   row += '│';
      else if (r < bodyLo && r >= loRow)   row += '│';
      else if (r >= bodyLo && r <= bodyHi) row += bull ? '█' : '░';
      else row += ' ';
    });
    grid.push(row);
  }
  // Eixo X: posição 3–5 do formato HH:MM ou HH:MM:SS → minutos
  grid.push('          +' + candles.map(c => c.time.slice(3, 5)).join(''));
  return grid.join('\n');
}

/**
 * Formata e imprime no console o resultado completo da simulação.
 * @param {object} result
 * @param {string} result.pair       - Par da moeda (ex: EDUUSDT)
 * @param {string} result.exchange   - Exchange utilizada
 * @param {string} result.interval   - Intervalo dos candles
 * @param {string} result.timestamp  - Horário da consulta
 * @param {number} result.livePrice  - Preço live obtido via ticker
 * @param {number} result.buyPrice   - Preço simulado de compra
 * @param {number} result.buyQty     - Quantidade simulada comprada
 * @param {number} result.sellPrice  - Preço simulado de venda
 * @param {number} result.netUsdt    - Receita líquida estimada após taxas
 * @param {number} result.pnl        - Lucro/prejuízo estimado em USDT
 * @param {number} result.pnlPct     - Lucro/prejuízo em porcentagem
 * @param {Array}  result.candles    - Candles para o gráfico
 */
function printResult(result) {
  const { pair, exchange, interval, timestamp, livePrice, buyPrice, buyQty,
          sellPrice, netUsdt, pnl, pnlPct, candles } = result;

  const decimals = livePrice < 0.01 ? 6 : livePrice < 1 ? 5 : 4;
  const pnlSign  = pnl >= 0 ? '+' : '';

  console.log('\n' + '═'.repeat(62));
  console.log(`Par       : ${pair}  |  ${exchange}  |  intervalo: ${interval}`);
  console.log(`Horário   : ${timestamp}`);
  console.log('─'.repeat(62));
  console.log(`Preço live (ticker) : ${livePrice}`);
  console.log(`─`.repeat(62));
  console.log(`COMPRA  → preço: ${buyPrice}  (−${BUY_DISCOUNT * 100}% sobre live)`);
  console.log(`           qty : ${buyQty.toFixed(6)} tokens  (≈$${SIMULATED_BUDGET_USDT} USDT)`);
  console.log(`─`.repeat(62));
  console.log(`VENDA   → preço: ${sellPrice}  (−${SELL_DISCOUNT * 100}% sobre live)`);
  console.log(`           rec.: ≈$${netUsdt.toFixed(4)} USDT líquidos`);
  console.log(`           PnL : ${pnlSign}$${pnl.toFixed(4)} USDT  (${pnlSign}${pnlPct.toFixed(2)}%)`);
  console.log('─'.repeat(62));
  console.log(`Candles ${interval} — últimos ${candles.length}:`);
  console.log(renderAsciiChart(candles, decimals));
  const last = candles[candles.length - 1];
  console.log(`Última vela: ${last.time}  O:${last.open}  H:${last.high}  L:${last.low}  C:${last.close}`);
  console.log('═'.repeat(62));
}

/**
 * Monta o objeto de resultado da simulação a partir do preço live e dos candles.
 * @param {string} pair      - Par da moeda
 * @param {string} exchange  - 'gate' | 'binance'
 * @param {string} interval  - Intervalo dos candles
 * @param {number} livePrice - Preço atual via ticker
 * @param {Array}  rawCandles - Candles brutos retornados pelas funções de fetch
 * @returns {object} Resultado completo da simulação
 */
function buildResult(pair, exchange, interval, livePrice, rawCandles) {
  const timestamp = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const buyPrice  = parseFloat((livePrice * (1 - BUY_DISCOUNT)).toFixed(8));
  const buyQty    = parseFloat((SIMULATED_BUDGET_USDT / buyPrice * (1 - FEE_RATE)).toFixed(8));
  const sellPrice = parseFloat((livePrice * (1 - SELL_DISCOUNT)).toFixed(8));
  const grossUsdt = sellPrice * buyQty;
  const netUsdt   = grossUsdt * (1 - FEE_RATE);
  const pnl       = netUsdt - SIMULATED_BUDGET_USDT;
  const pnlPct    = (pnl / SIMULATED_BUDGET_USDT) * 100;

  // Formata timestamp de cada candle para exibição no gráfico
  const isMinutes = /^\d+m$/.test(interval);
  const candles = rawCandles.map(c => ({
    time: new Date(c.openTime).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit',
      ...(isMinutes ? { second: '2-digit' } : {}),
    }),
    open: c.open, high: c.high, low: c.low, close: c.close,
  }));

  return { pair, exchange, interval, timestamp, livePrice, buyPrice, buyQty,
           sellPrice, netUsdt, pnl, pnlPct, candles };
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('Bot — simulação de preços de compra e venda', () => {

  /**
   * Testa o par informado via variável de ambiente, ou SKYAI_USDT na Gate.io por padrão.
   *
   * Uso:
   *   SYMBOL=SKYAI_USDT EXCHANGE=gate INTERVAL=1m npx jest backend/tests/bot-prices.test.js --verbose
   */
  test('Gate.io — preço de compra e venda (par configurável por ENV)', async () => {
    const pair     = process.env.SYMBOL   || 'SKYAI_USDT';
    const interval = process.env.INTERVAL || '1m';

    const [livePrice, rawCandles] = await Promise.all([
      fetchGateCurrentPrice(pair),
      fetchGateCandles(pair, 30, interval),
    ]);

    const result = buildResult(pair, 'Gate.io', interval, livePrice, rawCandles);
    printResult(result);

    // Validações básicas: garante que os preços calculados fazem sentido
    expect(result.livePrice).toBeGreaterThan(0);
    expect(result.buyPrice).toBeLessThan(result.livePrice);
    expect(result.sellPrice).toBeLessThan(result.livePrice);
    expect(result.sellPrice).toBeGreaterThan(result.buyPrice);
  }, 15000);

  /**
   * Testa o par informado via variável de ambiente, ou EDUUSDT na Binance por padrão.
   *
   * Uso:
   *   SYMBOL=EDUUSDT EXCHANGE=binance INTERVAL=30m npx jest backend/tests/bot-prices.test.js --verbose
   */
  test('Binance — preço de compra e venda (par configurável por ENV)', async () => {
    const symbol   = process.env.SYMBOL   || 'EDUUSDT';
    const interval = process.env.INTERVAL || '30m';

    const [livePrice, rawCandles] = await Promise.all([
      fetchBinanceCurrentPrice(symbol),
      fetchBinanceCandles(symbol, 30, interval),
    ]);

    const result = buildResult(symbol, 'Binance', interval, livePrice, rawCandles);
    printResult(result);

    expect(result.livePrice).toBeGreaterThan(0);
    expect(result.buyPrice).toBeLessThan(result.livePrice);
    expect(result.sellPrice).toBeLessThan(result.livePrice);
    expect(result.sellPrice).toBeGreaterThan(result.buyPrice);
  }, 15000);

});
