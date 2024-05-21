import CurrencyModel from "../model/currency-model";

const FilterView = {
    init: async function () {
        this.div = $('#list-filters');
        this.filters = CurrencyModel.getFilters()
        this.render();
        this.div.on('click', 'li', function () {
            const selection = $(this).text().trim();
            $(document).trigger('currencyViewSelectFilter', selection);
        });

        // Atualiza as tabs ao pesquisar por indicador
        $(document).on('onSearchByIndicator', async function () {
            FilterView.render()
        });

    },
    // Renderiza a tabela e as tabs
    render: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let filters = await this.filters;
        // Cria array de li tags com a array de cotações.
        let tags = filters.map(filter => '<li><a class="float-left mx-2 cursor-pointer">' + filter.name + '</a></li>');
        // Concatena como string a array de li tags.

        tags = tags.join('')

        //let table = $('#list-currencies').empty();
        this.div.empty();
        
        this.div.append(`
            <ul id="filter-view" >
                ${tags}
            </ul>
            `);
    }
};


export default FilterView;