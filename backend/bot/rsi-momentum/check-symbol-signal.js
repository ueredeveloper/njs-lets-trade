'use strict';
/**
 * Depuração pontual: mostra a série de RSI recente de UM símbolo no entry.interval do RSI
 * Momentum (igual ao que o marketScanner.js avalia a cada ciclo) e o motivo exato pelo qual
 * evaluateEntrySignal aprovaria/bloquearia um sinal agora — usa a config GLOBAL real (a mesma
 * lida em rsi_momentum_global_config, cai no preset estático se o usuário nunca salvou nada).
 * Útil pra conferir no log "RSI_VOLATILE_NEAR_THRESHOLD (repique)" / "RSI_NOT_CROSSING" contra
 * os candles reais da Binance, sem precisar reimplementar o cálculo à mão.
 *
 * Uso:
 *   node backend/bot/rsi-momentum/check-symbol-signal.js VELODROMEUSDT
 *   node backend/bot/rsi-momentum/check-symbol-signal.js BTCUSDT --n 20
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { fetchBinanceCandles } = require('../prices');
const { getRequiredSpecs, evaluateEntrySignal, computeRsiSeries, closedCandlesOnly, RSI_PERIOD } = require('./strategyEngine');
const { loadGlobalConfigBody } = require('./strategyPresets');
const { toEngineConfig, normalizeRsiMomentumConfig } = require('./tradeConfigSchema');
const { sbReq } = require('../shared/supabaseRest');

const DEFAULT_USER_ID = process.env.SUPABASE_DEFAULT_USER_ID ?? 'ueredeveloper';

function toBRT(ms) {
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function main() {
  const [symbolArg, ...rest] = process.argv.slice(2);
  if (!symbolArg) {
    console.error('Uso: node check-symbol-signal.js <SYMBOL> [--n <candles a mostrar>]');
    process.exit(1);
  }
  const symbol = symbolArg.toUpperCase();
  const nFlagIdx = rest.indexOf('--n');
  const showN = nFlagIdx >= 0 ? Number(rest[nFlagIdx + 1]) : 12;

  const presetBody = await loadGlobalConfigBody(sbReq, DEFAULT_USER_ID);
  const config = toEngineConfig(normalizeRsiMomentumConfig(presetBody));

  const specs = getRequiredSpecs(config);
  const cMap = Object.fromEntries(
    await Promise.all(specs.map(async ({ interval, limit }) => [interval, await fetchBinanceCandles(symbol, limit, interval)])),
  );

  const iv = config.entry.interval;
  const closed = closedCandlesOnly(cMap[iv] ?? []);
  const rsiValues = computeRsiSeries(closed);
  const offset = closed.length - rsiValues.length;

  console.log(`\n${symbol} — RSI(${RSI_PERIOD}) em ${iv} (threshold ${config.entry.rsiThreshold}, priorRsiFilter ${config.entry.priorRsiFilter?.count ?? 3} candles)\n`);
  for (let i = Math.max(0, rsiValues.length - showN); i < rsiValues.length; i++) {
    const candle = closed[i + offset];
    console.log(`  ${toBRT(Number(candle.openTime))} BRT  close=${candle.close}  rsi=${rsiValues[i].toFixed(2)}`);
  }

  const signal = evaluateEntrySignal(config, cMap);
  console.log('\nResultado evaluateEntrySignal:', JSON.stringify(signal, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
