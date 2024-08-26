
const fetchCandlesAndIndicators = async (currencies, intervals) => {

  
  async function _fetch(symbol, intervals) {

    // Array para armazenar todas as Promises de requisições
    let promises = [];

    for (const interval of intervals) {
      try {
        // Fetch candlesticks
        let candlesticks = await fetch(`http://localhost:3000/services/candles/?symbol=${symbol}&limit=266&interval=${interval}`)
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
          body: JSON.stringify(candlesticks.slice(-166))
        }).then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.json();
        });

        // Fetch moving average
        let period = 200;
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

        // Fetch RSI indicator
        let rsiIndicator = await fetch('http://localhost:3000/services/rsi', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(candlesticks.slice(-166))
        }).then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.json();
        });

        // Adicione todas as Promises ao array de promises
        promises.push(Promise.all([candlesticks, ichimokuCloud, movingAverage, rsiIndicator])
          .then(([candlesticks, ichimokuCloud, movingAverage, rsiIndicator]) => {
            return {
              symbol: symbol,
              price: candlesticks.slice(-1)[0].close,
              interval: interval,
              candlesticks: candlesticks,
              ichimokuCloud: ichimokuCloud,
              movingAverage: movingAverage,
              rsiIndicator: rsiIndicator
            };
          })
        );

      } catch (error) {
        console.error(`Error fetching data for ${symbol} (${interval}):`, error);
      }
    }

    // Espere todas as promises serem resolvidas antes de retornar
    return Promise.all(promises);
  }

  try {
    // Map as moedas para um array de promises
    let promises = currencies.map(currency => _fetch(currency.symbol, intervals));

    // Espere que todas as promises sejam resolvidas
    let results = await Promise.all(promises);
    return results.flat(); // Retorna um array plano de resultados

  } catch (error) {
    console.error('Error fetching data:', error);
    return []; // Em caso de erro, retorne um array vazio ou trate conforme necessário
  }
}

export default fetchCandlesAndIndicators;