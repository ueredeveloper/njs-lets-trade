import CurrencyModel from "../model/currency-model";

const fetchCandlesticksAndCloud = (currencies, interval)=>{
    
    function fetchCandlesticksAndCloud(symbol, interval) {

        return new Promise(async (resolve, reject) => {
          try {
            // Fetch candlesticks
            let candlesticks = await fetch(`http://localhost:3000/services/candles/?symbol=${symbol}&limit=${166}&interval=${interval}`)
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
            resolve({ symbol, ichimokuCloud, candlesticks });
          } catch (error) {
            reject(error);
          }
        });
      }

      // Map the currencies to an array of promises
      let promises = currencies.map(currency => fetchCandlesticksAndCloud(currency.symbol, interval));

      // Use Promise.all to wait for all promises to resolve
      let results = Promise.all(promises)
        .then(results => {
            return results;

            /*
          results.forEach(result => {
            let { currency, ichimokuCloud } = result;

            if (ichimokuCloud[114].base > ichimokuCloud[114].conversion) {
              coins.push(currency.symbol);
            }
          });
          console.log(coins); // You can access coins here
          */
        })
        .catch(error => {
          console.error('Error:', error);
        });


        return results;

    
}

export default fetchCandlesticksAndCloud;