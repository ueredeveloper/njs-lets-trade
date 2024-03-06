import IndicatorModel from "../model/indicators-model";


const IndicatorView = {
    init: async function () {
        this.div = $('#list-indicators');
        this.indicators = IndicatorModel.getIndicators();
        this.ichimokuLines = IndicatorModel.getIchimokuLines();
        this.renderList();
       
        $(document).on('click', 'button', function(){
            // adicionar intervalor symbol, limit, interval nos parametros
            $(document).trigger('onClickButtonIndicatorView', 'params');
        });

        $(document).on('click')

    },
    renderList: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let indicators = await this.indicators;
        // Cria array de li tags com a array de cotações.
        let tags = indicators.map(value => `
            <input type="radio" id=${value} value=${value} name="value">
            <label for="html">${value}</label>
            `);
        // Concatena como string a array de li tags.
        tags = tags.join('');

        this.createIndicatorsForm(this.div)
        this.fillIndicatorsForm(tags)

        // Cria uma array de cotações de forma assíncrona.
        let ichimokuLines = await this.ichimokuLines;
        // Cria array de li tags com a array de cotações.
        let ichiTags = ichimokuLines.map(value => `
            <input type="radio" id="ma9" value="ma09">
            <label for="html">${value}</label>
            `);
        // Concatena como string a array de li tags.
        ichiTags = ichiTags.join('');


        this.createIchimokuSelectLines(this.div);
        this.fillIchimokuSelectLines();
        this.createIndicatorButton(this.div)

    },
    createIndicatorsForm(div) {
        this.div.append('<form id="indicators-form" class="mx-5"></form><br>')
    },
    fillIndicatorsForm(tags) {
        let form = $('#indicators-form');
        form.append(`${tags}`);
    },
    createIchimokuSelectLines(div) {
        this.div.append(
            `
            <select id="select-line-1" onchange="showSecondaryOptions()" class="mx-2"></select>
            <select id="selectCompare" class="mx-2"></select>
            <select id="select-line-2" onchange="showSecondaryOptions()" class="mx-2"></select>
            `
        )
    },
    fillIchimokuSelectLines() {
        let select1 = $('#select-line-1');
        select1.append(
            `
                <option value="conversionLine">Linha de Conversão</option>
                <option value="baseLine">Linha de Base</option>
                <option value="spanA">Linha Span A</option>
                <option value="spanB">Linha Span B</option>
                `
        )
        let selectCompare = $('#selectCompare');
        selectCompare.append(
            `
                    <option value="above">Acima</option>
                    <option value="below">Abaixo</option>
                    `
        )
        let select2 = $('#select-line-2');

        select2.append(
            `
            <option value="conversionLine">Linha de Conversão</option>
            <option value="baseLine">Linha de Base</option>
            <option value="spanA">Linha Span A</option>
            <option value="spanB">Linha Span B</option>
            `
        )
    },
    createIndicatorButton: function () {
        this.div.append(`<button type="button" class="bg-gray-200 hover:bg-green-200 hover:p-0.5 active:bg-blue-200">Click Me!</button>`)
    }
};


export default IndicatorView;
