import CurrencyView from "../view/currency-view";

const IntervalModel = {
  
  
    intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '8h', '1d'],
    addInterval: function(item) {
      this.intervals.push(item);
      // Notify the View of changes
      CurrencyView.renderList();
    },
    getIntervals: async function() {
      return this.intervals;
    }
  };

  export default IntervalModel;