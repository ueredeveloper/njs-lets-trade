
const fetchCandlesticksAndCloud = (currencies, interval) => {

  function _fetchCandlesticksAndCloud(symbol, interval) {

    return new Promise(async (resolve, reject) => {
      try {
        // Fetch candlesticks // valor padrão: 166
        let candlesticks = await fetch(`http://localhost:3000/services/candles/?symbol=${symbol}&limit=${266}&interval=${interval}`)
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
          // A array de candles deve 166 resultas e retornar assim 115 valores ichimoku
          body: JSON.stringify(candlesticks.slice(-166))
        }).then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.json();
        });

        // Fetch moving average 200 or period variable
        let period = 200
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
        resolve({ 'symbol': symbol, 'ichimoku': ichimokuCloud, 'candles': candlesticks, 'sma': sma });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Map the currencies to an array of promises
  let promises = currencies.map(currency => _fetchCandlesticksAndCloud(currency.symbol, interval));

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

export default fetchCandlesticksAndCloud;