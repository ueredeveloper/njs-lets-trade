import CurrencyModel from "../model/currency-model";
import IntervalController from "../controller/interval-controller";
import fetchCandlesticksAndCloud from "../services/fetchCandlesAndIchimokuCloud";
import ichimokuLinesCompartions from "../utils/compareIchimokuLines";
import compareIchimokuLines from "../utils/compareIchimokuLines";
import fetchCandlesAndSMA from "../services/fetchCandlesAndSMA";
import compareCandlesAndSMA from "../utils/compareCandlesAndSMA";

const CandleView = {

  init: async function () {

    this.div = $('#candles-container');
    // Adiciona a tag para os intervalos.
    this.div.append($('<div id="list-intervals"></div>'));
    // Inicializa os intervalos na tag criada.
    IntervalController.init();

    this.interval = '1h';
    this.indicatorParams = {
      "line1": "conversionLine",
      "compare": "below",
      "line2": "baseLine",
      "indicator": "Ichimoku"
    }

    this.filteredCurrencyByQuote = []
    this.filteredCurrenciesByBinanceUSDT =[];
    
    $(document).on('intervalChanged', (event, value) => {
      this.interval = value;
    });

    $(document).on('onIndicatorChange', async (event, params) => {
      this.indicatorParams = params;
    })

    $(document).on('onClickButtonIndicatorView', async (event) => {


      let indicator = this.indicatorParams.indicator;

      let condition = this.indicatorParams.line1 + '|' + this.indicatorParams.compare + '|' + this.indicatorParams.line2;

      let symbolCandlesAndSMA;
      let smaResult;

      /** é preciso criar um método que filtre por cotação (USDT, BNB, BTC) e por moedas presentes na binance(JASMYUSDT, ...) */

      this.filteredCurrencyByQuote = await CurrencyModel.currencies.filter(currency => currency.symbol.endsWith('USDT'));

      this.filteredCurrenciesByBinanceUSDT = await CurrencyModel.currencies.filter(currency => CurrencyModel.binanceUSDT.includes(currency.symbol));


      switch (this.indicatorParams.indicator) {
        case 'MA09':
          symbolCandlesAndSMA = await fetchCandlesAndSMA(this.filteredCurrenciesByBinanceUSDT, this.interval, 9, 21);
          smaResult = await compareCandlesAndSMA(symbolCandlesAndSMA);
          console.log(smaResult)
          break;
        case 'MA21':
          symbolCandlesAndSMA = await fetchCandlesAndSMA(this.filteredCurrenciesByBinanceUSDT, this.interval, 21, 32);
          smaResult = await compareCandlesAndSMA(symbolCandlesAndSMA);
          console.log(smaResult)
          break;
        case 'MA200':
          symbolCandlesAndSMA = await fetchCandlesAndSMA(this.filteredCurrenciesByBinanceUSDT, this.interval, 200, 232);
          smaResult = await compareCandlesAndSMA(symbolCandlesAndSMA);
          console.log(smaResult)
          break;
        case 'Bollinger Bands':
          console.log('bollinger bands')
          break;
        default:
          //Busca candles e ichimoku cloud
          let symbolCandlesAndIchimoku = await fetchCandlesticksAndCloud(this.filteredCurrenciesByBinanceUSDT, this.interval)
          // Compara as linhas ichimoku
          let result = await compareIchimokuLines(symbolCandlesAndIchimoku, condition)
          
          console.log(this.interval, condition, result)
      }

    });



    this.renderList();


  },
  renderList: async function () {

    /*let currencies = await CurrencyModel.getCurrencies();
    let currenciesFilteredByQuote = this.filterCurrenciesByQuote(currencies, 'USDT')

    this.createTable(this.currenciesTable)

    this.fillTable(this.currenciesTable, currenciesFilteredByQuote)*/

    this.div.append(`<p> Hello World Candle Container</p>`);

  },
  getInverval: () => {
    return CandleView.interval;
  }

};

export default CandleView;
