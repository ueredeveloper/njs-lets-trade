import IndicatorModel from "../model/indicators-model";
import IndicatorView from "../view/indicator-view";



const IndicatorController = {
    init: async function () {
        IndicatorView.init();
    },
    addCurrency: function (item) {
        IndicatorModel.addIndicator(item)
    }
};

export default IndicatorController;