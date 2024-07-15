import CurrencyModel from "../model/currency-model";
import QuoteModel from "../model/quotes-model";

const QuoteView = {
    
    init: async function () {
        this.div = $('#list-quotes');
        this.quotes = CurrencyModel.getQuotes();
        this.renderList();
        this.div.on('click', 'li', function () {
            const selection = $(this).text().trim();
            $(document).trigger('onQuoteViewSelectChange', selection);
        });

    },
    renderList: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let quotes = await this.quotes;
        // Cria array de li tags com a array de cotações.
        let tags = quotes.map(quote => '<li name="quotation"><a class="float-left mx-0.5 cursor-pointer bg-green-200 w-12 text-center">' + quote + '</a></li>');
        // Concatena como string a array de li tags.
        tags = tags.join('')

        this.div.append(`
            <ul id="quote-view" class="flex flex-row">
                ${tags}
            </ul>
            `);
    }
};


export default QuoteView;