import CandleView from "../view/candle-view";

const CandleModel = {
  
  candles: [[
    {
      openTime: 0,
      open: '0',
      high: '0',
      low: '0',
      close: '0',
      volume: '0',
      closeTime: 0,
      quoteAssetVolume: '0',
      trades: 0,
      baseAssetVolume: '0',
    },
  ]],
  addCandle: function (item) {
    this.candles.push(item);
    // Notify the View of changes
    CandleView.renderList();
  },
  getCandles: async function () {
    return this.candles;
  }
};

export default CandleModel;