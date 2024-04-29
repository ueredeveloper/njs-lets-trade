const compareCandlesAndSMA = async (symbolCandlesAndSMA) => {

    /*
    {
        "symbol": "ETHBTC",
        "sma": [0.05707, 0.05693, ...],
        "candlesticks": [
            {
                "openTime": 1709776800000,
                "open": "0.05768000",
                "high": "0.05770000",
                "low": "0.05722000",
                "close": "0.05725000",
                "volume": "1638.11010000",
                "closeTime": 1709780399999,
                "quoteVolume": "94.07543848",
                "trades": 4589,
                "baseAssetVolume": "651.14570000",
                "quoteAssetVolume": "37.38858456"
            },
            
            
        ]
    }
    */

    let results = []

    symbolCandlesAndSMA.forEach(({ sma, symbol, candlesticks }) => {

        let lastCandlesticks = candlesticks.slice(-1)[0]

        let lastSMA = sma.slice(-1)[0];
        //Se SMA acima do último candlestick(close)
        if (lastSMA > lastCandlesticks.close) {
            //results.push({ symbol, lastSMA, lastCandlesticks });
            results.push(symbol);
        }

    });

    return results;
}

export default compareCandlesAndSMA;