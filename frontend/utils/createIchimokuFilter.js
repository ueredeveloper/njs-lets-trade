import CurrencyModel from "../model/currency-model";

async function createIchimokuFilter(array, intervals, acronym, condictionCallback) {

    intervals.forEach(interval => {

        let name = `${interval}|${acronym}`;
        // Cria uma array unidimensiona, ex: 
        let filter = {
            name: name,
            list: []
        }

        // Adiciona as moedas pesquisadas, editando com novas informações como ichimoku e ma-200 desta moeda.
        array.forEach(item => {

            let { symbol: _symbol, ichimokuCloud: _ichimokuCloud, candlesticks: _candlesticks, interval: _interval } = item;
            /*
            example

            Ichimoku Cloud

            [{
                "conversion": 59261.494999999995,
                "base": 59974.115000000005,
                "spanA": 59617.805,
                "spanB": 59593.65
            },
            ...
            ]


            Moving Average

            [
                59437.52915000004,
                59449.45855000003,
            ]



            rsi

            [
                55.22,
                55.01,
                53.99,
                56.2,
                ... 
            ]

            candle 

            [{
                "openTime": 1723676400000,
                "open": "58985.99000000", // converter, string para float
                "high": "59022.50000000",
                "low": "58673.81000000",
                "close": "58683.39000000",
                "volume": "465.60977000",
                "closeTime": 1723679999999,
                "quoteVolume": "27405997.55307920",
                "trades": 32397,
                "baseAssetVolume": "206.78628000",
                "quoteAssetVolume": "12173559.68012180"
            }]
    */
            if (interval === _interval) {

                if (_ichimokuCloud.length === 0) {
                    filter.list.push(`erro: ${_symbol}, moeda recente, sem candles suficientes.`)
                } else {

                    let lastIchimokuValue = _ichimokuCloud.slice(-1)[0];
                    let lastCandlestick = _candlesticks.slice(-1)[0];
                    let spanA = _ichimokuCloud.slice(-25)[0].spanA;
                    let spanB = _ichimokuCloud.slice(-25)[0].spanB;
                    // spanA e B são 25 períodos adiantadas, então é preciso comparar com 25 períodos antes.

                    if (condictionCallback(lastIchimokuValue, lastCandlestick, spanA, spanB)) {
                        //results.push({symbol, lastIchimokuValue});

                        filter.list.push(_symbol);
                    }
                }
            }
            // atualiza moeda  
            // CurrencyModel.addCurrency(item);
        });

        /* Exemplo de filtro: {
            "name": "1h|i|conversion|a|base",
            "list": [
                "BTCUSDT",
                "ETHUSDT",
                ...
            ]
        }*/
        // adiciona filtro
        CurrencyModel.addFilter(filter);
    });
}

function conversionAboveBase(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > lastIchimokuValue.base;
}
function conversionBellowBase(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion < lastIchimokuValue.base;
}
function conversionAboveSpanA(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > spanA;
}
function conversionAboveSpanB(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > spanB;
}
function conversionAboveSpanAAndSpanB(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > spanA & lastIchimokuValue.conversion > spanB;;
}
function conversionAboveHighCandle(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > parseFloat(lastCandlestick.high);
}
function conversionAboveLowCandle(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > parseFloat(lastCandlestick.low);
}
function conversionAboveCloseCandle(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > parseFloat(lastCandlestick.close);
}


export {
    createIchimokuFilter, conversionAboveBase, conversionBellowBase,
    conversionAboveSpanA, conversionAboveSpanB,
    conversionAboveSpanAAndSpanB, conversionAboveHighCandle,
    conversionAboveLowCandle, conversionAboveCloseCandle
}