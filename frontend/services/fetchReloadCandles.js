async function fetchReloadCandles(symbol, interval = 'all') {
    const url = `http://localhost:3000/services/reload-candles?symbol=${symbol}&interval=${interval}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Erro ao recarregar candles: ${response.statusText}`);
    return response.json();
}

export default fetchReloadCandles;
