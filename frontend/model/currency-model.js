import CurrencyView from "../view/currency-view";

const CurrencyModel = {
    currencies: [],
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