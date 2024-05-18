import QuoteModel from "../model/quotes-model";

const FilterView = {
    init: async function () {
        this.div = $('#list-filters');
        this.filters = [
            'CAB',
            'CAC',
            'CAspanA',
            'CAspanA+B'
        ]
        this.renderList();
        this.div.on('click', 'li', function () {
            const selectedQuote = $(this).text().trim();

            //$(document).trigger('quoteChanged', selectedQuote);
        });

    },
    renderList: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let filters = await this.filters;
        // Cria array de li tags com a array de cotações.
        let tags = filters.map(filter => '<li><a class="float-left mx-2 cursor-pointer">' + filter + '</a></li>');
        // Concatena como string a array de li tags.
        tags = tags.join('')

        this.div.append(`
            <ul id="filter-view" >
                ${tags}
            </ul>
            `);
    }
};


export default FilterView;