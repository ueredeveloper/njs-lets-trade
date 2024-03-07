/**
 * Função para buscar os dados de candlesticks e a Média Móvel Simples (SMA) para uma lista de moedas.
 * @param {Array<Object>} currencies - Array de objetos que contêm informações sobre as moedas.
 * @param {string} interval - O intervalo de tempo dos candlesticks.
 * @param {number} period - O período para calcular a Média Móvel Simples (SMA).
 * @returns {Promise<Array<Object>>} Uma promessa que resolve em uma matriz de objetos contendo os dados dos candlesticks e a SMA para cada moeda.
 */
const fetchCandlesAndSMA = (currencies, interval, period, limit) => {
  /**
 * Função interna para buscar os candlesticks e a SMA para um símbolo específico.
 * @param {string} symbol - O símbolo da moeda.
 * @param {string} interval - O intervalo de tempo dos candlesticks.
 * @returns {Promise<Object>} Uma promessa que resolve em um objeto contendo os dados dos candlesticks e a SMA para o símbolo especificado.
 */
  function _fetchCandlesAndSMA(symbol, limit, interval) {

    return new Promise(async (resolve, reject) => {
      try {
        // Fetch candlesticks
        let candlesticks = await fetch(`http://localhost:3000/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}`)
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

  // Mapeia as moedas para uma matriz de promessas
  let promises = currencies.map(currency => _fetchCandlesAndSMA(currency.symbol,limit, interval));

  // Usa o Promise.all para esperar que todas as promessas sejam resolvidas
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