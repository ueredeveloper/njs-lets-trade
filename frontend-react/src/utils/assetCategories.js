/**
 * Classificação de pares spot em categorias especiais (espelho de backend/utils/assetCategories.js).
 */

const STABLE_BASES = new Set([
  'USDC', 'DAI', 'TUSD', 'FDUSD', 'PYUSD', 'USDS', 'USDB', 'USDP', 'FRAX', 'LUSD',
  'USDD', 'BUSD', 'SUSD', 'GUSD', 'OUSD', 'USD1', 'WUSDT', 'BFUSD', 'USDE',
  'CRVUSD', 'DOLA', 'STUSD', 'CUSD', 'USDX', 'USDT', 'USTC', 'UST',
  'EURT', 'EURS', 'EURC', 'AEUR', 'EURI', 'AGEUR', 'XEUR', 'EUR',
  'XAUT', 'PAXG', 'CACHE', 'GOLD',
  'GYEN', 'JPYC', 'BIDR', 'XSGD', 'IDRT', 'BVND', 'BRLA', 'BRLC', 'TRYB', 'CNHT', 'GBPT',
  'NEXO', 'FXS',
]);

const WRAPPED_BASES = new Set([
  'WBTC', 'WETH', 'WBNB', 'WMATIC', 'WAVAX', 'WFTM', 'WCRO', 'WXRP', 'WLUNC',
  'WTRX', 'WBCH', 'WCELO', 'WONE', 'WSOL', 'WNEAR', 'WDOT', 'WGLMR', 'WROSE',
  'WCFG', 'WXTZ', 'WALGO', 'WATOM', 'WOSMO', 'WSEI', 'WTON', 'WSUI', 'WAPT',
  'WBETH', 'BETH', 'BNSOL', 'RENBTC', 'HBTC', 'TBTC', 'SBTC',
  'BTCB', 'ETH2', 'ANYBTC', 'ANYETH',
]);

const LIQUID_STAKING_BASES = new Set([
  'STETH', 'CBETH', 'RETH', 'MSOL', 'STSOL', 'BSOL', 'ANKRETH', 'SWETH', 'OETH',
  'OSETH', 'SFRXETH', 'FRXETH', 'LSETH', 'ETHX', 'CMETH', 'METH', 'WEETH',
  'EZETH', 'PUFETH', 'RSETH', 'ETHW', 'BETH', 'WBETH', 'JITOSOL', 'BNSOL',
  'STSOL', 'SCNSOL', 'HSOL', 'JSOL', 'DSOL',
]);

const SYNTHETIC_BASES = new Set([
  'SUSD', 'SETH', 'SBTC', 'SXAU', 'SXAG', 'SEUR', 'SGBP', 'SAUD', 'SCNH',
  'SJPY', 'SKRW', 'STRX', 'SBNB', 'SDOT', 'SADA', 'SAVAX', 'SMATIC',
  'SNEAR', 'SFTM', 'SATOM', 'SUNI', 'SLINK', 'SAAVE', 'SCRV', 'SYFI',
  'PERP', 'DYDX', 'GMX', 'GNS',
]);

const LEVERAGED_LONG_BASES = new Set([
  'BTCUP', 'ETHUP', 'BNBUP', 'ADAUP', 'LINKUP', 'XRPUP', 'DOTUP', 'LTCUP',
  'BCHUP', 'EOSUP', 'TRXUP', 'XLMUP', 'ETCUP', 'FILUP', 'UNIUP', 'SUSHIUP',
  'AAVEUP', 'DOGEUP', 'MATICUP', 'SOLUP', 'AVAXUP', 'FTMUP', 'ATOMUP',
  'NEARUP', 'ALGOUP', 'VETUP', 'ICPUP', 'AXSUP', 'SANDUP', 'MANAUP',
  '1INCHUP', 'CRVUP', 'MKRUP', 'COMPUP', 'SNXUP', 'YFIUP', 'BALUP',
]);

const LEVERAGED_SHORT_BASES = new Set([
  'BTCDOWN', 'ETHDOWN', 'BNBDOWN', 'ADADOWN', 'LINKDOWN', 'XRPDOWN', 'DOTDOWN',
  'LTCDOWN', 'BCHDOWN', 'EOSDOWN', 'TRXDOWN', 'XLMDOWN', 'ETCDOWN', 'FILDOWN',
  'UNIDOWN', 'SUSHIDOWN', 'AAVEDOWN', 'DOGEDOWN', 'MATICDOWN', 'SOLDOWN',
  'AVAXDOWN', 'FTMDOWN', 'ATOMDOWN', 'NEARDOWN', 'ALGODOWN', 'VETDOWN',
  'ICPDOWN', 'AXSDOWN', 'SANDDOWN', 'MANADOWN',
]);

const W_PREFIX_NOT_WRAPPED = new Set([
  'WIN', 'WAXP', 'WOO', 'WLD', 'WIF', 'WING', 'WAVES', 'WEMIX', 'WAL', 'WCT',
  'W', 'WELL', 'WEN', 'WHITE', 'WMTX', 'WOM', 'WRX', 'WTC', 'WAN', 'WABI',
]);

/** Tickers spot que parecem LP token mas não são (ex.: SLP = Smooth Love Potion). */
const NOT_LP_BASES = new Set(['SLP']);

export const ASSET_CATEGORY_KEYS = [
  'stablecoins',
  'leveragedLong',
  'leveragedShort',
  'wrapped',
  'liquidStaking',
  'lpTokens',
  'synthetic',
];

export const DEFAULT_ASSET_DISPLAY = Object.fromEntries(
  ASSET_CATEGORY_KEYS.map((k) => [k, false]),
);

export const STORAGE_KEY = 'lets_trade_asset_display';

function extractBase(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s.endsWith('USDT')) return s.slice(0, -4);
  if (s.endsWith('BUSD')) return s.slice(0, -4);
  if (s.endsWith('USDC')) return s.slice(0, -4);
  if (s.endsWith('BTC')) return s.slice(0, -3);
  if (s.endsWith('BNB')) return s.slice(0, -3);
  if (s.endsWith('ETH')) return s.slice(0, -3);
  return s;
}

function isLeveragedLong(base) {
  if (LEVERAGED_LONG_BASES.has(base)) return true;
  if (/\d+L$/.test(base)) return true;
  if (/BULL$/i.test(base)) return true;
  if (base.endsWith('UP') && base.length > 3 && !W_PREFIX_NOT_WRAPPED.has(base)) {
    const stem = base.slice(0, -2);
    if (stem.length >= 2 && stem.length <= 8) return true;
  }
  return false;
}

function isLeveragedShort(base) {
  if (LEVERAGED_SHORT_BASES.has(base)) return true;
  if (/\d+S$/.test(base)) return true;
  if (/BEAR$/i.test(base)) return true;
  if (base.endsWith('DOWN') && base.length > 4) return true;
  return false;
}

function isWrapped(base) {
  if (WRAPPED_BASES.has(base)) return true;
  if (base.startsWith('W') && base.length > 1 && !W_PREFIX_NOT_WRAPPED.has(base)) {
    if (WRAPPED_BASES.has(base) || /^W(BTC|ETH|BNB|SOL|AVAX|MATIC|DOT|ATOM|TRX|XRP|LUNC|NEAR|FTM|CRO|BCH|CELO|ONE|OSMO|SEI|TON|SUI|APT)/.test(base)) {
      return true;
    }
  }
  if (/^(BTCB|BETH|ANYBTC|ANYETH|BRIDGED|BSC-)/i.test(base)) return true;
  return false;
}

function isLiquidStaking(base) {
  if (LIQUID_STAKING_BASES.has(base)) return true;
  if (/^(ST|CB|R|WST|SFRX|FRX|LS|EZ|PUF|RS)/i.test(base) && /ETH$/i.test(base)) return true;
  if (/SOL$/.test(base) && /^(MS|ST|BS|JITO|BN|SCN|H|J|D)/i.test(base) && base.length > 4) return true;
  return false;
}

function isLpToken(base) {
  if (NOT_LP_BASES.has(base)) return false;
  if (/LP$/i.test(base)) return true;
  if (/-LP$/i.test(base)) return true;
  if (/^LP-/i.test(base)) return true;
  if (/UNI-V\d/i.test(base)) return true;
  if (/CAKE-LP/i.test(base)) return true;
  if (/BPT$/i.test(base)) return true;
  if (base.length > 3 && /SLP$/i.test(base)) return true;
  if (/XLP$/i.test(base)) return true;
  return false;
}

function isSynthetic(base) {
  return SYNTHETIC_BASES.has(base);
}

function isStablecoin(base) {
  return STABLE_BASES.has(base);
}

export function getSymbolCategories(symbol) {
  const base = extractBase(symbol);
  const categories = [];

  if (isStablecoin(base)) categories.push('stablecoins');
  if (isLeveragedLong(base)) categories.push('leveragedLong');
  if (isLeveragedShort(base)) categories.push('leveragedShort');
  if (isWrapped(base)) categories.push('wrapped');
  if (isLiquidStaking(base)) categories.push('liquidStaking');
  if (isLpToken(base)) categories.push('lpTokens');
  if (isSynthetic(base)) categories.push('synthetic');

  return categories;
}

export function isSymbolVisible(symbol, assetDisplay = DEFAULT_ASSET_DISPLAY) {
  const categories = getSymbolCategories(symbol);
  if (categories.length === 0) return true;
  return categories.every((cat) => assetDisplay[cat] === true);
}

export function filterSymbols(symbols, assetDisplay = DEFAULT_ASSET_DISPLAY) {
  return symbols.filter((sym) => isSymbolVisible(sym, assetDisplay));
}

export function filterCurrencies(list, assetDisplay = DEFAULT_ASSET_DISPLAY) {
  return list.filter((c) => isSymbolVisible(c.symbol, assetDisplay));
}

export function loadAssetDisplay() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ASSET_DISPLAY };
    const parsed = JSON.parse(raw);
    const result = { ...DEFAULT_ASSET_DISPLAY };
    for (const key of ASSET_CATEGORY_KEYS) {
      if (typeof parsed[key] === 'boolean') result[key] = parsed[key];
    }
    return result;
  } catch {
    return { ...DEFAULT_ASSET_DISPLAY };
  }
}

export function saveAssetDisplay(assetDisplay) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assetDisplay));
}
