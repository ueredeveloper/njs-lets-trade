import CurrencyModel from "../model/currency-model";

const FilterView = {

    init: async function () {

        this.div = $('#list-filters');
        this.filters = CurrencyModel.getFilters();

         // Filtra moedas por volume, maior que 10M, maior que 20M e maior que 50M
        await CurrencyModel.get24hsVolume();

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
        let filters = await CurrencyModel.getFilters();

        this.div.empty();
        $('#list-currencies').empty()

        let tag = $('<ul id="filter-view" class="flex flex-row inline-block max-w-full whitespace-nowrap">')

        filters.forEach(filter => {

            console.log(filter)

            tag.append(`

                <li class="px-0.5 text-center">
                    <div class="bg-gray-200 border-1 border-red-200 border-solid px-1 mr-2">
                        <a class="float-left cursor-pointer mr-1">${filter.name}</a>
                        <input type="checkbox" name=${filter.name} class="ch-filters"/>
                    </div>
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

        // Botão de adicionar filtro
        let div = $('#list-actions')
            .append(`
            <button id="btn-add-filter" class="mx-2">
                <svg width="25px" height="25px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 4.6C3 4.03995 3 3.75992 3.10899 3.54601C3.20487 3.35785 3.35785 3.20487 3.54601 3.10899C3.75992 3 4.03995 3 4.6 3H19.4C19.9601 3 20.2401 3 20.454 3.10899C20.6422 3.20487 20.7951 3.35785 20.891 3.54601C21 3.75992 21 4.03995 21 4.6V6.33726C21 6.58185 21 6.70414 20.9724 6.81923C20.9479 6.92127 20.9075 7.01881 20.8526 7.10828C20.7908 7.2092 20.7043 7.29568 20.5314 7.46863L14.4686 13.5314C14.2957 13.7043 14.2092 13.7908 14.1474 13.8917C14.0925 13.9812 14.0521 14.0787 14.0276 14.1808C14 14.2959 14 14.4182 14 14.6627V17L10 21V14.6627C10 14.4182 10 14.2959 9.97237 14.1808C9.94787 14.0787 9.90747 13.9812 9.85264 13.8917C9.7908 13.7908 9.70432 13.7043 9.53137 13.5314L3.46863 7.46863C3.29568 7.29568 3.2092 7.2092 3.14736 7.10828C3.09253 7.01881 3.05213 6.92127 3.02763 6.81923C3 6.70414 3 6.58185 3 6.33726V4.6Z" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>`)

        div.find("#btn-add-filter").click(function () {

            // Une filtros de acordo com as moedas semelhantes
            CurrencyModel.joinFilters(FilterView.selectedFilters)
            // Renderiza novamente
            FilterView.render()
        });

        // Botão de  remover filtro
        div.append(`
            <button id="btn-remove-filters" class="mx-2">
                <svg width="25px" height="25px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 15L21 21M21 15L15 21M10 21V14.6627C10 14.4182 10 14.2959 9.97237 14.1808C9.94787 14.0787 9.90747 13.9812 9.85264 13.8917C9.7908 13.7908 9.70432 13.7043 9.53137 13.5314L3.46863 7.46863C3.29568 7.29568 3.2092 7.2092 3.14736 7.10828C3.09253 7.01881 3.05213 6.92127 3.02763 6.81923C3 6.70414 3 6.58185 3 6.33726V4.6C3 4.03995 3 3.75992 3.10899 3.54601C3.20487 3.35785 3.35785 3.20487 3.54601 3.10899C3.75992 3 4.03995 3 4.6 3H19.4C19.9601 3 20.2401 3 20.454 3.10899C20.6422 3.20487 20.7951 3.35785 20.891 3.54601C21 3.75992 21 4.03995 21 4.6V6.33726C21 6.58185 21 6.70414 20.9724 6.81923C20.9479 6.92127 20.9075 7.01881 20.8526 7.10828C20.7908 7.2092 20.7043 7.29568 20.5314 7.46863L17 11" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            `)

        div.find("#btn-remove-filters").click(function () {
            // Busca todos os checkboxes clicados (checked) para criar novos filtros.
            let filtersToRemove = $('.ch-filters:checked').map(function () {
                return $(this).attr('name');
            }).get();

            CurrencyModel.removeFilters(filtersToRemove);
            FilterView.render();


        });

        // Botão de remover todos os filtros
        div.append(`
            <button id="btn-remove-all-filters" class="mx-2">
                <svg width="25px" height="25px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21L3 3V6.33726C3 6.58185 3 6.70414 3.02763 6.81923C3.05213 6.92127 3.09253 7.01881 3.14736 7.10828C3.2092 7.2092 3.29568 7.29568 3.46863 7.46863L9.53137 13.5314C9.70432 13.7043 9.7908 13.7908 9.85264 13.8917C9.90747 13.9812 9.94787 14.0787 9.97237 14.1808C10 14.2959 10 14.4182 10 14.6627V21L14 17V14M8.60139 3H19.4C19.9601 3 20.2401 3 20.454 3.10899C20.6422 3.20487 20.7951 3.35785 20.891 3.54601C21 3.75992 21 4.03995 21 4.6V6.33726C21 6.58185 21 6.70414 20.9724 6.81923C20.9479 6.92127 20.9075 7.01881 20.8526 7.10828C20.7908 7.2092 20.7043 7.29568 20.5314 7.46863L16.8008 11.1992" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        `)

        div.find("#btn-remove-all-filters").click(function () {

            CurrencyModel.clearAllFilters()
            FilterView.render()

        });


    }
};


export default FilterView;