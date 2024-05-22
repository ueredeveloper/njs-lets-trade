import CurrencyModel from "../model/currency-model";

function createMovingAverageFilter(array, name, condictionCallback) {
    // Cria uma array unidimensiona, ex: 
    let filter = {
        name: name,
        list: []
    }
    // Adiciona as moedas pesquisadas, editando com novas informações como ichimoku e ma-200 desta moeda.
    array.forEach(items => {
        items.forEach(item => {

            let { symbol, movingAverage, candlesticks } = item;

            if (movingAverage.length === 0) {
                results.push(`erro: ${symbol}, moeda recente, sem candles suficientes.`)
            } else {

                let lastCandlestick = candlesticks.slice(-1)[0];
                let lastMovingAverage = movingAverage.slice(-1)[0];
            
                if (condictionCallback(lastMovingAverage, lastCandlestick)) {
                    filter.list.push(symbol);
                }

            }

            CurrencyModel.addCurrency(item)
        })

    });
    CurrencyModel.addFilter(filter)
}

function movingAverageAboveCandleClose(lastMovingAverage, lastCandlestick) {
    return lastMovingAverage > lastCandlestick.close;
}
function movingAverageBellowCandleClose(lastMovingAverage, lastCandlestick) {
    return lastMovingAverage < lastCandlestick.close;
}


export {
    createMovingAverageFilter, movingAverageAboveCandleClose, movingAverageBellowCandleClose
}