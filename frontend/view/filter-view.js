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

        console.log('this  FilterView render')
        // Cria uma array de cotações de forma assíncrona.
        let filters = await CurrencyModel.getFilters();
       
        this.div.empty();
        $('#list-currencies').empty()

        let tag = $('<ul id="filter-view" class="flex flex-row inline-block max-w-full whitespace-nowrap">')

        filters.forEach(filter => {

            tag.append(`
                <li class="mx-0.5 bg-red-200 px-1 text-center">
                    <a class="float-left cursor-pointer">${filter.name}</a>
                    <input type="checkbox" name=${filter.name} class="ch-filters mx-2"/>
                </li>`)
                .appendTo(this.div)

            tag.find('.ch-filters').click(function () {

                let selectedName = $(this).attr('name');
                
                // Busca todos os checkboxes clicados (checked) para criar novos filtros.
                let checkedNames = $('.ch-filters:checked').map(function () {
                    return $(this).attr('name');
                }).get();
                // Adiciona todos os inputs checados em um Set para não haver repetições
                let names = new Set(checkedNames);
                // Remove o nome deste input para ordenar e adicioná-lo como sempre o primeiro
                names.delete(selectedName);
                if ($(this).is(':checked')) {
                    names.add(selectedName);
                } else {
                    names.delete(selectedName);
                }
                // Converte Set para array e cria novo filtro de filtros selecionados
                FilterView.selectedFilters = Array.from(names);

            });
        });

        $('#list-actions').empty()
        let div = $('#list-actions')
            .append(`
            <button id="btn-filter" class="mx-8">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
  			    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
				</svg>
            </button>`)

        div.find("#btn-filter").click(function () {

            // Une filtros de acordo com as moedas semelhantes
            CurrencyModel.joinFilters(FilterView.selectedFilters)
            // Renderiza novamente
            FilterView.render()
        });

        div.append(`
            <button id="btn-clear-filter">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
            </button>
            `)
        div.find("#btn-clear-filter").click(function () {

            CurrencyModel.clearFilter()
            FilterView.render()
   
        });

    }
};


export default FilterView;