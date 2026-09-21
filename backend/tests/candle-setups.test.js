'use strict';

const {
  SETUP_IDS, toSeries, smaSeries, emaSeries, hhhlSeries, createDetector,
} = require('../bot/candle-setups/setupDetectors');
const { simulateSetupTrade } = require('../bot/candle-setups/setupSimulator');
const { normalizeCandleSetupsOptions } = require('../bot/candle-setups/tradeConfigSchema');
const { runSetupsOnCandles, summarizeTrades } = require('../utils/analyseCandleSetupsBacktest');

const IV = 900_000; // 15m
const T0 = Date.UTC(2026, 0, 5, 0, 0, 0); // segunda-feira 00:00 UTC (alinhado ao dia)

function candle(i, o, h, l, c, v = 1000) {
  return { openTime: T0 + i * IV, open: String(o), high: String(h), low: String(l), close: String(c), volume: String(v), closeTime: T0 + (i + 1) * IV - 1 };
}

/** Série com candles "planos" (o=c) e range fixo em torno do preço. */
function flat(i, price, halfRange = 0.5) {
  return candle(i, price, price + halfRange, price - halfRange, price);
}

/** LCG determinístico p/ série sintética reprodutível. */
function randomCandles(n, seed = 42) {
  let x = seed;
  const rnd = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o * (1 + (rnd() - 0.48) * 0.03);
    const h = Math.max(o, c) * (1 + rnd() * 0.012);
    const l = Math.min(o, c) * (1 - rnd() * 0.012);
    out.push(candle(i, o, h, l, c, 500 + rnd() * 2000));
    price = c;
  }
  return out;
}

const OPTS = normalizeCandleSetupsOptions({ costs: { feePct: 0, slippagePct: 0 }, common: { minRiskPct: 0, maxRiskPct: 0, entryOffsetPct: 0, stopOffsetPct: 0 } });

describe('indicadores', () => {
  test('SMA e EMA (semeada com SMA)', () => {
    expect(smaSeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    const ema = emaSeries([1, 2, 3, 4, 5], 3);
    expect(ema.slice(0, 2)).toEqual([null, null]);
    expect(ema[2]).toBe(2);
    expect(ema[3]).toBeCloseTo(3, 10);
    expect(ema[4]).toBeCloseTo(4, 10);
  });

  test('topos e fundos ascendentes só valem depois do candle seguinte fechar', () => {
    // fundos 10 → 12 e topos 20 → 22, confirmados um candle depois.
    const h = [15, 20, 16, 17, 22, 18, 19, 19];
    const l = [12, 14, 10, 13, 15, 12, 14, 14];
    const s = { n: h.length, h, l, c: h, o: h, t: h.map((_, i) => i), v: h };
    const out = hhhlSeries(s);
    expect(out.slice(0, 6).every((v) => v === false)).toBe(true);
    expect(out[6]).toBe(true); // fundo 12 (k=5) confirmado em i=6, > fundo 10; topo 22 > 20
  });
});

describe('simulador (regras conservadoras)', () => {
  // sinal em i=1: máxima 100, mínima 98 → gatilho 100, stop 98 (R = 2, sem folga/custos).
  const base = () => [flat(0, 99), candle(1, 99, 100, 98, 99.5)];
  const signal = { setup: 'pfr', index: 1, signalTime: T0 + IV, trigger: 100, stop: 98, riskPct: 2, levels: {}, overrides: null };
  const run = (extra, targets, common = {}) => {
    const candles = [...base(), ...extra];
    return simulateSetupTrade(toSeries(candles), signal, {
      common: { ...OPTS.common, ...common }, targets, costs: { feePct: 0, slippagePct: 0 }, positionSizeUsd: 100,
    });
  };
  const partial = [{ type: 'r', value: 1, qtyPct: 50 }, { type: 'r', value: 2, qtyPct: 50 }];

  test('bate 1R e 2R → alvo cheio: +1,5R', () => {
    const sim = run([candle(2, 100, 102.5, 99.5, 102), candle(3, 102, 104.5, 101, 104)], partial);
    expect(sim.trade.outcome).toBe('target');
    expect(sim.trade.pnlPct).toBeCloseTo(3.0, 5); // 0,5×2% + 0,5×4%
    expect(sim.trade.rNet).toBeCloseTo(1.5, 5);
  });

  test('bate 1R e volta ao stop original → parcial zero a zero', () => {
    const sim = run([candle(2, 100, 102.5, 99.5, 102), candle(3, 102, 102.4, 97, 98)], partial);
    expect(sim.trade.outcome).toBe('partial');
    expect(sim.trade.pnlPct).toBeCloseTo(0, 5);
  });

  test('mesmo candle toca stop e alvo → conta o stop', () => {
    const sim = run([candle(2, 100, 103, 97.5, 100)], partial);
    expect(sim.trade.outcome).toBe('stop');
    expect(sim.trade.rNet).toBeCloseTo(-1, 5);
  });

  test('gap acima do gatilho preenche na abertura e o R muda', () => {
    const sim = run([candle(2, 101, 102, 100.5, 101.5), candle(3, 101.5, 104.9, 101, 104)], [{ type: 'r', value: 1, qtyPct: 100 }]);
    expect(sim.trade.entryPrice).toBe(101);
    expect(sim.trade.riskPct).toBeCloseTo((3 / 101) * 100, 1);
    expect(sim.trade.outcome).toBe('target');
  });

  test('sem rompimento na janela → não preenche', () => {
    const sim = run([candle(2, 99, 99.9, 98.5, 99.2), candle(3, 99, 99.9, 98.5, 99.2), candle(4, 99, 101, 98.5, 100)], partial);
    expect(sim.filled).toBe(false);
    expect(sim.reason).toBe('expired'); // validCandles = 2 → candle 4 já é tarde
  });

  test('perde o stop antes do gatilho → ordem cancelada', () => {
    const sim = run([candle(2, 99, 99.5, 97.5, 98.5), candle(3, 99, 101, 98.5, 100)], partial);
    expect(sim.filled).toBe(false);
    expect(sim.reason).toBe('stopBreak');
  });

  test('ordem ainda dentro da validade no fim dos dados → pending', () => {
    const sim = run([], partial);
    expect(sim.filled).toBe(false);
    expect(sim.reason).toBe('pending');
  });

  test('saída por tempo fecha o restante a mercado', () => {
    const sim = run(
      [candle(2, 100, 100.5, 99.5, 100.2), candle(3, 100.2, 100.6, 99.8, 100.4), candle(4, 100.4, 100.8, 99.9, 100.6)],
      partial, { maxHoldCandles: 2 },
    );
    expect(sim.trade.outcome).toBe('time');
    expect(sim.trade.holdCandles).toBe(2);
  });

  test('taxa e slippage reduzem o resultado', () => {
    const candles = [...base(), candle(2, 100, 102.5, 99.5, 102), candle(3, 102, 104.5, 101, 104)];
    const sim = simulateSetupTrade(toSeries(candles), signal, {
      common: OPTS.common, targets: partial, costs: { feePct: 0.1, slippagePct: 0.05 }, positionSizeUsd: 100,
    });
    expect(sim.trade.pnlPct).toBeLessThan(3.0);
    expect(sim.trade.pnlPct).toBeGreaterThan(2.5);
  });

  test('alvo por nível abaixo da entrada cai pro fallback em R', () => {
    const lvSignal = { ...signal, levels: { middleBand: 99 } };
    const candles = [...base(), candle(2, 100, 104.5, 99.5, 104)];
    const sim = simulateSetupTrade(toSeries(candles), lvSignal, {
      common: OPTS.common, targets: [{ type: 'level', key: 'middleBand', qtyPct: 100, fallbackR: 2 }],
      costs: { feePct: 0, slippagePct: 0 }, positionSizeUsd: 100,
    });
    expect(sim.trade.targets[0].price).toBeCloseTo(104, 5);
    expect(sim.trade.targets[0].fallback).toBe(true);
  });
});

describe('detectores', () => {
  test('PFR: tendência de alta + mínima abaixo das 2 anteriores + fecha acima do anterior', () => {
    const candles = [];
    for (let i = 0; i < 120; i++) candles.push(flat(i, 100 + i * 0.5, 0.3)); // tendência de alta contínua
    const p = 100 + 120 * 0.5;
    // sinal: dip abaixo das mínimas dos 2 anteriores, fecha acima do fechamento anterior
    candles.push(candle(120, p - 0.5, p + 0.4, p - 1.5, p + 0.1));
    const s = toSeries(candles);
    const opts = normalizeCandleSetupsOptions({});
    const det = createDetector('pfr', s, opts.params.pfr, opts.common, '15m');
    const sig = det.detect(120);
    expect(sig).not.toBeNull();
    expect(sig.trigger).toBeGreaterThan(s.h[120]);
    expect(sig.stop).toBeLessThan(s.l[120]);
    expect(det.detect(119)).toBeNull(); // candle comum de tendência não é PFR
  });

  test('PFR: fora de tendência (EMA8 < EMA80) não sinaliza', () => {
    const candles = [];
    for (let i = 0; i < 120; i++) candles.push(flat(i, 200 - i * 0.5, 0.3));
    const p = 200 - 120 * 0.5;
    candles.push(candle(120, p - 0.5, p + 0.4, p - 1.5, p + 0.1));
    const s = toSeries(candles);
    const opts = normalizeCandleSetupsOptions({});
    expect(createDetector('pfr', s, opts.params.pfr, opts.common, '15m').detect(120)).toBeNull();
  });

  test('Fechou Fora, Fechou Dentro: fecha abaixo da banda e volta pra dentro', () => {
    const candles = [];
    for (let i = 0; i < 30; i++) candles.push(candle(i, 100, 100.6, 99.4, 100 + (i % 2 ? 0.3 : -0.3)));
    candles.push(candle(30, 100, 100.2, 96, 96.5));  // fecha bem abaixo da banda inferior
    candles.push(candle(31, 96.5, 99, 96.3, 98.5));  // volta pra dentro
    const s = toSeries(candles);
    const opts = normalizeCandleSetupsOptions({});
    const det = createDetector('fechouForaDentro', s, opts.params.fechouForaDentro, opts.common, '15m');
    expect(det.detect(30)).toBeNull();
    const sig = det.detect(31);
    expect(sig).not.toBeNull();
    expect(sig.stop).toBeLessThan(96); // mínima dos dois candles (96)
    expect(sig.levels.upperBand).toBeGreaterThan(sig.levels.middleBand);
  });

  test('Ponto Contínuo: recuo até a SMA21 dentro de tendência de alta com topos/fundos ascendentes', () => {
    const candles = [];
    let p = 100;
    // Ondas de alta com correções curtas: gera fractais ascendentes e mantém SMA20 > EMA80.
    for (let i = 0; i < 160; i++) {
      p += (i % 6 < 4) ? 1.2 : -0.9;
      candles.push(candle(i, p - 0.2, p + 0.6, p - 0.6, p));
    }
    const s = toSeries(candles);
    const opts = normalizeCandleSetupsOptions({ common: { minRiskPct: 0, maxRiskPct: 0 } });
    const run = runSetupsOnCandles(candles, { ...opts, setups: ['pontoContinuo'] });
    // Se houve toque válido, o sinal precisa respeitar o esqueleto (stop < gatilho, R > 0).
    for (const t of run.perSetup.pontoContinuo.trades) {
      expect(t.stopPrice).toBeLessThan(t.entryPrice);
      expect(t.riskPct).toBeGreaterThan(0);
    }
    expect(s.n).toBe(160);
  });

  test('One Punch: barra grande na virada da sessão rompendo a congestão + 2ª barra pequena', () => {
    const candles = [];
    for (let i = 0; i < 96; i++) candles.push(flat(i, 100));                        // congestão: máx 100,5
    candles.push(candle(96, 100, 103.2, 99.9, 103, 3000));                          // 00:00 UTC: barra grande (amplitude 3,3)
    candles.push(candle(97, 103, 103.6, 102.9, 103.4, 1500));                       // 2ª barra: 0,7 ≤ 50% de 3,3
    const s = toSeries(candles);
    const opts = normalizeCandleSetupsOptions({});
    const params = { ...opts.params.onePunch, congestionCandles: 10 };
    const det = createDetector('onePunch', s, params, opts.common, '15m');
    expect(det.detect(96)).toBeNull();
    const sig = det.detect(97);
    expect(sig).not.toBeNull();
    expect(sig.levels.projection).toBeCloseTo(102.9 + 1.618 * 3.3, 6);
    expect(sig.overrides).toEqual({ validCandles: 2, maxHoldCandles: 3 }); // até o 4º candle, 45 min
    // barra "pequena" grande demais não sinaliza
    const wide = toSeries([...candles.slice(0, 97), candle(97, 103, 105, 102, 104, 1500)]);
    expect(createDetector('onePunch', wide, params, opts.common, '15m').detect(97)).toBeNull();
  });

  test.each(SETUP_IDS)('%s não olha o futuro: sinal em i é idêntico com a série cortada em i+1', (id) => {
    const candles = randomCandles(9000, 7);
    const s = toSeries(candles);
    const opts = normalizeCandleSetupsOptions({});
    const params = { ...opts.params };
    // afrouxa o One Punch/Martelinho pra aparecerem sinais na série sintética
    params.onePunch = { ...params.onePunch, congestionCandles: 8, bigBarAtrMult: 0.3, volumeMult: 0.3, minBodyPct: 10, smallMaxRatio: 1 };
    params.martelinho = { ...params.martelinho, tolerancePct: 2, levels: ['P', 'S1', 'S2', 'S3', 'R1'] };
    const full = createDetector(id, s, params[id], opts.common, '15m');
    const hits = [];
    for (let i = full.warmup; i < s.n && hits.length < 25; i++) if (full.detect(i)) hits.push(i);
    expect(hits.length).toBeGreaterThan(0); // evita passar no vazio
    const noHits = [];
    for (let i = full.warmup; i < s.n && noHits.length < 25; i += 97) if (!full.detect(i)) noHits.push(i);

    for (const i of hits) {
      const cut = toSeries(candles.slice(0, i + 1));
      const sig = createDetector(id, cut, params[id], opts.common, '15m').detect(i);
      expect(sig).not.toBeNull();
      expect(sig.trigger).toBeCloseTo(full.detect(i).trigger, 10);
      expect(sig.stop).toBeCloseTo(full.detect(i).stop, 10);
    }
    for (const i of noHits) {
      const cut = toSeries(candles.slice(0, i + 1));
      expect(createDetector(id, cut, params[id], opts.common, '15m').detect(i)).toBeNull();
    }
  });
});

describe('backtest integrado', () => {
  test('roda todos os setups na série sintética sem estourar e respeita a exclusividade', () => {
    const candles = randomCandles(3000, 11);
    const opts = normalizeCandleSetupsOptions({ setups: SETUP_IDS, common: { minRiskPct: 0, maxRiskPct: 0 } });
    const run = runSetupsOnCandles(candles, opts);
    expect(Object.keys(run.perSetup).sort()).toEqual([...SETUP_IDS].sort());
    for (const id of SETUP_IDS) {
      const { trades } = run.perSetup[id];
      const sorted = [...trades].sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));
      for (let k = 1; k < sorted.length; k++) {
        // um trade só começa depois do anterior terminar
        expect(new Date(sorted[k].entryDate).getTime()).toBeGreaterThan(new Date(sorted[k - 1].exitDate ?? sorted[k - 1].entryDate).getTime());
      }
    }
    const all = SETUP_IDS.flatMap((id) => run.perSetup[id].trades);
    expect(all.length).toBeGreaterThan(0);
    const sm = summarizeTrades(all);
    expect(sm.trades).toBe(all.length);
  });

  test('filtro de risco descarta sinais fora da faixa', () => {
    const candles = randomCandles(3000, 11);
    const loose = runSetupsOnCandles(candles, normalizeCandleSetupsOptions({ setups: ['pfr'], common: { minRiskPct: 0, maxRiskPct: 0 } }));
    const tight = runSetupsOnCandles(candles, normalizeCandleSetupsOptions({ setups: ['pfr'], common: { minRiskPct: 1, maxRiskPct: 1.2 } }));
    expect(tight.perSetup.pfr.trades.length).toBeLessThanOrEqual(loose.perSetup.pfr.trades.length);
    for (const t of tight.perSetup.pfr.trades) expect(t.riskPct).toBeGreaterThan(0.9);
    expect(tight.perSetup.pfr.counters.blockedSmallRisk + tight.perSetup.pfr.counters.blockedBigRisk).toBeGreaterThan(0);
  });
});
