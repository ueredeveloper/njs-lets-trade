/*import * as echarts from 'echarts';

var chartDom = document.getElementById('main');
var myChart = echarts.init(chartDom);
var option;

fetch('http://localhost:3000/services/candles/?symbol=BTCUSDT&limit=23&period=1h')
  .then(response => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return response.json();
  })
  .then(candles => {


    option = {
      xAxis: {
        data: candles.map(c=> c.openTime)
      },
      yAxis: {},
      series: [
        {
          type: 'candlestick',
          data: 
            candles.map(c=> [parseFloat(c.open), parseFloat(c.close), parseFloat(c.low), parseFloat(c.high)])
          
        }
      ]
    };
    
    option && myChart.setOption(option);
    console.log(data); // Process the data received from the server
  })
  .catch(error => {
    console.error('There was a problem with your fetch operation:', error);
  });*/

import { myChart } from "./shanghai-index";


