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
  fetchSMA, fetchRSI, fetchVWAP, fetchLowestIndex,
  fetchHighLowVariation, fetch24HsVolume } = require('./services');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const router = express.Router();

app.use('/services', fetchCandles);
app.use('/services', fetchIchimokuCloud);
app.use('/services', fetchAllCurrencies);
app.use('/services', fetchSMA);
app.use('/services', fetchRSI);
app.use('/services', fetchVWAP);
app.use('/services', fetchLowestIndex)
app.use('/services', fetchHighLowVariation)
app.use('/services', fetch24HsVolume)

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


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});