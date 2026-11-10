'use strict';

/**
 * Scanner de "estouro de alta": varre os pares USDT ativos da Binance atrás de moedas cujo
 * candle (padrão 4h) tem o perfil de um rompimento forte — ponto de partida pra escolher moedas
 * pro trade de price action (caixa 'priceAction' do gráfico, ver
 * frontend-react/src/utils/priceActionBoxSim.js, cujo sinal é justamente um candle de alta).
 *
 * Um candle é "estouro" quando passa em TODOS os critérios (todos editáveis, ver DEFAULTS):
 *   1. corpo verde ≥ minBodyPct%          (close − open) / open
 *   2. volume ≥ minVolumeRatio × média     dos `lookback` candles anteriores
 *   3. fechamento na parte de cima         (close − low) / (high − low) ≥ minClosePos (0..1)
 *   4. rompimento (opcional)               close > máxima dos `lookback` candles anteriores
 *
 * Calibrado na SLPUSDT 4h de 31/10/2026 01:00 BRT (máxima +21,8% desde a abertura, volume 14× a
 * média, rompeu a máxima de 20 candles — às 03:46 o candle ainda aberto já tinha devolvido até
 * +8,5% de corpo e fechamento a 45% do range) — por isso minClosePos é 0,4: um estouro desses
 * costuma deixar pavio superior grande.
 *
 * É sempre UM candle de explosão. Padrão `withinCandles=1`: só o candle mais recente — a moeda tem
 * que estar NO candle de explosão agora (um estouro de horas atrás que já devolveu não serve).
 * `withinCandles=N` procura nos últimos N (estudo/histórico): se houver mais de um, fica o de maior
 * score; `candlesAgo` diz há quantos candles foi e `changeSincePct` quanto o preço andou desde
 * o fechamento dele.
 *
 * Por padrão inclui o candle EM FORMAÇÃO (pega o estouro enquanto acontece); `closedOnly`
 * ignora o candle aberto (menos sinal falso — o candle aberto pode devolver a alta).
 *
 * `firstOfMove`: só vale a 1ª explosão do movimento — se algum dos `lookback` candles anteriores
 * ao estouro também foi explosão (mesmos critérios), a moeda fica de fora. Caso INITUSDT 4h
 * 09–10/11/2026: explodiu às 13:00, 17:00 e 01:00 e o automático entrou nas três.
 *
 * Candles via fetchKlines direto (não o cache em disco de getCandles.js): o scan pede só
 * lookback+2 candles por moeda e precisa do candle aberto fresco, sem gravar ~400 arquivos.
 *
 * CLI:  node backend/market/bullishBreakoutScanner.js [--interval 1h] [--minBodyPct 3] ...
 */

const fetchKlines = require('../binance/fetchKlines');
const getTickers = require('../binance/cachedTicker24hr');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { getSymbolCategories } = require('../utils/assetCategories');

// Stablecoins (sem momentum) e bStocks (ações/ETFs tokenizados — Binance recusa "not permitted
// for this account" nesta conta) ficam fora da varredura.
const isUntradableCategory = (sym) => getSymbolCategories(sym).some((c) => c === 'stablecoins' || c === 'tokenizedStocks');

const DEFAULTS = {
  interval: '4h',
  minBodyPct: 5,
  minVolumeRatio: 3,
  minClosePos: 0.4,
  lookback: 20,
  withinCandles: 1,
  requireBreakout: true,
  closedOnly: false,
  firstOfMove: false,
  minVolume24h: 1_000_000,
};

const VALID_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
const INTERVAL_MS = {
  m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000,
};
const SCAN_CONCURRENCY = 10;
const CACHE_TTL_MS = 60 * 1000;

function intervalToMs(interval) {
  const m = /^(\d+)([mhdw])$/.exec(interval);
  return m ? Number(m[1]) * INTERVAL_MS[m[2]] : NaN;
}

function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Normaliza e valida as opções (query string ou CLI chegam como string). */
function normalizeOptions(raw = {}) {
  const num = (v, def) => (v === undefined || v === null || v === '' ? def : Number(v));
  const bool = (v, def) => (v === undefined || v === null || v === '' ? def : v === true || v === 'true' || v === '1');
  const opts = {
    interval: raw.interval ?? DEFAULTS.interval,
    minBodyPct: num(raw.minBodyPct, DEFAULTS.minBodyPct),
    minVolumeRatio: num(raw.minVolumeRatio, DEFAULTS.minVolumeRatio),
    minClosePos: num(raw.minClosePos, DEFAULTS.minClosePos),
    lookback: Math.trunc(num(raw.lookback, DEFAULTS.lookback)),
    withinCandles: Math.trunc(num(raw.withinCandles, DEFAULTS.withinCandles)),
    requireBreakout: bool(raw.requireBreakout, DEFAULTS.requireBreakout),
    closedOnly: bool(raw.closedOnly, DEFAULTS.closedOnly),
    firstOfMove: bool(raw.firstOfMove, DEFAULTS.firstOfMove),
    minVolume24h: num(raw.minVolume24h, DEFAULTS.minVolume24h),
  };
  if (!VALID_INTERVALS.includes(opts.interval)) throw new Error(`intervalo inválido: ${opts.interval}`);
  for (const k of ['minBodyPct', 'minVolumeRatio', 'minClosePos', 'minVolume24h']) {
    if (!Number.isFinite(opts[k]) || opts[k] < 0) throw new Error(`${k} inválido: ${raw[k]}`);
  }
  if (opts.minClosePos > 1) throw new Error(`minClosePos deve estar entre 0 e 1: ${raw.minClosePos}`);
  if (!(opts.lookback >= 2 && opts.lookback <= 500)) throw new Error(`lookback inválido: ${raw.lookback}`);
  if (!(opts.withinCandles >= 1 && opts.withinCandles <= 100)) throw new Error(`withinCandles inválido: ${raw.withinCandles}`);
  return opts;
}

/**
 * Avalia o último candle da lista (ou o último FECHADO, com closedOnly). Função pura.
 * @param {Array<{openTime, open, high, low, close, volume}>} candles  ascendentes (number ou string)
 * @returns {object|null}  métricas do candle se passou em todos os critérios, senão null
 */
function evaluateBullishBreakout(candles, options, nowMs = Date.now()) {
  const opts = { ...DEFAULTS, ...options };
  let cs = (candles ?? []).map((c) => ({
    openTime: Number(c.openTime),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  }));
  const ivMs = intervalToMs(opts.interval);
  if (opts.closedOnly && cs.length && cs[cs.length - 1].openTime + ivMs > nowMs) cs = cs.slice(0, -1);
  if (cs.length < opts.lookback + 1) return null;

  const cur = cs[cs.length - 1];
  const prev = cs.slice(-(opts.lookback + 1), -1);
  if (!(cur.close > cur.open) || !(cur.high > cur.low)) return null;

  const bodyPct = ((cur.close - cur.open) / cur.open) * 100;
  const avgVolume = prev.reduce((s, c) => s + c.volume, 0) / prev.length;
  const volumeRatio = avgVolume > 0 ? cur.volume / avgVolume : 0;
  const closePos = (cur.close - cur.low) / (cur.high - cur.low);
  const priorHigh = Math.max(...prev.map((c) => c.high));
  const brokeOut = cur.close > priorHigh;

  if (bodyPct < opts.minBodyPct || volumeRatio < opts.minVolumeRatio || closePos < opts.minClosePos) return null;
  if (opts.requireBreakout && !brokeOut) return null;

  return {
    openTime: cur.openTime,
    closed: cur.openTime + ivMs <= nowMs,
    open: cur.open,
    high: cur.high,
    low: cur.low,
    close: cur.close,
    bodyPct: round(bodyPct),
    volumeRatio: round(volumeRatio),
    closePos: round(closePos),
    priorHigh,
    brokeOut,
    breakoutPct: round(((cur.close - priorHigh) / priorHigh) * 100),
    risePct: round(((cur.high - cur.open) / cur.open) * 100),
    // Volume limitado a 20× pra uma moeda ilíquida com volume anterior ~0 não dominar o ranking
    score: round(bodyPct * Math.min(volumeRatio, 20) * closePos),
  };
}

/**
 * Procura o candle de explosão nos últimos `withinCandles` candles (cada um avaliado sozinho
 * por evaluateBullishBreakout, com os `lookback` anteriores A ELE como referência). Devolve o de
 * maior score + candlesAgo (0 = o mais recente avaliado) e changeSincePct (último preço vs.
 * fechamento do candle de explosão), ou null.
 */
function findRecentBreakout(candles, options, nowMs = Date.now()) {
  const opts = { ...DEFAULTS, ...options };
  let cs = candles ?? [];
  const ivMs = intervalToMs(opts.interval);
  if (opts.closedOnly && cs.length && Number(cs[cs.length - 1].openTime) + ivMs > nowMs) cs = cs.slice(0, -1);
  if (!cs.length) return null;
  const lastClose = Number(cs[cs.length - 1].close);
  let best = null;
  for (let ago = 0; ago < opts.withinCandles && cs.length - ago >= opts.lookback + 1; ago++) {
    const r = evaluateBullishBreakout(cs.slice(0, cs.length - ago), { ...opts, closedOnly: false }, nowMs);
    if (r && (!best || r.score > best.score)) best = { ...r, candlesAgo: ago };
  }
  if (!best) return null;
  if (opts.firstOfMove) {
    const at = cs.length - 1 - best.candlesAgo;
    for (let j = at - 1; j >= Math.max(opts.lookback, at - opts.lookback); j--) {
      if (evaluateBullishBreakout(cs.slice(0, j + 1), { ...opts, closedOnly: false }, nowMs)) return null;
    }
  }
  best.changeSincePct = round(((lastClose - best.close) / best.close) * 100);
  return best;
}

async function runWithConcurrency(items, worker, concurrency) {
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

/** Nome no padrão de filtro do painel ("interval|tipo|params"), ex.: "4h|Explosão|c5|v3|f40|r". */
function buildFilterName(opts) {
  const parts = [opts.interval, 'Explosão', `c${opts.minBodyPct}`, `v${opts.minVolumeRatio}`, `f${Math.round(opts.minClosePos * 100)}`];
  if (opts.withinCandles > 1) parts.push(`n${opts.withinCandles}`);
  if (opts.requireBreakout) parts.push('r');
  if (opts.closedOnly) parts.push('fechado');
  if (opts.firstOfMove) parts.push('1a');
  return parts.join('|');
}

/**
 * Varre o mercado. Devolve no formato de filtro do painel ({ name, list, meta }) — `list`
 * ordenada pelo score (mais forte primeiro), `meta.breakouts[symbol]` com as métricas do candle.
 */
async function scanBullishBreakouts(rawOptions = {}, { log = () => {} } = {}) {
  const opts = normalizeOptions(rawOptions);
  const [{ list: symbols }, tickers] = await Promise.all([getActiveUsdtPairs(), getTickers()]);
  const volume24h = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));

  const candidates = symbols.filter((sym) => !isUntradableCategory(sym)
    && (volume24h.get(sym) ?? 0) >= opts.minVolume24h);

  const hits = [];
  let errors = 0;
  const now = Date.now();
  await runWithConcurrency(candidates, async (symbol) => {
    try {
      // firstOfMove avalia também os `lookback` candles antes do estouro, cada um com o seu histórico.
      const extra = opts.firstOfMove ? opts.lookback : 0;
      const candles = await fetchKlines(symbol, opts.interval, opts.lookback + opts.withinCandles + 1 + extra);
      const r = findRecentBreakout(candles, opts, now);
      if (r) hits.push({ symbol, ...r, volume24h: volume24h.get(symbol) });
    } catch (err) {
      errors++;
      log(`   ${symbol}: erro ao buscar candles (${err.message})`);
    }
  }, SCAN_CONCURRENCY);

  hits.sort((a, b) => b.score - a.score);
  return {
    name: buildFilterName(opts),
    list: hits.map((h) => h.symbol),
    meta: {
      options: opts,
      scannedAt: now,
      analyzed: candidates.length,
      errors,
      breakouts: Object.fromEntries(hits.map(({ symbol, ...rest }) => [symbol, rest])),
    },
  };
}

// Cache curto por combinação de opções: a tela pode re-pedir o mesmo scan várias vezes seguidas
// e cada scan custa ~1 chamada de klines por moeda (~400).
const _cache = new Map();

async function getBullishBreakouts(rawOptions = {}) {
  const opts = normalizeOptions(rawOptions);
  const key = JSON.stringify(opts);
  const hit = _cache.get(key);
  if (hit && (hit.inflight || Date.now() - hit.at < CACHE_TTL_MS)) return hit.promise;

  const promise = scanBullishBreakouts(opts);
  _cache.set(key, { promise, inflight: true, at: 0 });
  try {
    await promise;
    _cache.set(key, { promise, inflight: false, at: Date.now() });
  } catch (err) {
    _cache.delete(key);
  }
  return promise;
}

function fmtBrt(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([A-Za-z0-9]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[m[1]] = argv[++i];
    else out[m[1]] = 'true';
  }
  return out;
}

async function runCli() {
  const args = parseCliArgs(process.argv.slice(2));
  const result = await scanBullishBreakouts(args, { log: console.log });
  const o = result.meta.options;
  console.log(`\n${result.name} — ${result.meta.analyzed} pares USDT no ${o.interval} `
    + `(${o.closedOnly ? 'só fechados' : 'inclui candle em formação'})`);
  if (!result.list.length) {
    console.log('Nenhum estouro encontrado com esses critérios.');
    return;
  }
  console.log(`\n${'PAR'.padEnd(14)}${'CANDLE'.padStart(13)}${'CORPO'.padStart(9)}${'MÁX'.padStart(9)}${'VOL'.padStart(8)}`
    + `${'FECH'.padStart(7)}${'ROMPEU'.padStart(9)}${'DESDE'.padStart(9)}${'PREÇO'.padStart(14)}`);
  for (const sym of result.list) {
    const b = result.meta.breakouts[sym];
    const since = `${b.changeSincePct >= 0 ? '+' : ''}${b.changeSincePct.toFixed(2)}%`;
    console.log(`${sym.padEnd(14)}${fmtBrt(b.openTime).padStart(13)}${`${b.bodyPct.toFixed(2)}%`.padStart(9)}`
      + `${`+${b.risePct.toFixed(1)}%`.padStart(9)}${`${b.volumeRatio.toFixed(1)}x`.padStart(8)}`
      + `${`${Math.round(b.closePos * 100)}%`.padStart(7)}`
      + `${(b.brokeOut ? `+${b.breakoutPct.toFixed(2)}%` : 'não').padStart(9)}${since.padStart(9)}`
      + `${String(b.close).padStart(14)}${b.closed ? '' : '  (aberto)'}`);
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULTS, VALID_INTERVALS, normalizeOptions, evaluateBullishBreakout, findRecentBreakout, buildFilterName,
  scanBullishBreakouts, getBullishBreakouts,
};
