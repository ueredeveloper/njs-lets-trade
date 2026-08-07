'use strict';
/**
 * Backtest do vwap-bands sobre TODAS as moedas favoritas (rsi_multi_bot_state,
 * strategy_id='vwap-bands'), simulando a estratégia real (mesmo motor de
 * backtest-vwap-bands.js / strategyEngine.js) num histórico maior, e testando o filtro de
 * entrada emaFilter (backend/bot/vwap-bands/strategyEngine.js): além das condições já
 * usadas hoje, só compraria se o close do candle de compra estivesse ACIMA de uma banda
 * inferior da EMA(period,interval) — floor = EMA * (1 - tolerancePct%). Período, intervalo
 * e tolerância são parametrizáveis (--ema-period/--ema-interval/--tolerance-pct) — padrão
 * EMA200(15m) -2%, igual ao default de produção — pra comparar intervalos/períodos
 * diferentes (ex.: EMA200 5m vs 15m).
 *
 * Mesma simplificação de analyze-ema50-filter-2w.js (ma-cross): roda a simulação BASELINE
 * (como o bot funciona hoje) e, pra cada compra gerada, só marca se o filtro da banda EMA
 * teria bloqueado aquela entrada — não re-simula um caminho alternativo pros trades
 * bloqueados (não tenta adivinhar se um sinal mais tarde teria comprado no lugar).
 *
 * Uso:
 *   node backend/bot/vwap-bands/analyze-ema200-15m-filter.js
 *   node backend/bot/vwap-bands/analyze-ema200-15m-filter.js --days 30
 *   node backend/bot/vwap-bands/analyze-ema200-15m-filter.js --tolerance-pct 2
 *   node backend/bot/vwap-bands/analyze-ema200-15m-filter.js --ema-interval 5m --ema-period 200
 *   node backend/bot/vwap-bands/analyze-ema200-15m-filter.js --symbol PYRUSDT --days 30
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { toGateSymbol } = require('../../utils/toGateSymbol');
const { sbReq } = require('../shared/supabaseRest');
const { buildMaTimeSeries } = require('../../utils/movingAverage');
const { normalizeVwapBandsConfig, toEngineConfig } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isVwapBandsStrategy } = require('./strategyPresets');
const {
  evaluateEntrySignal, evaluatePullbackReady, evaluateExit, intervalMs,
} = require('./strategyEngine');

const PRICE_IV = '1h';
const VWAP_IV = '4h';
const PRICE_VWAP_BUFFER_DAYS = 21;   // contexto (sessão VWAP semanal) antes da janela testada
const EMA_WARMUP_CANDLES_MULT = 3;   // folga de 3x o período pra EMA estabilizar

const INTERVAL_SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400 };

function argNum(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? Number(v) : def;
}
function argStr(flag) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? v.toUpperCase() : null;
}
function argLower(flag, def) {
  const v = process.argv.find((a, i) => process.argv[i - 1] === flag);
  return v != null ? v.toLowerCase() : def;
}

const TEST_DAYS = argNum('--days', 30);
const SYMBOL_FILTER = argStr('--symbol');
const TOLERANCE_PCT = argNum('--tolerance-pct', 2);
const EMA_PERIOD = argNum('--ema-period', 200);
const EMA_IV = argLower('--ema-interval', '15m');
// Candles extras (em dias) antes da janela testada pra EMA estabilizar, na unidade de EMA_IV.
const EMA_WARMUP_DAYS = Math.max(3, Math.ceil((EMA_PERIOD * EMA_WARMUP_CANDLES_MULT * (INTERVAL_SEC[EMA_IV] ?? 900)) / 86_400));

function fmtBRT(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

async function fetchBinanceRange(symbol, interval, startMs, endMs) {
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      const t = Number(c[0]);
      if (t > endMs) break;
      out.push({ openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] });
    }
    const last = raw[raw.length - 1][0];
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

async function fetchGateRange(symbol, interval, startMs, endMs) {
  const pair = toGateSymbol(symbol);
  const stepSec = INTERVAL_SEC[interval] ?? 3600;
  const out = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const from = Math.floor(cursor / 1000);
    const to = Math.min(Math.floor(endMs / 1000), from + 1000 * stepSec);
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${interval}&from=${from}&to=${to}&limit=1000`;
    const raw = await fetch(url).then(r => r.json());
    if (!Array.isArray(raw) || !raw.length) break;
    for (const c of raw) {
      out.push({
        openTime: Number(c[0]) * 1000, open: +c[5], high: +c[3], low: +c[4], close: +c[2], volume: +c[1],
      });
    }
    const last = Number(raw[raw.length - 1][0]) * 1000;
    if (last <= cursor) break;
    cursor = last + stepSec * 1000;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

function fetcherFor(exchange) {
  return exchange === 'gate' ? fetchGateRange : fetchBinanceRange;
}

/** Último valor da série MA cujo openTime <= alvo (mesma convenção de vwapPointAt). */
function maValueAt(series, openTime) {
  if (!series?.length) return null;
  let best = null;
  for (const pt of series) {
    if (pt.openTime <= openTime) best = pt.ma; else break;
  }
  return best;
}

async function loadFavorites() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?or=(${ids})&select=symbol,exchange,strategy_id&order=symbol.asc`);
  return (rows ?? []).filter(r => isVwapBandsStrategy(r.strategy_id));
}

/**
 * Roda a simulação BASELINE (WATCHING/PENDING/BOUGHT, mesmo motor do bot real) sobre o
 * histórico de um símbolo e devolve os trades fechados, cada um já marcado com o valor da
 * EMA200(15m) no instante da compra e se o close da compra ficou acima dela.
 */
async function backtestSymbol(row) {
  const symbol = row.symbol.toUpperCase();
  const fetcher = fetcherFor(row.exchange);

  const testEndTime = Date.now();
  const testStartTime = testEndTime - TEST_DAYS * 86_400_000;

  // "Relógio mestre" da simulação = entry.pullback.pollInterval real (padrão 15m) — não é
  // o mesmo intervalo do filtro EMA (EMA_IV), que é configurável via --ema-interval e pode
  // ser diferente (ex.: 5m). Confundir os dois faz o cMap[pollInterval] ficar vazio dentro
  // de evaluatePullbackReady (que exige esse intervalo pra checar o retorno) e nenhum trade
  // é detectado — por isso os dois são buscados/mantidos separados.
  // O emaFilter (EMA200 15m -2%) já é o default de produção em strategyEngine.js — desliga
  // aqui pra simular o BASELINE sem ele e comparar contra o filtro proposto via CLI (que
  // pode ser esse mesmo default ou uma variação, ex.: --ema-interval 5m) aplicado por fora,
  // do jeito que este script já fazia antes do filtro virar parte do motor.
  const config = toEngineConfig(normalizeVwapBandsConfig({ entry: { emaFilter: { enabled: false } } }));
  const pollIv = config.entry.pullback.pollInterval;
  const efSameAsPoll = EMA_IV === pollIv;

  const fetches = [
    fetcher(symbol, PRICE_IV, testStartTime - PRICE_VWAP_BUFFER_DAYS * 86_400_000, testEndTime),
    fetcher(symbol, VWAP_IV, testStartTime - PRICE_VWAP_BUFFER_DAYS * 86_400_000, testEndTime),
    fetcher(symbol, pollIv, testStartTime - PRICE_VWAP_BUFFER_DAYS * 86_400_000, testEndTime),
  ];
  if (!efSameAsPoll) fetches.push(fetcher(symbol, EMA_IV, testStartTime - EMA_WARMUP_DAYS * 86_400_000, testEndTime));
  const [rawPrice, rawVwap, rawPoll, rawEmaFetched] = await Promise.all(fetches);
  const rawEma = efSameAsPoll ? rawPoll : rawEmaFetched;

  if (!rawPrice.length || !rawVwap.length || !rawPoll.length || !rawEma.length) {
    return { symbol, error: 'sem candles suficientes' };
  }

  const ema200Series = buildMaTimeSeries(rawEma, EMA_PERIOD);

  const pollStartIdx = Math.max(0, rawPoll.findIndex(c => Number(c.openTime) >= Number(testStartTime)));

  let phase = 'WATCHING';
  let pending = null;
  let position = null;
  const trades = [];

  for (let j = pollStartIdx; j < rawPoll.length; j++) {
    const now = rawPoll[j].openTime;
    const priceUpTo = rawPrice.filter(c => Number(c.openTime) <= Number(now));
    if (!priceUpTo.length) continue;

    const cMap = {
      [PRICE_IV]: priceUpTo,
      [VWAP_IV]: rawVwap.filter(c => Number(c.openTime) <= Number(now)),
      [pollIv]: rawPoll.slice(0, j + 1),
    };
    if (!efSameAsPoll) cMap[EMA_IV] = rawEma.filter(c => Number(c.openTime) <= Number(now));

    if (phase === 'WATCHING') {
      const signal = evaluateEntrySignal(config, cMap);
      if (signal.allowed) {
        pending = {
          setupId: signal.setupId, touchLevel: signal.touchLevel, confirmLevel: signal.confirmLevel,
          targetLevel: signal.targetLevel, signalOpenTime: signal.confirmOpenTime, signalClose: signal.close,
        };
        phase = 'PENDING';
      }
    } else if (phase === 'PENDING') {
      const freshSignal = evaluateEntrySignal(config, cMap);
      if (freshSignal.allowed && Number(freshSignal.confirmOpenTime) > Number(pending.signalOpenTime)) {
        pending = {
          setupId: freshSignal.setupId, touchLevel: freshSignal.touchLevel, confirmLevel: freshSignal.confirmLevel,
          targetLevel: freshSignal.targetLevel, signalOpenTime: freshSignal.confirmOpenTime, signalClose: freshSignal.close,
        };
      }

      const ready = evaluatePullbackReady(config, cMap, pending);
      if (ready.cancel) {
        phase = 'WATCHING';
        pending = null;
      } else if (ready.ready) {
        const decisionTime = ready.decisionTime ?? now;
        const ema200AtBuy = maValueAt(ema200Series, decisionTime);
        const ema200Floor = ema200AtBuy != null ? ema200AtBuy * (1 - TOLERANCE_PCT / 100) : null;
        position = {
          buyPrice: ready.close, buyTime: decisionTime,
          touchLevel: pending.touchLevel, targetLevel: pending.targetLevel,
          ema200AtBuy, ema200Floor, passesEmaFilter: ema200Floor != null && ready.close > ema200Floor,
        };
        phase = 'BOUGHT';
        pending = null;
      }
    } else if (phase === 'BOUGHT') {
      const exitResult = evaluateExit(config, cMap, position.buyPrice, {
        peakPrice: position.buyPrice, targetLevel: position.targetLevel, touchLevel: position.touchLevel,
        buyTime: position.buyTime,
      });
      if (exitResult.exit) {
        const sellTime = exitResult.decisionTime ?? now;
        const pnlPct = ((exitResult.close - position.buyPrice) / position.buyPrice) * 100;
        trades.push({
          symbol,
          buyTime: position.buyTime, buyPrice: position.buyPrice,
          sellTime, sellPrice: exitResult.close,
          pnlPct, reason: exitResult.reason,
          ema200AtBuy: position.ema200AtBuy, ema200Floor: position.ema200Floor,
          passesEmaFilter: position.passesEmaFilter,
        });
        phase = 'WATCHING';
        position = null;
      }
    }
  }

  return { symbol, trades, openPosition: phase === 'BOUGHT' ? position : null };
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  let favorites = await loadFavorites();
  if (SYMBOL_FILTER) favorites = favorites.filter(r => r.symbol.toUpperCase() === SYMBOL_FILTER);

  const emaLabel = `EMA${EMA_PERIOD}(${EMA_IV})`;
  console.log(`\n═══ vwap-bands — ${favorites.length} moeda(s) favorita(s), janela ${TEST_DAYS} dias ═══`);
  console.log(`Regra testada: além das condições atuais, só compraria se close da entrada > banda inferior da ${emaLabel} (${emaLabel} * (1 - ${TOLERANCE_PCT}%))\n`);

  const allTrades = [];
  const errors = [];

  for (const row of favorites) {
    process.stderr.write(`  ${row.symbol} (${row.exchange})...`);
    try {
      const r = await backtestSymbol(row);
      if (r.error) {
        errors.push(r);
        process.stderr.write(` skip (${r.error})\n`);
        continue;
      }
      allTrades.push(...r.trades);
      process.stderr.write(` ok (${r.trades.length} trade(s))\n`);
    } catch (err) {
      errors.push({ symbol: row.symbol, error: err.message });
      process.stderr.write(` erro: ${err.message}\n`);
    }
  }

  const withData = allTrades.filter(t => t.ema200AtBuy != null);
  const noEmaData = allTrades.filter(t => t.ema200AtBuy == null);
  const allowed = withData.filter(t => t.passesEmaFilter);
  const blocked = withData.filter(t => !t.passesEmaFilter);

  const sum = (arr) => arr.reduce((s, t) => s + t.pnlPct, 0);
  const winRate = (arr) => arr.length ? (arr.filter(t => t.pnlPct > 0).length / arr.length) * 100 : null;

  console.log('\n── Resumo geral ──');
  console.log(`Símbolos analisados: ${favorites.length - errors.length} / ${favorites.length} (${errors.length} sem dados)`);
  console.log(`Trades simulados no período: ${allTrades.length}`);
  console.log(`  Sem ${emaLabel} disponível na compra (fora da janela de warmup): ${noEmaData.length}`);
  console.log(`  Com dado de EMA: ${withData.length}`);
  console.log(`    Passariam no filtro (close > banda -${TOLERANCE_PCT}% da ${emaLabel}): ${allowed.length}`);
  console.log(`    Seriam bloqueados pelo filtro (close <= banda -${TOLERANCE_PCT}% da ${emaLabel}): ${blocked.length}`);

  console.log(`\nPnL BASELINE (todos os trades c/ dado de EMA):        ${fmtPct(sum(withData))}  (taxa de acerto ${winRate(withData)?.toFixed(0) ?? '—'}%)`);
  console.log(`PnL dos trades que o filtro PERMITIRIA:                ${fmtPct(sum(allowed))}  (taxa de acerto ${winRate(allowed)?.toFixed(0) ?? '—'}%, ${allowed.length} trade(s))`);
  console.log(`PnL dos trades que o filtro BLOQUEARIA:                ${fmtPct(sum(blocked))}  (taxa de acerto ${winRate(blocked)?.toFixed(0) ?? '—'}%, ${blocked.length} trade(s))`);
  console.log(`Δ PnL total com o filtro (bloqueados viram 0):         ${fmtPct(sum(allowed) - sum(withData))}`);

  if (allowed.length) {
    console.log(`\n── Trades permitidos pelo filtro (close > banda -${TOLERANCE_PCT}% da ${emaLabel}) ──`);
    console.log(`Símbolo     | Compra               | Preço      | ${emaLabel.padEnd(11)} | Banda ${(-TOLERANCE_PCT + '%').padEnd(4)} | Saída          | PnL`);
    console.log('------------|----------------------|------------|-------------|-------------|----------------|----------');
    for (const t of allowed.sort((a, b) => a.buyTime - b.buyTime)) {
      console.log(
        `${t.symbol.padEnd(11)} | ${fmtBRT(t.buyTime).padEnd(20)} | ${t.buyPrice.toFixed(6).padStart(10)} | `
        + `${t.ema200AtBuy.toFixed(6).padStart(11)} | ${t.ema200Floor.toFixed(6).padStart(11)} | ${t.reason.padEnd(14)} | ${fmtPct(t.pnlPct)}`,
      );
    }
  }

  if (blocked.length) {
    console.log(`\n── Trades que o filtro teria bloqueado (close <= banda -${TOLERANCE_PCT}% da ${emaLabel}) ──`);
    console.log(`Símbolo     | Compra               | Preço      | ${emaLabel.padEnd(11)} | Banda ${(-TOLERANCE_PCT + '%').padEnd(4)} | Saída          | PnL`);
    console.log('------------|----------------------|------------|-------------|-------------|----------------|----------');
    for (const t of blocked.sort((a, b) => a.buyTime - b.buyTime)) {
      console.log(
        `${t.symbol.padEnd(11)} | ${fmtBRT(t.buyTime).padEnd(20)} | ${t.buyPrice.toFixed(6).padStart(10)} | `
        + `${t.ema200AtBuy.toFixed(6).padStart(11)} | ${t.ema200Floor.toFixed(6).padStart(11)} | ${t.reason.padEnd(14)} | ${fmtPct(t.pnlPct)}`,
      );
    }
  }

  if (errors.length) {
    console.log('\n── Erros / sem dados ──');
    for (const e of errors) console.log(`  ${e.symbol}: ${e.error}`);
  }
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
