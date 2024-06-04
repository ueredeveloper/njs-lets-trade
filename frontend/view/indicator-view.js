import CurrencyModel from "../model/currency-model";
import FilterModel from "../model/filter-model";
import IndicatorModel from "../model/indicators-model";
import fetchCandlesticksAndCloud from "../services/fetchCandlesAndIchimokuCloud";
import fetchCandlesAndMovingAverage from "../services/fetchCandlesAndMovingAverage";
import fetchCandlesAndSMA from "../services/fetchCandlesAndSMA";
import compareIchimokuLines from "../utils/compareIchimokuLines";
import { conversionAboveBase, conversionAboveCloseCandle, conversionAboveHighCandle, conversionAboveLowCandle, conversionAboveSpanA, conversionAboveSpanAAndSpanB, conversionAboveSpanB, conversionBellowBase, createIchimokuFilter } from "../utils/createIchimokuFilter";
import { createMovingAverageFilter, movingAverageAboveCandleClose, movingAverageBellowCandleClose } from "../utils/createMovingAverageFilter";


const IndicatorView = {

    init: function () {

        this.div = $('#list-indicators');
        this.currencies = []

        this.render();

        $(document).ready(function () {

            IndicatorView.params = []

            $('#btnSearch').on('click', async function () {

                let params = []

                $('.indicatorContent').each(async function () {
                    let container = $(this);
                    let indicatorType = container.find('.indicatorType').val();
                    let selects = container.find('.indicatorSelects select');
                    let line1 = selects.eq(0).val();
                    let compare = selects.eq(1).val();
                    let line2 = selects.eq(2).val();
                    let checkboxes = container.find('.indicatorSelects input[type="checkbox"]');
                    let checkboxValues = checkboxes.filter(':checked').map(function () {
                        return this.value;
                    }).get();

                    if (indicatorType === 'ichimokuCloud') {
                        let intervals = checkboxValues.toString();

                        console.log('ichi ', intervals)
                        params.push({
                            condition: `${indicatorType}|${line1}|${compare}|${line2}`,
                            acronym: `${indicatorType.toString()[0]}|${line1.toString()}|${compare.toString()[0]}|${line2.toString()}`,
                            intervals: intervals
                        });

                    } else if (indicatorType === 'movingAverage') {
                        let intervals = checkboxValues.toString();

                        console.log('moving average ', intervals)
                        params.push({
                            condition: `${indicatorType}|${line1}|${compare}|${line2}`,
                            acronym: `${indicatorType.toString()[0]}|${line1.toString()}|${compare.toString()[0]}|${line2.toString()}`,
                            intervals: `${intervals}`
                        });

                    } else {
                        console.log(`Indicador não encontrado: ${indicatorType}`)
                    }

                    for (const param of params) {
                        let { condition, intervals, acronym } = param

                        //let allCurrencies = await CurrencyModel.getAllCurrencies();
                        let allCurrencies = await CurrencyModel.getAllCurrencies();

                        let currencies = await CurrencyModel.getBinanceCurrenciesWithUsdt(allCurrencies);

                        let splitIntervals = intervals.split(',');

                        for (const interval of splitIntervals) {

                            if (condition.startsWith('ichimokuCloud')) {

                                // Busca indicadores de cada moeda solicitada
                                let array = await fetchCandlesticksAndCloud(currencies, intervals);
                                let filterName = `${interval}|${acronym}`;

                                const keywords = ['high', 'low', 'close'];
                                for (let keyword of keywords) {
                                    if (condition.includes(keyword)) {
                                        switch (condition) {
                                            case 'ichimokuCloud|conversion|above|high':
                                                createIchimokuFilter(array, filterName, conversionAboveHighCandle)
                                                break;
                                            case 'ichimokuCloud|conversion|above|close':
                                                createIchimokuFilter(array, filterName, conversionAboveCloseCandle)
                                                break;
                                            case 'ichimokuCloud|conversion|above|low':
                                                createIchimokuFilter(array, filterName, conversionAboveLowCandle)
                                                break;
                                        }
                                    } else {
                                        switch (condition) {
                                            case 'ichimokuCloud|conversion|above|base':
                                                createIchimokuFilter(array, filterName, conversionAboveBase)
                                                break;
                                            case 'ichimokuCloud|conversion|bellow|base':
                                                createIchimokuFilter(array, filterName, conversionBellowBase)
                                                break;
                                            case 'ichimokuCloud|conversion|above|spanA':
                                                createIchimokuFilter(array, filterName, conversionAboveSpanA)
                                                break;
                                            case 'ichimokuCloud|conversion|above|spanB':
                                                createIchimokuFilter(array, filterName, conversionAboveSpanB)
                                                break;
                                            case 'ichimokuCloud|conversion|above|spanA+B':
                                                createIchimokuFilter(array, filterName, conversionAboveSpanAAndSpanB)
                                                break;
                                        }
                                    }



                                }

                            } else {

                                let filterName = `${interval}|${acronym}`;
                                let maPeriod = filterName.split('|')[2]// 9, 21 ou 200
                                let array = await fetchCandlesAndMovingAverage(currencies, intervals, maPeriod);

                                switch (condition) {
                                    case 'movingAverage|200|above|close':
                                        createMovingAverageFilter(array, filterName, movingAverageAboveCandleClose)
                                        break;
                                    case 'movingAverage|200|bellow|close':
                                        createMovingAverageFilter(array, filterName, movingAverageBellowCandleClose)
                                        break;

                                }
                            }

                        }

                    }

                    $(document).trigger('filterViewOnSearchByIndicator');


                });

            });

        });

    },
    render: function () {

        this.div.append(`
            <div class="flex flex-1 flex-col">
                <div class="indicatorContainer"></div>
                <div id="btnSearch" class="flex flex-1 justify-end m-2">
                    <button id="btnPlus" value=0 class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                    </button>
                    <button id="btnMinus"  class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
                        </svg>
                    </button>
                    <button class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                    </button>
                </div>
                
        `);

        $(document).on('change', '.indicatorType', function () {

            let value = $(this).val();
            let indicatorSelects = $(this).closest('.indicatorContent').find('.indicatorSelects');

            switch (value) {
                case 'movingAverage':
                    indicatorSelects.empty();
                    indicatorSelects.append(IndicatorView.renderMovingAverage());
                    $("#fieldMaIndicator").append(`${IndicatorView.renderintervals()}`);
                    break;
                case 'ichimokuCloud':
                    indicatorSelects.empty();
                    indicatorSelects.append(IndicatorView.renderIchimokuCloud());
                    break;
                default:
                    indicatorSelects.empty(); // Clear the content if no option is selected
            }
        });

        $('.indicatorContainer').append(this.createIndicatorContent());


        $('#btnPlus').on('click', function () {
            $('.indicatorContainer').append(IndicatorView.createIndicatorContent());
        });

        $('#btnMinus').on('click', function () {
            $('.indicatorContainer').children().last().remove();
        });


    },
    renderMovingAverage: function () {

        return `
            
            <select name="length" class="flex-1 mx-2 h-7 " id="maLength">
                <option value="9">09</option>
                <option value="21">21</option>
                <option value="200" selected>200</option>
            </select>
              
            <select name="compare" class="flex-1 mx-2 h-7" id="maCompare">
                <option value="above" selected>Above</option>
                <option value="bellow">Bellow</option>
            </select>
              
            <select name="candle" class="flex-1 mx-2 h-7" id="maCandle">
                <option value="high">Candle High</option>
                <option value="close" selected>Candle Close</option>
                <option value="low">Candle Low</option>
            </select>
            
            ${this.renderintervals()}
             
              `
    },
    renderIchimokuCloud: function () {

        return `
             
            <select name="line1" class="flex-1 mx-2 h-7" id="line1">
                <option value="conversion" class="bg-green-200" selected>Conversion Line</option>
                <option value="base" class="bg-green-100">Base Line</option>
                <option value="spanA" class="bg-green-200">Span A</option>
                <option value="spanB" class="bg-gray-200">Span B</option>
                <option value="spanA+B" class="bg-gray-100">Span A and B</option>
                <option value="high" class="bg-red-200">Candle High</option>
                <option value="close" class="bg-red-100">Candle Close</option>
            <option value="low" class="bg-red-200">Candle Low</option>
            </select>
            
            <select name="compare" class="flex-1 mx-2 h-7" id="compare">
                <option value="above" selected>Above</option>
                <option value="bellow">Below</option>
            </select>
            
            <select name="line2" class="flex-1 mx-2 h-7" id="line2">
                <option value="conversion" class="bg-green-200">Conversion Line</option>
                <option value="base" class="bg-green-100" selected>Base Line</option>
                <option value="spanA" class="bg-green-200">Span A</option>
                <option value="spanB" class="bg-gray-200">Span B</option>
                <option value="spanA+B" class="bg-gray-100">Span A and B</option>
                <option value="high" class="bg-red-200">Candle High</option>
                <option value="close" class="bg-red-100">Candle Close</option>
                <option value="low" class="bg-red-200">Candle Low</option>
            </select>
    
            
            ${this.renderintervals()}
             
        `
    },

    renderintervals: function () {

        return `
            <div class="flex flex-row">
                <input type="checkbox" id="ma1m" name="1m" value="1m">
                <label for="ma1m" class="mx-1">1m</label><br>
                <input type="checkbox" id="ma5m name="5m" value="5m">
                <label for="ma5m" class="mx-1">5m</label><br>
                <input type="checkbox" id="ma15m" name="15m" value="15m">
                <label for="ma5m" class="mx-1">15m</label><br>
                <input type="checkbox" id="ma1h" name="1h" value="1h" checked>
                <label for="ma1h" class="mx-1">1h</label><br>
                <input type="checkbox" id="ma4h" name="4h" value="4h">
                <label for="ma4h" class="mx-1">4h</label><br>
                <input type="checkbox" id="ma8h" name="8h" value="8h">
                <label for="ma8h" class="mx-1">8h</label><br>
                <input type="checkbox" id="ma1d" name="1d" value="1d">
                <label for="ma1d" class="mx-1">1d</label><br>
                <input type="checkbox" id="ma3d" name="3d" value="3d">
                <label for="ma3d" class="mx-1">3d</label><br>
                <input type="checkbox" id="ma1w" name="1w" value="1w">
                <label for="ma1w" class="mx-1">1w</label><br>
            </div>
            
        `

    },

    createIndicatorButton: function () {
        this.div.append(`<button type="button" class="w-20 m-5 bg-gray-200 hover:bg-green-200 hover:p-0.5 active:bg-blue-200">Search</button>`)
    },
    createIndicatorContent: function (item) {

        return `
            <div class="indicatorContent flex w-full items-center bg-green-200 p-2">
                <select name="indicatorType" class="indicatorType" class="mx-2 h-7">
                    <option value="">Indicador</option>
                    <option value="ichimokuCloud">Ichimoku Cloud</option>
                    <option value="movingAverage">Moving Average</option>
                </select>
                <!-- Selects -->
                <div class="indicatorSelects flex flex-row flex-wrap" class="bg-red-200"></div>
               
            </div>
        `
    }

}

export default IndicatorView;
