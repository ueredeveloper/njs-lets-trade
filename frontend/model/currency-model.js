
// model/currency-model.js
const CurrencyModel = {
  currencies: [],
  filters: [
    {
      name: '1h|Binance|USDT',
      // Lista atualizada em 30/08/2024
      list: [
        "BTCUSDT",
        "ETHUSDT",
        "USDCUSDT",
        "DOGEUSDT",
        "SOLUSDT",
        "FDUSDUSDT",
        "NEIROUSDT",
        "SUIUSDT",
        "PEPEUSDT",
        "BNBUSDT",
        "WIFUSDT",
        "XRPUSDT",
        "SHIBUSDT",
        "COWUSDT",
        "UNIUSDT",
        "RUNEUSDT",
        "FETUSDT",
        "WLDUSDT",
        "AAVEUSDT",
        "TAOUSDT",
        "BOMEUSDT",
        "TIAUSDT",
        "ARKMUSDT",
        "CETUSUSDT",
        "AVAXUSDT",
        "ENAUSDT",
        "BONKUSDT",
        "PEOPLEUSDT",
        "RAYUSDT",
        "EURUSDT",
        "NEARUSDT",
        "TROYUSDT",
        "ADAUSDT",
        "FLOKIUSDT",
        "FTMUSDT",
        "INJUSDT",
        "SEIUSDT",
        "LINKUSDT",
        "TURBOUSDT",
        "TONUSDT",
        "TRXUSDT",
        "ARBUSDT",
        "ORDIUSDT",
        "APTUSDT",
        "LDOUSDT",
        "PENDLEUSDT",
        "1000SATSUSDT",
        "LTCUSDT",
        "BCHUSDT",
        "APEUSDT",
        "1MBABYDOGEUSDT",
        "RENDERUSDT",
        "ETHFIUSDT",
        "JUPUSDT",
        "SAGAUSDT",
        "MASKUSDT",
        "SCRUSDT",
        "MKRUSDT",
        "DOGSUSDT",
        "WBTCUSDT",
        "MEMEUSDT",
        "ICPUSDT",
        "OPUSDT",
        "FILUSDT",
        "EIGENUSDT",
        "DOTUSDT",
        "POLUSDT",
        "RAREUSDT",
        "NOTUSDT",
        "DYDXUSDT",
        "RDNTUSDT",
        "PYTHUSDT",
        "STXUSDT",
        "ZROUSDT",
        "IOUSDT",
        "ARUSDT",
        "JTOUSDT",
        "GALAUSDT",
        "JASMYUSDT",
        "STRKUSDT",
        "ZKUSDT",
        "SANTOSUSDT",
        "ENSUSDT",
        "PIXELUSDT",
        "SUPERUSDT",
        "ATOMUSDT",
        "EURIUSDT",
        "BANANAUSDT",
        "CRVUSDT",
        "CKBUSDT",
        "BICOUSDT",
        "FIDAUSDT",
        "CELOUSDT",
        "SXPUSDT",
        "OMUSDT",
        "HBARUSDT",
        "MINAUSDT",
        "ETCUSDT",
        "WUSDT",
        "CATIUSDT",
        "MANTAUSDT",
        "AEVOUSDT",
        "HARDUSDT",
        "SUSHIUSDT",
        "ASTRUSDT",
        "PROSUSDT",
        "IMXUSDT",
        "LUNCUSDT",
        "ARPAUSDT",
        "GRTUSDT",
        "TNSRUSDT",
        "CAKEUSDT",
        "SLFUSDT",
        "PAXGUSDT",
        "HMSTRUSDT",
        "CFXUSDT",
        "SSVUSDT",
        "ALTUSDT",
        "CHZUSDT",
        "OGUSDT",
        "BLURUSDT",
        "BEAMXUSDT",
        "DIAUSDT",
        "YGGUSDT",
        "GHSTUSDT",
        "EOSUSDT",
        "KAIAUSDT",
        "WOOUSDT",
        "ZECUSDT",
        "GMTUSDT",
        "CYBERUSDT",
        "THETAUSDT",
        "XLMUSDT",
        "ROSEUSDT",
        "XAIUSDT",
        "LUMIAUSDT",
        "BBUSDT",
        "USTCUSDT",
        "FTTUSDT",
        "ALGOUSDT",
        "METISUSDT",
        "TRBUSDT",
        "RONINUSDT",
        "VANRYUSDT",
        "PHBUSDT",
        "AXSUSDT",
        "EGLDUSDT",
        "STORJUSDT",
        "WBETHUSDT",
        "SNXUSDT",
        "OGNUSDT",
        "IDUSDT",
        "AIUSDT",
        "ARKUSDT",
        "BNSOLUSDT",
        "VETUSDT",
        "SUNUSDT",
        "LUNAUSDT",
        "AGLDUSDT",
        "AXLUSDT",
        "OMNIUSDT",
        "LPTUSDT",
        "BNXUSDT",
        "PORTALUSDT",
        "1INCHUSDT",
        "RSRUSDT",
        "AUCTIONUSDT",
        "TRUUSDT",
        "WINGUSDT",
        "HOTUSDT",
        "NEOUSDT",
        "FLOWUSDT",
        "DYMUSDT",
        "MANAUSDT",
        "ACEUSDT",
        "POLYXUSDT",
        "MAGICUSDT",
        "SANDUSDT",
        "DARUSDT",
        "TUSDUSDT",
        "MBOXUSDT",
        "BAKEUSDT",
        "COTIUSDT",
        "HIGHUSDT",
        "LISTAUSDT",
        "RADUSDT",
        "REZUSDT",
        "LEVERUSDT",
        "OAXUSDT",
        "QNTUSDT",
        "ALPHAUSDT",
        "IOTXUSDT",
        "ACHUSDT",
        "LINAUSDT",
        "ZILUSDT",
        "VIDTUSDT",
        "COMPUSDT",
        "COSUSDT",
        "TLMUSDT",
        "API3USDT",
        "ILVUSDT",
        "BELUSDT",
        "KDAUSDT",
        "USDPUSDT",
        "YFIUSDT",
        "TFUELUSDT",
        "GUSDT",
        "GMXUSDT",
        "ALICEUSDT",
        "XECUSDT",
        "MAVUSDT",
        "EDUUSDT",
        "PERPUSDT",
        "TWTUSDT",
        "UMAUSDT",
        "IOTAUSDT",
        "FIOUSDT",
        "SKLUSDT",
        "LRCUSDT",
        "SLPUSDT",
        "AMPUSDT",
        "GNOUSDT",
        "ZENUSDT",
        "DODOUSDT",
        "BARUSDT",
        "C98USDT",
        "STGUSDT",
        "MOVRUSDT",
        "FXSUSDT",
        "PYRUSDT",
        "SYNUSDT",
        "LAZIOUSDT",
        "PORTOUSDT",
        "RPLUSDT",
        "PROMUSDT",
        "GLMRUSDT",
        "HOOKUSDT",
        "NFPUSDT",
        "CHRUSDT",
        "NEXOUSDT",
        "FLUXUSDT",
        "TKOUSDT",
        "RVNUSDT",
        "CTKUSDT",
        "ADXUSDT",
        "ONEUSDT",
        "MBLUSDT",
        "ZRXUSDT",
        "XVSUSDT",
        "GASUSDT",
        "ALPINEUSDT",
        "CTXCUSDT",
        "GLMUSDT",
        "ANKRUSDT",
        "BSWUSDT",
        "DUSKUSDT",
        "CVCUSDT",
        "SPELLUSDT",
        "KEYUSDT",
        "HIFIUSDT",
        "BTTCUSDT",
        "NTRNUSDT",
        "JOEUSDT",
        "AMBUSDT",
        "DASHUSDT",
        "KAVAUSDT",
        "KSMUSDT",
        "REIUSDT",
        "BETAUSDT",
        "AUDIOUSDT",
        "LQTYUSDT",
        "SYSUSDT",
        "CELRUSDT",
        "ALPACAUSDT",
        "FISUSDT",
        "SCUSDT",
        "IOSTUSDT",
        "SNTUSDT",
        "ENJUSDT",
        "XTZUSDT",
        "RLCUSDT",
        "MTLUSDT",
        "CHESSUSDT",
        "PSGUSDT",
        "IQUSDT",
        "VOXELUSDT",
        "BURGERUSDT",
        "QUICKUSDT",
        "BADGERUSDT",
        "DENTUSDT",
        "WINUSDT",
        "CVXUSDT",
        "RIFUSDT",
        "POWRUSDT",
        "HFTUSDT",
        "BLZUSDT",
        "STMXUSDT",
        "ONTUSDT",
        "GTCUSDT",
        "JSTUSDT",
        "NKNUSDT",
        "TUSDT",
        "PHAUSDT",
        "OSMOUSDT",
        "LOKAUSDT",
        "KNCUSDT",
        "VITEUSDT",
        "VIBUSDT",
        "NMRUSDT",
        "CTSIUSDT",
        "COMBOUSDT",
        "BANDUSDT",
        "ARDRUSDT",
        "ELFUSDT",
        "JUVUSDT",
        "NULSUSDT",
        "STPTUSDT",
        "CITYUSDT",
        "XVGUSDT",
        "BATUSDT",
        "LITUSDT",
        "WAXPUSDT",
        "ONGUSDT",
        "ERNUSDT",
        "RENUSDT",
        "SFPUSDT",
        "QTUMUSDT",
        "LTOUSDT",
        "LSKUSDT",
        "AKROUSDT",
        "OXTUSDT",
        "CLVUSDT",
        "QKCUSDT",
        "ASRUSDT",
        "DGBUSDT",
        "ATMUSDT",
        "FLMUSDT",
        "DEGOUSDT",
        "CREAMUSDT",
        "PONDUSDT",
        "ACAUSDT",
        "ASTUSDT",
        "ATAUSDT",
        "AERGOUSDT",
        "QIUSDT",
        "DATAUSDT",
        "MDTUSDT",
        "ALCXUSDT",
        "ICXUSDT",
        "VTHOUSDT",
        "XNOUSDT",
        "PDAUSDT",
        "STEEMUSDT",
        "AEURUSDT",
        "PUNDIXUSDT",
        "GFTUSDT",
        "SCRTUSDT",
        "HIVEUSDT",
        "FORTHUSDT",
        "ACMUSDT",
        "FUNUSDT",
        "BALUSDT",
        "STRAXUSDT",
        "MLNUSDT",
        "IRISUSDT",
        "WRXUSDT",
        "FIROUSDT",
        "DCRUSDT",
        "BNTUSDT",
        "PIVXUSDT",
        "UTKUSDT",
        "FARMUSDT",
        "AVAUSDT",
        "VICUSDT",
        "IDEXUSDT",
        "GNSUSDT",
        "WANUSDT",
        "BIFIUSDT",
        "UFTUSDT",
        "REQUSDT",
        "DFUSDT",
        "DEXEUSDT",
        "KMDUSDT"
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