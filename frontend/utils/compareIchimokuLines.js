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
                    //results.push({ symbol, conversion: lastIchimoku.conversion, base: lastIchimoku.base, lastIchimoku});
                    results.push(symbol);
                }

                break;
            case 'Conversion|above|Baseline':
                if (lastIchimoku.conversion > lastIchimoku.base) {
                    //results.push({ symbol, lastIchimoku });
                    results.push(symbol);
                }
                break;
            case 'Conversion|below|span A':
                if (lastIchimoku.conversion < lastIchimoku.spanA && lastIchimoku.conversion < lastIchimoku.spanB) {
                    //results.push({ symbol, lastIchimoku });
                    results.push(symbol);
                }
                break;
            case 'Conversion|above|span A':
                if (lastIchimoku.conversion > lastIchimoku.spanA && lastIchimoku.conversion > lastIchimoku.spanB) {
                    //results.push({ symbol, lastIchimoku });
                    results.push(symbol);
                }
                break;

            case 'Conversion|below|span B':
                if (lastIchimoku.conversion < lastIchimoku.spanB && lastIchimoku.conversion < lastIchimoku.spanA) {
                    //results.push({ symbol, lastIchimoku });
                    results.push(symbol);
                }
                break;
            case 'Conversion|above|span B':
                if (lastIchimoku.conversion > lastIchimoku.spanB && lastIchimoku.conversion > lastIchimoku.spanA) {
                    //results.push({ symbol, lastIchimoku });
                    results.push(symbol);
                }
                break;

            default:
                console.log('No matching condition found');
        }

    });

    return results;
}

export default compareIchimokuLines;