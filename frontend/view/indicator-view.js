import CurrencyModel from "../model/currency-model";
import fetchCandlesAndIndicators from "../services/fetchCandlesAndIndicators";
import { conversionAboveBase, conversionAboveCloseCandle, conversionAboveHighCandle, conversionAboveLowCandle, conversionAboveSpanA, conversionAboveSpanAAndSpanB, conversionAboveSpanB, conversionBellowBase, createIchimokuFilter } from "../utils/createIchimokuFilter";
import { createMovingAverageFilter, movingAverageAboveCandleClose, movingAverageBellowCandleClose } from "../utils/createMovingAverageFilter";
import { createRsiFilter, lastRsiAbove10Bellow20, lastRsiAbove20Bellow30, lastRsiAbove30Bellow40, lastRsiAbove40Bellow50, lastRsiAbove50Bellow60, lastRsiAbove60Bellow70, lastRsiAbove70Bellow80 } from "../utils/createRsiFilter";


const IndicatorView = {


    init: function () {

        this.div = $('#list-indicators');
        this.currencies = []

        this.render();

        $(document).ready(function () {

            IndicatorView.params = []

            $('#btnSearch').on('click', async function () {

                let params = []
                // Verifica seleções do usuário e cria novos parâmetros de busca
                $('.indicatorContent').each(async function () {
                    let container = $(this);
                    let indicatorType = container.find('.indicatorType').val();
                    let selects = container.find('.indicatorSelects select');

                    let checkboxes = container.find('.indicatorSelects input[type="checkbox"]');
                    let checkboxValues = checkboxes.filter(':checked').map(function () {
                        return this.value;
                    }).get();


                    if (indicatorType === 'ichimokuCloud') {
                        let intervals = checkboxValues.toString();
                        // Captura as seleções do usuário neste indicador
                        let line1 = selects.eq(0).val();
                        let compare = selects.eq(1).val();
                        let line2 = selects.eq(2).val();

                        params.push({
                            condition: `${indicatorType}|${line1}|${compare}|${line2}`,
                            acronym: `${indicatorType.toString()[0]}|${line1.toString()}|${compare.toString()[0]}|${line2.toString()}`,
                            intervals: intervals
                        });

                    } 
                    else if (indicatorType === 'movingAverage') {
                        let intervals = checkboxValues.toString();
                        // Captura as seleções do usuário neste indicador
                        let line1 = selects.eq(0).val();
                        let compare = selects.eq(1).val();
                        let line2 = selects.eq(2).val();

                        params.push({
                            condition: `${indicatorType}|${line1}|${compare}|${line2}`,
                            acronym: `${indicatorType.toString()[0]}|${line1.toString()}|${compare.toString()[0]}|${line2.toString()}`,
                            intervals: `${intervals}`
                        });

                    } 
                    else if (indicatorType === 'relativeStrengthIndex') {
                        let intervals = checkboxValues.toString();
                        // Captura as seleções do usuário neste indicador
                        let compare1 = selects.eq(0).val();
                        let line1 = selects.eq(1).val();
                        let compare2 = selects.eq(2).val();
                        let line2 = selects.eq(3).val();

                        params.push({
                            condition: `${indicatorType}|${compare1}|${line1}|${compare2}|${line2}`,
                            acronym: `${indicatorType.toString()[0]}|${compare1.toString()[0]}|${line1.toString()[0]}|${compare2.toString()[0]}|${line2.toString()[0]}`,
                            intervals: `${intervals}`
                        });

                    }
                    else if (indicatorType === 'lowestIndex') {
                        let intervals = checkboxValues.toString();
                        // Captura as seleções do usuário neste indicador
                        let name = selects.eq(0).val();
                       
                        console.log('lowest index name ', name)

                        /*params.push({
                            condition: `${indicatorType}|${compare1}|${line1}|${compare2}|${line2}`,
                            acronym: `${indicatorType.toString()[0]}|${compare1.toString()[0]}|${line1.toString()[0]}|${compare2.toString()[0]}|${line2.toString()[0]}`,
                            intervals: `${intervals}`
                        });*/

                    }
                    else {
                        console.log(`Indicador não encontrado: ${indicatorType}`)
                    }

                });

                // Unifica os intervalos solicitados pelo usuário.
                let uniqueIntervals = new Set();
                let intervals = [];
                intervals = params.map(param => param.intervals.split(','))
                intervals.forEach(items => {
                    items.forEach(item => {
                        // trim remove espaços iniciais e finais na string, ex: " 1h" => "1h"
                        uniqueIntervals.add(item.trim())
                    })
                });

                intervals = Array.from(uniqueIntervals);

                let allCurrencies = await CurrencyModel.getAllCurrencies();
                let usdtCurrencies = await CurrencyModel.getBinanceCurrenciesWithUsdt(allCurrencies);
                let candlesAndIndicators = await fetchCandlesAndIndicators(usdtCurrencies, intervals)

                // Não está funcionando. É para testes com dados locais,sem que pricise fazer fetch.
                //let candlesAndIndicators = currencyModel.getForTestIndicatorsAndCurrencies();

                for (const param of params) {

                    console.log(param)

                    let { condition, acronym } = param;

                    /**
                     * {
                        name: '1h|All', 
                        list: [
                        {
                            "id": null,
                            "symbol": "ETHBTC",
                            "price": "0.04335000",
                            "currency_collections": [
                                []
                            ]
                        }
                        ]
                        }
                        
                     */


                    /*
                    [
                         {
                             "id": null,
                             "symbol": "BTCUSDT",
                             "price": "61661.31000000",
                             "currency_collections": [[]]
                         }
                     ]
                     */

                    //let splitIntervals = intervals.split(',');

                    //let candlesticks = await fetchCandlesticks(usdtCurrencies, intervals);

                    if (condition.startsWith('relative')) {

                        //let rsiIndicador = await fetchRsiIndicator(usdtCurrencies, intervals)

                        //relativeStrengthIndex|above|60|bellow|70

                        switch (condition) {
                            case 'relativeStrengthIndex|above|10|bellow|20':
                                createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove10Bellow20)
                                break;
                            case 'relativeStrengthIndex|above|20|bellow|30':
                                createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove20Bellow30)
                                break;
                            case 'relativeStrengthIndex|above|30|bellow|40':
                                createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove30Bellow40)
                                break;
                            case 'relativeStrengthIndex|above|40|bellow|50':
                                createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove40Bellow50)
                                break;
                            case 'relativeStrengthIndex|above|50|bellow|60':
                                createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove50Bellow60)
                                break;
                            case 'relativeStrengthIndex|above|60|bellow|70':
                                createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove60Bellow70)
                                break;
                            case 'relativeStrengthIndex|above|70|bellow|80':
                                createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove70Bellow80)
                                break;
                            default: alert("Não há ainda cálculo para estas condições!")

                        }


                        // createRsiFilter(candlesAndIndicators, intervals, acronym, lastRsiAbove60Bellow70)

                    }
                    else if (condition.startsWith('ichimokuCloud')) {
                        switch (condition) {
                            case 'ichimokuCloud|conversion|above|high':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionAboveHighCandle)
                                break;

                            case 'ichimokuCloud|conversion|above|close':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionAboveCloseCandle)
                                break;
                            case 'ichimokuCloud|conversion|above|low':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionAboveLowCandle)
                                break;
                            case 'ichimokuCloud|conversion|above|base':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionAboveBase)
                                break;
                            case 'ichimokuCloud|conversion|bellow|base':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionBellowBase)
                                break;
                            case 'ichimokuCloud|conversion|above|spanA':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionAboveSpanA)
                                break;
                            case 'ichimokuCloud|conversion|above|spanB':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionAboveSpanB)
                                break;
                            case 'ichimokuCloud|conversion|above|spanA+B':
                                createIchimokuFilter(candlesAndIndicators, intervals, acronym, conversionAboveSpanAAndSpanB)
                                break;
                            default: alert("Ichimoku Cloud ainda não calculado!")

                        }
                    }
                    else if (condition.startsWith('movingAverage')) {
                        console.log(condition)
                        switch (condition) {
                            case 'movingAverage|9|above|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageBellowCandleClose)
                                break;
                            case 'movingAverage|9|bellow|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageBellowCandleClose)
                                break;
                            case 'movingAverage|20|above|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageBellowCandleClose)
                                break;
                            case 'movingAverage|20|bellow|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageBellowCandleClose)
                                break;
                            case 'movingAverage|80|above|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageBellowCandleClose)
                                break;
                            case 'movingAverage|80|bellow|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageBellowCandleClose)
                                break;
                            case 'movingAverage|200|above|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageAboveCandleClose)
                                break;
                            case 'movingAverage|200|bellow|close':
                                createMovingAverageFilter(candlesAndIndicators, intervals, acronym, movingAverageBellowCandleClose)
                                break;

                            default: alert("Condição de MA ainda não calculada!")

                        }
                    }


                    /*for (const interval of splitIntervals) {
 
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
 
                    }*/

                }

                $(document).trigger('filterViewOnSearchByIndicator');

            });


        });

    },
    render: function () {

        this.div.append(`
            <div class="flex flex-1 flex-col">
                <div class="indicatorContainer"></div>
                <div class="flex flex-1 justify-end m-2">
                    <button id="btnPlus" value=0 class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                    </button>
                    <button id="btnMinus" class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
                        </svg>
                    </button>
                    <button id="btnSearch" class="m-2 bg-violet-500 hover:bg-violet-600 active:bg-violet-700 focus:outline-none focus:ring focus:ring-violet-300">
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
                case 'relativeStrengthIndex':
                    indicatorSelects.empty();
                    indicatorSelects.append(IndicatorView.renderRelativeStrengthIndex());
                    break;
                case 'lowestIndex':
                    indicatorSelects.empty();
                    indicatorSelects.append(IndicatorView.renderLowestIndex());
                    break;
                default:
                    indicatorSelects.empty(); // Clear the content if no option is selected
            }
        });

        $('.indicatorContainer').append(this.createIndicatorContent());


        $('#btnPlus').on('click', function (e) {

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
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="80">80</option>
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
    renderRelativeStrengthIndex: function () {

        return `

            <select name="compare" class="flex-1 mx-2 h-7" id="compare-1">
                <option value="above" selected>Above</option>
                <option value="bellow">Below</option>
            </select>

            <select name="line1" class="flex-1 mx-2 h-7" id="line1">
                <option value="conversion" class="bg-green-200">Value</option>
                <option value="10" class="bg-green-100" selected>10</option>
                <option value="20" class="bg-green-100">20</option>
                <option value="30" class="bg-green-100">30</option>
                <option value="40" class="bg-green-100">40</option>
                <option value="50" class="bg-green-100">50</option>
                <option value="60" class="bg-green-200">60</option>
                <option value="70" class="bg-gray-200">70</option>
                <option value="80" class="bg-gray-200">80</option>
            </select>
             
            <select name="compare" class="flex-1 mx-2 h-7" id="compare-2">
                <option value="above">Above</option>
                <option value="bellow" selected>Below</option>
            </select>
            
            <select name="line2" class="flex-1 mx-2 h-7" id="line2">
                <option value="conversion" class="bg-green-200">Value</option>
                <option value="10" class="bg-green-100">10</option>
                <option value="20" class="bg-green-100" selected>20</option>
                <option value="30" class="bg-green-100">30</option>
                <option value="40" class="bg-green-100">40</option>
                <option value="50" class="bg-green-100">50</option>
                <option value="60" class="bg-green-200">60</option>
                <option value="70" class="bg-gray-200">70</option>
                <option value="80" class="bg-gray-200">80</option>
            </select>

            ${this.renderintervals()}
             
        `
    },
    renderLowestIndex: function () {
        return `<span class="flex-1 mx-2 h-7 ">${this.renderintervals()}</span>`
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
                <input type="checkbox" id="ma1h" name="1h" value="1h">
                <label for="ma1h" class="mx-1">1h</label><br>
                <input type="checkbox" id="ma2h" name="2h" value="2h">
                <label for="ma2h" class="mx-1">2h</label><br>
                <input type="checkbox" id="ma4h" name="4h" value="4h">
                <label for="ma4h" class="mx-1">4h</label><br>

                <input type="checkbox" id="ma6h" name="6h" value="6h" checked>
                <label for="ma6h" class="mx-1">6h</label><br>

                <input type="checkbox" id="ma8h" name="8h" value="8h">
                <label for="ma8h" class="mx-1">8h</label><br>
                <input type="checkbox" id="ma12h" name="12h" value="12h">
                <label for="ma12h" class="mx-1">12h</label><br>
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
                    <option value="relativeStrengthIndex">RSI</option>
                    <option value="lowestIndex">Index de Menor Preço</option>
                </select>
                <!-- Selects -->
                <div class="indicatorSelects flex flex-row flex-wrap" class="bg-red-200"></div>
               
            </div>
        `
    }

}

export default IndicatorView;