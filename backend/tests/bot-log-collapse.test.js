'use strict';

const { collapseNoise } = require('../admin/botLog');

describe('collapseNoise — resumo do /admin/log', () => {
  test('colapsa o bloco repetido do scanner mantendo só a última ocorrência', () => {
    const input = [
      '[RSI Momentum] [10-09/2026 05:02] 📋 Moedas avaliadas (3): CRVUSDT, SEIUSDT, SKYAIUSDT',
      '[RSI Momentum] 🔎 Scan RSI Momentum: 82 moeda(s) analisadas',
      '[RSI Momentum]    bloqueadas — volume 24h abaixo de 5.000.000 USDT: 391',
      '[RSI Momentum]    bloqueadas — RSI não cruzou o valor 69: 82',
      '[RSI Momentum] [10-09/2026 05:24] 📋 Moedas avaliadas (3): CRVUSDT, SEIUSDT, SKYAIUSDT',
      '[RSI Momentum] [10-09/2026 05:51] 📋 Moedas avaliadas (3): CRVUSDT, SEIUSDT, SKYAIUSDT',
      '[RSI Momentum] 🔎 Scan RSI Momentum: 81 moeda(s) analisadas',
      '[RSI Momentum]    bloqueadas — volume 24h abaixo de 5.000.000 USDT: 392',
      '[RSI Momentum]    bloqueadas — RSI não cruzou o valor 69: 81',
      '[RSI Momentum] [10-09/2026 07:37] 📋 Moedas avaliadas (3): CRVUSDT, SEIUSDT, SKYAIUSDT',
      '[RSI Momentum] [07:43:02] [SKYAIUSDT/rsi-momentum] ⚠️  Posição órfã — resetando para WATCHING',
      '[launcher] controle: REINICIAR (exit 10)',
      '[launcher] >> njs-lets-trade launcher v1.137.0',
    ];

    const out = collapseNoise(input);

    // um só "Moedas avaliadas", contando as 4 ocorrências e a janela de horário
    const avaliadas = out.filter((l) => l.includes('Moedas avaliadas'));
    expect(avaliadas).toHaveLength(1);
    expect(avaliadas[0]).toContain('[10-09/2026 07:37]');
    expect(avaliadas[0]).toMatch(/\(4×, 05:02→07:37\)/);

    // um só de cada linha do scan, com contagem 2×
    expect(out.filter((l) => l.includes('🔎 Scan RSI Momentum'))).toHaveLength(1);
    expect(out.find((l) => l.includes('🔎 Scan RSI Momentum'))).toMatch(/\(2×\)/);
    expect(out.filter((l) => l.includes('bloqueadas — volume 24h'))).toHaveLength(1);
    expect(out.filter((l) => l.includes('bloqueadas — RSI'))).toHaveLength(1);

    // linhas não-ruído passam intactas e na ordem
    expect(out).toContain('[RSI Momentum] [07:43:02] [SKYAIUSDT/rsi-momentum] ⚠️  Posição órfã — resetando para WATCHING');
    expect(out).toContain('[launcher] controle: REINICIAR (exit 10)');
    expect(out).toContain('[launcher] >> njs-lets-trade launcher v1.137.0');
  });

  test('ocorrência única não ganha anotação', () => {
    const input = [
      '[RSI Momentum] 🔎 Scan RSI Momentum: 80 moeda(s) analisadas',
      '[launcher] >> njs-lets-trade launcher v1.137.0',
    ];
    expect(collapseNoise(input)).toEqual(input);
  });

  test('lista de moedas diferente = grupo diferente (não colapsa junto)', () => {
    const input = [
      '[RSI Momentum] [05:02] 📋 Moedas avaliadas (3): CRVUSDT, SEIUSDT, SKYAIUSDT',
      '[RSI Momentum] [05:24] 📋 Moedas avaliadas (2): CRVUSDT, SEIUSDT',
      '[RSI Momentum] [05:51] 📋 Moedas avaliadas (3): CRVUSDT, SEIUSDT, SKYAIUSDT',
    ];
    const out = collapseNoise(input);
    expect(out).toHaveLength(2);
    expect(out.find((l) => l.includes('(2):'))).toBeTruthy();
    expect(out.find((l) => l.includes('(3):'))).toMatch(/\(2×, 05:02→05:51\)/);
  });
});
