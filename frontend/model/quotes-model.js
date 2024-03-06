import CurrencyView from "../view/currency-view";

const QuoteModel = {
    quotes: [],
    addQuote: function(item) {
      this.quotes.push(item);
      // Notify the View of changes
      CurrencyView.renderList();
    },
    getQuotes: async function() {
      return this.quotes;
    }
  };

  export default QuoteModel;