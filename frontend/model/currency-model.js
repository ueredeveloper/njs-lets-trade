
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
        "ALGOUSDT",
        "ALICEUSDT",
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
        "BANDUSDT",
        "BATUSDT",
        "BCHUSDT",
        "BELUSDT",
        "BNTUSDT",
        "C98USDT",
        "CAKEUSDT",
        "CELOUSDT",
        "CELRUSDT",
        "CFXUSDT",
        "CHRUSDT",
        "CHZUSDT",
        "CKBUSDT",
        "COMPUSDT",
        "COSUSDT",
        "COTIUSDT",
        "CRVUSDT",
        "CTKUSDT",
        "CTSIUSDT",
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
        "ETCUSDT",
        "EURUSDT",
        "FARMUSDT",
        "FETUSDT",
        "FILUSDT",
        "FIOUSDT",
        "FISUSDT",
        "FLMUSDT",
        "FLOWUSDT",
        "FORTHUSDT",
        "FTTUSDT",
        "FUNUSDT",
        "GRTUSDT",
        "GTCUSDT",
        "HBARUSDT",
        "HIVEUSDT",
        "HOTUSDT",
        "ICPUSDT",
        "ICXUSDT",
        "INJUSDT",
        "IOSTUSDT",
        "IOTAUSDT",
        "IOTXUSDT",
        "JSTUSDT",
        "JUVUSDT",
        "KAVAUSDT",
        "KNCUSDT",
        "KSMUSDT",
        "LINKUSDT",
        "LPTUSDT",
        "LRCUSDT",
        "LSKUSDT",
        "LTCUSDT",
        "LUNAUSDT",
        "MANAUSDT",
        "MASKUSDT",
        "MBLUSDT",
        "MDTUSDT",
        "MINAUSDT",
        "MLNUSDT",
        "MTLUSDT",
        "NEARUSDT",
        "NEOUSDT",
        "NMRUSDT",
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
        "STORJUSDT",
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
        "TRUUSDT",
        "TRXUSDT",
        "TUSDUSDT",
        "TWTUSDT",
        "UMAUSDT",
        "UNIUSDT",
        "USDCUSDT",
        "UTKUSDT",
        "VETUSDT",
        "VTHOUSDT",
        "WANUSDT",
        "WINUSDT",
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
        "NKNUSDT",
        "BARUSDT",
        "MBOXUSDT",
        "REQUSDT",
        "GHSTUSDT",
        "WAXPUSDT",
        "GNOUSDT",
        "XECUSDT",
        "DYDXUSDT",
        "IDEXUSDT",
        "USDPUSDT",
        "GALAUSDT",
        "ILVUSDT",
        "YGGUSDT",
        "SYSUSDT",
        "DFUSDT",
        "FIDAUSDT",
        "AGLDUSDT",
        "RADUSDT",
        "RAREUSDT",
        "LAZIOUSDT",
        "CHESSUSDT",
        "ADXUSDT",
        "AUCTIONUSDT",
        "MOVRUSDT",
        "CITYUSDT",
        "ENSUSDT",
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
        "SPELLUSDT",
        "JOEUSDT",
        "ACHUSDT",
        "IMXUSDT",
        "GLMRUSDT",
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
        "BIFIUSDT",
        "STEEMUSDT",
        "NEXOUSDT",
        "REIUSDT",
        "LDOUSDT",
        "OPUSDT",
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
        "RPLUSDT",
        "GNSUSDT",
        "SYNUSDT",
        "SSVUSDT",
        "LQTYUSDT",
        "USTCUSDT",
        "GASUSDT",
        "GLMUSDT",
        "PROMUSDT",
        "QKCUSDT",
        "IDUSDT",
        "ARBUSDT",
        "RDNTUSDT",
        "WBTCUSDT",
        "EDUUSDT",
        "SUIUSDT",
        "PEPEUSDT",
        "FLOKIUSDT",
        "MAVUSDT",
        "PENDLEUSDT",
        "ARKMUSDT",
        "WBETHUSDT",
        "WLDUSDT",
        "FDUSDUSDT",
        "SEIUSDT",
        "CYBERUSDT",
        "ARKUSDT",
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
        "KAIAUSDT",
        "COWUSDT",
        "CETUSUSDT",
        "PNUTUSDT",
        "ACTUSDT",
        "USUALUSDT",
        "THEUSDT",
        "ACXUSDT",
        "ORCAUSDT",
        "MOVEUSDT",
        "MEUSDT",
        "VELODROMEUSDT",
        "VANAUSDT",
        "1000CATUSDT",
        "PENGUUSDT",
        "BIOUSDT",
        "DUSDT",
        "AIXBTUSDT",
        "CGPTUSDT",
        "COOKIEUSDT",
        "SUSDT",
        "SOLVUSDT",
        "TRUMPUSDT",
        "ANIMEUSDT",
        "BERAUSDT",
        "1000CHEEMSUSDT",
        "TSTUSDT",
        "LAYERUSDT",
        "HEIUSDT",
        "KAITOUSDT",
        "SHELLUSDT",
        "REDUSDT",
        "GPSUSDT",
        "EPICUSDT",
        "BMTUSDT",
        "FORMUSDT",
        "XUSDUSDT",
        "NILUSDT",
        "PARTIUSDT",
        "MUBARAKUSDT",
        "TUTUSDT",
        "BANANAS31USDT",
        "BROCCOLI714USDT",
        "GUNUSDT",
        "BABYUSDT",
        "ONDOUSDT",
        "BIGTIMEUSDT",
        "VIRTUALUSDT",
        "KERNELUSDT",
        "WCTUSDT",
        "HYPERUSDT",
        "INITUSDT",
        "SIGNUSDT",
        "STOUSDT",
        "SYRUPUSDT",
        "KMNOUSDT",
        "SXTUSDT",
        "NXPCUSDT",
        "AWEUSDT",
        "HAEDALUSDT",
        "USD1USDT",
        "HUMAUSDT",
        "AUSDT",
        "SOPHUSDT",
        "RESOLVUSDT",
        "HOMEUSDT",
        "SPKUSDT",
        "NEWTUSDT",
        "SAHARAUSDT",
        "LAUSDT",
        "ERAUSDT",
        "CUSDT",
        "TREEUSDT",
        "A2ZUSDT",
        "TOWNSUSDT",
        "PROVEUSDT",
        "BFUSDUSDT",
        "PLUMEUSDT",
        "DOLOUSDT",
        "MITOUSDT",
        "WLFIUSDT",
        "SOMIUSDT",
        "OPENUSDT",
        "USDEUSDT",
        "LINEAUSDT",
        "HOLOUSDT",
        "PUMPUSDT",
        "AVNTUSDT",
        "ZKCUSDT",
        "SKYUSDT",
        "BARDUSDT",
        "0GUSDT",
        "HEMIUSDT",
        "XPLUSDT",
        "MIRAUSDT",
        "FFUSDT",
        "EDENUSDT",
        "NOMUSDT",
        "2ZUSDT",
        "MORPHOUSDT",
        "ASTERUSDT"
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

    // Moedas estáveis que não quero capturar
    let stableCurrencies = ["TUSDUSDT", "USDPUSDT", "FDUSDUSDT", "EURIUSDT", "XUSDUSDT", "USDCUSDT", "EURUSDT", "USDEUSDT", "USD1USDT", "BFUSDUSDT"];


    let filteredCurrenciesByBinanceWithUsdt = currencies.list.filter(currency => bincanceCurrenciesWithUsdt.includes(currency.symbol) && !stableCurrencies.includes(currency.symbol));

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