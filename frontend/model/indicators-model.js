import CurrencyView from "../view/currency-view";

const IndicatorModel = {
    
    indicators: ['ma-09', 'ma-21', 'ma-200', 'bb', 'ichimoku'],
    ichomokuLines: ['Conversion', 'Baseline', 'Span A', 'Span B' ],
    addIndicator: function (item) {
        this.indicators.push(item);
        // Notify the View of changes
        CurrencyView.renderList();
    },
    getIndicators: async function () {
        return this.indicators;
    },
    getIchimokuLines: function(){
        return this.ichomokuLines;
    }
};

export default IndicatorModel;