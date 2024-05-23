import CurrencyModel from "../model/currency-model";

function createIchimokuFilter(array, name, condictionCallback) {
    // Cria uma array unidimensiona, ex: 
    let filter = {
        name: name,
        list: []
    }
    // Adiciona as moedas pesquisadas, editando com novas informações como ichimoku e ma-200 desta moeda.
    array.forEach(items => {
        items.forEach(item => {

            let { symbol, ichimokuCloud, candlesticks } = item;

            if (ichimokuCloud.length === 0) {
                filter.list.push(`erro: ${symbol}, moeda recente, sem candles suficientes.`)
            } else {

                let lastIchimokuValue = ichimokuCloud.slice(-1)[0];
                let lastCandlestick = candlesticks.slice(-1)[0];
                let spanA = ichimokuCloud.slice(-25)[0].spanA;
                let spanB = ichimokuCloud.slice(-25)[0].spanB;
                // spanA e B são 25 períodos adiantadas, então é preciso comparar com 25 períodos antes.


                if (condictionCallback(lastIchimokuValue, lastCandlestick, spanA, spanB)) {
                    //results.push({symbol, lastIchimokuValue});
                    filter.list.push(symbol);
                }

            }

            CurrencyModel.addCurrency(item)
        })

    });
    CurrencyModel.addFilter(filter)
}

function conversionAboveBase(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > lastIchimokuValue.base;
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
    return lastIchimokuValue.conversion > lastCandlestick.high;;
}
function conversionAboveLowCandle(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > lastCandlestick.low;;
}
function conversionAboveCloseCandle(lastIchimokuValue, lastCandlestick, spanA, spanB) {
    return lastIchimokuValue.conversion > lastCandlestick.close;;
}


export {
    createIchimokuFilter, conversionAboveBase,
    conversionAboveSpanA, conversionAboveSpanB,
    conversionAboveSpanAAndSpanB, conversionAboveHighCandle,
    conversionAboveLowCandle, conversionAboveCloseCandle
}