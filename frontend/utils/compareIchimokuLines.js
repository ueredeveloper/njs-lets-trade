const compareIchimokuLines = async (symbolCandlesAndIchimoku, condition) => {

    //console.log('compare inchimoku lines ', symbolCandlesAndIchimoku)

    // let { candlesticks, ichimoku, symbol } = symbolCandlesAndIchimoku;

    let results = []

    symbolCandlesAndIchimoku.forEach(({ ichimoku, symbol }) => {

        /* 
            Lines of Ichimoku 
                base conversion spanA spanB

            IndicatorModel.ichomokuLines: ['Conversion', 'Baseline', 'Span A', 'Span B' ],

        */

        if (ichimoku.length === 0) {
            results.push(`moeda recente: ${symbol}, + sem candles suficientes.`)
        } else {


            let lastIchimoku = ichimoku.slice(-1)[0];

            switch (condition) {

                // Se a solicitação é a linha de conversão abaixo da linha base. Considerando a comparação da última linha ichimoku.
                case 'Conversion|below|Baseline':
                    if (lastIchimoku.conversion < lastIchimoku.base) {
                        //results.push({symbol, lastIchimoku});
                        results.push(symbol);
                    }

                    break;
                case 'Conversion|above|Baseline':
                    if (lastIchimoku.conversion > lastIchimoku.base || lastIchimoku.conversion === lastIchimoku.base) {
                        //results.push({symbol, lastIchimoku});
                        results.push(symbol);
                    }
                    break;
                case 'Conversion|above|span A':
                    // comparação com 25 períodos anteriores da spanA e spanB
                    let spanA = ichimoku.slice(-25)[0].spanA;
                    let spanB = ichimoku.slice(-25)[0].spanB;
                    if (lastIchimoku.conversion > spanA && lastIchimoku.conversion > spanB) {
                        results.push({ symbol: symbol, conversion: lastIchimoku.conversion, spanA: spanA, spanB: spanB });
                        //results.push(symbol);
                    }
                    break;
                default:
                    console.log('No matching condition found');

            }

        }

    });

    /*symbolCandlesAndIchimoku.forEach(({ sma, symbol, candlesticks }) => {


        let lastCandlesticks = candlesticks.slice(-1)[0]

        let lastSMA = sma.slice(-1)[0];
        //Se SMA acima do último candlestick(close)
        if (lastSMA > lastCandlesticks.close) {
            //results.push({ symbol, lastSMA, lastCandlesticks });
            results.push(symbol);
        }

    });*/

    return results;
}
export default compareIchimokuLines;