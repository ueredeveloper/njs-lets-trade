/*import { renderShangaiIndexChart } from "./components/content/shanghai-index-chart";
import ChartsList from "./components/content/charts-list";

const chartsList = new ChartsList()

document.body.appendChild(chartsList)
*/
// intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
//renderShangaiIndexChart('SCUSDT', 266, '1m')
//renderShangaiIndexChart('BTCUSDT', 266, '1m')
/*
import ChartList from "./components/content/chart-list";

// Create a container element
const container = document.createElement('div');

// Set the innerHTML of the container to the markup returned by ChartsList
container.innerHTML = ChartsList();

// Append the container to the body of the document
document.body.appendChild(container);*/

//import renderCharts from "./components/content/chart-list";
import renderQuoteCurrenciesButton from "./components/content/renderQuoteCurrenciesButton";
import renderQuoteCurrencies from "./components/content/renderQuotesCurrencies";

let currency = {
    symbol: 'BTCUSDT',
    limit: 266,
    intervals: ['5m', '15m', '30m', '1h', '4h', '1d']
}

//renderCharts(currency)

let tab = document.getElementById('tab-quote-currencies');

tab.innerHTML = renderQuoteCurrencies();
let topTab = document.getElementsByClassName('tab-buttons');

topTab[0].appendChild(renderQuoteCurrenciesButton('London'));
topTab[0].appendChild(renderQuoteCurrenciesButton('Paris'));
topTab[0].appendChild(renderQuoteCurrenciesButton('Tokyo'));






