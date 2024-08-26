const compareIchimokuLines = async (symbolCandlesAndIchimoku, condition) => {

    /*let symbolCandlesAndIchimoku = [{
        "symbol": "BTCUSDT",
        "price": "71220.00000000",
        "interval": "1h",
        "ichimokuCloud": [
            {
                "conversion": 65677.39,
                "base": 65677.39,
                "spanA": 65677.39,
                "spanB": 63955.674999999996
            },
            
        ],
        "candlesticks": [
            {
                "openTime": 1715342400000,
                "open": "63299.63000000",
                "high": "63469.13000000",
                "low": "62939.00000000",
                "close": "63007.92000000",
                "volume": "1387.45502000",
                "closeTime": 1715345999999,
                "quoteVolume": "87725457.42486560",
                "trades": 65179,
                "baseAssetVolume": "672.10137000",
                "quoteAssetVolume": "42504331.02000510"
            },
          
        ],
        "movingAverage": [63418.2203, 63438.00075,...]
    }]
    */

    let results = []

    symbolCandlesAndIchimoku.forEach(({ ichimokuCloud, symbol }) => {

        /* 
            Lines of Ichimoku 
                base conversion spanA spanB

            IndicatorModel.ichomokuLines: ['Conversion', 'Baseline', 'Span A', 'Span B' ],

        */

        if (ichimokuCloud.length === 0) {
            results.push(`${symbol}, moeda recente, sem candles suficientes.`)
        } else {


            let lastIchimokuValue = ichimokuCloud.slice(-1)[0];

            switch (condition) {

                // Se a solicitação é a linha de conversão abaixo da linha base. Considerando a comparação da última linha ichimoku.
                case 'Conversion|below|Baseline':
                    if (lastIchimokuValue.conversion < lastIchimokuValue.base) {
                        //results.push({symbol, lastIchimokuValue});
                        results.push(symbol);
                    }

                    break;
                case 'ichimokuCloud|conversion|above|base':
                    if (lastIchimokuValue.conversion > lastIchimokuValue.base || lastIchimokuValue.conversion === lastIchimokuValue.base) {
                        //results.push({symbol, lastIchimokuValue});
                        results.push(symbol);
                    }
                    break;
                case 'Conversion|above|span A':
                    // comparação com 25 períodos anteriores da spanA e spanB
                    let spanA = ichimokuCloud.slice(-25)[0].spanA;
                    let spanB = ichimokuCloud.slice(-25)[0].spanB;
                    if (lastIchimokuValue.conversion > spanA && lastIchimokuValue.conversion > spanB) {
                        //results.push({ symbol: symbol, conversion: lastIchimokuValue.conversion, spanA: spanA, spanB: spanB });
                        results.push(symbol);
                    }
                    break;
                default:
                    console.log('No matching condition found');

            }

        }

    });

    /*symbolCandlesAndIchimoku.forEach(({ sma, symbol, candlesticks }) => {


        let lastCandlesticks = candlesticks.slice(-1)[0]

        let lastSMA = sma.slice(-1)[0];
        //Se SMA acima do último candlestick(close)
        if (lastSMA > lastCandlesticks.close) {
            //results.push({ symbol, lastSMA, lastCandlesticks });
            results.push(symbol);
        }

    });*/

    return results;
}
export default compareIchimokuLines;