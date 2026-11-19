// Filtros de mercado do bot Price action (marketRegime.js) + config do painel (priceActionConfig.js)
// + o watcher barrando/liberando no fechamento do candle (close_condition.regime).
jest.mock('../bot/whatsapp', () => ({ sendWhatsApp: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/whatsappApiClient', () => ({ sendText: jest.fn(() => Promise.resolve()) }));
jest.mock('../bot/shared/supabaseRest', () => ({ sbReq: jest.fn() }));
jest.mock('../bot/shared/buildAdapter', () => ({ buildAdapter: jest.fn() }));
jest.mock('../binance/fetchKlines', () => jest.fn());
jest.mock('../binance/cachedTicker24hr', () => jest.fn());
jest.mock('../binance/getActiveUsdtPairs', () => ({ getActiveUsdtPairs: jest.fn() }));
jest.mock('../bot/shared/candleCloseCondition', () => ({
  ...jest.requireActual('../bot/shared/candleCloseCondition'),
  fetchClosedCandle: jest.fn(),
  bearishClosePattern: jest.fn(() => null),
}));
jest.mock('../market/bullishBreakoutScanner', () => ({
  ...jest.requireActual('../market/bullishBreakoutScanner'),
  evaluateBullishBreakout: jest.fn(() => ({ ok: true })),
}));

const fetchKlines = require('../binance/fetchKlines');
const getTickers = require('../binance/cachedTicker24hr');
const { getActiveUsdtPairs } = require('../binance/getActiveUsdtPairs');
const { sbReq } = require('../bot/shared/supabaseRest');
const { buildAdapter } = require('../bot/shared/buildAdapter');
const { fetchClosedCandle } = require('../bot/shared/candleCloseCondition');
const { evaluateRegime, checkMarketRegime, DEFAULT_REGIME, _test: regimeTest } = require('../bot/breakout-auto/marketRegime');
beforeEach(() => regimeTest.resetBtcCache());
const { normalizePriceActionConfig, DEFAULTS } = require('../bot/breakout-auto/priceActionConfig');
const { buildConfig } = require('../bot/breakout-auto/bullishBreakoutAuto');
const { _test: { processRow } } = require('../bot/manual-oco/manualOcoWatcher');

const H4 = 4 * 3600_000;
const D1 = 86_400_000;
const T0 = 2_000 * D1;
// Série que sobe (ou cai) devagar: n candles de `iv` terminando antes de T0.
const ramp = (n, iv, step, base = 100) => Array.from({ length: n }, (_, i) => ({
  openTime: T0 - (n - i) * iv, close: base + i * step,
}));
// Alta ACELERANDO no 4h da moeda (numa rampa linear o histograma do MACD fica em ~0).
const accel = (n, iv) => Array.from({ length: n }, (_, i) => ({ openTime: T0 - (n - i) * iv, close: 100 + 0.02 * i * i }));
const UP = { btc4h: ramp(120, H4, 1), btc1d: ramp(60, D1, 1), coin4h: accel(120, H4), coin1d: ramp(40, D1, 1) };

describe('evaluateRegime (pura)', () => {
  test('tudo em alta → libera, com detalhes', () => {
    const r = evaluateRegime(UP, T0, DEFAULT_REGIME);
    expect(r.ok).toBe(true);
    expect(r.details.btcVsEma50Pct).toBeGreaterThan(0);
    expect(r.details.btcEma20_1dSlopePct).toBeGreaterThan(0);
  });
  test('BTC 4h em queda → barra pela EMA50', () => {
    const r = evaluateRegime({ ...UP, btc4h: ramp(120, H4, -0.5, 200) }, T0);
    expect(r).toMatchObject({ ok: false, reason: 'BTC 4h abaixo da EMA50' });
  });
  test('EMA20 1d do BTC caindo → período de baixa', () => {
    const r = evaluateRegime({ ...UP, btc1d: ramp(60, D1, -0.5, 200) }, T0);
    expect(r).toMatchObject({ ok: false, reason: 'período de baixa (EMA20 1d do BTC caindo)' });
  });
  test('moeda abaixo da EMA20 1d / MACD 4h negativo', () => {
    expect(evaluateRegime({ ...UP, coin1d: ramp(40, D1, -1, 200) }, T0).reason).toBe('moeda abaixo da EMA20 1d');
    expect(evaluateRegime({ ...UP, coin4h: Array.from({ length: 120 }, (_, i) => ({ openTime: T0 - (120 - i) * H4, close: 400 - 0.02 * i * i })) }, T0).reason).toBe('MACD 4h da moeda ≤ 0');
  });
  test('ignora candles ainda abertos no fechamento do sinal (sem olhar o futuro)', () => {
    // candle 4h do BTC que abriu ANTES de T0 mas fecha depois → não conta
    const open = { openTime: T0 - H4 / 2, close: 1 };
    expect(evaluateRegime({ ...UP, btc4h: [...UP.btc4h, open] }, T0).ok).toBe(true);
  });
  test('filtro desligado não é avaliado', () => {
    const cfg = { ...DEFAULT_REGIME, btcEma50_4h: false };
    expect(evaluateRegime({ ...UP, btc4h: ramp(120, H4, -0.5, 200) }, T0, cfg).ok).toBe(true);
  });
});

describe('checkMarketRegime — ranking top N altas 24h', () => {
  beforeEach(() => {
    fetchKlines.mockImplementation(async (sym, iv) => {
      if (sym === 'BTCUSDT') return iv === '4h' ? UP.btc4h : UP.btc1d;
      return iv === '4h' ? UP.coin4h : UP.coin1d;
    });
    const syms = Array.from({ length: 50 }, (_, i) => `C${i}USDT`);
    getActiveUsdtPairs.mockResolvedValue({ list: syms });
    getTickers.mockResolvedValue(syms.map((s, i) => ({ symbol: s, priceChangePercent: String(50 - i), quoteVolume: '5000000' })));
  });
  test('dentro das 40 → libera e grava a posição', async () => {
    const r = await checkMarketRegime('C3USDT', T0, DEFAULT_REGIME);
    expect(r.ok).toBe(true);
    expect(r.details.gainerRank).toBe(4);
  });
  test('fora das 40 → barra', async () => {
    const r = await checkMarketRegime('C45USDT', T0, DEFAULT_REGIME);
    expect(r).toMatchObject({ ok: false, reason: 'fora das 40 maiores altas 24h (#46)' });
  });
  test('erro de rede → não libera (fail-closed)', async () => {
    fetchKlines.mockRejectedValue(new Error('timeout'));
    const r = await checkMarketRegime('C1USDT', T0 + 1, DEFAULT_REGIME);
    expect(r.ok).toBe(false);
  });
});

describe('priceActionConfig', () => {
  test('padrão: alvo +15% / stop −30%, todos os filtros, top 40', () => {
    expect(DEFAULTS).toMatchObject({ targetPct: 15, stopPct: 30, regime: { btcEma50_4h: true, coinEma20_1d: true, coinMacd4h: true, btcEma20_1dRising: true, topGainers: 40 } });
    const c = buildConfig(DEFAULTS);
    expect(c.exit).toMatchObject({ targetPct: 15, minStopPct: 30 });
    expect(c.regime.topGainers).toBe(40);
  });
  test('normaliza: stop mínimo 10%, lixo vira padrão', () => {
    const c = normalizePriceActionConfig({ stopPct: 3, targetPct: 'x', regime: { topGainers: -5, coinMacd4h: false } });
    expect(c.stopPct).toBe(10);
    expect(c.targetPct).toBe(15);
    expect(c.regime.topGainers).toBe(0);
    expect(c.regime.coinMacd4h).toBe(false);
  });
});

describe('watcher no fechamento com close_condition.regime', () => {
  const OPEN_T = T0 - H4;
  let adapter;
  beforeEach(() => {
    jest.clearAllMocks();
    adapter = {
      marketBuy: jest.fn(async () => ({ filledQty: 1, quoteQty: 25, avgPrice: 100 })),
      placeExitBracket: jest.fn(async (qty, target, stop) => ({ targetPrice: target, stopPrice: stop })),
    };
    buildAdapter.mockReturnValue(adapter);
    sbReq.mockImplementation(async () => [{}]);
    jest.spyOn(Date, 'now').mockReturnValue(T0 + 60_000);
    fetchClosedCandle.mockResolvedValue({ open: 94, high: 101, low: 93, close: 100, prev: [] });
    const syms = ['XUSDT', 'YUSDT'];
    getActiveUsdtPairs.mockResolvedValue({ list: syms });
    getTickers.mockResolvedValue([{ symbol: 'XUSDT', priceChangePercent: '20', quoteVolume: '9000000' }, { symbol: 'YUSDT', priceChangePercent: '5', quoteVolume: '9000000' }]);
  });
  afterEach(() => jest.restoreAllMocks());
  const row = (rg) => ({
    id: 7, symbol: 'XUSDT', exchange: 'binance', usdt: 25, status: 'OPEN', entry_kind: 'candle_close',
    entry_price: 100, target_price: 115, stop_price: 70,
    close_condition: {
      interval: '4h', candleOpenTime: OPEN_T, closeAt: T0, source: 'bullish_breakout_auto',
      confirmBreakout: { lookback: 20 }, exit: { targetPct: 15, stopMode: 'candleMid', minStopPct: 30 }, regime: rg,
    },
  });

  test('mercado ok → compra e grava o regime no closeCheck; OCO +15% / −30%', async () => {
    fetchKlines.mockImplementation(async (sym, iv) => {
      if (sym === 'BTCUSDT') return iv === '4h' ? UP.btc4h : UP.btc1d;
      if (iv === '4h' && sym === 'XUSDT') return [...UP.coin4h, { openTime: OPEN_T }];
      return iv === '4h' ? UP.coin4h : UP.coin1d;
    });
    await processRow(row(DEFAULT_REGIME), () => {});
    expect(adapter.marketBuy).toHaveBeenCalledWith(25);
    const [, target, stop] = adapter.placeExitBracket.mock.calls[0];
    expect(target).toBeCloseTo(115);
    expect(stop).toBeCloseTo(70);
    const cc = sbReq.mock.calls.find(([m, , body]) => m === 'PATCH' && body?.close_condition?.closeCheck)[2].close_condition;
    expect(cc.closeCheck.regime).toMatchObject({ ok: true, gainerRank: 1 });
  });

  test('período de baixa → CLOSED sem comprar', async () => {
    fetchKlines.mockImplementation(async (sym, iv) => {
      if (sym === 'BTCUSDT') return iv === '4h' ? UP.btc4h : ramp(60, D1, -0.5, 200);
      if (iv === '4h' && sym === 'XUSDT') return [...UP.coin4h, { openTime: OPEN_T }];
      return iv === '4h' ? UP.coin4h : UP.coin1d;
    });
    await processRow(row(DEFAULT_REGIME), () => {});
    expect(adapter.marketBuy).not.toHaveBeenCalled();
    const p = sbReq.mock.calls.find(([m, , body]) => m === 'PATCH' && body?.status === 'CLOSED')[2];
    expect(p.error).toMatch(/filtro de mercado barrou: período de baixa/);
  });
});
