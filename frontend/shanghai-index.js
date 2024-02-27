import * as echarts from 'echarts';

var chartDom = document.getElementById('main');
var myChart = echarts.init(chartDom);
var option;

const upColor = '#ec0000';
const upBorderColor = '#8A0000';
const downColor = '#00da3c';
const downBorderColor = '#008F28';
// Each item: open，close，lowest，highest

(async () => {

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
    function calculateMA(dayCount, candles) {
        var result = [];

        let candlesValues = candles.map(c => [c.openTime, c.close, c.open, c.low, c.high])
        for (var i = 0, len = candlesValues.values.length; i < len; i++) {
            if (i < dayCount) {
                result.push('-');
                continue;
            }
            var sum = 0;
            for (var j = 0; j < dayCount; j++) {
                sum += +candlesValues.values[i - j][1];
            }
            result.push(sum / dayCount);
        }
        return result;
    }

    const fetchCandlessticks = async (symbol, limit, period)=> {


       let candlesticks =  await fetch(`http://localhost:3000/services/candles/?symbol=${symbol}&limit=${limit}&period=${period}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        });

        return candlesticks;
    }

    const fetchIchimokuCloud = async (candles) => {


        let ichimokuCloud = await fetch('http://localhost:3000/services/ichimoku-cloud', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(candles)
        }).then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })

        return ichimokuCloud;
    }

    let candles = await fetchCandlessticks('BTCUSDT', 230, '1h')

    /**
     * Adicionar apenas os últimos 115 resultados para comparar com ichimoku cloud
     */
    let candlesOpenCloseLowHigh = splitData(candles.slice(-115).map(c => [c.openTime, c.close, c.open, c.low, c.high]))//.slice(-115);

    /**
     * Traz 115 períodos a partir de 166 enviados.
     */
    let ichimokuValues = await fetchIchimokuCloud(candles.slice(-166))


    option = {
        title: {
            text: 'Candlestick',
            left: 0
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross'
            }
        },
        legend: {
            //data: ['Candles', 'MA5', 'MA10', 'MA20', 'MA30']
            data: ['Candles', 'MA200', 'ichiBaseLine']
        },
        grid: {
            left: '10%',
            right: '10%',
            bottom: '15%'
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
                start: 50,
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
                data: calculateMA(200, candles),
                smooth: true,
                lineStyle: {
                    opacity: 0.5
                }
            },
            {
                name: 'ichiBaseLine',
                type: 'line',
                data: ichimokuValues.map(ic => ic.base),
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

    option && myChart.setOption(option);



})();




export { myChart }