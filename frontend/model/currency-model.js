const CurrencyModel = {

  currencies: [],
  filters: [
    {
      name: '1h|Binance|USDT',
      list: ["ZROUSDT","LISTAUSDT","1INCHUSDT","ZKUSDT", "BTCUSDT", "AAVEUSDT", "ACMUSDT", "ADAUSDT", "IOUSDT", "AKROUSDT", "ALGOUSDT", "ALICEUSDT", "ALPACAUSDT", "ALPHAUSDT", "ANKRUSDT", "ARDRUSDT", "ARPAUSDT", "ARUSDT", "ASRUSDT", "ATAUSDT", "ATMUSDT", "ATOMUSDT", "AUDIOUSDT", "AVAUSDT", "AVAXUSDT", "AXSUSDT", "BADGERUSDT", "BAKEUSDT", "BALUSDT", "BANDUSDT", "BATUSDT", "BCHUSDT", "BELUSDT", "BLZUSDT", "BNTUSDT", "BONDUSDT", "BURGERUSDT", "C98USDT", "CAKEUSDT", "CELOUSDT", "CELRUSDT", "CFXUSDT", "CHRUSDT", "CHZUSDT", "CKBUSDT", "CLVUSDT", "COMPUSDT", "COSUSDT", "COTIUSDT", "CRVUSDT", "CTKUSDT", "CTSIUSDT", "CTXCUSDT", "CVCUSDT", "DASHUSDT", "DATAUSDT", "DCRUSDT", "DEGOUSDT", "DENTUSDT", "DEXEUSDT", "DGBUSDT", "DIAUSDT", "DOCKUSDT", "DODOUSDT", "DOGEUSDT", "DOTUSDT", "DUSKUSDT", "EGLDUSDT", "ENJUSDT", "EOSUSDT", "ERNUSDT", "ETCUSDT", "EURUSDT", "FARMUSDT", "FETUSDT", "FILUSDT", "FIOUSDT", "FIROUSDT", "FISUSDT", "FLMUSDT", "FLOWUSDT", "FORTHUSDT", "FTMUSDT", "FTTUSDT", "FUNUSDT", "GRTUSDT", "GTCUSDT", "HARDUSDT", "HBARUSDT", "HIVEUSDT", "HOTUSDT", "ICPUSDT", "ICXUSDT", "INJUSDT", "IOSTUSDT", "IOTAUSDT", "IOTXUSDT", "IRISUSDT", "JSTUSDT", "JUVUSDT", "KAVAUSDT", "KEYUSDT", "KLAYUSDT", "KMDUSDT", "KNCUSDT", "KSMUSDT", "LINAUSDT", "LINKUSDT", "LITUSDT", "LPTUSDT", "LRCUSDT", "LSKUSDT", "LTCUSDT", "LTOUSDT", "LUNAUSDT", "MANAUSDT", "MASKUSDT", "MATICUSDT", "MBLUSDT", "MDTUSDT", "MDXUSDT", "MINAUSDT", "MKRUSDT", "MLNUSDT", "MTLUSDT", "NEARUSDT", "NEOUSDT", "NMRUSDT", "NULSUSDT", "OCEANUSDT", "OGNUSDT", "OGUSDT", "GUSDT", "OMGUSDT", "OMUSDT", "ONEUSDT", "ONGUSDT", "ONTUSDT", "ORNUSDT", "OXTUSDT", "PAXGUSDT", "PERPUSDT", "PHAUSDT", "POLSUSDT", "PONDUSDT", "PSGUSDT", "PUNDIXUSDT", "QNTUSDT", "QTUMUSDT", "QUICKUSDT", "RAYUSDT", "REEFUSDT", "RIFUSDT", "RLCUSDT", "ROSEUSDT", "RSRUSDT", "RUNEUSDT", "RVNUSDT", "SANDUSDT", "SCUSDT", "SFPUSDT", "SHIBUSDT", "SKLUSDT", "SLPUSDT", "SNXUSDT", "SOLUSDT", "STMXUSDT", "STORJUSDT", "STPTUSDT", "STRAXUSDT", "STXUSDT", "SUNUSDT", "SUPERUSDT", "SUSHIUSDT", "SXPUSDT", "TFUELUSDT", "THETAUSDT", "TKOUSDT", "TLMUSDT", "TRBUSDT", "TROYUSDT", "TRUUSDT", "TRXUSDT", "TUSDUSDT", "TWTUSDT", "UMAUSDT", "UNFIUSDT", "UNIUSDT", "USDCUSDT", "UTKUSDT", "VETUSDT", "VITEUSDT", "VTHOUSDT", "WANUSDT", "WAVESUSDT", "WINGUSDT", "WINUSDT", "WNXMUSDT", "WRXUSDT", "XEMUSDT", "XLMUSDT", "XRPUSDT", "XTZUSDT", "XVGUSDT", "XVSUSDT", "YFIUSDT", "ZECUSDT", "ZENUSDT", "ZILUSDT", "ZRXUSDT", "BNBUSDT", "ETHUSDT", "RENUSDT", "NKNUSDT", "BARUSDT", "MBOXUSDT", "FORUSDT", "REQUSDT", "GHSTUSDT", "WAXPUSDT", "GNOUSDT", "XECUSDT", "ELFUSDT", "DYDXUSDT", "IDEXUSDT", "VIDTUSDT", "USDPUSDT", "GALAUSDT", "ILVUSDT", "YGGUSDT", "SYSUSDT", "DFUSDT", "FIDAUSDT", "FRONTUSDT", "CVPUSDT", "AGLDUSDT", "RADUSDT", "BETAUSDT", "RAREUSDT", "LAZIOUSDT", "CHESSUSDT", "ADXUSDT", "AUCTIONUSDT", "DARUSDT", "BNXUSDT", "MOVRUSDT", "CITYUSDT", "ENSUSDT", "KP3RUSDT", "QIUSDT", "PORTOUSDT", "POWRUSDT", "VGXUSDT", "JASMYUSDT", "AMPUSDT", "PYRUSDT", "RNDRUSDT", "ALCXUSDT", "SANTOSUSDT", "BICOUSDT", "FLUXUSDT", "FXSUSDT", "VOXELUSDT", "HIGHUSDT", "CVXUSDT", "PEOPLEUSDT", "OOKIUSDT", "SPELLUSDT", "JOEUSDT", "ACHUSDT", "IMXUSDT", "GLMRUSDT", "LOKAUSDT", "SCRTUSDT", "API3USDT", "BTTCUSDT", "ACAUSDT", "XNOUSDT", "WOOUSDT", "ALPINEUSDT", "TUSDT", "ASTRUSDT", "GMTUSDT", "KDAUSDT", "APEUSDT", "BSWUSDT", "BIFIUSDT", "STEEMUSDT", "NEXOUSDT", "REIUSDT", "GALUSDT", "LDOUSDT", "EPXUSDT", "OPUSDT", "LEVERUSDT", "STGUSDT", "LUNCUSDT", "GMXUSDT", "POLYXUSDT", "APTUSDT", "OSMOUSDT", "HFTUSDT", "PHBUSDT", "HOOKUSDT", "MAGICUSDT", "HIFIUSDT", "RPLUSDT", "PROSUSDT", "AGIXUSDT", "GNSUSDT", "SYNUSDT", "VIBUSDT", "SSVUSDT", "LQTYUSDT", "AMBUSDT", "USTCUSDT", "GASUSDT", "GLMUSDT", "PROMUSDT", "QKCUSDT", "UFTUSDT", "IDUSDT", "ARBUSDT", "LOOMUSDT", "OAXUSDT", "RDNTUSDT", "WBTCUSDT", "EDUUSDT", "SUIUSDT", "AERGOUSDT", "PEPEUSDT", "FLOKIUSDT", "ASTUSDT", "SNTUSDT", "COMBOUSDT", "MAVUSDT", "PENDLEUSDT", "ARKMUSDT", "WBETHUSDT", "WLDUSDT", "FDUSDUSDT", "SEIUSDT", "CYBERUSDT", "ARKUSDT", "CREAMUSDT", "GFTUSDT", "IQUSDT", "NTRNUSDT", "TIAUSDT", "MEMEUSDT", "ORDIUSDT", "BEAMXUSDT", "PIVXUSDT", "VICUSDT", "BLURUSDT", "VANRYUSDT", "AEURUSDT", "JTOUSDT", "1000SATSUSDT", "BONKUSDT", "ACEUSDT", "NFPUSDT", "AIUSDT", "XAIUSDT", "MANTAUSDT", "ALTUSDT", "JUPUSDT", "PYTHUSDT", "RONINUSDT", "DYMUSDT", "PIXELUSDT", "STRKUSDT", "PORTALUSDT", "PDAUSDT", "AXLUSDT", "WIFUSDT", "METISUSDT", "AEVOUSDT", "BOMEUSDT", "ETHFIUSDT", "ENAUSDT", "WUSDT", "TNSRUSDT", "SAGAUSDT", "TAOUSDT", "OMNIUSDT", "REZUSDT", "BBUSDT", "NOTUSDT"]

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
  addFilter: function (item) {

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

  }
};

export default CurrencyModel;