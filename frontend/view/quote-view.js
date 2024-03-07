import QuoteModel from "../model/quotes-model";


const QuoteView = {
    init: async function () {
        this.div = $('#list-quotes');
        this.quotes = QuoteModel.getQuotes();
        this.renderList();
        this.div.on('click', 'li', function () {
            const selectedQuote = $(this).text().trim();

            $(document).trigger('quoteChanged', selectedQuote);
        });

    },
    renderList: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let quotes = await this.quotes;
        // Cria array de li tags com a array de cotações.
        let tags = quotes.map(quote => '<li><a class="float-left mx-2 cursor-pointer">' + quote + '</a></li>');
        // Concatena como string a array de li tags.
        tags = tags.join('')

        this.div.append(`
            <ul id="quote-view" >
                ${tags}
            </ul>
            `);
    }
};


export default QuoteView;