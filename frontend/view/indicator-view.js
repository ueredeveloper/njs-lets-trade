import IndicatorModel from "../model/indicators-model";


const IndicatorView = {
    init: async function () {
        this.div = $('#list-indicators');
        this.indicators = IndicatorModel.getIndicators();
        this.ichimokuLines = IndicatorModel.getIchimokuLines();
        this.renderList();
        /*this.div.on('click', 'li', function () {
            const selectedQuote = $(this).text().trim();
            console.log(selectedQuote)
            // Trigger an event to notify about the quote change
            $(document).trigger('quoteChanged', selectedQuote);
        });*/

    },
    renderList: async function () {
        // Cria uma array de cotações de forma assíncrona.
        let indicators = await this.indicators;
        // Cria array de li tags com a array de cotações.
        let tags = indicators.map(indicator => `
            <input type="radio" id="ma9" value="ma09" name="indicator">
            <label for="html">${indicator}</label>
            `);
        // Concatena como string a array de li tags.
        tags = tags.join('');

        console.log(tags)

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


        this.createIchimokuSelectLines(this.div)
        this.fillIchimokuSelectLines()

    },
    createIndicatorsForm(div) {
        this.div.append('<form id="indicators-form"></form><br>')
    },
    fillIndicatorsForm(tags) {
        let form = $('#indicators-form');
        form.append(`${tags}`);
    },
    createIchimokuSelectLines(div) {
        this.div.append(
            `
            <select id="select-line-1" onchange="showSecondaryOptions()"></select>
            <select id="selectCompare"></select>
            <select id="select-line-2" onchange="showSecondaryOptions()"></select>
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
    }
};


export default IndicatorView;

/*
<select id="inchimoku-select-1" onchange="showSecondaryOptions()">
  <option value="">Ichimoku</option>
  <option value="conversionLine">Linha de Conversão</option>
  <option value="baseLine">Linha de Base</option>
  <option value="spanA">Linha Span A</option>
  <option value="spanB">Linha Span B</option>
</select>
<select id="conversionPosition">
  <option value="above">Acima</option>
  <option value="below">Abaixo</option>
</select>

<select id="inchimoku-select-2" onchange="showSecondaryOptions()">
  <option value="">Ichimoku</option>
  <option value="conversionLine">Linha de Conversão</option>
  <option value="conversionLine">Linha de Base</option>
  <option value="conversionLine">Linha Span A</option>
  <option value="conversionLine">Linha Span B</option>
</select>

*/