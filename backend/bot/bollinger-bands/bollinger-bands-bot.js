'use strict';

/**
 * Bollinger Bands Bot — o bot mais simples do painel:
 *   1. A mínima do candle toca a banda inferior BB(period,stdDev) do intervalo escolhido
 *      (pullback opcional: exige tocar `belowPct`% ainda mais abaixo dela) → compra (ordem
 *      limite no preço exato da banda/pullback).
 *   2. Coloca bracket TP/SL resting na corretora: alvo = banda superior ao vivo, stop =
 *      piso percentual (stopLoss.maxLossPct) — recriada quando o alvo ou o stop desviarem
 *      driftPct% do preço em que foi colocada. Mesma mecânica do vwap-bands-bot.js.
 *
 * Sem fase PENDING/escada — só WATCHING → BOUGHT.
 *
 * strategy_id: bollinger-bands
 *
 * Uso:
 *   node backend/bot/bollinger-bands/bollinger-bands-bot.js
 *   node backend/bot/bollinger-bands/bollinger-bands-bot.js --symbol BTCUSDT
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const registry = require('../multitradeRegistry');
const { startMultitradeWatch, configFingerprint } = require('../multitradeWatch');
const { resolveStrategy } = require('./tradeConfigSchema');
const { STRATEGY_IDS, isBollingerBandsStrategy } = require('./strategyPresets');
const {
  getRequiredSpecs, evaluateEntrySignal, evaluateExit, computeBracketPrices, computeStopLossFloor,
} = require('./strategyEngine');

// Componentes genéricos (compra/venda/execução), compartilhados com os outros bots de
// trade — ver backend/bot/shared/*.
const { buildAdapter, syncExchangeClocks } = require('../shared/buildAdapter');
const { sbReq } = require('../shared/supabaseRest');
const { createTradeExecution } = require('../shared/tradeExecution');

const BOT_LABEL = 'BOLLINGER-BANDS';
const VOL_CACHE_MS = 5 * 60_000;

// ── Logging ───────────────────────────────────────────────────────────────────
const BOT_DIR = path.join(__dirname, '../../data/bot');
fs.mkdirSync(BOT_DIR, { recursive: true });

const G = '\x1b[32m', Y = '\x1b[33m', X = '\x1b[0m';
const COLORS = ['\x1b[94m','\x1b[93m','\x1b[95m','\x1b[96m','\x1b[33m','\x1b[35m','\x1b[36m','\x1b[34m','\x1b[97m','\x1b[90m'];

function nowFmt() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function makeLogger(symbol, strategyId, color = '') {
  const logFile = path.join(BOT_DIR, `log-${symbol}-${strategyId}.txt`);
  const tag = `${symbol}/${strategyId}`;
  return function log(...args) {
    const msg    = `[${nowFmt()}] ${color}[${tag}]${X} ${args.join(' ')}`;
    const noAnsi = msg.replace(/\x1b\[[0-9;]*m/g, '');
    console.log(msg);
    try { fs.appendFileSync(logFile, noAnsi + '\n'); } catch {}
  };
}

async function loadRows() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  return sbReq('GET', 'rsi_multi_bot_state', null, `?or=(${ids})&order=id.asc`);
}

/** Só quem está favoritado e ativo em multitrade_favorites — sem isso, toda linha que já
 *  existiu em rsi_multi_bot_state (inclusive removida do painel há muito tempo) começava a
 *  rodar no boot, e só era encerrada minutos depois pelo ciclo periódico do
 *  startMultitradeWatch (mesmo fix aplicado em vwap-bands-bot.js). */
async function loadEnabledFavoriteKeys() {
  const ids = STRATEGY_IDS.map(id => `strategy_id.eq.${id}`).join(',');
  const favorites = await sbReq('GET', 'multitrade_favorites', null, `?or=(${ids})&enabled=eq.true&select=symbol,strategy_id`);
  return new Set((favorites ?? []).map(f => registry.sessionKey(f.symbol, f.strategy_id)));
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  if (x < 0.01) return x.toFixed(6);
  if (x < 1) return x.toFixed(4);
  return x.toFixed(2);
}

function buildEntryReasonLines(config, entryMeta) {
  return [`${entryMeta.entryDesc} @ ${fmtPrice(entryMeta.close)}`];
}

// executeBuy/executeSell/saveState/hasOpenPosition/resetOrphanPosition/parseRulesState são
// genéricos — ver backend/bot/shared/tradeExecution.js. Sem extraInitialRulesState: alvo e
// stop são recalculados ao vivo a cada tick (computeBracketPrices), não há "degrau" pra
// lembrar entre ticks como no vwap-bands.
const {
  saveState, hasOpenPosition, resetOrphanPosition,
  parseRulesState, executeBuy, executeSell, recordBracketFill,
} = createTradeExecution({
  botLabel: BOT_LABEL,
  buildReasonLines: buildEntryReasonLines,
  computeStopLossFloor,
});

/**
 * Coloca a bracket TP/SL resting na corretora logo após a compra confirmar (só se
 * `exit.restingBracket.enabled`). Falha em silêncio (loga e segue) — sem a bracket, a
 * saída continua funcionando via evaluateExit no candle (venda a mercado).
 */
async function placeInitialBracket({ rowId, adapter, config, cMap, session, log, filledQty, buyPrice }) {
  if (!config.exit.restingBracket?.enabled) return;
  const { targetPrice, stopPrice } = computeBracketPrices(config, cMap, buyPrice, buyPrice);
  if (targetPrice == null || stopPrice == null) {
    log(`${Y}⚠️  Bracket TP/SL não colocada — banda superior indisponível ainda${X}`);
    return;
  }
  try {
    const bracket = await adapter.placeExitBracket(filledQty, targetPrice, stopPrice);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, placedAt: new Date().toISOString() } };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    log(`${G}🎯 Bracket TP/SL colocada na corretora — alvo (banda superior) ${fmtPrice(bracket.targetPrice)} / stop ${fmtPrice(bracket.stopPrice)}${X}`);
  } catch (err) {
    log(`${Y}⚠️  Falha ao colocar bracket TP/SL (${err.message}) — segue só no candle fechado${X}`);
  }
}

/** Recalcula alvo/stop vigentes e recria a bracket se algum desviou ≥driftPct% do preço em
 *  que foi colocada (a banda superior se move a cada candle novo). */
async function maybeReplaceBracket({ rowId, adapter, config, cMap, session, log, exitBracket, buyPrice, buyQty, peakPrice }) {
  const driftPct = config.exit.restingBracket?.driftPct ?? 3;
  const { targetPrice: liveTarget, stopPrice: liveStop } = computeBracketPrices(config, cMap, buyPrice, peakPrice);
  if (liveTarget == null || liveStop == null) return;

  const drifted = (livePrice, placedPrice) => placedPrice
    ? Math.abs((livePrice - placedPrice) / placedPrice) * 100 >= driftPct
    : false;
  if (!drifted(liveTarget, exitBracket.targetPrice) && !drifted(liveStop, exitBracket.stopPrice)) return;

  let cancelled = false;
  try {
    await adapter.cancelExitBracket(exitBracket);
    cancelled = true;
    const bracket = await adapter.placeExitBracket(buyQty, liveTarget, liveStop);
    session.rulesState = { ...(session.rulesState ?? {}), exitBracket: { ...bracket, placedAt: new Date().toISOString() } };
    await saveState(rowId, { rules_state: session.rulesState }, log);
    log(`🔁 Bracket TP/SL recriada (deriva ≥${driftPct}%) — alvo ${fmtPrice(bracket.targetPrice)} / stop ${fmtPrice(bracket.stopPrice)}`);
  } catch (err) {
    if (cancelled) {
      // A bracket antiga já foi cancelada na corretora antes da nova falhar — limpa
      // exitBracket pra o próximo tick cair no fallback de saída via candle (evaluateExit).
      session.rulesState = { ...(session.rulesState ?? {}), exitBracket: null };
      await saveState(rowId, { rules_state: session.rulesState }, log);
      log(`${Y}⚠️  Falha ao recriar bracket TP/SL (${err.message}) — bracket antiga já cancelada, voltando pra saída via candle${X}`);
    } else {
      log(`${Y}⚠️  Falha ao recriar bracket TP/SL (${err.message}) — mantendo a atual${X}`);
    }
  }
}

async function fetchCandleMap(adapter, specs) {
  const maxLimits = {};
  for (const { interval, limit } of specs) {
    maxLimits[interval] = Math.max(maxLimits[interval] || 0, limit);
  }
  const fetchAll = () => Promise.all(
    Object.entries(maxLimits).map(async ([iv, lim]) => [iv, await adapter.fetchCandles(lim, iv)]),
  );
  let entries;
  try {
    entries = await fetchAll();
  } catch (err) {
    if (err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || /fetch failed/i.test(err.message)) {
      await new Promise(r => setTimeout(r, 2000));
      entries = await fetchAll();
    } else {
      throw err;
    }
  }
  return Object.fromEntries(entries);
}

// ── Tick ──────────────────────────────────────────────────────────────────────
async function tick(rowId, adapter, strategy, log, session) {
  const { config } = strategy;
  const specs = getRequiredSpecs(config);
  const cMap  = await fetchCandleMap(adapter, specs);

  const rows = await sbReq('GET', 'rsi_multi_bot_state', null, `?id=eq.${rowId}&limit=1`);
  const state = rows?.[0];
  if (!state) return { phase: 'WATCHING' };

  const { capital, symbol, strategy_id: strategyId } = state;
  const buyPrice = state.buy_price ? parseFloat(state.buy_price) : null;
  let phase = session.phase ?? state.phase;
  if (phase === 'BOUGHT' && !hasOpenPosition(state)) {
    return resetOrphanPosition(rowId, log, session, state, 'sem buy_qty/buy_price no Supabase');
  }
  if (session.phase === 'BOUGHT' && state.phase !== 'BOUGHT') {
    session.phase = state.phase;
    phase = state.phase;
  }

  // ── WATCHING ──────────────────────────────────────────────────────────────
  if (phase !== 'BOUGHT') {
    const signal = evaluateEntrySignal(config, cMap);
    if (!signal.allowed) return { phase: 'WATCHING' };

    log(`${G}📍 Sinal (${signal.entryDesc}) — comprando ${parseFloat(capital).toFixed(2)} USDT a ${fmtPrice(signal.limitPrice)} (ordem limite)${X}`);
    const bought = await executeBuy({
      rowId, adapter, strategy, log, session,
      entryMeta: { ...signal, signalPrice: signal.close },
      capital, strategyId, symbol,
    });
    if (bought) {
      await placeInitialBracket({
        rowId, adapter, config, cMap, session, log,
        filledQty: bought.filledQty, buyPrice: bought.avgPrice,
      });
    }
    return { phase: bought ? 'BOUGHT' : 'WATCHING' };
  }

  // ── BOUGHT ────────────────────────────────────────────────────────────────
  const rulesState = { ...parseRulesState(state), ...(session.rulesState ?? {}) };

  // Trailing do stop percentual: acompanha o pico de preço desde a compra (usado tanto pra
  // recalcular o stop da bracket quanto pro fallback via candle).
  const storedPeak = rulesState.stopPeakPrice != null ? parseFloat(rulesState.stopPeakPrice) : buyPrice;
  const lastCandle = (cMap[config.entry.interval] ?? []).at(-1);
  const lastHigh = lastCandle?.high != null ? parseFloat(lastCandle.high) : buyPrice;
  const peakPrice = Math.max(storedPeak ?? buyPrice, lastHigh);
  if (peakPrice > (storedPeak ?? buyPrice) + 1e-12) {
    session.rulesState = { ...rulesState, stopPeakPrice: peakPrice };
    await saveState(rowId, { rules_state: session.rulesState }, log);
  }

  if (rulesState.exitBracket) {
    let bracketResult;
    try {
      bracketResult = await adapter.pollExitBracket(rulesState.exitBracket);
    } catch (err) {
      log(`${Y}⚠️  Erro ao consultar bracket TP/SL: ${err.message}${X}`);
      bracketResult = { filled: null };
    }

    if (bracketResult.filled) {
      const kind = bracketResult.filled;
      const exitResult = {
        reason: kind === 'target' ? 'BB_UPPER_TARGET' : 'STOP_LOSS',
        targetLevelValue: kind === 'target' ? rulesState.exitBracket.targetPrice : rulesState.exitBracket.stopPrice,
        exitDesc: kind === 'target'
          ? 'Bracket TP na banda superior (ordem resting)'
          : 'Bracket SL no piso percentual (ordem resting)',
      };
      await recordBracketFill({ rowId, strategy, log, state, session, exitResult, result: bracketResult });
      session.phase = 'WATCHING';
      session.rulesState = null;
      return { phase: 'WATCHING' };
    }

    await maybeReplaceBracket({
      rowId, adapter, config, cMap, session, log,
      exitBracket: rulesState.exitBracket, buyPrice, buyQty: parseFloat(state.buy_qty), peakPrice,
    });

    // Bracket ainda resting na corretora — a saída é responsabilidade exclusiva dela.
    return { phase: 'BOUGHT' };
  }

  // Sem bracket resting (desligada pra esse símbolo, ou falhou ao colocar) — venda a
  // mercado via evaluateExit no candle em formação (alvo = banda superior, stop = piso %).
  const exitResult = evaluateExit(config, cMap, buyPrice, { peakPrice });
  if (!exitResult.exit) return { phase: 'BOUGHT' };

  try {
    await executeSell({
      rowId, adapter, strategy, log, state, exitResult, session,
      defaultReasonDesc: 'BB banda superior',
    });
    session.phase = 'WATCHING';
    session.rulesState = null;
  } catch {
    return { phase: 'BOUGHT' };
  }
  return { phase: 'WATCHING' };
}

// ── startSymbol ───────────────────────────────────────────────────────────────
async function startSymbol(row, color) {
  if (registry.has(row.id)) return;

  let strategy = resolveStrategy(row);
  if (!strategy) return;

  const adapter = buildAdapter(row.exchange ?? 'binance', row.symbol);
  const log     = makeLogger(row.symbol, row.strategy_id, color);

  const ctx = {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: registry.sessionKey(row.symbol, row.strategy_id),
    adapter,
    log,
    strategy,
    stopped: false,
    timer: null,
    configFingerprint: configFingerprint(row),
  };

  let lastResult = { phase: row.phase };
  const rs = parseRulesState(row);
  const session = {
    volCache: null,
    phase: row.phase === 'BOUGHT' ? 'BOUGHT' : null,
    rulesState: null,
    lastExitTime: rs.lastExitTime ?? null,
  };
  let volIv;

  const stop = async () => {
    if (ctx.stopped) return;
    ctx.stopped = true;
    if (ctx.timer) clearTimeout(ctx.timer);
    if (volIv) clearInterval(volIv);
    registry.unregister(ctx.rowId);
  };

  const updateFromRow = (newRow) => {
    const next = resolveStrategy(newRow);
    if (!next) return;
    ctx.strategy = next;
  };

  registry.register(row.id, {
    rowId: row.id,
    symbol: row.symbol,
    strategyId: row.strategy_id,
    key: ctx.key,
    stop,
    updateFromRow,
    configFingerprint: ctx.configFingerprint,
  });

  const refreshVol = async () => {
    if (ctx.stopped) return;
    try {
      const volumeUsdt = await adapter.fetch24hVol();
      session.volCache = { ts: Date.now(), volumeUsdt };
    } catch {}
  };
  await refreshVol();
  volIv = setInterval(refreshVol, VOL_CACHE_MS);

  const schedule = () => {
    if (ctx.stopped) return;
    const delay = lastResult.phase === 'BOUGHT' ? ctx.strategy.fastPollMs : ctx.strategy.pollMs;
    ctx.timer = setTimeout(run, delay);
  };

  const run = async () => {
    if (ctx.stopped) return;
    try {
      lastResult = await tick(ctx.rowId, adapter, ctx.strategy, log, session);
    } catch (err) {
      log(`❌ Tick error: ${err.message}`);
    }
    schedule();
  };

  await run();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
    process.exit(1);
  }

  // Gate.io sincroniza o próprio relógio sozinha ao carregar o módulo (ver
  // backend/gate/getGateClient.js) — só a Binance precisa ser sincronizada aqui.
  await syncExchangeClocks();
  setInterval(syncExchangeClocks, 60 * 60_000);

  const symbolFilter = process.argv.includes('--symbol')
    ? process.argv[process.argv.indexOf('--symbol') + 1]?.toUpperCase()
    : null;

  let rows = await loadRows();
  rows = (rows ?? []).filter(r => isBollingerBandsStrategy(r.strategy_id));
  if (symbolFilter) {
    // --symbol força uma moeda específica pra teste manual, mesmo que não esteja favoritada.
    rows = rows.filter(r => r.symbol.toUpperCase() === symbolFilter);
  } else {
    const enabledKeys = await loadEnabledFavoriteKeys();
    rows = rows.filter(r => enabledKeys.has(registry.sessionKey(r.symbol, r.strategy_id)));
  }

  startMultitradeWatch({
    sbReq,
    strategyIds: STRATEGY_IDS,
    symbolFilter,
    resolveStrategy,
    onStartSymbol: (row) => {
      const idx = row.symbol.charCodeAt(0) + (row.strategy_id?.length ?? 0);
      return startSymbol(row, COLORS[idx % COLORS.length]);
    },
    log: console.log,
  });

  if (!rows.length) {
    await new Promise(() => {});
    return;
  }

  await Promise.all(rows.map((row, i) => startSymbol(row, COLORS[i % COLORS.length])));
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { runBollingerBandsBot: main };
