import CurrencyModel from "../model/currency-model";
import CurrencyController from "../controller/currency-controller";

const CurrencyView = {
  init: async function () {
    this.textInput = $('#textInput');
    this.addButton = $('#addButton');
    this.currenciesTable = $('#list-currencies')
    this.addButton.on('click', function () {
      CurrencyController.addCurrency({ symbol: CurrencyView.textInput.val() });
      CurrencyView.textInput.val('');
    });
    this.renderList();
    $(document).on('quoteChanged', async function (event, selectedQuote) {
      // Busca todas as moedas
      let currencies = await CurrencyModel.getCurrencies();
      // Filtra por quotação, por exemplo: USDT.
      let currenciesFilteredByQuote = CurrencyView.filterCurrenciesByQuote(currencies, selectedQuote);
      // Busca a tag tbody dentro da tag table e limpa esta tabela para novas linhas.
      let table = $('#list-currencies').empty();

      CurrencyView.createTable(table)

      CurrencyView.fillTable(table, currenciesFilteredByQuote)

    });
  },
  renderList: async function () {

    let currencies = await CurrencyModel.getCurrencies();
    let currenciesFilteredByQuote = this.filterCurrenciesByQuote(currencies, 'USDT')

    this.createTable(this.currenciesTable)

    this.fillTable(this.currenciesTable, currenciesFilteredByQuote)

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

    currencies.forEach(function (item) {
      tbody.append(`
        <tr>
          <td>${item.symbol}</td>
          <td>${item.price}</td>
        </tr>
      `);
    });
  },
  /**
   * Filtra por cotação, por exemplo: USDT.
   * @param {*} currencies 
   * @param {*} quote 
   * @returns 
   */
  filterCurrenciesByQuote: function (currencies, quote) {
    return currencies.filter(currency => currency.symbol.endsWith(quote))
  }

};

export default CurrencyView;
