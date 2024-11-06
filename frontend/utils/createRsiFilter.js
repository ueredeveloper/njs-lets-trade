import CurrencyModel from "../model/currency-model";

function createRsiFilter(array, intervals, acronym, condictionCallback) {

    /*
    example of objects and arrays:

        acronym = 'r|a|6|b|7'

        intervals = [
                [
                    "1h"
                ]
            ]

        array = [
            {
                "symbol": "BTCUSDT",
                "price": "64137.03000000",
                "interval": [
                    "1h"
                ],
                "candlesticks": [
                    {
                        "openTime": 1723546800000,
                        "open": "58672.09000000",
                        "high": "58904.00000000",
                        "low": "58563.99000000",
                        "close": "58830.00000000",
                        "volume": "509.25128000",
                        "closeTime": 1723550399999,
                        "quoteVolume": "29919669.81605020",
                        "trades": 41097,
                        "baseAssetVolume": "245.96266000",
                        "quoteAssetVolume": "14453341.11635920"
                    },
                
                ],
                "rsiIndicator": [
                    51.76,
                    53.6,
                
                ]
            }
        ]
    */


    // let splitIntervals = intervals.split(',');

    intervals.forEach(interval => {

        let name = `${interval}|${acronym}`;

        // Cria uma array unidimensiona, ex: 
        let filter = {
            name: name,
            list: []
        }
        // Adiciona as moedas pesquisadas, editando com novas informações como ichimoku e ma-200 desta moeda.
        array.forEach(item => {

            let { symbol: _symbol, rsiIndicator: _rsiIndicator, candlesticks: _candlesticks, interval: _interval } = item;

            if (interval === _interval) {

                if (_rsiIndicator.length === 0) {
                    filter.list.push(`erro: ${_symbol}, moeda recente, sem candles suficientes.`)
                } else {

                    let lastRsi = _rsiIndicator.slice(-1)[0];

                    if (condictionCallback(lastRsi)) {
                        filter.list.push(_symbol);
                    }

                }
            }
            //CurrencyModel.addCurrency(item)
        });

        CurrencyModel.addFilter(filter);
    });

}

function lastRsiAbove10Bellow20(lastRsi) {
    return lastRsi > 10.0 && lastRsi < 20.0;
}
function lastRsiAbove20Bellow30(lastRsi) {
    return lastRsi > 20.0 && lastRsi < 30.0;
}

function lastRsiAbove30Bellow40(lastRsi) {
    return lastRsi > 30.0 && lastRsi < 40.0;
}
function lastRsiAbove40Bellow50(lastRsi) {
    return lastRsi > 40.0 && lastRsi < 50.0;
}
function lastRsiAbove50Bellow60(lastRsi) {
    return lastRsi > 50.0 && lastRsi < 60.0;
}
function lastRsiAbove60Bellow70(lastRsi) {
    return lastRsi > 60.0 && lastRsi < 70.0;
}
function lastRsiAbove70Bellow80(lastRsi) {
    return lastRsi > 70.0 && lastRsi < 80.0;
}


export {
    createRsiFilter,
    lastRsiAbove10Bellow20,
    lastRsiAbove20Bellow30,
    lastRsiAbove30Bellow40,
    lastRsiAbove40Bellow50,
    lastRsiAbove50Bellow60,
    lastRsiAbove60Bellow70,
    lastRsiAbove70Bellow80,

}