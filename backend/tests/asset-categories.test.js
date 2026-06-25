const {
  getSymbolCategories,
  isSymbolVisible,
  filterSymbols,
  DEFAULT_ASSET_DISPLAY,
} = require('../utils/assetCategories');

describe('assetCategories', () => {
  test('BTCUSDT is traditional spot (no categories)', () => {
    expect(getSymbolCategories('BTCUSDT')).toEqual([]);
    expect(isSymbolVisible('BTCUSDT', DEFAULT_ASSET_DISPLAY)).toBe(true);
  });

  test('stablecoins hidden by default', () => {
    expect(getSymbolCategories('USDCUSDT')).toContain('stablecoins');
    expect(isSymbolVisible('USDCUSDT', DEFAULT_ASSET_DISPLAY)).toBe(false);
    expect(isSymbolVisible('USDCUSDT', { ...DEFAULT_ASSET_DISPLAY, stablecoins: true })).toBe(true);
  });

  test('leveraged tokens', () => {
    expect(getSymbolCategories('BTCUPUSDT')).toContain('leveragedLong');
    expect(getSymbolCategories('BTCDOWNUSDT')).toContain('leveragedShort');
    expect(isSymbolVisible('BTCUPUSDT', DEFAULT_ASSET_DISPLAY)).toBe(false);
  });

  test('wrapped tokens', () => {
    expect(getSymbolCategories('WBTCUSDT')).toContain('wrapped');
    expect(isSymbolVisible('WBTCUSDT', { ...DEFAULT_ASSET_DISPLAY, wrapped: true })).toBe(true);
  });

  test('liquid staking', () => {
    expect(getSymbolCategories('STETHUSDT')).toContain('liquidStaking');
  });

  test('filterSymbols removes hidden categories', () => {
    const list = ['BTCUSDT', 'USDCUSDT', 'ETHUSDT', 'BTCUPUSDT'];
    expect(filterSymbols(list, DEFAULT_ASSET_DISPLAY)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  test('WIF is not classified as wrapped', () => {
    expect(getSymbolCategories('WIFUSDT')).not.toContain('wrapped');
  });
});
