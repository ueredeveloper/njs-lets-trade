import CurrencyView from "../view/currency-view";

const IndicatorModel = {
    indicators: ['MA9', 'MA21', 'MA200', 'Bollinger Bands', 'Ichimoku Cloud'],
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