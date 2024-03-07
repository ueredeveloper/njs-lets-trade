import IndicatorModel from "../model/indicators-model";



const IndicatorView = {

    /*
    indicators: ['MA09', 'MA21', 'MA200', 'Bollinger Bands', 'Ichimoku Cloud'],
    ichomokuLines: ['Conversion', 'Baseline', 'Span A', 'Span B' ]
    */
    init: async function () {
        this.div = $('#list-indicators');
        this.indicators = IndicatorModel.getIndicators();
        this.ichimokuLines = IndicatorModel.getIchimokuLines();

        this.indicatorParams = {
            "line1": "Conversion",
            "compare": "below",
            "line2": "Baseline",
            "indicator": "Ichimoku"
        }
        this.renderList();
        /**
         * Ação de busca
         */
        $(document).on('click', 'button', function () {
            // adicionar intervalor symbol, limit, interval nos parametros
            $(document).trigger('onClickButtonIndicatorView', 'indicatorParams');
        });

        /**
         * Muda o tipo de indicador
         */
        this.div.on('click', 'input', (event) => {

            let value = $(event.target).val();

            this.indicatorParams.indicator = value;

            $(document).trigger('onIndicatorChange', this.indicatorParams);

        });
        /**
         * Muda as comparações entre as linhas Ichimoku, ex: linha de  conversão abaixo da linha base.
         */

        $(document).on('onSelectsChange', async (event, indicatorParams) => {
            // Parâmetros enviados pelos selects e options
            let { name, value } = indicatorParams;
            // Preencher a variável `this.indicatorParams` com valores.
            switch (name) {
                case 'selectLine1':
                    this.indicatorParams.line1 = value;
                    break;
                case 'selectCompare':
                    this.indicatorParams.compare = value;
                    break;
                default:
                    this.indicatorParams.line2 = value;
            }

            $(document).trigger('onIndicatorChange', this.indicatorParams);
        })

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
            <input type="radio" id=${value} value=${value}>
            <label for="html">${value}</label>
            `);
        // Concatena como string a array de li tags.
        ichiTags = ichiTags.join('');

        this.createIchimokuSelectLines(this.div);
        this.fillIchimokuSelectLines();
        this.createIndicatorButton(this.div)

    },
    createIndicatorsForm: function (div) {
        this.div.append('<form id="indicators-form" class="mx-5"></form><br>')
    },
    fillIndicatorsForm: function (tags) {
        let form = $('#indicators-form');
        form.append(`${tags}`);
    },
    createIchimokuSelectLines: function (div) {
        this.div.append(
            `
            <select id="selectLine1" class="mx-2"></select>
            <select id="selectCompare" class="mx-2"></select>
            <select id="selectLine2" class="mx-2"></select>
            `
        )
    },
    fillIchimokuSelectLines: function () {

        let selectLine1 = $('#selectLine1');

        selectLine1.append(
            `
            <option value="">-- Linha Ichimoku --</option>
            <option value="Conversion">Linha de Conversão</option>
            <option value="Baseline">Linha de Base</option>
            <option value="span A">Linha Span A</option>
            <option value="span B">Linha Span B</option>
                `
        );
        selectLine1.on('change', function () {
            let value = $(this).val();
            $(document).trigger('onSelectsChange', { value: value, name: 'selectLine1' });
        });

        let selectCompare = $('#selectCompare');

        selectCompare.append(
            `
            <option value="">-- Comparação --</option>
            <option value="above">Acima</option>
            <option value="below">Abaixo</option>
            `
        );
        selectCompare.on('change', function () {
            let value = $(this).val();
            $(document).trigger('onSelectsChange', { value: value, name: 'selectCompare' });
        });
        let selectLine2 = $('#selectLine2');

        selectLine2.append(
            `
            <option value="">-- Linha Ichimoku --</option>
            <option value="Conversion">Linha de Conversão</option>
            <option value="Baseline">Linha de Base</option>
            <option value="span A">Linha Span A</option>
            <option value="span B">Linha Span B</option>
            `
        );
        selectLine2.on('change', function () {
            let value = $(this).val();
            $(document).trigger('onSelectsChange', { value: value, name: 'selectLine2' });
        });
    },
    createIndicatorButton: function () {
        this.div.append(`<button type="button" class="bg-gray-200 hover:bg-green-200 hover:p-0.5 active:bg-blue-200">Click Me!</button>`)
    }
};


export default IndicatorView;
