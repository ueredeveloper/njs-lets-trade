
const fetchCandlesAndMovingAverage = (currencies, intervals, period) => {


  function _fetchCandlesAndMovingAverage(symbol, intervals, period) {

    return new Promise(async (resolve, reject) => {

      let results = []

      // Cria array de intervalos solicitados
      let array = intervals.split(',')

      for (const interval of array) {

        try {
          // Fetch candlesticks // valor padrão: 166
          let candlesticks = await fetch(`http://localhost:3000/services/candles/?symbol=${symbol}&limit=${266}&interval=${interval}`)
            .then(response => {
              if (!response.ok) {
                throw new Error('Network response was not ok');
              }
              return response.json();
            });

          // Fetch moving average 200 or period variable

          let movingAverage = await fetch(`http://localhost:3000/services/sma?period=${period}`, {
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

          let movingAverage50 = await fetch(`http://localhost:3000/services/sma?period=${50}`, {
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

          results.push({
            symbol: symbol,
            // Adiciona o fechamento do último preço
            price: candlesticks.slice(-1)[0].close,
            interval: interval,
            candlesticks: candlesticks,
            movingAverage: movingAverage,
            movingAverage50: movingAverage50
          })

          // Resolve with the data
          resolve(results);
        } catch (error) {
          reject(error);
        }


      }

      return results;

    });
  }

  // Map the currencies to an array of promises
  // Se quiser pesquisar somente 20 moedas para teste, adicione .slice(0, 20)
  let promises = currencies.map(currency => _fetchCandlesAndMovingAverage(currency.symbol, intervals, period));

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

export default fetchCandlesAndMovingAverage;