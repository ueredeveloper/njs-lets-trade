
// model/currency-model.js
const CurrencyModel = {
  currencies: [],
  filters: [
    {
      name: '1h|Binance|USDT',
      // Lista atualizada em 30/08/2024
      list: [
        "1000SATSUSDT",
        "1INCHUSDT",
        "AAVEUSDT",
        "ACAUSDT",
        "ACEUSDT",
        "ACHUSDT",
        "ACMUSDT",
        "ADAUSDT",
        "ADXUSDT",
        "AERGOUSDT",
        "AEURUSDT",
        "AEVOUSDT",
        "AGLDUSDT",
        "AIUSDT",
        "AKROUSDT",
        "ALCXUSDT",
        "ALGOUSDT",
        "ALICEUSDT",
        "ALPACAUSDT",
        "ALPHAUSDT",
        "ALPINEUSDT",
        "ALTUSDT",
        "AMBUSDT",
        "AMPUSDT",
        "ANKRUSDT",
        "APEUSDT",
        "API3USDT",
        "APTUSDT",
        "ARBUSDT",
        "ARDRUSDT",
        "ARKMUSDT",
        "ARKUSDT",
        "ARPAUSDT",
        "ARUSDT",
        "ASRUSDT",
        "ASTRUSDT",
        "ASTUSDT",
        "ATAUSDT",
        "ATMUSDT",
        "ATOMUSDT",
        "AUCTIONUSDT",
        "AUDIOUSDT",
        "AVAUSDT",
        "AVAXUSDT",
        "AXLUSDT",
        "AXSUSDT",
        "BADGERUSDT",
        "BAKEUSDT",
        "BALUSDT",
        "BANANAUSDT",
        "BANDUSDT",
        "BARUSDT",
        "BATUSDT",
        "BBUSDT",
        "BCHUSDT",
        "BEAMXUSDT",
        "BELUSDT",
        "BETAUSDT",
        "BICOUSDT",
        "BIFIUSDT",
        "BLURUSDT",
        "BLZUSDT",
        "BNBUSDT",
        "BNTUSDT",
        "BNXUSDT",
        "BOMEUSDT",
        "BONKUSDT",
        "BSWUSDT",
        "BTCUSDT",
        "BTTCUSDT",
        "BURGERUSDT",
        "C98USDT",
        "CAKEUSDT",
        "CELOUSDT",
        "CELRUSDT",
        "CFXUSDT",
        "CHESSUSDT",
        "CHRUSDT",
        "CHZUSDT",
        "CITYUSDT",
        "CKBUSDT",
        "CLVUSDT",
        "COMBOUSDT",
        "COMPUSDT",
        "COSUSDT",
        "COTIUSDT",
        "CREAMUSDT",
        "CRVUSDT",
        "CTKUSDT",
        "CTSIUSDT",
        "CTXCUSDT",
        "CVCUSDT",
        "CVXUSDT",
        "CYBERUSDT",
        "DARUSDT",
        "DASHUSDT",
        "DATAUSDT",
        "DCRUSDT",
        "DEGOUSDT",
        "DENTUSDT",
        "DEXEUSDT",
        "DFUSDT",
        "DGBUSDT",
        "DIAUSDT",
        "DODOUSDT",
        "DOGEUSDT",
        "DOGSUSDT",
        "DOTUSDT",
        "DUSKUSDT",
        "DYDXUSDT",
        "DYMUSDT",
        "EDUUSDT",
        "EGLDUSDT",
        "ELFUSDT",
        "ENAUSDT",
        "ENJUSDT",
        "ENSUSDT",
        "EOSUSDT",
        "ERNUSDT",
        "ETCUSDT",
        "ETHFIUSDT",
        "ETHUSDT",
        "EURIUSDT",
        "EURUSDT",
        "FARMUSDT",
        "FDUSDUSDT",
        "FETUSDT",
        "FIDAUSDT",
        "FILUSDT",
        "FIOUSDT",
        "FIROUSDT",
        "FISUSDT",
        "FLMUSDT",
        "FLOKIUSDT",
        "FLOWUSDT",
        "FLUXUSDT",
        "FORTHUSDT",
        "FTMUSDT",
        "FTTUSDT",
        "FUNUSDT",
        "FXSUSDT",
        "GALAUSDT",
        "GASUSDT",
        "GFTUSDT",
        "GHSTUSDT",
        "GLMRUSDT",
        "GLMUSDT",
        "GMTUSDT",
        "GMXUSDT",
        "GNOUSDT",
        "GNSUSDT",
        "GRTUSDT",
        "GTCUSDT",
        "GUSDT",
        "HARDUSDT",
        "HBARUSDT",
        "HFTUSDT",
        "HIFIUSDT",
        "HIGHUSDT",
        "HIVEUSDT",
        "HOOKUSDT",
        "HOTUSDT",
        "ICPUSDT",
        "ICXUSDT",
        "IDEXUSDT",
        "IDUSDT",
        "ILVUSDT",
        "IMXUSDT",
        "INJUSDT",
        "IOSTUSDT",
        "IOTAUSDT",
        "IOTXUSDT",
        "IOUSDT",
        "IQUSDT",
        "IRISUSDT",
        "JASMYUSDT",
        "JOEUSDT",
        "JSTUSDT",
        "JTOUSDT",
        "JUPUSDT",
        "JUVUSDT",
        "KAVAUSDT",
        "KDAUSDT",
        "KEYUSDT",
        "KLAYUSDT",
        "KMDUSDT",
        "KNCUSDT",
        "KP3RUSDT",
        "KSMUSDT",
        "LAZIOUSDT",
        "LDOUSDT",
        "LEVERUSDT",
        "LINAUSDT",
        "LINKUSDT",
        "LISTAUSDT",
        "LITUSDT",
        "LOKAUSDT",
        "LPTUSDT",
        "LQTYUSDT",
        "LRCUSDT",
        "LSKUSDT",
        "LTCUSDT",
        "LTOUSDT",
        "LUNAUSDT",
        "LUNCUSDT",
        "MAGICUSDT",
        "MANAUSDT",
        "MANTAUSDT",
        "MASKUSDT",
        "MATICUSDT",
        "MAVUSDT",
        "MBLUSDT",
        "MBOXUSDT",
        "MDTUSDT",
        "MEMEUSDT",
        "METISUSDT",
        "MINAUSDT",
        "MKRUSDT",
        "MLNUSDT",
        "MOVRUSDT",
        "MTLUSDT",
        "NEARUSDT",
        "NEOUSDT",
        "NEXOUSDT",
        "NFPUSDT",
        "NKNUSDT",
        "NMRUSDT",
        "NOTUSDT",
        "NTRNUSDT",
        "NULSUSDT",
        "OAXUSDT",
        "OGNUSDT",
        "OGUSDT",
        "OMNIUSDT",
        "OMUSDT",
        "ONEUSDT",
        "ONGUSDT",
        "ONTUSDT",
        "OOKIUSDT",
        "OPUSDT",
        "ORDIUSDT",
        "ORNUSDT",
        "OSMOUSDT",
        "OXTUSDT",
        "PAXGUSDT",
        "PDAUSDT",
        "PENDLEUSDT",
        "PEOPLEUSDT",
        "PEPEUSDT",
        "PERPUSDT",
        "PHAUSDT",
        "PHBUSDT",
        "PIVXUSDT",
        "PIXELUSDT",
        "POLYXUSDT",
        "PONDUSDT",
        "PORTALUSDT",
        "PORTOUSDT",
        "POWRUSDT",
        "PROMUSDT",
        "PROSUSDT",
        "PSGUSDT",
        "PUNDIXUSDT",
        "PYRUSDT",
        "PYTHUSDT",
        "QIUSDT",
        "QKCUSDT",
        "QNTUSDT",
        "QTUMUSDT",
        "QUICKUSDT",
        "RADUSDT",
        "RAREUSDT",
        "RAYUSDT",
        "RDNTUSDT",
        "REIUSDT",
        "RENDERUSDT",
        "RENUSDT",
        "REQUSDT",
        "REZUSDT",
        "RIFUSDT",
        "RLCUSDT",
        "RONINUSDT",
        "ROSEUSDT",
        "RPLUSDT",
        "RSRUSDT",
        "RUNEUSDT",
        "RVNUSDT",
        "SAGAUSDT",
        "SANDUSDT",
        "SANTOSUSDT",
        "SCRTUSDT",
        "SCUSDT",
        "SEIUSDT",
        "SFPUSDT",
        "SHIBUSDT",
        "SKLUSDT",
        "SLFUSDT",
        "SLPUSDT",
        "SNTUSDT",
        "SNXUSDT",
        "SOLUSDT",
        "SPELLUSDT",
        "SSVUSDT",
        "STEEMUSDT",
        "STGUSDT",
        "STMXUSDT",
        "STORJUSDT",
        "STPTUSDT",
        "STRAXUSDT",
        "STRKUSDT",
        "STXUSDT",
        "SUIUSDT",
        "SUNUSDT",
        "SUPERUSDT",
        "SUSHIUSDT",
        "SXPUSDT",
        "SYNUSDT",
        "TAOUSDT",
        "TFUELUSDT",
        "THETAUSDT",
        "TIAUSDT",
        "TKOUSDT",
        "TLMUSDT",
        "TNSRUSDT",
        "TONUSDT",
        "TRBUSDT",
        "TROYUSDT",
        "TRUUSDT",
        "TRXUSDT",
        "TUSDT",
        "TUSDUSDT",
        "USTCUSDT",
        "UTKUSDT",
        "VANRYUSDT",
        "VETUSDT",
        "VIBUSDT",
        "VICUSDT",
        "VIDTUSDT",
        "VITEUSDT",
        "VOXELUSDT",
        "VTHOUSDT",
        "WANUSDT",
        "WAXPUSDT",
        "WBETHUSDT",
        "WBTCUSDT",
        "WIFUSDT",
        "WINGUSDT",
        "WINUSDT",
        "WLDUSDT",
        "WOOUSDT",
        "WRXUSDT",
        "WUSDT",
        "XAIUSDT",
        "XECUSDT",
        "XLMUSDT",
        "XNOUSDT",
        "XRPUSDT",
        "XTZUSDT",
        "XVGUSDT",
        "XVSUSDT",
        "YFIUSDT",
        "YGGUSDT",
        "ZECUSDT",
        "ZENUSDT",
        "ZILUSDT",
        "ZKUSDT",
        "ZROUSDT",
        "ZRXUSDT",
        "UNIUSDT",
        "USDCUSDT",
        "USDPUSDT",
        "TWTUSDT",
        "UFTUSDT",
        "UMAUSDT",
        "UNFIUSDT",
        "SYSUSDT"
      ]
    },
  ],
  quotes: ['USDT', 'BTC', 'BNB'],

  addCurrency: function (item) {
    let index = this.currencies.list.findIndex(obj => obj.symbol === item.symbol);

    // Se o objeto for econtrado, edite.
    if (index !== -1) {
      this.currencies[index] = item;
    }
  },
  getAllCurrencies: async function () {
    return await this.currencies;
  },
  getBinanceCurrenciesWithUsdt: async function (currencies) {

    let bincanceCurrenciesWithUsdt = this.filters[0].list;

    let filteredCurrenciesByBinanceWithUsdt = currencies.list.filter(currency => bincanceCurrenciesWithUsdt.includes(currency.symbol));

    return filteredCurrenciesByBinanceWithUsdt;

  },
  addFilter: async function (item) {

    let index = this.filters.findIndex(obj => obj.name === item.name);

    // Se o objeto for econtrado, edite.
    if (index !== -1) {
      this.filters[index] = item;
    } else {
      this.filters.push(item)
    }


  },
  getQuotes: function () {
    return this.quotes;
  },
  getFilters: function () {
    return this.filters;
  },
  findFilter: function (name) {
    let filter = this.filters.find(filter => filter.name === name)

    return filter;
  },
  findCurrency: function () {
    this.currencies.list.find(currency.symbol)
  },
  joinFilters: function (selectedFilters) {

    let name = selectedFilters.join('|')

    let data = this.filters.filter(f => selectedFilters.includes(f.name))

    function getCommonSymbols(arrays) {
      if (arrays.length === 0) return [];

      // Start with the first list
      let commonSymbols = arrays[0].list;

      // Iterate through the remaining lists
      for (let i = 1; i < arrays.length; i++) {
        commonSymbols = commonSymbols.filter(symbol => arrays[i].list.includes(symbol));
      }

      return commonSymbols;
    }

    const commonSymbols = getCommonSymbols(data);

    this.addFilter({
      name: name,
      list: commonSymbols
    })

  },
  clearAllFilters: function () {
    this.filters = this.filters.filter(f => f.name === '1h|Binance|USDT')
  },
  removeFilters: function (filtersToRemove) {
    // Não pode remover o primeiro filtro
    let firstFilter = this.filters[0]
    let newFilters = this.filters.filter(f => !filtersToRemove.includes(f.name));
    this.filters = []
    this.filters.push(firstFilter);
    // Retira repetições
    let setFilters = new Set([firstFilter, ...newFilters])
    this.filters = Array.from(setFilters)

  },

  getForTestIndicatorsAndCurrencies: async function () {

    try {
      let response = await fetch('./indicators-and-currencies.json');  // Fetch the JSON file
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      let data = await response.json();
      return data;  // Return the JSON data
    } catch (error) {
      console.error('There has been a problem with your fetch operation:', error);
      return null;  // Return null or handle the error as needed
    }
  }

};

export default CurrencyModel;