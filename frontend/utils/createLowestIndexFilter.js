import CurrencyModel from "../model/currency-model";

/**
 * Cria e registra filtros de moedas com base no índice de menor valor (lowestIndex)
 * entre os últimos períodos analisados.
 *
 * @async
 * @function createLowestIndexFilter
 * @description
 * Para cada intervalo informado, a função:
 * - Cria um nome no formato `${interval}|${acronym}`.
 * - Ordena o array de moedas pelo campo `lowestIndex` (do menor para o maior).
 * - Extrai apenas os símbolos das moedas ordenadas.
 * - Monta um objeto `filter` com o nome e a lista.
 * - Adiciona o filtro no `CurrencyModel` através de `CurrencyModel.addFilter(filter)`.
 *
 * @param {Array<Object>} array - Lista de objetos de moedas, contendo ao menos as propriedades `symbol` e `lowestIndex`.
 * @param {Array<string>} intervals - Lista de intervalos de tempo (ex: ["1h", "4h", "1d"]) usados para nomear os filtros.
 * @param {string} acronym - Sigla de referência usada na composição do nome do filtro (ex: "USDT").
 *
 * @returns {Promise<void>} Retorna uma Promise que é resolvida quando todos os filtros são criados e adicionados.
 *
 * @example
 * const array = [
 *   { symbol: "BTCUSDT", lowestIndex: 5 },
 *   { symbol: "ETHUSDT", lowestIndex: 3 },
 *   { symbol: "XRPUSDT", lowestIndex: 8 }
 * ];
 *
 * await createLowestIndexFilter(array, ["1h", "4h"], "USDT");
 * // Cria filtros com nomes "1h|USDT" e "4h|USDT" e adiciona ao CurrencyModel
 */
async function createLowestIndexFilter(array, intervals, acronym) {

    intervals.forEach(interval => {

        let name = `${interval}|${acronym}`;
        // Cria uma array unidimensiona, ex: 

        let filterListByInterval = array.filter(arr => arr.interval === interval)

        let filter = {
            name: name,
            list: filterListByInterval
                .sort((a, b) => a.lowestIndex - b.lowestIndex)
                .map(_arr => _arr.symbol)
        }

        CurrencyModel.addFilter(filter);

    });

}

export {
    createLowestIndexFilter
}