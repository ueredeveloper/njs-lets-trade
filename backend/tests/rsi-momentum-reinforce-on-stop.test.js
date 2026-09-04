'use strict';

const {
    runReinforcementLadder,
    runRearmLadder,
    computeReinforceStats,
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
