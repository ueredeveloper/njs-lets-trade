const getClient = require('./getClient');

module.exports = getAllCurrencies = async function (symbol, interval, limit) {
    try {
        let client = await getClient();
        let currenciesSymbolPrices = await client.prices();
        const currencies = Object.entries(currenciesSymbolPrices).map(([symbol, price]) => ({
            id: null,
            symbol: symbol,
            price: price,
            currency_collections: [[]]
        }));
        return currencies;
    } catch (error) {
        console.error('Error fetching prices:', error);
    }
    return candles;
}