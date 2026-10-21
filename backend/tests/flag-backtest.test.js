const { runFlagsOnCandles } = require('../utils/analyseFlagBacktest');

const H = 4 * 3600 * 1000;
function candle(i, o, h, l, c, v = 100) {
  return { openTime: i * H, open: o, high: h, low: l, close: c, volume: v };
}

// Lateral -> mastro de alta (+~20%) -> bandeira de 6 candles caindo de leve -> rompimento -> alvo.
function bullFlagSeries({ afterBreak = 'target' } = {}) {
  const cs = [];
  let i = 0;
  for (; i < 30; i++) cs.push(candle(i, 100, 100.5, 99.5, 100));
  const pole = [100, 104, 108, 112, 116, 120];
  for (let k = 1; k < pole.length; k++, i++) cs.push(candle(i, pole[k - 1], pole[k], pole[k - 1] - 0.2, pole[k] - 0.1, 400));
  const flag = [[119.5, 119.8, 117.5, 118], [118, 118.6, 116.5, 117], [117, 117.8, 115.8, 116.2], [116.2, 117, 115, 115.6],
    [115.6, 116.4, 114.6, 115], [115, 115.8, 114.2, 114.8]];
  for (const [o, h, l, c] of flag) cs.push(candle(i++, o, h, l, c, 100));
  cs.push(candle(i++, 115, 121, 114.9, 120.5, 300)); // rompe o topo da bandeira
  if (afterBreak === 'target') {
    for (let k = 0; k < 16; k++, i++) cs.push(candle(i, 120.5 + k * 2, 122.5 + k * 2, 120 + k * 2, 122 + k * 2));
  } else {
    for (let k = 0; k < 10; k++, i++) cs.push(candle(i, 120 - k * 2, 120.5 - k * 2, 118 - k * 2, 118 - k * 2));
  }
  return cs;
}

const OPTS = { directions: ['bull'], pattern: { minPoleGainPct: 6 }, costs: { feePct: 0, slippagePct: 0 }, maxHoldCandles: 30 };

describe('analyseFlagBacktest.runFlagsOnCandles', () => {
  test('bandeira de alta rompida que anda até o measured move bate o alvo', () => {
    const r = runFlagsOnCandles(bullFlagSeries(), OPTS);
    expect(r.patterns.bull).toBe(1);
    const close = r.trades.find((t) => t.mode === 'close');
    expect(close).toBeDefined();
    expect(close.entryPrice).toBe(120.5);
    expect(close.outcome).toBe('target');
    expect(close.pnlPct).toBeGreaterThan(0);
    expect(close.targetPrice).toBeCloseTo(120.5 + close.flag.poleEnd.price - close.flag.poleStart.price, 6);
    // Stop padrão = fundo da bandeira.
    expect(close.stopPrice).toBe(114.2);
  });

  test('rompimento que falha estopa no fundo da bandeira', () => {
    const r = runFlagsOnCandles(bullFlagSeries({ afterBreak: 'fail' }), OPTS);
    const close = r.trades.find((t) => t.mode === 'close');
    expect(close.outcome).toBe('stop');
    expect(close.exitPrice).toBe(114.2);
    expect(close.pnlPct).toBeLessThan(0);
  });

  test('não usa candle depois do rompimento pra decidir a bandeira (causal)', () => {
    const full = bullFlagSeries();
    const cut = full.slice(0, full.findIndex((c) => c.close === 120.5) + 1);
    const a = runFlagsOnCandles(full, OPTS).trades.find((t) => t.mode === 'close');
    const b = runFlagsOnCandles(cut, OPTS).trades.find((t) => t.mode === 'close');
    expect(b.signalDate).toBe(a.signalDate);
    expect(b.stopPrice).toBe(a.stopPrice);
  });
});
