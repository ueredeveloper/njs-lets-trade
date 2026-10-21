'use strict';

/**
 * Backtest de BANDEIRAS (flags) de alta e de baixa — Estatísticas → aba "Bandeiras".
 * Uma moeda (`symbol`) ou TODO o mercado USDT da Binance (sem `symbol`); 4h por padrão.
 *
 * Detector = backend/bot/flags/detectFlags.js (espelho do botão "Band." do gráfico). Ele é causal
 * no rompimento: tudo que define a bandeira (mastro, retração, canal, volume) só usa candles até o
 * candle do rompimento — então dá pra simular a entrada a partir dali sem olhar o futuro.
 *
 * Objetivo do estudo: achar o MELHOR MOMENTO de entrar. Cada bandeira confirmada é simulada em
 * vários modos de entrada, lado a lado:
 *   - close    : no fechamento do candle que rompeu o canal (o gatilho clássico).
 *   - nextOpen : na abertura do candle seguinte (o que um bot que roda no fechamento consegue).
 *   - retest   : ordem limite no nível rompido (topo da bandeira na alta / fundo na baixa),
 *                esperando até `retestCandles` candles pelo pullback.
 * Stop: extremo oposto da bandeira (`flag`), linha oposta do canal no rompimento (`channel`) ou %
 * fixo (`pct`). Alvo: measured move (altura do mastro × `targetFrac`, projetada do rompimento).
 * Bandeira de BAIXA = venda a descoberto TEÓRICA (spot não opera short) — serve pra medir a
 * força do padrão e como alerta de saída/não-entrada.
 *
 * Execução conservadora (igual aos outros backtests): no mesmo candle, stop vence o alvo; gap além
 * do stop/alvo executa na abertura. Cada bandeira conta como uma ocorrência independente.
 */

const getCandles = require('../binance/getCandles');
const { getGateCandles } = require('../gate/getGateCandles');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const getTickers = require('../binance/cachedTicker24hr');
const { getGateFavoriteSymbols } = require('../gate/getGateFavoriteSymbols');
const { getAllGateCurrencies } = require('../gate/getAllGateCurrencies');
const { detectFlags } = require('../bot/flags/detectFlags');
const { dropOpenCandle } = require('./analyseCandleSetupsBacktest');

const CONCURRENCY = 15;
const ROWS_PER_GROUP = 400;
const BY_SYMBOL_MAX_ROWS = 40;

const DIRECTIONS = ['bull', 'bear'];
const ENTRY_MODES = ['close', 'nextOpen', 'retest'];
const STOP_MODES = ['flag', 'channel', 'pct'];
const TARGET_FRACS = [0.25, 0.5, 0.75, 1, 1.5, 2];

const DIR_LABEL = { bull: 'Bandeira de alta', bear: 'Bandeira de baixa' };
const MODE_LABEL = { close: 'Fechamento do rompimento', nextOpen: 'Abertura seguinte', retest: 'Reteste do rompimento' };

const BUCKETS = {
  poleGain: [
    { label: '< 10%', max: 10 }, { label: '10 – 15%', max: 15 }, { label: '15 – 25%', max: 25 },
    { label: '25 – 40%', max: 40 }, { label: '≥ 40%', max: Infinity },
  ],
  retrace: [
    { label: '< 25%', max: 0.25 }, { label: '25 – 38%', max: 0.382 }, { label: '≥ 38%', max: Infinity },
  ],
  flagBars: [
    { label: '4 – 6', max: 7 }, { label: '7 – 10', max: 11 }, { label: '11 – 15', max: 16 }, { label: '16+', max: Infinity },
  ],
};

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : parseFloat(Number(v).toFixed(d)));
const num = (v, def) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def);
const bool = (v, def) => (v == null || v === '' ? def : v === true || v === 1 || v === '1' || v === 'true');

function normalizeFlagOptions(raw = {}) {
  const p = raw.pattern ?? {};
  const pick = (list, v, def) => {
    const arr = Array.isArray(v) ? v : (v ? String(v).split(',') : []);
    const out = arr.map((s) => String(s).trim()).filter((s) => list.includes(s));
    return out.length ? out : def;
  };
  return {
    _normalized: true,
    interval: raw.interval || '4h',
    candleCount: Math.min(3000, Math.max(100, num(raw.candleCount, 3000))),
    positionSizeUsd: Math.max(1, num(raw.positionSizeUsd, 40)),
    directions: pick(DIRECTIONS, raw.directions, DIRECTIONS),
    entryModes: pick(ENTRY_MODES, raw.entryModes, ENTRY_MODES),
    retestCandles: Math.max(1, Math.round(num(raw.retestCandles, 6))),
    stopMode: STOP_MODES.includes(raw.stopMode) ? raw.stopMode : 'flag',
    stopPct: Math.max(0.1, num(raw.stopPct, 5)),
    targetFrac: Math.max(0.1, num(raw.targetFrac, 1)),
    maxHoldCandles: Math.max(0, Math.round(num(raw.maxHoldCandles, 30))),
    costs: { feePct: Math.max(0, num(raw.costs?.feePct, 0.1)), slippagePct: Math.max(0, num(raw.costs?.slippagePct, 0.05)) },
    pattern: {
      minPoleGainPct: num(p.minPoleGainPct, 6),
      maxPoleBars: Math.round(num(p.maxPoleBars, 12)),
      maxRetracePct: num(p.maxRetracePct, 0.5),
      minFlagBars: Math.round(num(p.minFlagBars, 4)),
      maxFlagBars: Math.round(num(p.maxFlagBars, 20)),
      volRatioMax: num(p.volRatioMax, 1),
      onlyTight: bool(p.onlyTight, false),
    },
  };
}

function toSeries(candles) {
  const cs = (candles ?? [])
    .map((c) => ({
      openTime: Number(c.openTime), open: Number(c.open), high: Number(c.high), low: Number(c.low),
      close: Number(c.close), volume: Number(c.volume),
    }))
    .filter((c) => Number.isFinite(c.openTime) && Number.isFinite(c.open) && Number.isFinite(c.high)
      && Number.isFinite(c.low) && Number.isFinite(c.close));
  return {
    n: cs.length,
    t: cs.map((c) => c.openTime), o: cs.map((c) => c.open), h: cs.map((c) => c.high),
    l: cs.map((c) => c.low), c: cs.map((c) => c.close), raw: cs,
  };
}

/**
 * Caminha candle a candle a partir de `from` com a posição aberta em `entry` no índice `entryIdx`.
 * dir +1 = compra, -1 = venda. Devolve { exitIdx, exitPrice, outcome, reach } — `reach` = maior
 * avanço a favor ANTES do stop (ignora o alvo), em preço, pro estudo de alvos.
 */
function walkTrade(s, dir, entryIdx, from, entry, stop, target, maxHold) {
  const lastIdx = maxHold > 0 ? Math.min(s.n - 1, entryIdx + maxHold) : s.n - 1;
  let best = entry;
  let result = null;
  for (let i = from; i <= lastIdx; i++) {
    const o = s.o[i]; const h = s.h[i]; const l = s.l[i];
    const adverse = dir > 0 ? l : h;
    const favor = dir > 0 ? h : l;
    const hitStop = dir > 0 ? adverse <= stop : adverse >= stop;
    if (hitStop) {
      const gap = dir > 0 ? o <= stop : o >= stop;
      if (!result) result = { exitIdx: i, exitPrice: gap ? o : stop, outcome: 'stop' };
      // Avanço no candle do stop não conta (não dá pra saber se veio antes).
      return { ...result, reach: best };
    }
    best = dir > 0 ? Math.max(best, favor) : Math.min(best, favor);
    if (!result && (dir > 0 ? favor >= target : favor <= target)) {
      const gap = dir > 0 ? o >= target : o <= target;
      result = { exitIdx: i, exitPrice: gap ? o : target, outcome: 'target' };
    }
  }
  if (!result) {
    const outcome = maxHold > 0 && lastIdx === entryIdx + maxHold ? 'time' : 'open';
    result = { exitIdx: lastIdx, exitPrice: s.c[lastIdx], outcome };
  }
  return { ...result, reach: best };
}

/** Preço/índice de entrada conforme o modo — ou { skip: motivo } quando não entra. */
function resolveEntry(s, mode, dir, f, stop, target, retestCandles) {
  const b = f.idx.breakout;
  if (mode === 'close') return { entryIdx: b, entry: s.c[b], from: b + 1 };
  if (mode === 'nextOpen') {
    if (b + 1 >= s.n) return { skip: 'pending' };
    return { entryIdx: b + 1, entry: s.o[b + 1], from: b + 1 };
  }
  // retest: limite no nível rompido (topo/fundo da bandeira).
  const level = f.level;
  for (let i = b + 1; i < s.n && i <= b + retestCandles; i++) {
    const o = s.o[i]; const h = s.h[i]; const l = s.l[i];
    const touched = dir > 0 ? l <= level : h >= level;
    if (touched) {
      const px = dir > 0 ? Math.min(o, level) : Math.max(o, level);
      if (dir > 0 ? px <= stop : px >= stop) return { skip: 'stopBreak' };
      // O candle do fill pode estopar na sequência (conservador); alvo só a partir do próximo.
      if (dir > 0 ? l <= stop : h >= stop) return { entryIdx: i, entry: px, from: i, sameBarStop: true };
      return { entryIdx: i, entry: px, from: i + 1 };
    }
    // Andou até o alvo sem voltar: o pullback não veio.
    if (dir > 0 ? h >= target : l <= target) return { skip: 'ran' };
  }
  return { skip: b + retestCandles >= s.n ? 'pending' : 'expired' };
}

function stopFor(mode, dir, f, entry, stopPct) {
  if (mode === 'pct') return dir > 0 ? entry * (1 - stopPct / 100) : entry * (1 + stopPct / 100);
  if (mode === 'channel') return dir > 0 ? f.chLowerAtBreak : f.chUpperAtBreak;
  return dir > 0 ? f.flagLow : f.flagHigh;
}

function pnlOf(dir, entry, exit, costs) {
  const gross = dir > 0 ? (exit / entry - 1) * 100 : (1 - exit / entry) * 100;
  return gross - 2 * (costs.feePct + costs.slippagePct);
}

/** Enriquecimento da bandeira detectada com os níveis que a simulação usa. */
function enrichFlag(s, f) {
  const { flagStart, flagEnd, breakout } = f.idx;
  let flagHigh = -Infinity; let flagLow = Infinity;
  for (let i = flagStart; i <= flagEnd; i++) { flagHigh = Math.max(flagHigh, s.h[i]); flagLow = Math.min(flagLow, s.l[i]); }
  const [c0, c1] = f.channel;
  const span = flagEnd - flagStart;
  const lineAt = (key, idx) => (span > 0 ? c0[key] + ((c1[key] - c0[key]) / span) * (idx - flagStart) : c1[key]);
  const at = breakout ?? (flagEnd + 1);
  const dir = f.type === 'bull' ? 1 : -1;
  return {
    ...f,
    dir,
    poleH: Math.abs(f.poleEnd.price - f.poleStart.price),
    flagHigh,
    flagLow,
    flagBars: flagEnd - flagStart + 1,
    level: dir > 0 ? flagHigh : flagLow,
    chUpperAtBreak: lineAt('upper', at),
    chLowerAtBreak: lineAt('lower', at),
  };
}

/**
 * Detecta e simula todas as bandeiras de uma série (puro — usado pelos testes).
 * @returns {{ candles, from, to, trades:object[], skips:object, patterns:{bull,bear}, forming:object[] }}
 */
function runFlagsOnCandles(candles, options) {
  const opts = options?._normalized ? options : normalizeFlagOptions(options);
  const s = toSeries(candles);
  const out = {
    candles: s.n,
    from: s.n ? new Date(s.t[0]).toISOString() : null,
    to: s.n ? new Date(s.t[s.n - 1]).toISOString() : null,
    trades: [],
    skips: {},
    patterns: { bull: 0, bear: 0 },
    forming: [],
  };
  if (s.n < 30) return out;

  const detected = detectFlags(s.raw, {
    ...opts.pattern,
    lookback: Infinity,
    maxFlags: Infinity,
  });

  for (const raw of detected) {
    if (!opts.directions.includes(raw.type)) continue;
    if (opts.pattern.onlyTight && !raw.tight) continue;
    const f = enrichFlag(s, raw);
    const dir = f.dir;
    const target = raw.confirmed
      ? f.breakout.price + dir * f.poleH * opts.targetFrac
      : null;
    const drawing = {
      type: raw.type, tight: raw.tight, confirmed: raw.confirmed, label: raw.label,
      poleStart: raw.poleStart, poleEnd: raw.poleEnd, channel: raw.channel,
      breakout: raw.breakout, target: raw.target, retracePct: raw.retracePct, poleGainPct: raw.poleGainPct,
    };
    const base = {
      dir: raw.type,
      tight: raw.tight,
      poleGainPct: round(raw.poleGainPct),
      retracePct: round(raw.retracePct * 100, 1),
      flagBars: f.flagBars,
      poleStartDate: new Date(raw.poleStart.time).toISOString(),
      flagStartDate: new Date(raw.channel[0].time).toISOString(),
      flag: drawing,
    };

    if (!raw.confirmed) {
      // Em formação agora: gatilho = rompimento do canal/extremo da bandeira no próximo candle.
      const nextLine = dir > 0 ? f.chUpperAtBreak : f.chLowerAtBreak;
      const trigger = dir > 0 ? Math.max(f.flagHigh, nextLine) : Math.min(f.flagLow, nextLine);
      const stop = stopFor(opts.stopMode, dir, f, trigger, opts.stopPct);
      out.forming.push({
        ...base,
        lastClose: s.c[s.n - 1],
        lastDate: new Date(s.t[s.n - 1]).toISOString(),
        triggerPrice: trigger,
        stopPrice: stop,
        targetPrice: trigger + dir * f.poleH * opts.targetFrac,
        distToTriggerPct: round(((trigger / s.c[s.n - 1]) - 1) * 100),
        riskPct: round(Math.abs(trigger - stop) / trigger * 100),
      });
      continue;
    }

    out.patterns[raw.type]++;
    const b = f.idx.breakout;
    for (const mode of opts.entryModes) {
      const key = `${raw.type}|${mode}`;
      const sk = (out.skips[key] ??= { expired: 0, ran: 0, stopBreak: 0, pending: 0, invalid: 0 });
      // Stop fixo da bandeira/canal; no modo % ele depende do preço de entrada (calculado abaixo).
      const preStop = opts.stopMode === 'pct' ? (dir > 0 ? -Infinity : Infinity) : stopFor(opts.stopMode, dir, f, s.c[b], opts.stopPct);
      const ent = resolveEntry(s, mode, dir, f, preStop, target, opts.retestCandles);
      if (ent.skip) { sk[ent.skip]++; continue; }
      const stop = opts.stopMode === 'pct' ? stopFor('pct', dir, f, ent.entry, opts.stopPct) : preStop;
      // Stop do lado errado (ex.: abriu com gap além da bandeira) ou alvo já ultrapassado na entrada.
      if (dir > 0 ? (stop >= ent.entry || target <= ent.entry) : (stop <= ent.entry || target >= ent.entry)) {
        sk.invalid++;
        continue;
      }

      let w;
      if (ent.sameBarStop) {
        w = { exitIdx: ent.entryIdx, exitPrice: stop, outcome: 'stop', reach: ent.entry };
      } else {
        w = walkTrade(s, dir, ent.entryIdx, ent.from, ent.entry, stop, target, opts.maxHoldCandles);
      }
      const riskPct = Math.abs(ent.entry - stop) / ent.entry * 100;
      const pnlPct = pnlOf(dir, ent.entry, w.exitPrice, opts.costs);

      // Estudo de alvos: mesmo trade com o alvo em várias frações do mastro.
      const fracs = TARGET_FRACS.map((fr) => {
        const tgt = f.breakout.price + dir * f.poleH * fr;
        if (dir > 0 ? tgt <= ent.entry : tgt >= ent.entry) return { hit: true, pnlPct: null };
        if (ent.sameBarStop) return { hit: false, pnlPct: pnlOf(dir, ent.entry, stop, opts.costs) };
        const r = walkTrade(s, dir, ent.entryIdx, ent.from, ent.entry, stop, tgt, opts.maxHoldCandles);
        return { hit: r.outcome === 'target', pnlPct: pnlOf(dir, ent.entry, r.exitPrice, opts.costs) };
      });

      out.trades.push({
        ...base,
        mode,
        group: key,
        signalDate: new Date(s.t[b]).toISOString(),
        breakoutPrice: f.breakout.price,
        entryDate: new Date(s.t[ent.entryIdx]).toISOString(),
        entryPrice: ent.entry,
        stopPrice: stop,
        targetPrice: target,
        exitDate: w.outcome === 'open' ? null : new Date(s.t[w.exitIdx]).toISOString(),
        lastDate: new Date(s.t[w.exitIdx]).toISOString(),
        exitPrice: w.exitPrice,
        outcome: w.outcome,
        riskPct: round(riskPct),
        pnlPct: round(pnlPct),
        rNet: round(riskPct > 0 ? pnlPct / riskPct : 0),
        holdCandles: w.exitIdx - ent.entryIdx,
        holdMs: s.t[w.exitIdx] - s.t[ent.entryIdx],
        // Quanto do measured move (altura do mastro) o preço andou a favor antes do stop.
        reachMM: round(f.poleH > 0 ? (dir * (w.reach - f.breakout.price)) / f.poleH : 0),
        fracs,
      });
    }
  }
  return out;
}

function summarize(trades, positionSizeUsd) {
  const n = trades.length;
  if (!n) {
    return { trades: 0, closed: 0, winRatePct: null, avgPnlPct: null, medianPnlPct: null, avgR: null, totalPnlUsd: 0,
      profitFactor: null, target: 0, stop: 0, time: 0, open: 0, avgRiskPct: null, avgHoldMs: null, avgReachMM: null };
  }
  const closed = trades.filter((t) => t.outcome !== 'open');
  const wins = closed.filter((t) => t.pnlPct > 0).length;
  const grossWin = trades.reduce((sum, t) => sum + Math.max(0, t.pnlPct), 0);
  const grossLoss = trades.reduce((sum, t) => sum + Math.max(0, -t.pnlPct), 0);
  const sorted = trades.map((t) => t.pnlPct).sort((a, b) => a - b);
  const count = (o) => trades.filter((t) => t.outcome === o).length;
  const avg = (k) => trades.reduce((sum, t) => sum + t[k], 0) / n;
  return {
    trades: n,
    closed: closed.length,
    winRatePct: closed.length ? round((wins / closed.length) * 100, 1) : null,
    avgPnlPct: round(avg('pnlPct')),
    medianPnlPct: round(sorted[Math.floor((n - 1) / 2)]),
    avgR: round(avg('rNet')),
    totalPnlUsd: round(trades.reduce((sum, t) => sum + (t.pnlPct / 100) * positionSizeUsd, 0)),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    target: count('target'),
    stop: count('stop'),
    time: count('time'),
    open: count('open'),
    avgRiskPct: round(avg('riskPct')),
    avgHoldMs: Math.round(avg('holdMs')),
    avgReachMM: round(avg('reachMM')),
  };
}

function targetStudy(trades) {
  return TARGET_FRACS.map((frac, k) => {
    const list = trades.map((t) => t.fracs[k]).filter((x) => x.pnlPct != null);
    const hits = list.filter((x) => x.hit).length;
    const wins = list.filter((x) => x.pnlPct > 0).length;
    return {
      frac,
      trades: list.length,
      hitPct: list.length ? round((hits / list.length) * 100, 1) : null,
      winRatePct: list.length ? round((wins / list.length) * 100, 1) : null,
      avgPnlPct: list.length ? round(list.reduce((sum, x) => sum + x.pnlPct, 0) / list.length) : null,
    };
  });
}

function bucketize(trades, defs, valueOf, positionSizeUsd) {
  const buckets = defs.map((d) => ({ ...d, list: [] }));
  for (const t of trades) (buckets.find((b) => valueOf(t) < b.max) ?? buckets[buckets.length - 1]).list.push(t);
  return buckets.map((b) => {
    const sm = summarize(b.list, positionSizeUsd);
    return { label: b.label, trades: sm.trades, winRatePct: sm.winRatePct, avgPnlPct: sm.avgPnlPct, avgR: sm.avgR };
  });
}

function bySymbol(trades, positionSizeUsd) {
  const map = new Map();
  for (const t of trades) {
    if (!map.has(t.symbol)) map.set(t.symbol, []);
    map.get(t.symbol).push(t);
  }
  return [...map.entries()]
    .map(([symbol, list]) => {
      const sm = summarize(list, positionSizeUsd);
      return { symbol, source: list[0].source, trades: sm.trades, winRatePct: sm.winRatePct, avgPnlPct: sm.avgPnlPct, totalPnlUsd: sm.totalPnlUsd };
    })
    .sort((a, b) => b.avgPnlPct - a.avgPnlPct)
    .slice(0, BY_SYMBOL_MAX_ROWS);
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function loadClosedCandles(symbol, source, interval, candleCount) {
  const fetchCandles = source === 'gate' ? getGateCandles : getCandles;
  return dropOpenCandle(await fetchCandles(symbol, interval, candleCount), interval);
}

/**
 * @param {object} rawOptions  ver normalizeFlagOptions + { symbol, source, minVolumeUsdt, includeGateFavorites }
 */
async function analyseFlagBacktest(rawOptions = {}) {
  const opts = normalizeFlagOptions(rawOptions);
  const minVolumeUsdt = Number(rawOptions.minVolumeUsdt) > 0 ? Number(rawOptions.minVolumeUsdt) : 0;
  const singleSymbol = rawOptions.symbol ? String(rawOptions.symbol).toUpperCase() : null;

  let workItems;
  let symbolsTotal = 1;
  let symbolsBlockedByVolume = 0;
  const volumeMap = new Map();

  if (singleSymbol) {
    workItems = [{ symbol: singleSymbol, source: rawOptions.source ?? null }];
  } else {
    const { list: allSymbols } = await getActiveUsdtPairs();
    symbolsTotal = allSymbols.length;
    try {
      for (const t of await getTickers()) volumeMap.set(t.symbol, Number(t.quoteVolume));
    } catch { /* fail-open: sem volume, o filtro não bloqueia nada */ }
    let symbols = allSymbols;
    if (minVolumeUsdt > 0 && volumeMap.size > 0) {
      symbols = allSymbols.filter((sym) => (volumeMap.get(sym) ?? 0) >= minVolumeUsdt);
      symbolsBlockedByVolume = allSymbols.length - symbols.length;
    }
    workItems = symbols.map((symbol) => ({ symbol, source: null }));

    if (rawOptions.includeGateFavorites) {
      try {
        const binanceSet = new Set(allSymbols);
        const favs = (await getGateFavoriteSymbols()).filter((sym) => !binanceSet.has(sym));
        const gateVol = new Map((await getAllGateCurrencies().catch(() => [])).map((c) => [c.symbol, Number(c.volume) || 0]));
        for (const sym of favs) {
          if (minVolumeUsdt > 0 && gateVol.size > 0 && (gateVol.get(sym) ?? 0) < minVolumeUsdt) continue;
          workItems.push({ symbol: sym, source: 'gate' });
        }
      } catch (err) {
        console.warn('[flag-backtest] favoritos Gate ignorados:', err.message);
      }
    }
  }

  const results = await runWithConcurrency(workItems, async ({ symbol, source }) => {
    try {
      const candles = await loadClosedCandles(symbol, source, opts.interval, opts.candleCount);
      return { symbol, source: source ?? 'binance', run: runFlagsOnCandles(candles, opts) };
    } catch (err) {
      if (singleSymbol) throw err;
      return null; // falha pontual por par não derruba a varredura
    }
  }, CONCURRENCY);
  const valid = results.filter(Boolean);

  const patterns = { bull: 0, bear: 0 };
  const allTrades = [];
  const skips = {};
  const forming = [];
  for (const { symbol, source, run } of valid) {
    patterns.bull += run.patterns.bull;
    patterns.bear += run.patterns.bear;
    for (const t of run.trades) allTrades.push({ symbol, source, ...t });
    for (const [k, v] of Object.entries(run.skips)) {
      skips[k] ??= { expired: 0, ran: 0, stopBreak: 0, pending: 0, invalid: 0 };
      for (const r of Object.keys(v)) skips[k][r] += v[r];
    }
    for (const f of run.forming) forming.push({ symbol, source, ...f });
  }

  const groups = [];
  const occurrences = [];
  for (const dir of opts.directions) {
    for (const mode of opts.entryModes) {
      const key = `${dir}|${mode}`;
      const trades = allTrades.filter((t) => t.group === key);
      groups.push({
        key,
        dir,
        mode,
        label: `${DIR_LABEL[dir]} · ${MODE_LABEL[mode]}`,
        patterns: patterns[dir],
        notFilled: skips[key] ?? { expired: 0, ran: 0, stopBreak: 0, pending: 0, invalid: 0 },
        summary: summarize(trades, opts.positionSizeUsd),
        targetStudy: targetStudy(trades),
        buckets: {
          poleGain: bucketize(trades, BUCKETS.poleGain, (t) => t.poleGainPct, opts.positionSizeUsd),
          retrace: bucketize(trades, BUCKETS.retrace, (t) => t.retracePct / 100, opts.positionSizeUsd),
          flagBars: bucketize(trades, BUCKETS.flagBars, (t) => t.flagBars, opts.positionSizeUsd),
          tight: [true, false].map((tight) => {
            const sm = summarize(trades.filter((t) => t.tight === tight), opts.positionSizeUsd);
            return { label: tight ? 'HTF (alta e apertada)' : 'Comum', trades: sm.trades, winRatePct: sm.winRatePct, avgPnlPct: sm.avgPnlPct, avgR: sm.avgR };
          }),
        },
        bySymbol: singleSymbol ? [] : bySymbol(trades, opts.positionSizeUsd),
      });
      const recent = trades.sort((a, b) => new Date(b.signalDate) - new Date(a.signalDate)).slice(0, ROWS_PER_GROUP);
      for (const { fracs, group, ...rest } of recent) occurrences.push({ ...rest, group });
      if (trades.length > ROWS_PER_GROUP) groups[groups.length - 1].truncated = true;
    }
  }
  forming.sort((a, b) => Math.abs(a.distToTriggerPct) - Math.abs(b.distToTriggerPct));

  const first = valid[0]?.run;
  const study = rawOptions.collectStudy
    ? buildStudyCoins(valid, volumeMap, opts.positionSizeUsd)
    : undefined;
  return {
    ...(study ? { study } : {}),
    scope: singleSymbol ? 'symbol' : 'market',
    symbol: singleSymbol,
    interval: opts.interval,
    candleCount: opts.candleCount,
    candles: first?.candles ?? 0,
    from: first?.from ?? null,
    to: first?.to ?? null,
    options: opts,
    targetFracs: TARGET_FRACS,
    minVolumeUsdt,
    symbolsTotal,
    symbolsScanned: valid.length,
    symbolsBlockedByVolume,
    patterns,
    groups,
    occurrences,
    forming: forming.slice(0, 60),
  };
}

/**
 * Arquivo de estudo (ver backend/utils/flagStudyStore.js): TODAS as moedas simuladas, sem o corte
 * de ROWS_PER_GROUP da tela. Uma entrada por moeda → uma por bandeira (dados do padrão + desenho)
 * → `entries` com o resultado de cada momento de entrada simulado (com o estudo de alvo por fração).
 */
function buildStudyCoins(valid, volumeMap, positionSizeUsd) {
  return valid.map(({ symbol, source, run }) => {
    const flags = new Map();
    for (const t of run.trades) {
      const key = `${t.dir}|${t.flagStartDate}`;
      if (!flags.has(key)) {
        flags.set(key, {
          dir: t.dir, tight: t.tight, poleGainPct: t.poleGainPct, retracePct: t.retracePct, flagBars: t.flagBars,
          poleStartDate: t.poleStartDate, flagStartDate: t.flagStartDate, breakoutDate: t.signalDate,
          breakoutPrice: t.breakoutPrice, targetPrice: t.targetPrice, flag: t.flag, entries: {},
        });
      }
      const { flag, group, dir, tight, poleGainPct, retracePct, flagBars, poleStartDate, flagStartDate,
        signalDate, breakoutPrice, targetPrice, fracs, mode, ...entry } = t;
      flags.get(key).entries[mode] = {
        ...entry,
        targetStudy: Object.fromEntries(TARGET_FRACS.map((fr, k) => [`${fr}x`, fracs[k]])),
      };
    }
    return {
      symbol,
      source,
      volumeUsd: volumeMap.has(symbol) ? Number(volumeMap.get(symbol)) || 0 : null,
      candles: run.candles,
      from: run.from,
      to: run.to,
      patterns: run.patterns,
      summary: summarize(run.trades, positionSizeUsd),
      flags: [...flags.values()].sort((a, b) => new Date(a.breakoutDate) - new Date(b.breakoutDate)),
      forming: run.forming,
    };
  });
}

module.exports = { analyseFlagBacktest, runFlagsOnCandles, normalizeFlagOptions, TARGET_FRACS };
