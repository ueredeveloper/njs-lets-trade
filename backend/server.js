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
  fetchSMA, fetchRSI, fetchVWAP, fetch24HsVolume, fetchMarketCapFilter, fetchStablecoins, fetchIndicatorSearch, fetchMaFilter, fetchMaTimeAboveFilter,
  fetchRsiOversoldRecovery, fetchReloadCandles,
  fetchGateCurrencies, fetchGatePrefetch, fetchBinanceTrades, fetchGateTrades,
  fetchActiveTrades, stgBotStatus, multitradeService } = require('./services');
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
app.use('/services', fetchMarketCapFilter)
app.use('/services', fetchStablecoins)
app.use('/services', fetchIndicatorSearch)
app.use('/services', fetchMaFilter)
app.use('/services', fetchMaTimeAboveFilter)
app.use('/services', fetchRsiOversoldRecovery)
app.use('/services', fetchReloadCandles)
app.use('/services', fetchGateCurrencies)
app.use('/services', fetchGatePrefetch)
app.use('/services', fetchBinanceTrades)
app.use('/services', fetchGateTrades)
app.use('/services', fetchActiveTrades)
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

  app.listen(PORT, () => {
    const boot = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`Server is running on port ${PORT} (pronto em ${boot}s)`);
  });

  // Warmup em background — só entradas com TTL expirado
  console.log(`[rsiCache] intervalos: ${RSI_INTERVALS.join(', ')} | tick ${RSI_TICK_MS / 60_000}min`);
  refreshRsiCache().catch(e => console.error('[rsiCache] erro no warmup:', e.message));

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