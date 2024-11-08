import CurrencyModel from "../model/currency-model";
import { fetchAllCurrencies } from "../services/binance";
import CurrencyView from "../view/currency-view";


const CurrencyController = {
    init: async function () {
        // Buscando pela binanace
        CurrencyModel.currencies = {name: '1h|All', list: await fetchAllCurrencies()};

        CurrencyView.init();
    },
    addCurrency: function (item) {
        CurrencyModel.addCurrency(item);
    }
};

export default CurrencyController;