const { all } = require("proxy-addr");
const getAllBookTickers = require("../binance/getAllBookTickers");
const getClandles = require("../binance/getClandles");
const { json } = require("body-parser");
const getBook = require("../binance/getBook");
const analyseMoneyFlow = require("./analyseMoneyFlow");

async function calculateLiquidity() {
    try {
        //const allBookTickers = await client.allBookTickers();

        const allBookTickers = await getAllBookTickers();

        /* Retorna um objeto
  
          { 
            REZUSDC: [Object: null prototype] {
                symbol: 'REZUSDC',
                bidPrice: '0.13000000',
                bidQty: '589.70000000',
                askPrice: '0.13040000',
                askQty: '9160.80000000'
            TRBFDUSD: [Object: null prototype] {
                symbol: ...
            ...
         */

        let array = Object.entries(allBookTickers);

        let allBooksTickersArray = array.map((obj) => { return { symbol: obj[0], ...obj[1] } })


        for (ticker of allBooksTickersArray) {
            const { symbol, bidQty, askQty } = ticker;
            const liquidez = parseFloat(bidQty) + parseFloat(askQty);

           // if (symbol === 'POLYXUSDT' || symbol === 'CKBUSDT') {
                if (symbol === 'POLYXUSDT' ) {

                

                let orderBookData = await getBook(symbol);

                //console.log(orderBookData)

                // Calculando a liquidez dos bids (compras)
                const liquidezBids = analyseMoneyFlow(orderBookData.bids);

                // Calculando a liquidez dos asks (vendas)
                const liquidezAsks = analyseMoneyFlow(orderBookData.asks);

                // Calculando a liquidez total
                const liquidezTotal = liquidezBids + liquidezAsks;

                // Calculando os valores de compra, venda e entradas
                const compra = liquidezBids;
                const venda = liquidezAsks;
                const entradas = compra - venda;

                console.log(`Compra (${symbol}):`, compra.toFixed(2));
                console.log(`Venda (${symbol}):`, venda.toFixed(2));
                console.log(`Entradas (${symbol}):`, entradas.toFixed(2));

                let candles = await getClandles(symbol, '15m', 1)

                console.log(`Símbolo: ${symbol}, Liquidez: ${liquidez}: ticker => BUY ${ticker.bidQty} SELL ${ticker.askQty}   `);
               // console.log(`Símbolo: ${symbol}, Liquidez: ${liquidez}: ticker => BUY ${ticker.bidQty} SELL ${ticker.askQty}  ${JSON.stringify(candles)} `);
            }
        }

        /*allBooksTickersArray.forEach(ticker => {
            const { symbol, bidQty, askQty } = ticker;
            const liquidez = parseFloat(bidQty) + parseFloat(askQty);

            if (symbol === 'BTCUSDT' || symbol === 'DYDXUSDT' || symbol ==='EDUUSDT') {

                let book = await getBook(symbol);

                console.log(`Símbolo: ${symbol}, Liquidez: ${liquidez}: ticker => ${JSON.stringify(ticker)}  ${JSON.stringify(candles)}`);
            }
           
        });*/
    } catch (error) {
        console.error('Erro ao buscar todos os book tickers:', error);
    }
}

calculateLiquidity();