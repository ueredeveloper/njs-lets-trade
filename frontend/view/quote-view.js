import CurrencyModel from "../model/currency-model";
import CurrencyController from "../controller/currency-controller";

const QuoteView = {
    init: async function () {
        this.div = $('#list-quotes');
        // this.addButton = $('#addButton');
        // this.currenciesTable = $('#currencies-table')
        // this.addButton.on('click', function () {
        //   CurrencyController.addCurrency({ symbol: QuoteView.textInput.val() });
        //   QuoteView.textInput.val('');
        // });
        this.includeStyles();
        this.renderList();
        
    },
    renderList: async function () {

        // this.div.empty();
        // let currencies = await CurrencyModel.getCurrencies();

        this.div.append(`
            <ul id="quote-view">
                <li><a href="#home">Home</a></li>
                <li><a href="#news">News</a></li>
                <li><a href="#contact">Contact</a></li>
                <li><a href="#about">About</a></li>
            </ul>
    `)

        // this.currenciesTable.append(`
        //   <table>
        //     <tbody>
        //       <tr>
        //         <th>Símbolo</th>
        //         <th>Preço</th>
        //       </tr>
        //     </tbody>
        //   </table>
        // `);

        // const tbody = this.currenciesTable.find('tbody');
        // currencies.forEach(function (item) {
        //   tbody.append(`
        //   <tr>
        //     <td>${item.symbol}</td>
        //     <td>${item.price}</td>
        //   </tr>
        // `);
        // });


    },
    includeStyles: function () {
     
        const cssLink = $('<link rel="stylesheet" type="text/css" href="/view/styles.css">');
        $('head').append(cssLink);
    }
    
};


export default QuoteView;