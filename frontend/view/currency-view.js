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

      // Busca todas as moedas
      let currencies = await CurrencyModel.getAllCurrencies();
      // Busca o filtro indicado
      let filter = await CurrencyModel.findFilter(selection);
      // Filtra 
      //let list = currencies.list.filter(currency => filter.list.includes(currency.symbol));

      // Desta forma se mantém a ordem do filtro. Necessário para o filtro por indexação do menor valor
      let list = filter.list.map(list => currencies.list.find(cl => cl.symbol === list))

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

    this.fillTable(this.currenciesTable, { name: '1h|USDT', list: currenciesFilteredByQuote })

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

      if (item != undefined) {
        var btn = $('<tr>') // Create a table row for the button
          .append(`<td>${item.symbol}</td>`) // Add currency symbol
          .append(`<td>${item.price}</td>`) // Add currency price
          .append(`
          <td>
            <button class="btn-select-currency">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </button>
          </td>`) // Add button with class

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
      }



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
