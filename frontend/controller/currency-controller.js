import CurrencyModel from "../model/currency-model";
import { fetchAllCurrencies } from "../services/binance";
import CurrencyView from "../view/currency-view";

const CurrencyController = {
    init: async function () {
        // Buscando pela binanace
        // CurrencyModel.currencies = await fetchAllCurrencies();

        // Exemplo de teste com duas moedas
        let currencies = await [
            { "id": null, "symbol": "ETHBTC", "price": "0.05522000", "currency_collections": [[]] },
            { "id": null, "symbol": "LTCBTC", "price": "0.00131400", "currency_collections": [[]] },
        ]
        CurrencyModel.currencies = currencies;

        CurrencyView.init();
    },
    addCurrency: function (item) {
        CurrencyModel.addCurrency(item);
    }
};

export default CurrencyController;