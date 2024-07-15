

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

        // Calcula porcentagem entre candle close e último valor da média móvel
        let percentDiffX = (parseFloat(x.candleClose) - parseFloat(x.lastSMA)) / parseFloat(x.candleClose);
        let percentDiffY = (parseFloat(y.candleClose) - parseFloat(y.lastSMA)) / parseFloat(y.candleClose);
        // Compare the percentage differences
        return percentDiffY - percentDiffX;
    });

    return result;

}

export { sortCoinsByProximity }