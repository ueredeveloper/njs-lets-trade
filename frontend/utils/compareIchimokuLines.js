const compareIchimokuLines = async (symbolCandlesAndIchimoku, condition) => {

    // let { candlesticks, ichimokuCloud, symbol } = symbolCandlesAndIchimoku;

    let results = []

    symbolCandlesAndIchimoku.forEach(({ ichimokuCloud, symbol }) => {

        /* 
            Lines of Ichimoku 
                base conversion spanA spanB

            IndicatorModel.ichomokuLines: ['Conversion', 'Baseline', 'Span A', 'Span B' ],

        */

        let lastIchimoku = ichimokuCloud.slice(-1)[0];

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
                let spanA = ichimokuCloud.slice(-25)[0].spanA;
                let spanB = ichimokuCloud.slice(-25)[0].spanB;
                if (lastIchimoku.conversion > spanA && lastIchimoku.conversion > spanB) {
                    results.push({ symbol: symbol, conversion: lastIchimoku.conversion, spanA: spanA, spanB: spanB });
                    //results.push(symbol);
                }
                break;
            default:
                console.log('No matching condition found');
        }

    });

    return results;
}
export default compareIchimokuLines;