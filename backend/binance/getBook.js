const getClient = require("./getClient");

module.exports = getBook = async function (symbol) {

    let client = await getClient();

    try {
        const book = await client.book({ symbol: symbol })
        return book;
    } catch (error) {
        console.error('Error fetching all book tickers:', error);
    }
}

/* return =>
{
  lastUpdateId: 17647759,
  asks:
   [
     { price: '0.05411500', quantity: '5.55000000' },
     { price: '0.05416700', quantity: '11.80100000' }
   ],
  bids:
   [
     { price: '0.05395500', quantity: '2.70000000' },
     { price: '0.05395100', quantity: '11.84100000' }
   ]
}

  */
