import CurrencyView from "../view/currency-view";

const CurrencyModel = {
    currencies : [
      { "id": null, "symbol": "ETHBTC", "price": "0.05522000", "currency_collections": [[]] },
      { "id": null, "symbol": "LTCBTC", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "DYDXUSDT", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "JASMYUSDT", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "ADABNB", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "ALGOUSDT", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "AXSBNB", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "LINKUSDC", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "INJUSDT", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "ETHUSDT", "price": "0.00131400", "currency_collections": [[]] },
      { "id": null, "symbol": "ALICEUSDT", "price": "0.00131400", "currency_collections": [[]] },
  ],
    addCurrency: function(item) {
      this.currencies.push(item);
      // Notify the View of changes
      CurrencyView.renderList();
    },
    getCurrencies: async function() {
      return this.currencies;
    }
  };

  export default CurrencyModel;