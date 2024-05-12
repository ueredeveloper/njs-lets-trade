const IndicatorModel = {

    ichimokuCloud: {
        type: 'ichimoku cloud',
        hide: false,
        intervals: new Set(['1h']),
        candle: 'close',
        line1: 'conversion',
        line2: 'base',
        compare: 'above',
        checked: false
    },
    movingAverage: {
        type: 'moving average',
        hide: false,
        intervals: new Set(['1h']),
        length: '200',
        candle: 'close',
        compare: 'bellow',
        checked: false
    },

    getIchimokuCloud: function () {
        return this.ichimokuCloud;
    },

    getMovingAverage: function () {
        return this.movingAverage;
    }
};

export default IndicatorModel;