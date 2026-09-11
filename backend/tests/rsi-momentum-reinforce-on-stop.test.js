'use strict';

const {
    runReinforcementLadder,
    runRearmLadder,
    computeReinforceStats,
    findRsiRecrossPoint,
    findScanIndexAtOrAfter,
} = require('../utils/analyseRsiThresholdBacktest');

/** Candle mínimo pro motor da escada (só usa low/high/close/openTime). */
function candle(low, high, close, i) {
    return { openTime: 1_700_000_000_000 + i * 60_000, low: String(low), high: String(high), close: String(close) };
}

describe('runReinforcementLadder — reforço no stop', () => {
    // Compra inicial entrou a 100 e bateu o stop a 90 (−10%). O 1º reforço entra a 90.
    // Gatilhos a partir do último aporte: +15% encerra a pilha, −10% adiciona outro degrau.
    const FIRST_ENTRY = 100;
    const FIRST_STOP = 90;
    const OPTS = { addDropPct: 10, exitRisePct: 15, maxRungs: 100 };

    test('recupera no 1º reforço: sobe +15% do aporte e vende as duas compras', () => {
        const scan = [candle(95, 104, 103, 0)]; // high 104 >= 90*1.15 = 103.5
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, OPTS);
        expect(r.outcome).toBe('target');
        expect(r.legs).toEqual([100, 90]);
        expect(r.exitPrice).toBeCloseTo(103.5, 6);
        // média simples dos retornos até 103.5: (3.5% + 15%) / 2
        expect(r.returnPct).toBeCloseTo(9.25, 4);
        expect(r.avgEntryPrice).toBeCloseTo(95, 6);
    });

    test('cai mais 10%, empilha 3ª compra, depois recupera vendendo tudo', () => {
        const scan = [
            candle(80, 92, 82, 0),  // low 80 <= 90*0.9 = 81 -> adiciona aporte a 81
            candle(90, 94, 93, 1),  // high 94 >= 81*1.15 = 93.15 -> alvo
        ];
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, OPTS);
        expect(r.outcome).toBe('target');
        expect(r.legs).toEqual([100, 90, 81]);
        expect(r.exitPrice).toBeCloseTo(93.15, 6);
        // (−6.85% + 3.5% + 15%) / 3
        expect(r.returnPct).toBeCloseTo(3.8833, 3);
    });

    test('nunca recupera na janela: outcome open, pilha marcada a mercado (último close)', () => {
        const scan = [candle(85, 88, 86, 0)]; // não toca alvo nem gatilho de reforço
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, OPTS);
        expect(r.outcome).toBe('open');
        expect(r.legs).toEqual([100, 90]);
        expect(r.exitPrice).toBeCloseTo(86, 6);
        expect(r.returnPct).toBeLessThan(0);
    });

    test('empate intra-candle conta a queda (novo aporte) antes da subida (alvo)', () => {
        // candle enorme: bate tanto −10% do aporte quanto +15% dele -> deve empilhar, não vender
        const scan = [
            candle(80, 105, 82, 0),
            candle(100, 101, 100, 1),
        ];
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, OPTS);
        expect(r.legs.length).toBe(3); // empilhou o 3º aporte
    });

    test('pernas de tamanhos diferentes (entrada 20 / reforço 40): P&L e capital ponderados', () => {
        const scan = [candle(95, 104, 103, 0)]; // vende a 103.5 (mesma cena do 1º teste)
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, firstLegUsd: 20, rungUsd: 40 });
        expect(r.legs).toEqual([100, 90]);
        // qty: 20/100 = 0.2 ; 40/90 = 0.44444 -> total 0.64444
        // investido = 60 ; saída = 0.64444 * 103.5 = 66.7 ; pnl = 6.7 ; retorno = 6.7/60 = 11.1667%
        expect(r.investedUsd).toBeCloseTo(60, 6);
        expect(r.pnlUsd).toBeCloseTo(6.7, 1);
        expect(r.returnPct).toBeCloseTo(11.1667, 3);
    });

    test('firstLegUsd === rungUsd reproduz a média simples anterior', () => {
        const scan = [candle(95, 104, 103, 0)];
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, firstLegUsd: 40, rungUsd: 40 });
        expect(r.returnPct).toBeCloseTo(9.25, 4);
    });

    test('trava de segurança maxRungs interrompe a escada', () => {
        // preço em queda livre: cada candle dispara mais um reforço
        const scan = Array.from({ length: 10 }, (_, i) => candle(1, 2, 1, i));
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, maxRungs: 3 });
        expect(r.outcome).toBe('open');
        expect(r.legs.length - 1).toBeLessThanOrEqual(3);
    });

    describe('waitCandles — espera antes do 1º reforço', () => {
        test('espera N candles e compra a perna 1 no fechamento desse candle (não no preço do stop)', () => {
            // stop a 90 (idx0); preço cai por 4 candles. Sem espera a perna 1 entra a 90; com
            // espera 4 candles entra no fechamento do idx4 = 82, bem mais barato.
            const scan = [
                candle(89, 91, 89, 0),
                candle(87, 89, 88, 1),
                candle(85, 88, 86, 2),
                candle(83, 86, 84, 3),
                candle(81, 84, 82, 4),   // fechamento 82 -> preço da perna 1 (startIdx + wait = 0 + 4)
                candle(82, 95, 94, 5),   // high 95 >= 82*1.15 = 94.3 -> alvo
            ];
            const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, waitCandles: 4 });
            expect(r.legs).toEqual([100, 82]);
            expect(r.outcome).toBe('target');
            expect(r.exitPrice).toBeCloseTo(94.3, 4);
        });

        test('waitCandles 0 = comportamento antigo (perna 1 no preço do stop)', () => {
            const scan = [candle(95, 104, 103, 0)];
            const a = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, OPTS);
            const b = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, waitCandles: 0 });
            expect(b).toEqual(a);
            expect(b.legs).toEqual([100, 90]);
        });

        test('janela acaba durante a espera: só a perna 0, marcada a mercado, outcome open', () => {
            const scan = [candle(89, 90, 88, 0), candle(87, 88, 86, 1)];
            const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, waitCandles: 5 });
            expect(r.legs).toEqual([100]);
            expect(r.outcome).toBe('open');
            expect(r.exitPrice).toBeCloseTo(86, 6);
            expect(r.investedUsd).toBeCloseTo(1, 6); // firstLegUsd default 1
        });
    });
});

describe('runRearmLadder — reforço no stop modo "re-armar bracket"', () => {
    // Entrada 100 @ 100, stop -10% -> vende a 90 (perda realizada). Recompra sobra + aporte.
    const FIRST_ENTRY = 100;
    const FIRST_STOP = 90;

    test('exemplo do usuário: compra 100, stop 90, recompra 190, alvo +10% rende +4.5% no capital', () => {
        // recompra a 90; alvo = 90*1.10 = 99; stop = 90*0.90 = 81
        const scan = [candle(88, 92, 90, 0), candle(89, 100, 99, 1)]; // idx1 high 100 >= 99
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP,
            { stopPct: 10, targetPct: 10, maxRungs: 100, firstLegUsd: 100, rungUsd: 100 });
        expect(r.outcome).toBe('target');
        expect(r.legs).toEqual([100, 90]);
        expect(r.investedUsd).toBeCloseTo(200, 6);  // caixa NOVO: 100 entrada + 100 reforço
        expect(r.pnlUsd).toBeCloseTo(9, 4);          // 190/90*99 - 200
        expect(r.returnPct).toBeCloseTo(4.5, 4);     // NÃO +10% — houve o stop antes
    });

    test('dois stops antes do alvo: "alvo alcançado" mas o resultado real é negativo', () => {
        const scan = [
            candle(78, 82, 80, 0),   // stop da 1ª recompra (entry 90 -> stop 81), sem furar o stop da 2ª (72.9)
            candle(80, 90, 89, 1),   // recompra a 81; alvo 81*1.1 = 89.1 -> high 90 alcança
        ];
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP,
            { stopPct: 10, targetPct: 10, maxRungs: 100, firstLegUsd: 100, rungUsd: 100 });
        expect(r.legs).toEqual([100, 90, 81]);
        expect(r.investedUsd).toBeCloseTo(300, 6);
        expect(r.pnlUsd).toBeLessThan(0);            // "target" mas no vermelho
        expect(r.outcome).toBe('target');
    });

    test('janela acaba com a pilha submersa: outcome open, retorno negativo sobre o caixa total', () => {
        const scan = [candle(85, 89, 86, 0), candle(83, 87, 84, 1)];
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP,
            { stopPct: 10, targetPct: 20, maxRungs: 100, firstLegUsd: 100, rungUsd: 100 });
        expect(r.outcome).toBe('open');
        expect(r.returnPct).toBeLessThan(0);
    });

    test('trava maxRungs interrompe a série de recompras', () => {
        const scan = Array.from({ length: 20 }, (_, i) => candle(0.0001, 0.0002, 0.0001, i));
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP,
            { stopPct: 10, targetPct: 10, maxRungs: 4, firstLegUsd: 100, rungUsd: 100 });
        expect(r.legs.length - 1).toBeLessThanOrEqual(4);
        expect(r.investedUsd).toBeCloseTo(500, 6); // 100 + 4×100
    });
});

describe('legTimeline — 1 quadrado por perna pro gráfico (verde=alvo, vermelho=stop)', () => {
    const FIRST_ENTRY = 100;
    const FIRST_STOP = 90;

    test('ladder: 2 pernas — quadrado 1 vermelho (stop), quadrado 2 verde (alvo)', () => {
        const scan = [candle(95, 104, 103, 0)];
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { addDropPct: 10, exitRisePct: 15, maxRungs: 100 });
        expect(r.legTimeline).toHaveLength(2);
        expect(r.legTimeline[0]).toMatchObject({ entryTime: null, entryPrice: 100, exitPrice: 90, outcome: 'stop' });
        expect(r.legTimeline[1]).toMatchObject({ entryPrice: 90, outcome: 'target' });
        expect(r.legTimeline[1].exitPrice).toBeCloseTo(103.5, 6);
    });

    test('ladder: 3 pernas — vermelho, vermelho, verde (compra 1/2/3 do usuário)', () => {
        const scan = [candle(80, 92, 82, 0), candle(90, 94, 93, 1)];
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { addDropPct: 10, exitRisePct: 15, maxRungs: 100 });
        expect(r.legTimeline.map((l) => l.outcome)).toEqual(['stop', 'stop', 'target']);
        expect(r.legTimeline.map((l) => l.entryPrice)).toEqual([100, 90, 81]);
        // cada perna começa onde a anterior terminou
        for (let i = 1; i < r.legTimeline.length; i++) {
            expect(r.legTimeline[i].entryPrice).toBeCloseTo(r.legTimeline[i - 1].exitPrice, 6);
            expect(r.legTimeline[i].entryTime).toBe(r.legTimeline[i - 1].exitTime);
        }
    });

    test('ladder: nunca recupera — última perna fica vermelha (open)', () => {
        const scan = [candle(85, 88, 86, 0)];
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { addDropPct: 10, exitRisePct: 15, maxRungs: 100 });
        expect(r.legTimeline).toHaveLength(2);
        expect(r.legTimeline[1].outcome).toBe('open');
    });

    test('rearm: exemplo do usuário — perna 1 vermelha (stop 90), perna 2 verde (alvo 99)', () => {
        const scan = [candle(88, 92, 90, 0), candle(89, 100, 99, 1)];
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { stopPct: 10, targetPct: 10, maxRungs: 100, firstLegUsd: 100, rungUsd: 100 });
        expect(r.legTimeline.map((l) => l.outcome)).toEqual(['stop', 'target']);
        expect(r.legTimeline[1].entryPrice).toBe(90);
        expect(r.legTimeline[1].exitPrice).toBeCloseTo(99, 6);
    });

    test('rearm: dois stops seguidos — vermelho, vermelho, verde', () => {
        const scan = [candle(78, 82, 80, 0), candle(80, 90, 89, 1)];
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { stopPct: 10, targetPct: 10, maxRungs: 100, firstLegUsd: 100, rungUsd: 100 });
        expect(r.legTimeline.map((l) => l.outcome)).toEqual(['stop', 'stop', 'target']);
    });
});

describe('computeReinforceStats', () => {
    test('resume só os trades que usaram reforço', () => {
        const filled = [
            { reinforceRungs: 0, outcome: 'target', pnlUsd: 10, investedUsd: 100 },
            { reinforceRungs: 2, outcome: 'target', pnlUsd: 5, investedUsd: 300 },
            { reinforceRungs: 4, outcome: 'open', pnlUsd: -120, investedUsd: 500 },
        ];
        const s = computeReinforceStats(filled);
        expect(s.trades).toBe(2);
        expect(s.rungsTotal).toBe(6);
        expect(s.maxRungsInTrade).toBe(4);
        expect(s.recovered).toBe(1);
        expect(s.stillOpen).toBe(1);
        expect(s.pnlUsd).toBeCloseTo(-115, 6);
        expect(s.investedUsd).toBeCloseTo(800, 6);
    });

    test('null quando nenhum trade usou reforço', () => {
        expect(computeReinforceStats([{ reinforceRungs: 0, outcome: 'stop', pnlUsd: -10 }])).toBeNull();
    });
});

/** Candle do intervalo PRINCIPAL pro findRsiRecrossPoint — só usa openTime/close. */
function mainCandle(i, close, ivMs = 900_000, t0 = 0) {
    return { openTime: t0 + i * ivMs, close: String(close) };
}

describe('findRsiRecrossPoint — gatilho de reentrada por RSI (reentryTrigger "rsiRecross")', () => {
    const IV_MS = 900_000; // 15m
    // 8 candles de 15m; offset=3 (RSI "nasce" em candles[3]) -> rsiValues[k] <-> candles[k+3].
    const candles = Array.from({ length: 8 }, (_, i) => mainCandle(i, 100 + i));
    const closes = candles.map((c) => parseFloat(c.close));
    const offset = 3;
    const rsiValues = [50, 55, 60, 65, 72]; // candles[3..7]

    test('acha o 1º cruzamento pra CIMA do threshold depois de fromTimeMs', () => {
        const r = findRsiRecrossPoint({
            candles, closes, rsiValues, offset, ivMs: IV_MS,
            rsi5mCandles: [], rsi5mSeries: [], rsi5mOffset: 0,
            fromTimeMs: candles[5].openTime, threshold: 69, rsi5m: null, earlyConfirm: null,
        });
        expect(r).not.toBeNull();
        expect(r.timeMs).toBe(candles[7].openTime); // rsiValues[3]=65 -> rsiValues[4]=72 cruza aqui
        expect(r.price).toBeCloseTo(107, 6);
    });

    test('nunca cruza o threshold -> null', () => {
        const r = findRsiRecrossPoint({
            candles, closes, rsiValues, offset, ivMs: IV_MS,
            rsi5mCandles: [], rsi5mSeries: [], rsi5mOffset: 0,
            fromTimeMs: candles[5].openTime, threshold: 90, rsi5m: null, earlyConfirm: null,
        });
        expect(r).toBeNull();
    });

    test('sem candle nenhum depois de fromTimeMs -> null', () => {
        const r = findRsiRecrossPoint({
            candles, closes, rsiValues, offset, ivMs: IV_MS,
            rsi5mCandles: [], rsi5mSeries: [], rsi5mOffset: 0,
            fromTimeMs: candles[7].openTime, threshold: 69, rsi5m: null, earlyConfirm: null,
        });
        expect(r).toBeNull();
    });

    test('filtro RSI 5m bloqueia o cruzamento (RSI 5m no fechamento <= threshold)', () => {
        // RSI 5m no fechamento do candle[7] (openTime+ivMs-1) resolve pro candle 5m em 6_300_000.
        const rsi5mCandles = [{ openTime: 0 }, { openTime: candles[7].openTime }];
        const rsi5mSeries = [80, 60];
        const r = findRsiRecrossPoint({
            candles, closes, rsiValues, offset, ivMs: IV_MS,
            rsi5mCandles, rsi5mSeries, rsi5mOffset: 0,
            fromTimeMs: candles[5].openTime, threshold: 69, rsi5m: { enabled: true, threshold: 65 }, earlyConfirm: null,
        });
        expect(r).toBeNull(); // 60 <= 65 -> bloqueia o único cruzamento disponível
    });

    test('filtro RSI 5m libera quando o RSI 5m está acima do threshold', () => {
        const rsi5mCandles = [{ openTime: 0 }, { openTime: candles[7].openTime }];
        const rsi5mSeries = [80, 90];
        const r = findRsiRecrossPoint({
            candles, closes, rsiValues, offset, ivMs: IV_MS,
            rsi5mCandles, rsi5mSeries, rsi5mOffset: 0,
            fromTimeMs: candles[5].openTime, threshold: 69, rsi5m: { enabled: true, threshold: 65 }, earlyConfirm: null,
        });
        expect(r).not.toBeNull();
        expect(r.timeMs).toBe(candles[7].openTime);
    });
});

describe('findScanIndexAtOrAfter', () => {
    const scan = [candle(1, 2, 1, 0), candle(1, 2, 1, 2), candle(1, 2, 1, 5)];

    test('acha o 1º candle com openTime >= alvo', () => {
        expect(findScanIndexAtOrAfter(scan, scan[1].openTime)).toBe(1);
        expect(findScanIndexAtOrAfter(scan, scan[1].openTime + 1)).toBe(2);
    });

    test('-1 quando nenhum candle alcança o alvo', () => {
        expect(findScanIndexAtOrAfter(scan, scan[2].openTime + 1)).toBe(-1);
    });
});

describe('runReinforcementLadder — reentryResolver (reentryTrigger "rsiRecross")', () => {
    const FIRST_ENTRY = 100;
    const FIRST_STOP = 90;
    const OPTS = { addDropPct: 10, exitRisePct: 15, maxRungs: 100 };

    test('perna 1 entra no preço/instante devolvido pelo resolver, não no preço do stop', () => {
        const scan = [
            candle(89, 91, 89, 0),
            candle(87, 89, 88, 1),
            candle(84, 96, 95, 2), // resolver aponta pra cá (close 82) -> depois disso, high 96 >= 82*1.15=94.3 -> alvo
        ];
        const resolver = jest.fn((fromTimeMs) => {
            expect(fromTimeMs).toBe(scan[0].openTime); // stopTime0
            return { timeMs: scan[2].openTime, price: 82 };
        });
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, reentryResolver: resolver });
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(r.legs).toEqual([100, 82]);
        expect(r.outcome).toBe('target');
        expect(r.exitPrice).toBeCloseTo(94.3, 4);
    });

    test('resolver nunca acha reentrada -> só a perna 0, outcome open', () => {
        const scan = [candle(89, 91, 89, 0), candle(85, 88, 86, 1)];
        const resolver = jest.fn(() => null);
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, reentryResolver: resolver });
        expect(r.legs).toEqual([100]);
        expect(r.outcome).toBe('open');
        expect(r.exitPrice).toBeCloseTo(86, 6);
    });

    test('reentryResolver tem prioridade sobre waitCandles quando os dois vêm preenchidos', () => {
        const scan = [candle(89, 91, 89, 0), candle(95, 104, 103, 1)];
        const resolver = () => ({ timeMs: scan[1].openTime, price: 95 });
        const r = runReinforcementLadder(scan, 0, FIRST_ENTRY, FIRST_STOP, { ...OPTS, waitCandles: 1, reentryResolver: resolver });
        expect(r.legs).toEqual([100, 95]); // 95 do resolver, não 89 (fechamento do candle 1 após wait)
    });
});

describe('runRearmLadder — reentryResolver (reentryTrigger "rsiRecross")', () => {
    const FIRST_ENTRY = 100;
    const FIRST_STOP = 90;

    test('recompra no preço/instante do resolver em vez do preço do stop', () => {
        const scan = [
            candle(85, 88, 86, 0),
            candle(88, 100, 99, 1), // resolver aponta pra cá (close 92) -> alvo = 92*1.10=101.2? checar high
        ];
        // recompra a 92 (resolver): alvo = 92*1.10 = 101.2, stop = 92*0.90 = 82.8 — nenhum bate no candle 1
        // (high 100 < 101.2, low 88 > 82.8) -> outcome open no fim da janela.
        const resolver = jest.fn(() => ({ timeMs: scan[1].openTime, price: 92 }));
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP,
            { stopPct: 10, targetPct: 10, maxRungs: 100, firstLegUsd: 100, rungUsd: 100, reentryResolver: resolver });
        expect(r.legs).toEqual([100, 92]); // 92 do resolver, não 90 (preço do stop)
        expect(resolver).toHaveBeenCalledTimes(1);
    });

    test('resolver nunca acha reentrada -> fica flat só com a perna 0 (sem recompra nenhuma)', () => {
        const scan = [candle(85, 88, 86, 0)];
        const resolver = jest.fn(() => null);
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP,
            { stopPct: 10, targetPct: 10, maxRungs: 100, firstLegUsd: 100, rungUsd: 100, reentryResolver: resolver });
        expect(r.legs).toEqual([100]);
        expect(r.outcome).toBe('open');
        expect(r.investedUsd).toBeCloseTo(100, 6); // nenhum aporte novo — só o caixa original
    });

    test('resolver é chamado de novo a CADA stop (diferente do modo ladder, que só afeta a perna 1)', () => {
        const scan = [
            candle(78, 82, 80, 0),  // resolver aponta a 1ª recompra pra cá (92) -> stop 82.8, low 78 já bate
            candle(80, 90, 89, 1),  // resolver aponta a 2ª recompra pra cá (81) -> alvo 81*1.1=89.1, high 90 bate
            candle(85, 95, 94, 2),  // nunca alcançado — o alvo já fechou a pilha no candle anterior
        ];
        const calls = [];
        const resolver = jest.fn((fromTimeMs) => {
            calls.push(fromTimeMs);
            if (calls.length === 1) return { timeMs: scan[0].openTime, price: 92 }; // antes da 1ª recompra
            return { timeMs: scan[1].openTime, price: 81 }; // depois do 2º stop
        });
        const r = runRearmLadder(scan, 0, FIRST_ENTRY, FIRST_STOP,
            { stopPct: 10, targetPct: 10, maxRungs: 100, firstLegUsd: 100, rungUsd: 100, reentryResolver: resolver });
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(r.legs).toEqual([100, 92, 81]);
        expect(r.outcome).toBe('target');
    });
});
