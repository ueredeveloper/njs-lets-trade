const FilterView = {
    init: async function () {
        this.div = $('#list-filters');
        this.filters = ['1hCAB', '1hCaSpanA+B']
        this.render();
        this.div.on('click', 'li', function () {
            const selectFilter = $(this).text().trim();
            $(document).trigger('filterChanged', selectFilter);
        });

    },
    render: async function () {
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