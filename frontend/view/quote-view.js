import QuoteModel from "../model/quotes-model";

const QuoteView = {
    init: async function () {
        this.div = $('#list-quotes');
        this.quotes = QuoteModel.getQuotes();
        this.renderList();
        this.div.on('click', 'li', function () {
            const selectedQuote = $(this).text().trim();
            console.log(selectedQuote)
            // Trigger an event to notify about the quote change
            $(document).trigger('quoteChanged', selectedQuote);
        });

    },
    renderList: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let quotes = await this.quotes;
        // Cria array de li tags com a array de cotações.
        let liTags = quotes.map(quote => '<li><a class="float-left mx-2 cursor-pointer">' + quote + '</a></li>');
        // Concatena como string a array de li tags.
        liTags = liTags.join('')

        this.div.append(`
            <ul id="quote-view" >
                ${liTags}
            </ul>
            `);
    }
};


export default QuoteView;