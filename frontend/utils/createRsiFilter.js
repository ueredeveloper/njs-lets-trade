import CurrencyModel from "../model/currency-model";

function createRsiFilter(array, intervals, acronym, condictionCallback) {


    let splitIntervals = intervals.split(',');

    splitIntervals.forEach(interval => {

        let name = `${interval}|${acronym}`;

        // Cria uma array unidimensiona, ex: 
        let filter = {
            name: name,
            list: []
        }
        // Adiciona as moedas pesquisadas, editando com novas informações como ichimoku e ma-200 desta moeda.
        array.forEach(items => {

            items.forEach(item => {

                let { symbol, rsiIndicator } = item;

                if (rsiIndicator.length === 0) {
                    filter.list.push(`erro: ${symbol}, moeda recente, sem candles suficientes.`)
                } else {

                    let lastRsi = rsiIndicator.slice(-1)[0];

                    if (condictionCallback(lastRsi)) {
                        filter.list.push(symbol);
                    }

                }

                CurrencyModel.addCurrency(item)
            })

        });
        CurrencyModel.addFilter(filter)

    });

}

function lastRsiAbove70(lastRsi) {
    return lastRsi > 70.0;
}

export {
    createRsiFilter,
    lastRsiAbove70
}