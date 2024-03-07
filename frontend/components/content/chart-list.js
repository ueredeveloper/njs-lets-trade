import { renderShangaiIndexChart } from "./shanghai-index-chart";

const renderCharts = (currency) => {

  currency.intervals.forEach ((interval, index) => {

  

    let container = document.getElementById('charts-container');
    let div = document.createElement('div');

    div.id = 'chart' + index;
    div.className = "chart";
    container.appendChild(div)

    renderShangaiIndexChart(div, currency.symbol, currency.limit, interval)

  })

};

export default renderCharts;

