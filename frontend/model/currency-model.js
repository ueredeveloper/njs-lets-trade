import fetch24hVolume from "../services/fetch24HsVolume";

// model/currency-model.js
const CurrencyModel = {
  currencies: [],
  filters: [],
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
    let stableCurrencies = [
      "TUSDUSDT",
      "USDPUSDT",
      "FDUSDUSDT",
      "EURIUSDT",
      "XUSDUSDT",
      "USDCUSDT",
      "EURUSDT",
      "USDEUSDT",
      "USD1USDT",
      "BFUSDUSDT",
      "NEXOUSDT",
      "FXSUSDT",
      "AEURUSDT",
      "PAXGUSDT",
      "FDUSDUSDT"
    ];


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

      // Captura a primeira lista, que tem todas moedas listadas na binance
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
  },

  get24hsVolume: async function () {

    let filteredVolumes = await fetch24hVolume();

    this.filters = [...this.filters, ...filteredVolumes]
  }

};

export default CurrencyModel;