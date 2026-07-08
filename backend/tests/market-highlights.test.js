const {
  rankBinanceGainers,
  buildBinanceGainersFromMarketing,
  buildBinanceGainersFromTickers,
  MIN_VOLUME_USDT,
} = require('../market/marketHighlights');

describe('market-highlights — Binance em alta', () => {
  const activeSet = new Set(['SYNUSDT', 'AIUSDT', 'PEOPLEUSDT', 'BTCUSDT']);

  test('exclui pares inativos (ex.: UTK deslistado)', () => {
    const ranked = rankBinanceGainers(
      [
        { symbol: 'UTKUSDT', changePct: 99, volume: 5_000_000 },
        { symbol: 'SYNUSDT', changePct: 15, volume: 2_000_000 },
        { symbol: 'AIUSDT', changePct: 10, volume: 2_000_000 },
      ],
      activeSet,
      10,
    );
    expect(ranked.map((r) => r.symbol)).toEqual(['SYNUSDT', 'AIUSDT']);
  });

  test('respeita volume mínimo em USDT', () => {
    const ranked = rankBinanceGainers(
      [
        { symbol: 'PEOPLEUSDT', changePct: 20, volume: MIN_VOLUME_USDT - 1 },
        { symbol: 'AIUSDT', changePct: 5, volume: MIN_VOLUME_USDT },
      ],
      activeSet,
      10,
    );
    expect(ranked.map((r) => r.symbol)).toEqual(['AIUSDT']);
  });

  test('marketing API: usa dayChange e volume do site', () => {
    const ranked = buildBinanceGainersFromMarketing(
      [
        { symbol: 'UTKUSDT', dayChange: 50, volume: 10_000_000 },
        { symbol: 'SYNUSDT', dayChange: 14, volume: 5_000_000 },
        { symbol: 'PEOPLEUSDT', dayChange: 4.5, volume: 7_000_000 },
      ],
      activeSet,
      10,
    );
    expect(ranked[0].symbol).toBe('SYNUSDT');
    expect(ranked.some((r) => r.symbol === 'PEOPLEUSDT')).toBe(true);
    expect(ranked.some((r) => r.symbol === 'UTKUSDT')).toBe(false);
  });

  test('fallback ticker/24hr também filtra pares inativos', () => {
    const ranked = buildBinanceGainersFromTickers(
      [
        { symbol: 'UTKUSDT', priceChangePercent: '40', quoteVolume: '9000000' },
        { symbol: 'AIUSDT', priceChangePercent: '9', quoteVolume: '2000000' },
      ],
      activeSet,
      10,
    );
    expect(ranked.map((r) => r.symbol)).toEqual(['AIUSDT']);
  });
});
