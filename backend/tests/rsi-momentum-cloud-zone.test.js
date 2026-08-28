'use strict';

const { computeCloudZoneStats } = require('../utils/analyseRsiThresholdBacktest');

describe('computeCloudZoneStats', () => {
  test('agrupa sinais pelas 5 faixas e calcula acerto/P&L por faixa', () => {
    const occ = [
      { cloudZone: 1, filled: true, outcome: 'target', pnlPct: 5 },
      { cloudZone: 1, filled: true, outcome: 'stop', pnlPct: -5 },
      { cloudZone: 5, filled: true, outcome: 'target', pnlPct: 4 },
      { cloudZone: 5, filled: true, outcome: 'open', pnlPct: 1 },
      { cloudZone: 5, filled: false, outcome: 'not_filled', pnlPct: null },
    ];
    const r = computeCloudZoneStats(occ);
    expect(r.total).toBe(5);
    expect(r.zones).toHaveLength(5);

    const z1 = r.zones[0];
    expect(z1.zone).toBe(1);
    expect(z1.signals).toBe(2);
    expect(z1.sharePct).toBe(40);
    expect(z1.winRatePct).toBe(50); // 1 alvo / (1 alvo + 1 stop)

    const z5 = r.zones[4];
    expect(z5.signals).toBe(3);
    expect(z5.sharePct).toBe(60);
    expect(z5.notFilled).toBe(1);
    expect(z5.winRatePct).toBe(100); // 1 alvo / 1 fechado (open não conta)

    // faixas vazias existem no array com contadores zerados
    expect(r.zones[2]).toMatchObject({ zone: 3, signals: 0, winRatePct: null, avgPnlPct: null });

    // soma das fatias = 100%
    expect(r.zones.reduce((s, z) => s + z.sharePct, 0)).toBeCloseTo(100);
  });

  test('ignora ocorrências sem faixa resolvida (cloudZone null)', () => {
    const r = computeCloudZoneStats([
      { cloudZone: null, filled: true, outcome: 'target', pnlPct: 3 },
      { cloudZone: 2, filled: true, outcome: 'target', pnlPct: 3 },
    ]);
    expect(r.total).toBe(1);
    expect(r.zones[1].signals).toBe(1);
  });

  test('sem nenhuma faixa resolvida → null', () => {
    expect(computeCloudZoneStats([{ cloudZone: null, filled: false }])).toBeNull();
    expect(computeCloudZoneStats([])).toBeNull();
  });
});
