'use strict';

const {
    resolveSrZonesNow,
    checkSupportResistanceEntry,
    computeBracketPrices,
    evaluateReinforceLadder,
    SR_STOP_FALLBACK_PCT,
} = require('../bot/rsi-momentum/strategyEngine');
const { normalizeRsiMomentumConfig } = require('../bot/rsi-momentum/tradeConfigSchema');

/** Série longa com topo claro em ~120 e fundo claro em ~90, terminando perto de 100 — pivôs
 *  fractais (±5) confirmados no pico e no fundo. */
function srCandles() {
    const out = [];
    let t = 1_700_000_000_000;
    const push = (mid) => {
        out.push({ openTime: t, open: String(mid), high: String(mid + 1.5), low: String(mid - 1.5), close: String(mid) });
        t += 4 * 3600 * 1000;
    };
    for (let i = 0; i < 10; i++) push(100 + i * 2.0);  // 100 -> ~118
    push(120); push(120);                              // topo (largo)
    for (let i = 0; i < 12; i++) push(118 - i * 2.4);  // ~118 -> ~90
    push(89); push(89);                                // fundo (largo)
    for (let i = 0; i < 10; i++) push(90 + i * 1.0);   // ~90 -> ~99
    return out;
}

const SR_CFG = { enabled: true, interval: '4h', candleCount: 30, entrySupportRank: 1, exitResistanceRank: 1, entryMaxPct: 5 };

describe('resolveSrZonesNow / checkSupportResistanceEntry', () => {
    const cMap = { '4h': srCandles() };

    test('acha suporte abaixo e resistência acima do preço atual', () => {
        const zones = resolveSrZonesNow(cMap, SR_CFG);
        expect(zones).not.toBeNull();
        expect(zones.supports.length + zones.resistances.length).toBeGreaterThan(0);
    });

    test('janela incompleta → null (fail-open no chamador)', () => {
        expect(resolveSrZonesNow({ '4h': srCandles().slice(0, 10) }, SR_CFG)).toBeNull();
        const r = checkSupportResistanceEntry({ entry: { supportResistance: SR_CFG } }, { '4h': srCandles().slice(0, 10) }, 100);
        expect(r.allowed).toBe(true);
        expect(r.warmup).toBe(true);
    });

    test('filtro desligado → passa, sem alvo nem stop', () => {
        const r = checkSupportResistanceEntry({ entry: { supportResistance: { enabled: false } } }, cMap, 100);
        expect(r).toEqual({ allowed: true, srTargetPrice: null, srStopPrice: null });
    });

    test('preço muito acima do suporte → bloqueia (SR_NO_DISCOUNT)', () => {
        // preço 130 está muito acima de qualquer suporte (~90) → > 5%
        const r = checkSupportResistanceEntry({ entry: { supportResistance: SR_CFG } }, cMap, 130);
        expect(r.allowed).toBe(false);
        expect(r.reason).toBe('SR_NO_DISCOUNT');
    });

    test('preço colado no suporte → passa e devolve alvo na resistência acima', () => {
        const zones = resolveSrZonesNow(cMap, SR_CFG);
        const nearestSupport = zones.supports[0]?.price ?? 90;
        const r = checkSupportResistanceEntry({ entry: { supportResistance: SR_CFG } }, cMap, nearestSupport * 1.01);
        expect(r.allowed).toBe(true);
        if (zones.resistances.length) {
            expect(r.srTargetPrice).toBeGreaterThan(nearestSupport);
        }
    });

    test('stopEnabled: devolve o preço ABSOLUTO do posto escolhido (stopSupportRank)', () => {
        const zones = resolveSrZonesNow(cMap, SR_CFG);
        const nearestSupport = zones.supports[0].price;
        const price = nearestSupport * 1.01;
        const r = checkSupportResistanceEntry(
            { entry: { supportResistance: { ...SR_CFG, stopEnabled: true, stopSupportRank: 1 } } }, cMap, price,
        );
        expect(r.allowed).toBe(true);
        expect(r.srStopPrice).toBeCloseTo(nearestSupport, 6);
    });

    test('stopEnabled sem suporte disponível naquele posto → srStopPrice null (fallback fica por conta do chamador)', () => {
        const zones = resolveSrZonesNow(cMap, SR_CFG);
        const nearestSupport = zones.supports[0].price;
        const price = nearestSupport * 1.01;
        // Fixture só tem 1 zona de suporte — rank 2 não existe.
        const r = checkSupportResistanceEntry(
            { entry: { supportResistance: { ...SR_CFG, stopEnabled: true, stopSupportRank: 2 } } }, cMap, price,
        );
        expect(r.allowed).toBe(true);
        expect(r.srStopPrice).toBeNull();
    });

    test('stopEnabled false → srStopPrice sempre null, mesmo com suporte disponível', () => {
        const zones = resolveSrZonesNow(cMap, SR_CFG);
        const nearestSupport = zones.supports[0].price;
        const r = checkSupportResistanceEntry(
            { entry: { supportResistance: { ...SR_CFG, stopEnabled: false, stopSupportRank: 1 } } }, cMap, nearestSupport * 1.01,
        );
        expect(r.srStopPrice).toBeNull();
    });
});

describe('computeBracketPrices — alvo por resistência do S/R', () => {
    const base = () => normalizeRsiMomentumConfig({
        exit: { targetMode: 'off', trailingStop: { enabled: false }, hardTakeProfit: { enabled: false } },
        stopLoss: { enabled: true, maxLossPct: 10 },
    });

    test('srTargetPrice acima da entrada vira o alvo, mesmo com targetMode "off"', () => {
        const r = computeBracketPrices(base(), 100, 100, 118);
        expect(r.targetPrice).toBeCloseTo(118, 6);
        expect(r.stopPrice).toBeCloseTo(90, 6);
    });

    test('teto de lucro ainda limita o alvo do S/R', () => {
        const cfg = normalizeRsiMomentumConfig({
            exit: { targetMode: 'off', trailingStop: { enabled: false }, hardTakeProfit: { enabled: true, pct: 12 } },
            stopLoss: { enabled: true, maxLossPct: 10 },
        });
        const r = computeBracketPrices(cfg, 100, 100, 130); // S/R quer +30%, teto +12%
        expect(r.targetPrice).toBeCloseTo(112, 6);
        expect(r.targetCapped).toBe(true);
    });

    test('srTargetPrice abaixo/igual à entrada é ignorado', () => {
        const r = computeBracketPrices(base(), 100, 100, 95);
        expect(r.targetPrice).toBeNull(); // volta pro targetMode "off"
    });
});

describe('computeBracketPrices — stop por suporte do S/R (entry.supportResistance.stopEnabled)', () => {
    const srStopCfg = (overrides) => normalizeRsiMomentumConfig({
        entry: { supportResistance: { enabled: true, stopEnabled: true, stopSupportRank: 2, ...overrides?.sr } },
        exit: { targetMode: 'off', trailingStop: { enabled: false }, hardTakeProfit: { enabled: false } },
        stopLoss: { enabled: true, maxLossPct: 10 },
        ...overrides?.rest,
    });

    test('srStopPrice válido (abaixo da entrada) vira o stop, FIXO — ignora entryPrice/peakPrice além da entrada', () => {
        const r = computeBracketPrices(srStopCfg(), 100, 100, null, 90);
        expect(r.stopPrice).toBeCloseTo(90, 6);
        // "fixo" = não recalcula com o pico, diferente do stop contínuo.
        const withHigherPeak = computeBracketPrices(srStopCfg(), 100, 150, null, 90);
        expect(withHigherPeak.stopPrice).toBeCloseTo(90, 6);
    });

    test('sem srStopPrice (linha escolhida não existe) → cai no fallback de SR_STOP_FALLBACK_PCT%', () => {
        const r = computeBracketPrices(srStopCfg(), 100, 100, null, null);
        expect(r.stopPrice).toBeCloseTo(100 * (1 - SR_STOP_FALLBACK_PCT / 100), 6);
    });

    test('srStopPrice inválido (>= entrada) → mesmo fallback, nunca usa o valor bruto', () => {
        const r = computeBracketPrices(srStopCfg(), 100, 100, null, 105);
        expect(r.stopPrice).toBeCloseTo(100 * (1 - SR_STOP_FALLBACK_PCT / 100), 6);
    });

    test('stop contínuo (trailingStop.enabled) tem prioridade sobre o stop por S/R', () => {
        const cfg = srStopCfg({ rest: { exit: {
            targetMode: 'off',
            trailingStop: { enabled: true, mode: 'continuous', startPct: 5, coinStepPct: 3, stopStepPct: 2 },
            hardTakeProfit: { enabled: false },
        } } });
        const r = computeBracketPrices(cfg, 100, 100, null, 90);
        // 90 seria o stop por S/R; com trailing ligado o stop vem de computeTrailingStopPrice
        // (100*(1-5%) no pico=entrada), não do S/R.
        expect(r.stopPrice).toBeCloseTo(95, 6);
    });

    test('stopEnabled desligado → volta pro stopLoss.maxLossPct fixo, ignora srStopPrice informado', () => {
        const cfg = normalizeRsiMomentumConfig({
            entry: { supportResistance: { enabled: true, stopEnabled: false } },
            exit: { targetMode: 'off', trailingStop: { enabled: false }, hardTakeProfit: { enabled: false } },
            stopLoss: { enabled: true, maxLossPct: 12 },
        });
        // srStopPrice=90 seria usado se stopEnabled estivesse ligado — aqui deve ser ignorado.
        const r = computeBracketPrices(cfg, 100, 100, null, 90);
        expect(r.stopPrice).toBeCloseTo(88 /* maxLossPct 12% */, 6);
    });
});

describe('evaluateReinforceLadder', () => {
    const rf = { lastEntryPrice: 100, addDropPct: 10, exitRisePct: 15 };

    test('high alcança +15% → exit', () => {
        expect(evaluateReinforceLadder(rf, { high: 116, low: 99 }).action).toBe('exit');
    });
    test('low cai -10% → addRung', () => {
        expect(evaluateReinforceLadder(rf, { high: 101, low: 89 }).action).toBe('addRung');
    });
    test('candle no meio → hold', () => {
        expect(evaluateReinforceLadder(rf, { high: 108, low: 95 }).action).toBe('hold');
    });
    test('empate (bate os dois) → addRung antes de exit', () => {
        expect(evaluateReinforceLadder(rf, { high: 120, low: 85 }).action).toBe('addRung');
    });
    test('sem candle → hold, com níveis calculados', () => {
        const r = evaluateReinforceLadder(rf, null);
        expect(r.action).toBe('hold');
        expect(r.addLevel).toBeCloseTo(90, 6);
        expect(r.tpPrice).toBeCloseTo(115, 6);
    });
});
