import CurrencyModel from "../model/currency-model";
import IntervalController from "../controller/interval-controller";
import fetchCandlesticksAndCloud from "../services/fetchCandlesAndIchimokuCloud";
import ichimokuLinesCompartions from "../utils/compareIchimokuLines";
import compareIchimokuLines from "../utils/compareIchimokuLines";
import fetchCandlesAndSMA from "../services/fetchCandlesAndSMA";

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

    $(document).on('intervalChanged', (event, value) => {
      this.interval = value;
    });

    $(document).on('onIndicatorChange', async (event, params) => {
      this.indicatorParams = params;
      console.log( this.indicatorParams.line1 + '|' + this.indicatorParams.compare + '|' + this.indicatorParams.line2
      )
    })

    $(document).on('onClickButtonIndicatorView', async (event) => {

    
      let indicator = this.indicatorParams.indicator;

      let condition = this.indicatorParams.line1 + '|' + this.indicatorParams.compare + '|' + this.indicatorParams.line2;


     /* if (this.indicatorParams.indicator == "Ichimoku") {
        let result = await ichimokuLinesCompartions(symbolCandlesAndIchimoku, condition)

        console.log(result)
      } else {
        console.log(indicator)
      }*/

       /*
    indicators: ['MA09', 'MA21', 'MA200', 'Bollinger Bands', 'Ichimoku Cloud'],
    ichomokuLines: ['Conversion', 'Baseline', 'Span A', 'Span B' ]
    */

      switch (this.indicatorParams.indicator) {
        case 'MA09':
            let symbolCandlesandSMA = await fetchCandlesAndSMA(CurrencyModel.currencies, this.interval, 66);
            //let result  = await compare
            break;
        case 'MA21':
            console.log(' iMA21')
            break;
            case 'MA200':
            console.log(' ima200')
            break;
            case 'Bollinger Bands':
            console.log(' iboll')
            break;
        default:
          //Busca candles e ichimoku cloud
          let symbolCandlesAndIchimoku = await fetchCandlesticksAndCloud(CurrencyModel.currencies, this.interval)
          // Compara as linhas ichimoku
          let result = await compareIchimokuLines(symbolCandlesAndIchimoku, condition)

          console.log(result)
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
