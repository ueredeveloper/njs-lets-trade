
// services/index.js
const fetchCandles = require('./fetchCandles');
const fetchIchimokuCloud = require('./fetchIchimokuCloud');
const fetchAllCurrencies = require('./fetchAllCurrencies');
const fetchSMA = require('./fetchSMA');
const fetchRSI = require('./fetchRSI');
const fetchVWAP = require('./fetchVWAP');
const fetchLowestIndex = require('./fetchLowestIndex')

// remove cíclical error
module.exports = { fetchCandles, fetchIchimokuCloud, fetchAllCurrencies, fetchSMA, fetchRSI, fetchVWAP, fetchLowestIndex }


