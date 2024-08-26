import CurrencyModel from "../model/currency-model";

async function createMovingAverageFilter(array, intervals, acronym, condictionCallback) {

    intervals.forEach(interval => {

        let name = `${interval}|${acronym}`;

        // Cria uma array unidimensiona, ex: 
        let filter = {
            name: name,
            list: []
        }

        // Adiciona as moedas pesquisadas, editando com novas informações como ichimoku e ma-200 desta moeda.
        array.forEach(item => {

            let { symbol: _symbol, movingAverage: _movingAverage, candlesticks: _candlesticks, interval: _interval } = item;

            // É preciso comparar os intervalos, por isso nomeação em underline. Ex: _movingAverage.
            if (interval === _interval) {

                if (_movingAverage.length === 0) {
                    filter.list.push(`erro: ${_symbol}, moeda recente, sem candles suficientes.`)
                } else {

                    let lastCandlestick = _candlesticks.slice(-1)[0];
                    let lastMovingAverage = _movingAverage.slice(-1)[0];

                    if (condictionCallback(lastMovingAverage, lastCandlestick)) {
                        filter.list.push(_symbol);
                    }

                }
            }
            //CurrencyModel.addCurrency(item)

        });

        CurrencyModel.addFilter(filter)

    });


}

function movingAverageAboveCandleClose(lastMovingAverage, lastCandlestick) {

    let percentageDifference = ((lastCandlestick.close - lastMovingAverage) / lastMovingAverage) * 100;
    /*
    Último valor da média móvel maior que o último valor do fechamento do candle ou porcentagem do 
    primeiro valor sobre o segundo menor que 0,5%. Assim pega-se também aqueles valores um 
    pouco maiores que o valor do última média móvel.*/
    return lastMovingAverage > lastCandlestick.close || percentageDifference <= 0.51;
}
function movingAverageBellowCandleClose(lastMovingAverage, lastCandlestick) {
    let percentageDifference = ((lastCandlestick.close - lastMovingAverage) / lastMovingAverage) * 100;

    return lastMovingAverage < lastCandlestick.close || percentageDifference >= -0.51;;
}


export {
    createMovingAverageFilter, movingAverageAboveCandleClose, movingAverageBellowCandleClose
}