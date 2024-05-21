import CurrencyModel from "../model/currency-model";
import CurrencyController from "../controller/currency-controller";
import fetchCandlesticksAndCloud from "../services/fetchCandlesAndIchimokuCloud";

const CurrencyView = {
  init: async function () {
    this.textInput = $('#textInput');
    this.addButton = $('#addButton');
    this.currenciesTable = $('#list-currencies')
    this.addButton.on('click', function () {
      CurrencyController.addCurrency({ symbol: CurrencyView.textInput.val() });
      CurrencyView.textInput.val('');
    });
    this.render();

    $(document).on('onQuoteViewSelectChange', async function (event, selection) {

      console.log(selection)
      // Busca todas as moedas
      let currencies = await CurrencyModel.getAllCurrencies();
      // Filtra por quotação, por exemplo: USDT.
      let currenciesFilteredByQuote = CurrencyView.filterCurrenciesByQuote(currencies, selection);
      // Busca a tag tbody dentro da tag table e limpa esta tabela para novas linhas.
      let table = $('#list-currencies').empty();

      CurrencyView.createTable(table)

      CurrencyView.fillTable(table, { name: `1h|${selection}`, list: currenciesFilteredByQuote })

    });

    $(document).on('currencyViewSelectFilter', async function (event, selection) {

      //console.log(selection)
      // Busca todas as moedas
      let currencies = await CurrencyModel.getAllCurrencies();
      // Busca o filtro indicado
      let filter = await CurrencyModel.findFilter(selection);
      // Filtra 
      let list = currencies.list.filter(currency => filter.list.includes(currency.symbol));

      // Busca a tag tbody dentro da tag table e limpa esta tabela para novas linhas.
      let table = $('#list-currencies').empty();

      CurrencyView.createTable(table)

      /*{
        name: 'BinanceUSDT',
        list: [
          "BTCUSDT",
        ]
      }*/

      CurrencyView.fillTable(table, { name: filter.name, list: list })

    });

  },
  render: async function () {

    let currencies = await CurrencyModel.getAllCurrencies();

    let currenciesFilteredByQuote = this.filterCurrenciesByQuote(currencies, 'USDT')

    this.createTable(this.currenciesTable)

    this.fillTable(this.currenciesTable, {name: '1h|USDT', list: currenciesFilteredByQuote})

  },
  /**
   * Cria tabela com moedas (símbolo, valor).
   * @param {*} table 
   */
  createTable: function (table) {

    table.append(`
      <table class="">
        <!-- congela a tag thead -->
        <thead class="sticky top-0 z-10" >
          <tr class="bg-zinc-100">
            <th>Símbolo</th>
            <th>Preço</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `);
  },
  /**
   * Preenche tabela com valores.
   * @param {*} table 
   * @param {*} currencies 
   */
  fillTable: function (table, currencies) {

    console.log(currencies)

    let tbody = table.find('tbody');

    let interval = currencies.name.split('|')[0] // ex: '1h|i|conversion|a|base'

    currencies.list.forEach(function (item) {
      /* item:
      {
        "id": null,
        "symbol": "BONKUSDT",
        "price": "0.00003194",
      }
      */
      var btn = $('<tr>') // Create a table row for the button
        .append(`<td>${item.symbol}</td>`) // Add currency symbol
        .append(`<td>${item.price}</td>`) // Add currency price
        .append('<td><button class="btn-select-currency">Select</button></td>') // Add button with class
        .appendTo(tbody); // Append the row to the table body

      // Ação dos botões
      btn.find('.btn-select-currency').click(async function () {

        // Busca indicadores da moeda
        let currency = await fetchCandlesticksAndCloud([item], interval);
        // Envia a moeda para o chart
        $(document).trigger('selectCurrencyForChart', currency);

        // Add your desired action here (e.g., highlight row, store selection, etc.)
        //$(this).parent().parent().addClass('selected'); // Example: Highlight selected row
      });
    });
  },
  /**
   * Filtra por cotação, por exemplo: USDT.
   * @param {*} currencies 
   * @param {*} quote 
   * @returns 
   */
  filterCurrenciesByQuote: function (currencies, quote) {
    return currencies.list.filter(currency => currency.symbol.endsWith(quote))
  }

};

export default CurrencyView;
