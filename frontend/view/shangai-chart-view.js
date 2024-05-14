import * as echarts from 'echarts';
import { convertOpenTime } from '../../utils/convertOpenTime';



const ShangaiChartView = async (div, currency) => {

    // var chartDom = document.getElementById(id);
    var shangaiIndexChart = echarts.init(div);
    var option;

    const upColor = '#ec0000';
    const upBorderColor = '#8A0000';
    const downColor = '#00da3c';
    const downBorderColor = '#008F28';

    function splitData(rawData) {
        const categoryData = [];
        const values = [];
        for (var i = 0; i < rawData.length; i++) {
            categoryData.push(rawData[i].splice(0, 1)[0]);
            values.push(rawData[i]);
        }
        return {
            categoryData: categoryData,
            values: values
        };
    }
    
   
    // Adicionar apenas os últimos 115 resultados para comparar com ichimoku cloud
    // Ordenação: openTime, open，close，lowest，highest
    let candlesOpenCloseLowHigh = splitData(currency.candlesticks.slice(-115).map(c => [convertOpenTime(c.openTime, interval), c.close, c.open, c.low, c.high]));

    //Traz 115 períodos a partir de 166 enviados.
    let ichimokuValues = await currency.ichimokuCloud;

    let spanA = ichimokuValues.map(ic => ic.spanA)
    // Adiciona 25 períodos antes dos valores para que esta linha fique adiantada no chart.
    Array.apply(null, Array(25)).map(arr => spanA.unshift(arr))
    let spanB = ichimokuValues.map(ic => ic.spanB)
    // Adiciona 25 períodos antes dos valores para que esta linha fique adiantada no chart.
    Array.apply(null, Array(25)).map(arr => spanB.unshift(arr))

    option = {
        title: {
            text: '', //`${symbol}, ${interval}`,
            left: 0
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross'
            }
        },
        legend: {
            data: ['Candles', 'MA200', 'Base Line', 'Conversion Line', 'Span A', 'Span B'],
            selected: {
                'Candles': true, // Somente Candles e MA200 não selecionadas
                'MA200': true, 
                'Base Line': false,
                'Conversion Line': false,
                'Span A': false,
                'Span B': false
            }
        },
        grid: {
            left: '10%',
            right: '5%',
            bottom: '20%'
        },
        xAxis: {
            type: 'category',
            data: candlesOpenCloseLowHigh.categoryData,
            boundaryGap: false,
            axisLine: { onZero: false },
            splitLine: { show: false },
            min: 'dataMin',
            max: 'dataMax'
        },
        yAxis: {
            scale: true,
            splitArea: {
                show: true
            }
        },
        dataZoom: [
            {
                type: 'inside',
                start: 70,
                end: 100
            },
            {
                show: true,
                type: 'slider',
                top: '90%',
                start: 50,
                end: 100
            }
        ],
        series: [
            {
                name: 'Candles',
                type: 'candlestick',
                data: candlesOpenCloseLowHigh.values,
                itemStyle: {
                    color: upColor,
                    color0: downColor,
                    borderColor: upBorderColor,
                    borderColor0: downBorderColor
                },
                markPoint: {
                    label: {
                        formatter: function (param) {
                            return param != null ? Math.round(param.value) + '' : '';
                        }
                    },
                    data: [
                        /* {
                             name: 'Mark',
                             coord: ['2013/5/31', 2300],
                             value: 2300,
                             itemStyle: {
                                 color: 'rgb(41,60,85)'
                             }
                         },
                         {
                             name: 'highest value',
                             type: 'max',
                             valueDim: 'highest'
                         },
                         {
                             name: 'lowest value',
                             type: 'min',
                             valueDim: 'lowest'
                         },
                         {
                             name: 'average value on close',
                             type: 'average',
                             valueDim: 'close'
                         }*/
                    ],
                    tooltip: {
                        formatter: function (param) {
                            return param.name + '<br>' + (param.data.coord || '');
                        }
                    }
                },
                /*markLine: {
                    symbol: ['none', 'none'],
                    data: [
                        [
                            {
                                name: 'from lowest to highest',
                                type: 'min',
                                valueDim: 'lowest',
                                symbol: 'circle',
                                symbolSize: 10,
                                label: {
                                    show: false
                                },
                                emphasis: {
                                    label: {
                                        show: false
                                    }
                                }
                            },
                            {
                                type: 'max',
                                valueDim: 'highest',
                                symbol: 'circle',
                                symbolSize: 10,
                                label: {
                                    show: false
                                },
                                emphasis: {
                                    label: {
                                        show: false
                                    }
                                }
                            }
                        ],
                        {
                            name: 'min line on close',
                            type: 'min',
                            valueDim: 'close'
                        },
                        {
                            name: 'max line on close',
                            type: 'max',
                            valueDim: 'close'
                        }
                    ]
                }*/
            },
            {
                name: 'MA200',
                type: 'line',
                data: currency.movingAverage.slice(-115),
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },
            {
                name: 'Conversion Line',
                type: 'line',
                data: currency.ichimokuCloud.map(ic => ic.conversion),
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },
            {
                name: 'Base Line',
                type: 'line',
                data: ichimokuValues.map(ic => ic.base),
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },
            {
                name: 'Span A',
                type: 'line',
                data: spanA,
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },
            {
                name: 'Span B',
                type: 'line',
                data: spanB,
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },


            

            /*{
                name: 'MA10',
                type: 'line',
                data: calculateMA(10),
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },
            {
                name: 'MA20',
                type: 'line',
                data: calculateMA(20),
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },
            {
                name: 'MA30',
                type: 'line',
                data: calculateMA(30),
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            }*/
        ]
    };

    option && shangaiIndexChart.setOption(option);

}

export { ShangaiChartView }