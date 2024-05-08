const IndicatorView = {
    init: function () {

        this.div = $('#list-indicators');
        this.params = {
            maIndicator: {
                maIntervals: new Set(['1m']),
                maValue: 200,
                maCandle: 'close',
                maCompare: 'above',
                checked: false
            },
            ichIndicator: {
                ichIntervals: new Set(['1m']),
                ichValue: null,
                ichCandle: 'close',
                ichLine1: 'conversion',
                ichLine2: 'base',
                ichCompare: 'above',
                checked: false
            }
        }

        this.render();

        $(document).ready(function () {

            // Moving Average

            ['maIndicator', 'ichIndicator'].forEach(item => {

                $('#' + item).change(function () {
                    // Seta se checkbox foi clicado ou não
                    IndicatorView.params[item].checked = $(this).is(':checked');

                })
            });

            ['maValue', 'maCandle', 'maCompare'].forEach(item => {

                $('#' + item).on('change', function () {
                    let name = $(this).attr('name');

                    let value = $(this).val();

                    let {
                        maIndicator
                    } = IndicatorView.params;

                    maIndicator.checked ? maIndicator[name] = value : maIndicator.params[name] = null;

                    console.log(IndicatorView.params.maIndicator)

                });

            });

            // Ichimoku

            ['ichLine1', 'ichCompare', 'ichLine2'].forEach(item => {

                $('#' + item).on('change', function () {
                    var name = $(this).attr('name');
                    let value = $(this).val();
                    let {
                        ichIndicator
                    } = IndicatorView.params;

                    ichIndicator.checked ? ichIndicator[name] = value : ichIndicator.params[name] = null

                    console.log(IndicatorView.params.ichIndicator)

                });

            });

            ['ich1m', 'ich5m', 'ich15m', 'ich1h', 'ich4h', 'ich8h', 'ich1d', 'ich3d', 'ich1w'].forEach(item => {

                $('#' + item).change(function () {
                    let checked = $(this).is(':checked');
                    let name = $(this).attr('name');

                    if (checked) {

                        let ichChecked = IndicatorView.params.ichIndicator.checked;
                        if (ichChecked) {
                            let intervals = IndicatorView.params.ichIndicator.ichIntervals;

                            intervals.add(name)
                            console.log('if ich indicator checked', IndicatorView.params.ichIndicator.ichIntervals);
                        }
                    } else {

                        console.log('else')

                        let intervals = IndicatorView.params.ichIndicator.ichIntervals;

                        intervals.delete(name)
                        console.log('if ich indicator checked', IndicatorView.params.ichIndicator.ichIntervals);


                    }

                })
            });


            ['ma1m', 'ma5m', 'ma15m', 'ma1h', 'ma4h', 'ma8h', 'ma1d', 'ma3d', 'ma1w'].forEach(item => {

                $('#' + item).change(function () {
                    let checked = $(this).is(':checked');
                    let name = $(this).attr('name');

                    if (checked) {

                        let maChecked = IndicatorView.params.maIndicator.checked;
                        if (maChecked) {
                            let intervals = IndicatorView.params.maIndicator.maIntervals;

                            intervals.add(name)
                            console.log('if ma indicator checked', IndicatorView.params.maIndicator.maIntervals);
                        }
                    } else {

                        console.log('else')

                        let intervals = IndicatorView.params.maIndicator.maIntervals;

                        intervals.delete(name)
                        console.log('if ma indicator checked', IndicatorView.params.maIndicator.maIntervals);


                    }

                })
            });

        });

        let button = this.createIndicatorButton()

        this.div.append(button)

    },
    render: function () {

        this.div.append(`
          <form class="flex-1 mx-2 ">
            ${this.renderMovingAverage()}
            ${this.renderIchimokuCloud()}
          </form>
        `)

        $("#fieldMaIndicator").append(`${this.renderMaIntervals()}`);
        $("#fieldIchIndicator").append(`${this.renderIchimokuIntervals()}`)

    },
    renderMovingAverage: function () {
        return `
          <fieldset id="fieldMaIndicator" class="flex flex-row border-2 p-2 items-center">
                <legend>Moving Average</legend>
                <!-- Checkbox --> 
                    <input type="checkbox" class="mx-2" id="maIndicator" name="ma" value="ma">
                  <label for="maIndicator" class="mx-2"> Moving Average</label>
              
              <!-- MA Value - Select -->
              <select name="maValue" class="flex-1 mx-2 h-7 " id="maValue">
                <option value="9">09</option>
                <option value="21">21</option>
                <option value="200">200</option>
                      </select>
              
               <!-- Compare - Select -->
              <select name="maCompare" class="flex-1 mx-2 h-7" id="maCompare">
                <option value="above">Above</option>
                <option value="bellow">Bellow</option>
                      </select>
              
              <!-- Candle - Select -->
              <select name="maCandle" class="flex-1 mx-2 h-7" id="maCandle">
                <option value="high">Candle High</option>
                <option value="close">Candle Close</option>
                <option value="low">Candle Low</option>
                      </select>
             
               </fieldset>
              `
    },
    renderIchimokuCloud: function () {

        return `
              <fieldset id="fieldIchIndicator" class="flex flexRow border-2 p-2 items-center">
                <legend>Ichimoku Cloud</legend>
                <input type="checkbox" id="ichIndicator" name="ichimoku" value="ichimoku">
                <label for="ichIndicator" class="mx-2"> Ichimoku Cloud</label>
                
                <!-- Line 1 - Select -->
                <select name="ichLine1" class="flex-1 mx-2 h-7" id="ichLine1">
                <option value="conversion">Conversion Line</option>
                <option value="base">Base Line</option>
                <option value="spanA">Span A</option>
                <option value="spanB">Span B</option>
                <option value="spanA+B">Span A and B</option>
                      </select>
              
                <!-- Compare - Select -->
                <select name="ichCompare" class="flex-1 mx-2 h-7" id="ichCompare">
                <option value="above">Above</option>
                <option value="bellow">Bellow</option>
                       </select>
              
                <!-- Line 2 - Select -->
                <select name="ichLine2" class="flex-1 mx-2 h-7" id="ichLine2">
                <option value="conversion">Conversion Line</option>
                <option value="base">Base Line</option>
                <option value="spanA">Span A</option>
                <option value="spanB">Span B</option>
                <option value="spanA+B">Span A and B</option>
                </select>
              
            </fieldset>
        `
    },

    renderMaIntervals: function () {

        return `
           
            <input type="checkbox" id="ma1m" name="1m" value="1h">
            <label for="ma1m">1m</label><br>
            <input type="checkbox" id="ma5m" name="5m" value="5m">
            <label for="ma5m">5m</label><br>
            <input type="checkbox" id="ma15m" name="15m" value="15m">
            <label for="ma5m">15m</label><br>
            <input type="checkbox" id="ma1h" name="1h" value="1h">
            <label for="ma1h">1h</label><br>
            <input type="checkbox" id="ma4h" name="4h" value="4h">
            <label for="ma4h">4h</label><br>
            <input type="checkbox" id="ma8h" name="8h" value="8h">
            <label for="ma8h">8h</label><br>
            <input type="checkbox" id="ma1d" name="1d" value="1d">
            <label for="ma1d">1d</label><br>
            <input type="checkbox" id="ma3d" name="3d" value="3d">
            <label for="ma3d">3d</label><br>
            <input type="checkbox" id="ma1w" name="1w" value="1w">
            <label for="ma1w">1w</label><br>
            
        `

    },
    renderIchimokuIntervals: function () {

        return `
        
          <input type="checkbox" id="ich1m" name="1m" value="1h">
          <label for="ich1m">1m</label><br>
          <input type="checkbox" id="ich5m" name="5m" value="5m">
          <label for="ich5m">5m</label><br>
          <input type="checkbox" id="ich15m" name="15m" value="15m">
          <label for="ich5m">15m</label><br>
          <input type="checkbox" id="ich1h" name="1h" value="1h">
          <label for="ich1h">1h</label><br>
          <input type="checkbox" id="ich4h" name="4h" value="4h">
          <label for="ich4h">4h</label><br>
          <input type="checkbox" id="ch8h" name="8h" value="8h">
          <label for="ch8h">8h</label><br>
          <input type="checkbox" id="ich1d" name="1d" value="1d">
          <label for="ich1d">1d</label><br>
          <input type="checkbox" id="ch3d" name="3d" value="3d">
          <label for="ch3d">3d</label><br>
          <input type="checkbox" id="ich1w" name="1w" value="1w">
          <label for="ich1w">1w</label><br>
          
              `

    },
    createIndicatorButton: function () {
        this.div.append(`<button type="button" class="w-20 m-5 bg-gray-200 hover:bg-green-200 hover:p-0.5 active:bg-blue-200">Search</button>`)
    }


}

export default IndicatorView;
