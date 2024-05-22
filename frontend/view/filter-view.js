import CurrencyModel from "../model/currency-model";

const FilterView = {
    init: async function () {
        this.div = $('#list-filters');
        this.filters = CurrencyModel.getFilters()
        this.selectedFilters = []
        this.render();
        this.div.on('click', 'li', function () {
            const selection = $(this).text().trim();
            $(document).trigger('currencyViewSelectFilter', selection);
        });

        // Atualiza as tabs ao pesquisar por indicador
        $(document).on('filterViewOnSearchByIndicator', async function () {
            FilterView.render()
        });
        

    },
    // Renderiza a tabela e as tabs
    render: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let filters = await this.filters;
        // Cria array de li tags com a array de cotações.
        /* let tags = filters.map(filter => `
             <li>
                 <a class="float-left mx-2 cursor-pointer">${filter.name}</a>
                 <input type="checkbox" class="mx-2"/>
             </li>`);
         // Concatena como string a array de li tags.
 
         tags = tags.join('')
 
         //let table = $('#list-currencies').empty();
         this.div.empty();
         
         this.div.append(`
             <ul id="filter-view" >
                 ${tags}
             </ul>
             `);*/

        this.div.empty();
        $('#list-currencies').empty()

        filters.forEach(filter => {
            let tag = $('<ul id="filter-view">')
                .append(`
                <li>
                    <a class="float-left mx-2 cursor-pointer">${filter.name}</a>
                    <input type="checkbox" name=${filter.name} class="ch-filters mx-2"/>
                </li>`)
                .appendTo(this.div)

            tag.find('.ch-filters').click(function () {
                // Busca todos os checkboxes clicados (checked) para criar novos filtros.
                let checkedNames = $('.ch-filters:checked').map(function() {
                    return $(this).attr('name');
                }).get();
        
                //console.log(checkedNames);
                FilterView.selectedFilters = checkedNames;

            });
        });

        $('#btn-new-filter').empty()
        let button = $('#btn-new-filter')
        .append(`<button class="flex justify-self-end">filtrar</button>`)

        button.click(function(){
            //console.log(FilterView.selectedFilters)

            CurrencyModel.joinFilters(FilterView.selectedFilters)

           FilterView.render()

        })
    }
};


export default FilterView;