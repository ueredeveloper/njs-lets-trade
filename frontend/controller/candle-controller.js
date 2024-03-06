import CandleModel from "../model/candle-model";
import CandleView from "../view/candle-view";



const CandleController = {
    init: async function () {
        // Buscando pela binanace
        //CurrencyModel.currencies = await fetchAllCurrencies();

        

        CandleView.init();
    },
    addCurrency: function (item) {
        CandleModel.addCurrency(item);
    }
};

export default CandleController;