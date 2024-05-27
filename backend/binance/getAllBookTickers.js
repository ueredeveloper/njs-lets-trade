const getClient = require("./getClient");

module.exports = getAllBookTickers = async function () {

    let client = await getClient();

    try {
        const allBookTickers = await client.allBookTickers();
        return allBookTickers;
    } catch (error) {
        console.error('Error fetching all book tickers:', error);
    }
}

/*
[
  {
    "symbol": "BTCUSDT",
    "bidPrice": "50000.00",
    "bidQty": "0.1",
    "askPrice": "50001.00",
    "askQty": "0.2"
  },
  ...
  */
