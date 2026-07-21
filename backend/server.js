// Impede que unhandled promise rejections (ex: async handlers sem try-catch) matem o processo.
// Express 4 não captura erros assíncronos automaticamente; sem este handler o Node.js 15+ encerra
// o processo e gera ECONNRESET em todas as conexões abertas.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

// Para rodar: `npm start` na raiz (Vite+backend no PC; bundle no Termux).
// Dev com HMR: `npm run start:dev`  |  Só bundle: `npm run start:bundle`
// Só backend: `npm run backend`

const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const httpProxy = require('http-proxy');
const { ichimokuCloudRouter } = require('./technicals-indicators');

//const {client} = require('./services/fetchClient');
const {
  fetchCandles, fetchIchimokuCloud, fetchAllCurrencies,
  fetchSMA, fetchRSI, fetchVWAP, fetch24HsVolume, fetchMarketCapFilter, fetchStablecoins, fetchIndicatorSearch, fetchMaFilter, fetchMaTimeAboveFilter, fetchMaCrossoverFilter, fetchMaCompareFilter, fetchMaDistanceFilter,
  fetchRsiOversoldRecovery, fetchMaCrossStats, fetchBollingerBandRecovery, fetchBollingerBandPositionFilter, fetchBollingerBands, fetchSimpleMaCross, fetchReloadCandles,
  fetchGateCurrencies, fetchGatePrefetch, fetchBinanceTrades, fetchGateTrades,
  fetchActiveTrades, fetchTradeFavorites, stgBotStatus, multitradeService, fetchMarketHighlights } = require('./services');
const supabaseService = require('./services/supabaseService');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const router = express.Router();

app.use('/services', fetchCandles);
app.use('/services', fetchIchimokuCloud);
app.use('/services', fetchAllCurrencies);
app.use('/services', fetchSMA);
app.use('/services', fetchRSI);
app.use('/services', fetchVWAP);
app.use('/services', fetch24HsVolume)
app.use('/services', fetchMarketHighlights)
app.use('/services', fetchMarketCapFilter)
app.use('/services', fetchStablecoins)
app.use('/services', fetchIndicatorSearch)
app.use('/services', fetchMaFilter)
app.use('/services', fetchMaTimeAboveFilter)
app.use('/services', fetchMaCrossoverFilter)
app.use('/services', fetchMaCompareFilter)
app.use('/services', fetchMaDistanceFilter)
app.use('/services', fetchRsiOversoldRecovery)
app.use('/services', fetchMaCrossStats)
app.use('/services', fetchBollingerBandRecovery)
app.use('/services', fetchBollingerBandPositionFilter)
app.use('/services', fetchBollingerBands)
app.use('/services', fetchSimpleMaCross)
app.use('/services', fetchReloadCandles)
app.use('/services', fetchGateCurrencies)
app.use('/services', fetchGatePrefetch)
app.use('/services', fetchBinanceTrades)
app.use('/services', fetchGateTrades)
app.use('/services', fetchActiveTrades)
app.use('/services', fetchTradeFavorites)
app.use('/services', stgBotStatus)
app.use('/services', multitradeService)
app.use('/services/sb', supabaseService)

// Frontend: bundle estático (Termux / produção) ou proxy para dev server (Vite / Parcel).
const BUNDLE_DIR = path.join(__dirname, '../frontend-react/dist');
const bundleIndex = path.join(BUNDLE_DIR, 'index.html');
const onTermux = !!process.env.TERMUX_VERSION;
const serveBundle =
  fs.existsSync(bundleIndex) &&
  (process.env.SERVE_BUNDLE === '1' || onTermux);

const FRONTEND_PORT = process.env.FRONTEND_PORT;
if (serveBundle) {
  app.use(express.static(BUNDLE_DIR, {
    setHeaders(res, filePath) {
      if (filePath.replace(/\\/g, '/').endsWith('/index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/services')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(bundleIndex);
  });
  console.log(`[frontend] bundle estático em ${BUNDLE_DIR}`);
} else if (FRONTEND_PORT) {
  const proxy = httpProxy.createProxyServer();
  app.use('/', (req, res) => {
    proxy.web(req, res, { target: `http://localhost:${FRONTEND_PORT}` });
  });
} else {
  const VITE_PORT = process.env.VITE_PORT || 5173;
  app.use('/', (req, res) => {
    res.redirect(`http://localhost:${VITE_PORT}${req.path}`);
  });
}


// RSI cache: carrega do disco, sobe o servidor, depois aquece em background
const rsiCache = require('./cache/rsiCache');
const { getActiveUsdtPairs } = require('./binance/getActiveUsdtPairs');

const RSI_INTERVALS = ['15m', '1h', '4h'];
const RSI_TICK_MS   = 2 * 60 * 1000; // verifica a cada 2 min; TTL por intervalo decide o que buscar
const PORT = process.env.BACKEND_PORT || process.env.SERVER_PORT || 3000;

async function refreshRsiCache() {
  const t0 = Date.now();
  const { list: symbols } = await getActiveUsdtPairs();
  if (!Array.isArray(symbols) || symbols.length === 0) return;
  const stats = await rsiCache.warmup(symbols, RSI_INTERVALS);
  if (stats.refreshed > 0 || stats.purged > 0) {
    await rsiCache.saveToDisk();
  }
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  if (stats.refreshed > 0) {
    console.log(`[rsiCache] ciclo em ${total}s`);
  }
}

async function startServer() {
  const t0 = Date.now();
  console.log('[rsiCache] carregando cache do disco...');
  await rsiCache.loadFromDisk();
  const maTimeAboveCache = require('./cache/maTimeAboveCache');
  await maTimeAboveCache.loadFromDisk();
  const maCrossCache = require('./cache/maCrossCache');
  await maCrossCache.loadFromDisk();
  const maCompareCache = require('./cache/maCompareCache');
  await maCompareCache.loadFromDisk();
  const bbPositionCache = require('./cache/bbPositionCache');
  await bbPositionCache.loadFromDisk();
  const maDistanceCache = require('./cache/maDistanceCache');
  await maDistanceCache.loadFromDisk();

  app.listen(PORT, () => {
    const boot = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`Server is running on port ${PORT} (pronto em ${boot}s)`);
  });

  // Warmup em background — só entradas com TTL expirado
  console.log(`[rsiCache] intervalos: ${RSI_INTERVALS.join(', ')} | tick ${RSI_TICK_MS / 60_000}min`);
  refreshRsiCache().catch(e => console.error('[rsiCache] erro no warmup:', e.message));

  async function refreshMaCrossCache() {
    try {
      const { list: symbols } = await getActiveUsdtPairs();
      if (!Array.isArray(symbols) || symbols.length === 0) return;
      const stats = await maCrossCache.refreshAll(symbols);
      if (stats.computed > 0) {
        await maCrossCache.saveToDisk();
        const m = stats.matched ?? {};
        console.log(
          `[maCrossCache] 4h cruzou:${m['4h|last'] ?? 0} 4h prox:${m['4h|nearup'] ?? 0}`
          + ` | disco:${stats.diskHits ?? 0} stale:${stats.diskStale ?? 0} api:${stats.apiFetches ?? 0}`
          + ` | fila:${stats.queuePending ?? 0}`,
        );
      }
    } catch (e) {
      console.error('[maCrossCache] erro no refresh:', e.message);
    }
  }

  refreshMaCrossCache().catch(e => console.error('[maCrossCache] erro no warmup:', e.message));
  setInterval(refreshMaCrossCache, maCrossCache.REFRESH_TICK_MS);

  async function refreshMaCompareCache() {
    try {
      const { list: symbols } = await getActiveUsdtPairs();
      if (!Array.isArray(symbols) || symbols.length === 0) return;
      const stats = await maCompareCache.refreshAll(symbols);
      if (stats.computed > 0) {
        await maCompareCache.saveToDisk();
        const m = stats.matched ?? {};
        console.log(
          `[maCompareCache] 4h↑:${m['4h|9|21|acim|0.5'] ?? 0} 4h↓:${m['4h|9|21|abaix|0.5'] ?? 0}`
          + ` prox↑:${m['4h|9|21|nearup|0.5'] ?? 0} prox↓:${m['4h|9|21|neardn|0.5'] ?? 0}`
          + ` | disco:${stats.diskHits ?? 0} stale:${stats.diskStale ?? 0} api:${stats.apiFetches ?? 0}`
          + ` | fila:${stats.queuePending ?? 0}`,
        );
      }
    } catch (e) {
      console.error('[maCompareCache] erro no refresh:', e.message);
    }
  }

  refreshMaCompareCache().catch(e => console.error('[maCompareCache] erro no warmup:', e.message));
  setInterval(refreshMaCompareCache, maCompareCache.REFRESH_TICK_MS);

  async function refreshBbPositionCache() {
    try {
      const { list: symbols } = await getActiveUsdtPairs();
      if (!Array.isArray(symbols) || symbols.length === 0) return;
      const stats = await bbPositionCache.refreshAll(symbols);
      if (stats.computed > 0) {
        const m = stats.matched ?? {};
        console.log(
          `[bbPositionCache] fundo:${m['4h|20|2|bot|20'] ?? 0} topo:${m['4h|20|2|top|20'] ?? 0}`
          + ` | disco:${stats.diskHits ?? 0} stale:${stats.diskStale ?? 0} api:${stats.apiFetches ?? 0}`
          + ` | fila:${stats.queuePending ?? 0}`,
        );
      }
    } catch (e) {
      console.error('[bbPositionCache] erro no refresh:', e.message);
    }
  }

  refreshBbPositionCache().catch(e => console.error('[bbPositionCache] erro no warmup:', e.message));
  setInterval(refreshBbPositionCache, bbPositionCache.REFRESH_TICK_MS);

  async function refreshMaDistanceCache() {
    try {
      const { list: symbols } = await getActiveUsdtPairs();
      if (!Array.isArray(symbols) || symbols.length === 0) return;
      const stats = await maDistanceCache.refreshAll(symbols);
      if (stats.computed > 0) {
        const m = stats.matched ?? {};
        console.log(
          `[maDistanceCache] 21↑:${m['4h|21|acim'] ?? 0} 21↓:${m['4h|21|abaix'] ?? 0}`
          + ` 50↑:${m['4h|50|acim'] ?? 0} 50↓:${m['4h|50|abaix'] ?? 0}`
          + ` | disco:${stats.diskHits ?? 0} stale:${stats.diskStale ?? 0} api:${stats.apiFetches ?? 0}`
          + ` | fila:${stats.queuePending ?? 0}`,
        );
      }
    } catch (e) {
      console.error('[maDistanceCache] erro no refresh:', e.message);
    }
  }

  refreshMaDistanceCache().catch(e => console.error('[maDistanceCache] erro no warmup:', e.message));
  setInterval(refreshMaDistanceCache, maDistanceCache.REFRESH_TICK_MS);

  const candleDiskWarmup = require('./utils/candleDiskWarmup');
  const CANDLE_WARMUP_TICK_MS = 60_000;

  async function refreshCandleDisk() {
    try {
      const { list: symbols } = await getActiveUsdtPairs();
      if (!Array.isArray(symbols) || symbols.length === 0) return;
      const stats = await candleDiskWarmup.runWarmupCycle(symbols);
      if (stats.refreshed > 0) {
        const i1 = stats.byInterval['1m']?.refreshed ?? 0;
        const i5 = stats.byInterval['5m']?.refreshed ?? 0;
        console.log(`[candleWarmup] 1m:${i1} 5m:${i5} atualizados | falhas:${stats.failed}`);
      }
    } catch (e) {
      console.error('[candleWarmup] erro:', e.message);
    }
  }

  console.log(`[candleWarmup] intervalos: ${candleDiskWarmup.WARMUP_INTERVALS.join(', ')} | tick 1min`);
  refreshCandleDisk().catch(e => console.error('[candleWarmup] erro no warmup:', e.message));
  setInterval(refreshCandleDisk, CANDLE_WARMUP_TICK_MS);

  // Tick leve — só busca na API quando o TTL do intervalo expirou (15m/1h/4h)
  setInterval(async () => {
    try {
      await refreshRsiCache();
    } catch (e) {
      console.error('[rsiCache] erro no refresh:', e.message);
    }
  }, RSI_TICK_MS);
}

startServer();