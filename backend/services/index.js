
// services/index.js
const fetchCandles = require('./fetchCandles');
const fetchIchimokuCloud = require('./fetchIchimokuCloud');
const fetchAllCurrencies = require('./fetchAllCurrencies');
const fetchSMA = require('./fetchSMA');
const fetchRSI = require('./fetchRSI');
const fetchVWAP = require('./fetchVWAP');

// remove cíclical error
module.exports = { fetchCandles, fetchIchimokuCloud, fetchAllCurrencies, fetchSMA, fetchRSI, fetchVWAP }


