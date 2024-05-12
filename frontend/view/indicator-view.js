import IndicatorModel from "../model/indicators-model";

const IndicatorView = {
    init: function () {

        this.div = $('#list-indicators');
        this.params = [IndicatorModel.getMovingAverage()]

        this.render();

        $(document).ready(function () {

            $('#indicatorType').on('change', function () {
                let value = $(this).val();
                /* switch (value) {
                     case 'movingAverage': IndicatorView.params.push(IndicatorModel.getMovingAverage());
                         break;
                     default: IndicatorView.params.push(IndicatorModel.getIchimokuCloud());
                 }
 
                 this.params.forEach(param => {
                     switch (param.type) {
                         case 'moving average': $("#indicatorSelects").append(this.renderMovingAverage());
                             break;
                         default: $("#indicatorSelects").append(this.renderIchimokuCloud());
                     }
 
                 })*/

            });

            $('#btnSearch').on('click', function () {

                console.log('btn search')
            })

            // Moving Average

            /* ['maIndicator', 'ichIndicator'].forEach(item => {
 
                 $('#' + item).change(function () {
                     let name = $(this).attr('name'); // ichimokuCloud movingAverage
 
                     console.log(name)
 
                     // Seta se checkbox foi clicado ou não
                     IndicatorView.params[name].checked = $(this).is(':checked');
 
                 })
             });
 
             ['maValue', 'maCandle', 'maCompare'].forEach(item => {
 
                 $('#' + item).on('change', function () {
                     let name = $(this).attr('name');
                     let value = $(this).val();
 
                     console.log(name, value)
 
                     let {
                         movingAverage
                     } = IndicatorView.params;
 
                     movingAverage.checked ? movingAverage[name] = value : movingAverage.params[name] = null;
 
                     let { length, compare, candle } = IndicatorView.params.movingAverage
 
                     let request = `${length}|${compare}|${candle}`;
 
                     console.log(request)
 
                 });
 
             });
 
             // ichimokuCloud
 
             ['line1', 'compare', 'line2'].forEach(item => {
 
                 $('#' + item).on('change', function () {
                     var name = $(this).attr('name');
                     let value = $(this).val();
                     let {
                         ichimokuCloud
                     } = IndicatorView.params;
 
                     ichimokuCloud.checked ? ichimokuCloud[name] = value : ichimokuCloud.params[name] = null
 
                     let { line1, compare, line2 } = IndicatorView.params.ichimokuCloud
 
                 });
 
             });
 
             ['ich1m', 'ich5m', 'ich15m', 'ich1h', 'ich4h', 'ich8h', 'ich1d', 'ich3d', 'ich1w'].forEach(item => {
 
                 $('#' + item).change(function () {
                     let checked = $(this).is(':checked');
                     let name = $(this).attr('name');
 
                     if (checked) {
 
                         let ichChecked = IndicatorView.params.ichimokuCloud.checked;
                         if (ichChecked) {
                             let intervals = IndicatorView.params.ichimokuCloud.intervals;
 
                             intervals.add(name)
                             console.log('if ich indicator checked', IndicatorView.params.ichimokuCloud.intervals);
                         }
                     } else {
 
                         console.log('else')
 
                         let intervals = IndicatorView.params.ichimokuCloud.intervals;
 
                         intervals.delete(name)
                         console.log('if ich indicator checked', IndicatorView.params.ichimokuCloud.intervals);
 
 
                     }
 
                 })
             });
 
 
             ['ma1m', 'ma5m', 'ma15m', 'ma1h', 'ma4h', 'ma8h', 'ma1d', 'ma3d', 'ma1w'].forEach(item => {
 
                 $('#' + item).change(function () {
                     let checked = $(this).is(':checked');
                     let name = $(this).attr('name');
 
                     if (checked) {
 
                         let maChecked = IndicatorView.params.movingAverage.checked;
                         if (maChecked) {
                             let intervals = IndicatorView.params.movingAverage.intervals;
 
                             intervals.add(name)
                             console.log('if ma indicator checked', IndicatorView.params.movingAverage.intervals);
                         }
                     } else {
 
                         console.log('else')
 
                         let intervals = IndicatorView.params.movingAverage.intervals;
 
                         intervals.delete(name)
                         console.log('if ma indicator checked', IndicatorView.params.movingAverage.intervals);
 
 
                     }
 
                 })
             });*/

        });

    },
    render: function () {

        this.div.append(`
            <div class="flex flex-1 flex-col">
                <div id="indicatorContainer"></div>
                <div id="btnSearch" class="flex flex-1 justify-end m-2">
                    <button class="bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                    </button>
                </div>
                
        `);

        $('#indicatorContainer').append(this.createIndicatorContent(0));

        

        $("#fieldMaIndicator").append(`${this.renderintervals()}`);
        $("#fieldIchIndicator").append(`${this.renderIchimokuIntervals()}`)

    },
    renderMovingAverage: function () {
        return `
         
              
              <!-- MA Value - Select -->
              <select name="length" class="flex-1 mx-2 h-7 " id="maValue">
                <option value="9">09</option>
                <option value="21">21</option>
                <option value="200">200</option>
                      </select>
              
              <!-- Compare - Select -->
              <select name="compare" class="flex-1 mx-2 h-7" id="maCompare">
                <option value="above">Above</option>
                <option value="bellow">Bellow</option>
                      </select>
              
              <!-- Candle - Select -->
              <select name="candle" class="flex-1 mx-2 h-7" id="maCandle">
                <option value="high">Candle High</option>
                <option value="close">Candle Close</option>
                <option value="low">Candle Low</option>
              </select>
             
              `
    },
    renderIchimokuCloud: function () {

        return `
              <fieldset id="fieldIchIndicator" class="flex flexRow border-2 p-2 items-center">
                <legend>Ichimoku Cloud</legend>
                <input type="checkbox" id="ichIndicator" name="ichimokuCloud" value="ichimokuCloud">
                <label for="ichIndicator" class="mx-2"> Ichimoku Cloud</label>
                
                <!-- Line 1 - Select -->
                <select name="line1" class="flex-1 mx-2 h-7" id="line1">
                <option value="conversion">Conversion Line</option>
                <option value="base">Base Line</option>
                <option value="spanA">Span A</option>
                <option value="spanB">Span B</option>
                <option value="spanA+B">Span A and B</option>
                      </select>
              
                <!-- Compare - Select -->
                <select name="compare" class="flex-1 mx-2 h-7" id="compare">
                <option value="above">Above</option>
                <option value="bellow">Bellow</option>
                       </select>
              
                <!-- Line 2 - Select -->
                <select name="line2" class="flex-1 mx-2 h-7" id="line2">
                <option value="conversion">Conversion Line</option>
                <option value="base">Base Line</option>
                <option value="spanA">Span A</option>
                <option value="spanB">Span B</option>
                <option value="spanA+B">Span A and B</option>
                </select>
              
            </fieldset>
        `
    },

    renderintervals: function () {

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
    },
    createIndicatorContent: function (item) {


        return `
            <div id="indicatorContent${item}" class="flex w-full items-center bg-green-200 ">
                <select name="indicatorType" id="indicatorType${item}" class="mx-2 h-7">
                    <option value="">Indicador</option>
                    <option value="ichimoku">Ichimoku Cloud</option>
                    <option value="movingAverage">Moving Average</option>
                </select>
                <!-- Selects -->
                <div id="indicatorSelects${item}" class="bg-red-200"></div>

                <!-- Handlers -->
                <div id="indicatorHandlers${item}" class="flex flex-1 justify-end m-2 bg-red-200">
                <button id="btnPlus${item}" value=${item} class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                </button>
        
                <button id="btnMinus${item}"  class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
                    </svg>
                </button>
                </div>
            </div>
            
        `
    }


}

export default IndicatorView;
