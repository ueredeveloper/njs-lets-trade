/**
 * For scrap binance browser
 */
const getSymbols = () => {
    let btn = document.createElement('button');
    btn.innerHTML = 'CLICK';
    let list = document.getElementsByClassName('sort-item-wrap');
    list[0].appendChild(btn)
    var symbols = []
    btn.onclick = function () {
        let items = document.getElementsByClassName('item-symbol-ba')
        for (let i = 0; i < items.length; i++) {
            symbols.push(items[i].innerHTML + 'USDT')
        }
    }
}
//getSymbols()

const scrollCurrencies = () => {
    let div = document.getElementsByClassName('header-container');

    let btn1 = document.createElement('button');

    btn1.innerHTML = '&#x002B;';
    btn1.width = '20px';


    let btn2 = document.createElement('button');

    btn2.innerHTML = '&#8853;';

    let par1 = document.createElement('p');
    par1.style.width = "100px"
    par1.id = 'par1';


    function handleSearch() {

        const currencies = document.getElementsByClassName('item-symbol-text');
        let i = 0;
        const interval = setInterval(() => {
            if (i >= currencies.length) {
                //console.log('if i>=currencies.len, clear')
                clearInterval(interval); // Stop the interval after clicking on all elements
                return;
            }

            try {
                //console.log('click  ', i, currencies[i].innerText)
                currencies[i].click();
                i++;
            } catch (error) {
                console.error('Error clicking element:', error);
                clearInterval(interval); // Stop the interval on error
            }
        }, 3000);
    }
    function handleUSDTMoviment() {

        let _buy = document.getElementsByClassName('tableContent')
        let __buy = _buy[3].getElementsByClassName('contentBuy')[0].innerText;


        let price = document.getElementsByClassName('showPrice')[0];


        //console.log('Buy ', __buy, 'Price ', price)

        let result = parseFloat(__buy.replace(/,/g, '')) * parseFloat(price.innerText.replace(/,/g, ''));

        document.getElementById('par1').innerHTML = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });;

    }


    btn1.addEventListener('click', handleSearch);
    btn2.addEventListener('click', handleUSDTMoviment);
    div[0].appendChild(btn1);
    div[0].appendChild(par1);
    div[0].appendChild(btn2);
}
scrollCurrencies()