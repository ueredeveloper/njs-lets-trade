// Impede que unhandled promise rejections (ex: async handlers sem try-catch) matem o processo.
// Express 4 não captura erros assíncronos automaticamente; sem este handler o Node.js 15+ encerra
// o processo e gera ECONNRESET em todas as conexões abertas.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

// Para rodar: `npm start` na raiz do projeto.
// Isso executa `node start.js`, que sobe este servidor (porta 3000) e o Vite (porta 5173) juntos.
// Para rodar só o backend: `npm run backend`

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
  fetchSMA, fetchRSI, fetchVWAP, fetch24HsVolume, fetchMarketCapFilter, fetchStablecoins, fetchIndicatorSearch,
  fetchRsiOversoldRecovery, fetchReloadCandles,
  fetchGateCurrencies, fetchGatePrefetch, fetchBinanceTrades, fetchGateTrades } = require('./services');
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
app.use('/services', fetchRsiOversoldRecovery)
app.use('/services', fetchReloadCandles)
app.use('/services', fetchGateCurrencies)
app.use('/services', fetchGatePrefetch)
app.use('/services', fetchBinanceTrades)
app.use('/services', fetchGateTrades)
app.use('/services/sb', supabaseService)

// Proxy para o frontend (só necessário no modo Parcel legado).
// No modo Vite, o próprio Vite faz proxy /services → Express, então não é preciso.
const FRONTEND_PORT = process.env.FRONTEND_PORT;
if (FRONTEND_PORT) {
  const proxy = httpProxy.createProxyServer();
  app.use('/', (req, res) => {
    proxy.web(req, res, { target: `http://localhost:${FRONTEND_PORT}` });
  });
} else {
  // Modo React/Vite: redireciona quem acessar o Express diretamente para o Vite
  const VITE_PORT = process.env.VITE_PORT || 5173;
  app.use('/', (req, res) => {
    res.redirect(`http://localhost:${VITE_PORT}${req.path}`);
  });
}


// RSI cache: carrega do disco, sobe o servidor, depois aquece em background
const rsiCache = require('./cache/rsiCache');
const { getActiveUsdtPairs } = require('./binance/getActiveUsdtPairs');

const RSI_INTERVALS = ['1h', '2h', '4h', '8h', '1d'];
const PORT = process.env.PORT || 3000;

async function refreshRsiCache() {
  const t0 = Date.now();
  const { list: symbols } = await getActiveUsdtPairs();
  console.log(`[rsiCache] iniciando warmup — ${symbols.length} símbolos × ${RSI_INTERVALS.length} intervalos`);
  await rsiCache.warmup(symbols, RSI_INTERVALS);
  await rsiCache.saveToDisk();
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[rsiCache] ciclo completo em ${total}s`);
}

async function startServer() {
  const t0 = Date.now();
  console.log('[rsiCache] carregando cache do disco...');
  await rsiCache.loadFromDisk();

  app.listen(PORT, () => {
    const boot = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`Server is running on port ${PORT} (pronto em ${boot}s)`);
  });

  // Warmup em background — atualiza entradas desatualizadas
  refreshRsiCache().catch(e => console.error('[rsiCache] erro no warmup:', e.message));

  // Refresh a cada 5 minutos
  setInterval(async () => {
    try {
      await refreshRsiCache();
    } catch (e) {
      console.error('[rsiCache] erro no refresh:', e.message);
    }
  }, 5 * 60 * 1000);
}

startServer();