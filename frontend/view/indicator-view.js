import IndicatorModel from "../model/indicators-model";



const IndicatorView = {

    /*
    indicators: ['MA09', 'MA21', 'MA200', 'Bollinger Bands', 'Ichimoku Cloud'],
    ichomokuLines: ['Conversion', 'Baseline', 'Span A', 'Span B' ]
    */
    init: async function () {
        this.div = $('#list-indicators');
        this.indicators = await IndicatorModel.getIndicators();
        this.params = new Set();
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
        /* // Cria uma array de cotações de forma assíncrona.
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
         this.createIndicatorButton(this.div)*/

        let forms = [
            {
                indicator: 'ma-09',
                legend: 'MA - 9 Períodos',
                id: 'ma-09',
                checkboxId: 'checkbox-ma-09',
                optionsId: 'ma-09-options',
                selects: [{
                    indicator: 'ma-09',
                    name: 'candle',
                    checkboxId: 'checkbox-ma-09',
                    selectId: 'select-ma-09-candle',
                    options: ['high', 'low', 'close']
                },
                {
                    indicator: 'ma-09',
                    name: 'compare',
                    checkboxId: 'checkbox-ma-09',
                    selectId: 'select-ma-09-compare',
                    options: ['above', 'bellow']

                }
                ]
            },
            {
                indicator: 'ma-21',
                legend: 'MA - 21 Períodos',
                checkboxId: 'checkbox-ma-21',
                optionsId: 'ma-21-options',
                id: 'ma-21',
                selects: [{
                    indicator: 'ma-21',
                    name: 'candle',
                    checkboxId: 'checkbox-ma-21',
                    selectId: 'select-ma-21-candle',
                    options: ['high', 'low', 'close']
                },
                {
                    indicator: 'ma-21',
                    name: 'compare',
                    checkboxId: 'checkbox-ma-21',
                    selectId: 'select-ma-21-compare',
                    options: ['above', 'bellow']

                }
                ]
            },
            {
                indicator: 'ma-200',
                legend: 'MA - 200 Períodos',
                checkboxId: 'checkbox-ma-200',
                optionsId: 'ma-200-options',
                id: 'ma-200',
                selects: [{
                    indicator: 'ma-200',
                    name: 'candle',
                    checkboxId: 'checkbox-ma-200',
                    selectId: 'select-ma-200-candle',
                    options: ['high', 'low', 'close']
                },
                {
                    indicator: 'ma-200',
                    name: 'compare',
                    checkboxId: 'checkbox-ma-200',
                    selectId: 'select-ma-200-compare',
                    options: ['above', 'bellow']

                }]
            },
            {
                indicator: 'ichimoku',
                legend: 'Ichimoku',
                checkboxId: 'checkbox-ichimoku',
                optionsId: 'ichi-options',
                id: 'ichi',
                selects: [{
                    indicator: 'ichimoku',
                    name: 'line1',
                    checkboxId: 'checkbox-ichimoku',
                    selectId: 'select-ma-ichimoku-line1',
                    options: ['conversion', 'base', 'spanA', 'spanB']
                },
                {
                    indicator: 'ichimoku',
                    name: 'compare',
                    checkboxId: 'checkbox-ichimoku',
                    selectId: 'select-ichimoku-compare',
                    options: ['above', 'bellow']

                },
                {
                    indicator: 'ichimoku',
                    name: 'line2',
                    checkboxId: 'checkbox-ichimoku',
                    selectId: 'select-ichimoku-line2',
                    options: ['conversion', 'base', 'spanA', 'spanB']

                }]
            }
        ]

        forms.map((form, i) => {
            console.log(form.selects, form.id, form.checkboxId, form.class, 'op id ', form.optionsId)
            this.div.append(`
            <div id=${form.id} class="flex-1">
                <fieldset class="border-2 mx-2">
                <legend>${form.legend}</legend>
                    <input type="checkbox" id=${form.checkboxId} mx-2'>
                </fieldset>
                <div id=${form.optionsId}></div>
            </div>
            
        `);


            form.selects.forEach(checkbox => {
                // adiciona select
                $('#' + form.optionsId).append(
                    `<select id=${checkbox.selectId} class="mx-2">
                ${checkbox.options.map(op => `<option>${op}</option>`)}
                </select>
              `
                );
                // remove da tela o select para apenas mostrar quanto o input estiver checked
                $('#' + form.optionsId).hide();

                $(document).ready(function () {
                    $('#' + checkbox.checkboxId).change(function () {
                        if ($(this).is(':checked')) {
                            $('#' + form.optionsId).show();
                            $('#' + checkbox.selectId).on('change', function () {
                                let value = $(this).val();
                                let param = [...IndicatorView.params].find(i => i.indicator === checkbox.indicator);
                                if (param) {
                                    param[checkbox.name] = value;
                                    console.log(IndicatorView.params)
                                } else {
                                    IndicatorView.params.add({
                                        indicator: checkbox.indicator,
                                        [checkbox.name]: value
                                    });
                                    console.log(IndicatorView.params)
                                }
                            });

                        } else {
                            $('#' + form.optionsId).hide();
                            $('#' + checkbox.selectId).off('change');
                            IndicatorView.params.delete([...IndicatorView.params].find(i => i.indicator === checkbox.indicator));
                            console.log('close params ', IndicatorView.params)
                        }

                    });
                });
            });



        })





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
