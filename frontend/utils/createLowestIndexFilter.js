import CurrencyModel from "../model/currency-model";

async function createLowestIndexFilter(array, intervals, acronym) {

    intervals.forEach(interval => {

        let name = `${interval}|${acronym}`;

        let list = array.sort((a, b) => a.lowestIndex - b.lowestIndex).map(_arr => _arr.symbol)

        console.log(list, array.sort((a, b) => a.lowestIndex - b.lowestIndex).map(_arr => _arr.lowestIndex))

        // Cria uma array unidimensiona, ex: 
        let filter = {
            name: name,
            list: list
        }

        CurrencyModel.addFilter(filter)

    });


}

export {
    createLowestIndexFilter
}