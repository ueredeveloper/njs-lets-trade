import CurrencyModel from "../model/currency-model";
import CurrencyController from "../controller/currency-controller";

const QuoteView = {
  init: async function () {
    this.div = $('#list-quotes');
    this.addButton = $('#addButton');
    this.currenciesTable = $('#currencies-table')
    this.addButton.on('click', function () {
      CurrencyController.addCurrency({ symbol: QuoteView.textInput.val() });
      QuoteView.textInput.val('');
    });
    this.renderList();
  },
  renderList: async function () {

    this.currenciesTable.empty();
    let currencies = await CurrencyModel.getCurrencies();

    this.currenciesTable.append(`
      <table>
        <tbody>
          <tr>
            <th>Símbolo</th>
            <th>Preço</th>
          </tr>
        </tbody>
      </table>
    `);

    const tbody = this.currenciesTable.find('tbody');
    currencies.forEach(function (item) {
      tbody.append(`
      <tr>
        <td>${item.symbol}</td>
        <td>${item.price}</td>
      </tr>
    `);
    });






  }

};


export default QuoteView;