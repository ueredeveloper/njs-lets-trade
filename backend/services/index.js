
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
const fetchMaFilter        = require('./fetchMaFilter')
const fetchRsiOversoldRecovery = require('./fetchRsiOversoldRecovery')
const fetchReloadCandles       = require('./fetchReloadCandles')
const fetchGateCurrencies      = require('./fetchGateCurrencies')
const fetchGatePrefetch        = require('./fetchGatePrefetch')
const fetchBinanceTrades       = require('./fetchBinanceTrades')
const fetchGateTrades          = require('./fetchGateTrades')
const fetchActiveTrades        = require('./fetchActiveTrades')
const stgBotStatus             = require('./stgBotStatus')
const multitradeService        = require('./multitradeService')

// remove cíclical error
module.exports = {
    fetchCandles, fetchIchimokuCloud, fetchAllCurrencies,
    fetchSMA, fetchRSI, fetchVWAP, fetch24HsVolume, fetchMarketCapFilter, fetchStablecoins,
    fetchIndicatorSearch, fetchMaFilter, fetchRsiOversoldRecovery, fetchReloadCandles,
    fetchGateCurrencies, fetchGatePrefetch, fetchBinanceTrades, fetchGateTrades, fetchActiveTrades,
    stgBotStatus, multitradeService }


