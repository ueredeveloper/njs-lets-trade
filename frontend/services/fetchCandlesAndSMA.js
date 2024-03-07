
const fetchCandlesAndSMA = (currencies, interval, period)=>{
    
    function _fetchCandlesAndSMA(symbol, interval) {

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
            let sma = await fetch(`http://localhost:3000/services/sma?period=${period}`, {
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
            resolve({ symbol, sma, candlesticks });
          } catch (error) {
            reject(error);
          }
        });
      }

      // Map the currencies to an array of promises
      let promises = currencies.map(currency => _fetchCandlesAndSMA(currency.symbol, interval));

      // Use Promise.all to wait for all promises to resolve
      let results = Promise.all(promises)
        .then(results => {
            return results;
        })
        .catch(error => {
          console.error('Error:', error);
        });

        return results;

}

export default fetchCandlesAndSMA;