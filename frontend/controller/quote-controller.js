import QuoteModel from "../model/quotes-model";
import QuoteView from "../view/quote-view";



const QuoteController = {
    init: async function () {
      
        // Moedas de cotação
        let quotes = await [
            { quote: 'USDT' },
            { quote: 'BTC' },
            { quote: 'BNB' },
            { quote: 'USDC' },
            { quote: 'FDUSD' },
            { quote: 'FIAT' },
        ]
        QuoteView.quotes = quotes;

        QuoteView.init();
    },
    addCurrency: function (item) {
        QuoteModel.addQuote(item);
    }
};

export default QuoteController;