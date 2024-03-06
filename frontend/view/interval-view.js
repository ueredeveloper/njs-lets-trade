import IntervalModel from "../model/interval-model";


const IntervalView = {
    init: async function () {
        this.div = $('#list-intervals');
        this.intervals = IntervalModel.getIntervals()

        this.renderList();

        this.div
            .on('click', 'input', function () {
                let value = $(this).val();
                $(document).trigger('intervalChanged', value);
            });


    },
    renderList: async function () {
        // Cria uma array de intervalos de forma assíncrona.
        let intervals = await this.intervals;
        // Cria array de li tags com a array de intervalos.
        let tags = intervals.map(value => `
            <input type="radio" id=${value} value=${value} name="value">
            <label for="html">${value}</label>
            `);
        // Concatena como string a array de li tags.
        tags = tags.join('');

        this.createIntervalsForm(this.div)
        this.fillIntervalsForm(tags)

    },
    createIntervalsForm(div) {
        this.div.append('<form id="intervals-form" class="mx-5"></form><br>')
    },
    fillIntervalsForm(tags) {
        let form = $('#intervals-form');
        form.append(`${tags}`);
    }
};


export default IntervalView;
