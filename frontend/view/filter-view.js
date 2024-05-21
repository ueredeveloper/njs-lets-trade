import CurrencyModel from "../model/currency-model";

const FilterView = {
    init: async function () {
        this.div = $('#list-filters');
        this.filters = CurrencyModel.getFilters()
        this.render();
        this.div.on('click', 'li', function () {
            const selection = $(this).text().trim();
            $(document).trigger('selectedFilter', selection);
        });

        $(document).on('onSearchByIndicator', async function () {

            FilterView.render()

        });

    },

    render: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let filters = await this.filters;
        // Cria array de li tags com a array de cotações.
        let tags = filters.map(filter => '<li><a class="float-left mx-2 cursor-pointer">' + filter.name + '</a></li>');
        // Concatena como string a array de li tags.

        console.log(tags)
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