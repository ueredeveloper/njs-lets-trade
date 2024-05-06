

function sortCoinsByProximity(coins) {

    /*
    [
        {
        "symbol": "NEOUSDT",
        "lastSMA": 16.954200000000004,
        "candleClose": "16.63000000"
        },
        ...
    ]
    */
    let result = coins.sort((x, y) => {

        //Comparação sma e candle
        let _x = (Number(x.candleClose) - Number(x.lastSMA)) / Number(x.candleClose)
        // Comparação sma e candle
        let _y = (Number(y.candleClose) - Number(y.lastSMA)) / Number(y.candleClose)
        // comparação para ordenamento
        return _x - _y
    });

    return result;

}

export { sortCoinsByProximity }