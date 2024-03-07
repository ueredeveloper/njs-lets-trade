import CurrencyModel from "../model/currency-model";
import IntervalController from "../controller/interval-controller";
import fetchCandlesticksAndCloud from "../services/fetchCandlesAndIchimokuCloud";

const CandleView = {

  init: async function () {

    this.div = $('#candles-container');
    // Adiciona a tag para os intervalos.
    this.div.append($('<div id="list-intervals"></div>'));
    // Inicializa os intervalos na tag criada.
    IntervalController.init();

    this.interval = '1h';

    $(document).on('intervalChanged', (event, value) => {
      this.interval = value;
    });

    $(document).on('onClickButtonIndicatorView', async (event) => {

     let results =  await fetchCandlesticksAndCloud(CurrencyModel.currencies, this.interval)

     console.log(results)

     /* function fetchCandlesticksAndCloud(currency, interval) {

        return new Promise(async (resolve, reject) => {
          try {
            // Fetch candlesticks
            let candlesticks = await fetch(`http://localhost:3000/services/candles/?symbol=${currency.symbol}&limit=${166}&interval=${interval}`)
              .then(response => {
                if (!response.ok) {
                  throw new Error('Network response was not ok');
                }
                return response.json();
              });

            // Fetch ichimoku cloud
            let ichimokuCloud = await fetch('http://localhost:3000/services/ichimoku-cloud', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(candlesticks)
            }).then(response => {
              if (!response.ok) {
                throw new Error('Network response was not ok');
              }
              return response.json();
            });

            // Resolve with the data
            resolve({ currency, ichimokuCloud });
          } catch (error) {
            reject(error);
          }
        });
      }

      let coins = [];

      // Map the currencies to an array of promises
      let promises = CurrencyModel.currencies.map(currency => fetchCandlesticksAndCloud(currency, this.interval));

      // Use Promise.all to wait for all promises to resolve
      Promise.all(promises)
        .then(results => {
          results.forEach(result => {
            let { currency, ichimokuCloud } = result;

            if (ichimokuCloud[114].base > ichimokuCloud[114].conversion) {
              coins.push(currency.symbol);
            }
          });
          console.log(coins); // You can access coins here
        })
        .catch(error => {
          console.error('Error:', error);
        });*/




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
