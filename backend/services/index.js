
// services/index.js
const fetchCandles = require('./fetchCandles');
const fetchIchimokuCloud = require('./fetchIchimokuCloud');
const fetchAllCurrencies = require('./fetchAllCurrencies');
const fetchSMA = require('./fetchSMA');
const fetchRSI = require('./fetchRSI');
const fetchVWAP = require('./fetchVWAP');
const fetch24HsVolume = require('./fetch24hsVolume')
const fetchMarketCapFilter = require('./fetchMarketCapFilter')
const fetchStablecoins     = require('./fetchStablecoins')
const fetchIndicatorSearch = require('./fetchIndicatorSearch')
const fetchRsiOversoldRecovery = require('./fetchRsiOversoldRecovery')
const fetchReloadCandles       = require('./fetchReloadCandles')
const fetchFavorites           = require('./fetchFavorites')
const fetchGateCurrencies      = require('./fetchGateCurrencies')
const fetchGatePrefetch        = require('./fetchGatePrefetch')

// remove cíclical error
module.exports = {
    fetchCandles, fetchIchimokuCloud, fetchAllCurrencies,
    fetchSMA, fetchRSI, fetchVWAP, fetch24HsVolume, fetchMarketCapFilter, fetchStablecoins,
    fetchIndicatorSearch, fetchRsiOversoldRecovery, fetchReloadCandles, fetchFavorites,
    fetchGateCurrencies, fetchGatePrefetch }


