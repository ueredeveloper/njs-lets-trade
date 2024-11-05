
// model/currency-model.js
const CurrencyModel = {
  currencies: [],
  filters: [
    {
      name: '1h|Binance|USDT',
      // Lista atualizada em 30/08/2024
      list: [
        "BTCUSDT",
        "1INCHUSDT",
        "AAVEUSDT",
        "ACMUSDT",
        "ADAUSDT",
        "AKROUSDT",
        "ALGOUSDT",
        "ALICEUSDT",
        "ALPACAUSDT",
        "ALPHAUSDT",
        "ANKRUSDT",
        "ARDRUSDT",
        "ARPAUSDT",
        "ARUSDT",
        "ASRUSDT",
        "ATAUSDT",
        "ATMUSDT",
        "ATOMUSDT",
        "AUDIOUSDT",
        "AVAUSDT",
        "AVAXUSDT",
        "AXSUSDT",
        "BADGERUSDT",
        "BAKEUSDT",
        "BALUSDT",
        "BANDUSDT",
        "BATUSDT",
        "BCHUSDT",
        "BELUSDT",
        "BLZUSDT",
        "BNTUSDT",
        "BURGERUSDT",
        "C98USDT",
        "CAKEUSDT",
        "CELOUSDT",
        "CELRUSDT",
        "CFXUSDT",
        "CHRUSDT",
        "CHZUSDT",
        "CKBUSDT",
        "CLVUSDT",
        "COMPUSDT",
        "COSUSDT",
        "COTIUSDT",
        "CRVUSDT",
        "CTKUSDT",
        "CTSIUSDT",
        "CTXCUSDT",
        "CVCUSDT",
        "DASHUSDT",
        "DATAUSDT",
        "DCRUSDT",
        "DEGOUSDT",
        "DENTUSDT",
        "DEXEUSDT",
        "DGBUSDT",
        "DIAUSDT",
        "DODOUSDT",
        "DOGEUSDT",
        "DOTUSDT",
        "DUSKUSDT",
        "EGLDUSDT",
        "ENJUSDT",
        "EOSUSDT",
        "ERNUSDT",
        "ETCUSDT",
        "EURUSDT",
        "FARMUSDT",
        "FETUSDT",
        "FILUSDT",
        "FIOUSDT",
        "FIROUSDT",
        "FISUSDT",
        "FLMUSDT",
        "FLOWUSDT",
        "FORTHUSDT",
        "FTMUSDT",
        "FTTUSDT",
        "FUNUSDT",
        "GRTUSDT",
        "GTCUSDT",
        "HARDUSDT",
        "HBARUSDT",
        "HIVEUSDT",
        "HOTUSDT",
        "ICPUSDT",
        "ICXUSDT",
        "INJUSDT",
        "IOSTUSDT",
        "IOTAUSDT",
        "IOTXUSDT",
        "IRISUSDT",
        "JSTUSDT",
        "JUVUSDT",
        "KAVAUSDT",
        "KEYUSDT",
        "KMDUSDT",
        "KNCUSDT",
        "KSMUSDT",
        "LINAUSDT",
        "LINKUSDT",
        "LITUSDT",
        "LPTUSDT",
        "LRCUSDT",
        "LSKUSDT",
        "LTCUSDT",
        "LTOUSDT",
        "LUNAUSDT",
        "MANAUSDT",
        "MASKUSDT",
        "MBLUSDT",
        "MDTUSDT",
        "MINAUSDT",
        "MKRUSDT",
        "MLNUSDT",
        "MTLUSDT",
        "NEARUSDT",
        "NEOUSDT",
        "NMRUSDT",
        "NULSUSDT",
        "OGNUSDT",
        "OGUSDT",
        "OMUSDT",
        "ONEUSDT",
        "ONGUSDT",
        "ONTUSDT",
        "OXTUSDT",
        "PAXGUSDT",
        "PERPUSDT",
        "PHAUSDT",
        "PONDUSDT",
        "PSGUSDT",
        "PUNDIXUSDT",
        "QNTUSDT",
        "QTUMUSDT",
        "QUICKUSDT",
        "RAYUSDT",
        "RIFUSDT",
        "RLCUSDT",
        "ROSEUSDT",
        "RSRUSDT",
        "RUNEUSDT",
        "RVNUSDT",
        "SANDUSDT",
        "SCUSDT",
        "SFPUSDT",
        "SHIBUSDT",
        "SKLUSDT",
        "SLPUSDT",
        "SNXUSDT",
        "SOLUSDT",
        "STMXUSDT",
        "STORJUSDT",
        "STPTUSDT",
        "STRAXUSDT",
        "STXUSDT",
        "SUNUSDT",
        "SUPERUSDT",
        "SUSHIUSDT",
        "SXPUSDT",
        "TFUELUSDT",
        "THETAUSDT",
        "TKOUSDT",
        "TLMUSDT",
        "TRBUSDT",
        "TROYUSDT",
        "TRUUSDT",
        "TRXUSDT",
        "TUSDUSDT",
        "TWTUSDT",
        "UMAUSDT",
        "UNFIUSDT",
        "UNIUSDT",
        "USDCUSDT",
        "UTKUSDT",
        "VETUSDT",
        "VITEUSDT",
        "VTHOUSDT",
        "WANUSDT",
        "WINGUSDT",
        "WINUSDT",
        "WRXUSDT",
        "XLMUSDT",
        "XRPUSDT",
        "XTZUSDT",
        "XVGUSDT",
        "XVSUSDT",
        "YFIUSDT",
        "ZECUSDT",
        "ZENUSDT",
        "ZILUSDT",
        "ZRXUSDT",
        "BNBUSDT",
        "ETHUSDT",
        "RENUSDT",
        "NKNUSDT",
        "BARUSDT",
        "MBOXUSDT",
        "REQUSDT",
        "GHSTUSDT",
        "WAXPUSDT",
        "GNOUSDT",
        "XECUSDT",
        "ELFUSDT",
        "DYDXUSDT",
        "IDEXUSDT",
        "VIDTUSDT",
        "USDPUSDT",
        "GALAUSDT",
        "ILVUSDT",
        "YGGUSDT",
        "SYSUSDT",
        "DFUSDT",
        "FIDAUSDT",
        "AGLDUSDT",
        "RADUSDT",
        "BETAUSDT",
        "RAREUSDT",
        "LAZIOUSDT",
        "CHESSUSDT",
        "ADXUSDT",
        "AUCTIONUSDT",
        "DARUSDT",
        "BNXUSDT",
        "MOVRUSDT",
        "CITYUSDT",
        "ENSUSDT",
        "KP3RUSDT",
        "QIUSDT",
        "PORTOUSDT",
        "POWRUSDT",
        "JASMYUSDT",
        "AMPUSDT",
        "PYRUSDT",
        "ALCXUSDT",
        "SANTOSUSDT",
        "BICOUSDT",
        "FLUXUSDT",
        "FXSUSDT",
        "VOXELUSDT",
        "HIGHUSDT",
        "CVXUSDT",
        "PEOPLEUSDT",
        "OOKIUSDT",
        "SPELLUSDT",
        "JOEUSDT",
        "ACHUSDT",
        "IMXUSDT",
        "GLMRUSDT",
        "LOKAUSDT",
        "SCRTUSDT",
        "API3USDT",
        "BTTCUSDT",
        "ACAUSDT",
        "XNOUSDT",
        "WOOUSDT",
        "ALPINEUSDT",
        "TUSDT",
        "ASTRUSDT",
        "GMTUSDT",
        "KDAUSDT",
        "APEUSDT",
        "BSWUSDT",
        "BIFIUSDT",
        "STEEMUSDT",
        "NEXOUSDT",
        "REIUSDT",
        "LDOUSDT",
        "OPUSDT",
        "LEVERUSDT",
        "STGUSDT",
        "LUNCUSDT",
        "GMXUSDT",
        "POLYXUSDT",
        "APTUSDT",
        "OSMOUSDT",
        "HFTUSDT",
        "PHBUSDT",
        "HOOKUSDT",
        "MAGICUSDT",
        "HIFIUSDT",
        "RPLUSDT",
        "PROSUSDT",
        "GNSUSDT",
        "SYNUSDT",
        "VIBUSDT",
        "SSVUSDT",
        "LQTYUSDT",
        "AMBUSDT",
        "USTCUSDT",
        "GASUSDT",
        "GLMUSDT",
        "PROMUSDT",
        "QKCUSDT",
        "UFTUSDT",
        "IDUSDT",
        "ARBUSDT",
        "OAXUSDT",
        "RDNTUSDT",
        "WBTCUSDT",
        "EDUUSDT",
        "SUIUSDT",
        "AERGOUSDT",
        "PEPEUSDT",
        "FLOKIUSDT",
        "ASTUSDT",
        "SNTUSDT",
        "COMBOUSDT",
        "MAVUSDT",
        "PENDLEUSDT",
        "ARKMUSDT",
        "WBETHUSDT",
        "WLDUSDT",
        "FDUSDUSDT",
        "SEIUSDT",
        "CYBERUSDT",
        "ARKUSDT",
        "CREAMUSDT",
        "GFTUSDT",
        "IQUSDT",
        "NTRNUSDT",
        "TIAUSDT",
        "MEMEUSDT",
        "ORDIUSDT",
        "BEAMXUSDT",
        "PIVXUSDT",
        "VICUSDT",
        "BLURUSDT",
        "VANRYUSDT",
        "AEURUSDT",
        "JTOUSDT",
        "1000SATSUSDT",
        "BONKUSDT",
        "ACEUSDT",
        "NFPUSDT",
        "AIUSDT",
        "XAIUSDT",
        "MANTAUSDT",
        "ALTUSDT",
        "JUPUSDT",
        "PYTHUSDT",
        "RONINUSDT",
        "DYMUSDT",
        "PIXELUSDT",
        "STRKUSDT",
        "PORTALUSDT",
        "PDAUSDT",
        "AXLUSDT",
        "WIFUSDT",
        "METISUSDT",
        "AEVOUSDT",
        "BOMEUSDT",
        "ETHFIUSDT",
        "ENAUSDT",
        "WUSDT",
        "TNSRUSDT",
        "SAGAUSDT",
        "TAOUSDT",
        "OMNIUSDT",
        "REZUSDT",
        "BBUSDT",
        "NOTUSDT",
        "IOUSDT",
        "ZKUSDT",
        "LISTAUSDT",
        "ZROUSDT",
        "GUSDT",
        "BANANAUSDT",
        "RENDERUSDT",
        "TONUSDT",
        "DOGSUSDT",
        "EURIUSDT",
        "SLFUSDT",
        "POLUSDT",
        "NEIROUSDT",
        "TURBOUSDT",
        "1MBABYDOGEUSDT",
        "CATIUSDT",
        "HMSTRUSDT",
        "EIGENUSDT",
        "SCRUSDT",
        "BNSOLUSDT",
        "LUMIAUSDT",
        "KAIAUSDT"
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