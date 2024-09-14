const getAllBookTickers = require("../binance/getAllBookTickers");
const getBook = require("../binance/getBook");
const analyseMoneyFlow = require("./analyseMoneyFlow");

function formatValueWithColor(value, colorCode) {
    return `\x1b[${colorCode}m${value}\x1b[0m`;
}

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

        // Converte objeto para array
        let array = Object.entries(allBookTickers);
        // Relaciona um símbole a seus valores
        let allBooksTickersArray = array.map((obj) => { return { symbol: obj[0], ...obj[1] } })
        let i = 1;

        for (ticker of allBooksTickersArray) {


            const { symbol, bidQty, askQty } = ticker;
            const qtyLiquidez = parseFloat(bidQty) + parseFloat(askQty);
            const qtyOrders = parseFloat(bidQty) - parseFloat(askQty)
            // Printa uma moeda específica
            // if (symbol === 'POLYXUSDT' || symbol === 'CKBUSDT') {
            if (symbol === 'PEPEUSDT' || symbol === 'PEOPLEUSDT') {

                let orderBookData = await getBook(symbol);


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

                console.log(`${i} Compra (${symbol}): ${compra.toFixed(2)} => Venda (${symbol}): ${venda.toFixed(2)} || entradas: ${entradas}`);
                console.log(`Símbolo: ${symbol}, Liquidez qty (compra+venda): ${qtyLiquidez}: tickers => compra: ${ticker.bidQty} venda: ${ticker.askQty}   `);
                console.log(
                    `Símbolo: ${symbol}, 
                    ${formatValueWithColor('Qty Ordens: ' + qtyOrders, qtyOrders < 0 ? 31 : 32)}
                    venda: ${liquidezAsks} 
                    ${formatValueWithColor('Entradas/Saídas: ' + entradas, entradas < 0 ? 31 : 32)},    
                        `);

                i++;
            }
        }

    } catch (error) {
        console.error('Erro ao buscar todos os book tickers:', error);
    }
}

module.exports = calculateLiquidity;