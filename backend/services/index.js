
// services/index.js
const fetchCandles = require('./fetchCandles');
const fetchIchimokuCloud = require('./fetchIchimokuCloud');
const fetchSupportResistance = require('./fetchSupportResistance');
const fetchPivotPointsHighLow = require('./fetchPivotPointsHighLow');
const fetchAllCurrencies = require('./fetchAllCurrencies');
const fetchSMA = require('./fetchSMA');
const fetchRSI = require('./fetchRSI');
const fetchChopZone = require('./fetchChopZone');
const fetchVWAP = require('./fetchVWAP');
const fetch24HsVolume = require('./fetch24hsVolume')
const fetchMarketCapFilter = require('./fetchMarketCapFilter')
const fetchStablecoins     = require('./fetchStablecoins')
const fetchIndicatorSearch = require('./fetchIndicatorSearch')
const fetchMaFilter        = require('./fetchMaFilter')
const fetchMaTimeAboveFilter = require('./fetchMaTimeAboveFilter')
const fetchMaCrossoverFilter = require('./fetchMaCrossoverFilter')
const fetchMaCompareFilter   = require('./fetchMaCompareFilter')
const fetchMaDistanceFilter  = require('./fetchMaDistanceFilter')
const fetchIndicatorGrowthFilter = require('./fetchIndicatorGrowthFilter')
const fetchRsiOversoldRecovery = require('./fetchRsiOversoldRecovery')
const fetchMaCrossStats          = require('./fetchMaCrossStats')
const fetchVwapBandsStats        = require('./fetchVwapBandsStats')
const fetchBollingerBandRecovery = require('./fetchBollingerBandRecovery')
const fetchBollingerBandPositionFilter = require('./fetchBollingerBandPositionFilter')
const fetchVwapPositionFilter = require('./fetchVwapPositionFilter')
const fetchVwapBandWidthFilter = require('./fetchVwapBandWidthFilter')
const fetchBollingerBandWidthFilter = require('./fetchBollingerBandWidthFilter')
const fetchBollingerMedianTrendFilter = require('./fetchBollingerMedianTrendFilter')
const fetchVwapBandExpansionFilter = require('./fetchVwapBandExpansionFilter')
const fetchBollingerBands             = require('./fetchBollingerBands')
const fetchSimpleMaCross       = require('./fetchSimpleMaCross')
const fetchReloadCandles       = require('./fetchReloadCandles')
const fetchGateCurrencies      = require('./fetchGateCurrencies')
const fetchGatePrefetch        = require('./fetchGatePrefetch')
const fetchBinanceTrades       = require('./fetchBinanceTrades')
const fetchGateTrades          = require('./fetchGateTrades')
const fetchActiveTrades        = require('./fetchActiveTrades')
const fetchTradeFavorites      = require('./fetchTradeFavorites')
const stgBotStatus             = require('./stgBotStatus')
const multitradeService        = require('./multitradeService')
const fetchMarketHighlights    = require('./fetchMarketHighlights')
const fetchVolumeIgnition      = require('./fetchVolumeIgnition')
const whatsappMessagesService  = require('./whatsapp-messages/whatsappMessagesService')
const fetchCacheSettings       = require('./fetchCacheSettings')

// remove cíclical error
module.exports = {
    fetchCandles, fetchIchimokuCloud, fetchSupportResistance, fetchPivotPointsHighLow, fetchAllCurrencies,
    fetchSMA, fetchRSI, fetchChopZone, fetchVWAP, fetch24HsVolume, fetchMarketCapFilter, fetchStablecoins,
    fetchIndicatorSearch, fetchMaFilter, fetchMaTimeAboveFilter, fetchMaCrossoverFilter, fetchMaCompareFilter, fetchMaDistanceFilter, fetchIndicatorGrowthFilter, fetchRsiOversoldRecovery, fetchMaCrossStats, fetchVwapBandsStats, fetchBollingerBandRecovery, fetchBollingerBandPositionFilter, fetchVwapPositionFilter, fetchVwapBandWidthFilter, fetchBollingerBandWidthFilter, fetchBollingerMedianTrendFilter, fetchVwapBandExpansionFilter, fetchBollingerBands, fetchSimpleMaCross, fetchReloadCandles,
    fetchGateCurrencies, fetchGatePrefetch, fetchBinanceTrades, fetchGateTrades, fetchActiveTrades,
    fetchTradeFavorites, stgBotStatus, multitradeService, fetchMarketHighlights, fetchVolumeIgnition, whatsappMessagesService, fetchCacheSettings }


