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
                filter.list.push(`erro: ${symbol}, moeda recente, sem candles suficientes.`)
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

    let percentageDifference  = ((lastCandlestick.close - lastMovingAverage) / lastMovingAverage) * 100;
    /*
    Último valor da média móvel maior que o último valor do fechamento do candle ou porcentagem do 
    primeiro valor sobre o segundo menor que 2%. Assim pega-se também aqueles valores um 
    pouco maiores que o valor do última média móvel.*/
    return lastMovingAverage > lastCandlestick.close || percentageDifference <=1.01;
}
function movingAverageBellowCandleClose(lastMovingAverage, lastCandlestick) {
    let percentageDifference  = ((lastCandlestick.close - lastMovingAverage) / lastMovingAverage) * 100;

    return lastMovingAverage < lastCandlestick.close || percentageDifference >=-1.01;;
}


export {
    createMovingAverageFilter, movingAverageAboveCandleClose, movingAverageBellowCandleClose
}