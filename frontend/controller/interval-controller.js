import IntervalModel from "../model/interval-model";
import IntervalView from "../view/interval-view";


const IntervalController = {
    init: async function () {
        IntervalView.init();
    },
    addCurrency: function (item) {
        IntervalModel.addIndicator(item)
    }
};

export default IntervalController;