
// services/index.js
const fetchCandles = require('./fetchCandles');
const fetchIchimokuCloud = require('./fetchIchimokuCloud');
const fetchAllCurrencies = require('./fetchAllCurrencies');
const fetchSMA = require('./fetchSMA');
const fetchRSI = require('./fetchRSI');
const fetchVWAP = require('./fetchVWAP');
const fetchLowestIndex = require('./fetchLowestIndex');
const fetchHighLowVariation = require('./fetchHighLowVariation')
const fetch24HsVolume = require('./fetch24hsVolume')
const fetchIndicatorSearch = require('./fetchIndicatorSearch')

// remove cíclical error
module.exports = {
    fetchCandles, fetchIchimokuCloud, fetchAllCurrencies,
    fetchSMA, fetchRSI, fetchVWAP, fetchLowestIndex, fetchHighLowVariation, fetch24HsVolume,
    fetchIndicatorSearch }


