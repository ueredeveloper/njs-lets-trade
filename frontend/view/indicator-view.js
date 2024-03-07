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

        this.div
            .on('click', 'input', function () {
                let value = $(this).val();
         
                switch (value) {
                    case 'MA09':
                      console.log('Ma 09');
                      break;
                    case 'MA21':
                        console.log('Ma 21');
                      break;
                    case 'MA200':
                        console.log('Ma 200');
                      break;
                    case 'Bollinger':
                        console.log('Bollinger Bands');
                      break;
                    
                    default:
                        // Ichimoku Clouds
                      console.log(`${value}.`);
                  }





                //$(document).trigger('intervalChanged', value);





            });

    this.div.on('change', 'select', function(){
        let value = $(this).val();
        console.log(value)
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
            <select id="select-line-1" class="mx-2"></select>
            <select id="selectCompare" class="mx-2"></select>
            <select id="select-line-2" class="mx-2"></select>
            `
        )
    },
    fillIchimokuSelectLines() {
        let select1 = $('#select-line-1');
        select1.append(
            `
                <option value="">-- Linha Ichimoku --</option>
                <option value="conversionLine">Linha de Conversão</option>
                <option value="baseLine">Linha de Base</option>
                <option value="spanA">Linha Span A</option>
                <option value="spanB">Linha Span B</option>
                `
        )
        let selectCompare = $('#selectCompare');
        selectCompare.append(
            `
                    <option value="">-- Comparação --</option>
                    <option value="above">Acima</option>
                    <option value="below">Abaixo</option>
                    `
        )
        let select2 = $('#select-line-2');

        select2.append(
            `
            <option value="">-- Linha Ichimoku --</option>
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
