/**
 * For scrap binance browser
 */
const getSymbols = () => {
    let btn = document.createElement('button');
    btn.innerHTML = 'CLICK';
    let list = document.getElementsByClassName('bn-tab-list');
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

/*
04/11/2024

let div = document.getElementsByClassName('fixed-size-list')[1]
div.style.setProperty('--scroll-size', '20px');

let symbols = new Set();

let items = document.getElementsByClassName('item-symbol-text');     

for (let i = 0; i < items.length; i++) {
	symbols.add(items[i].children[0].textContent + 'USDT');
}*/

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

    function parseAbbreviatedNumber(value) {
        // Extract the number and suffix
        const number = parseFloat(value);
        const suffix = value.slice(-1).toUpperCase();

        // Convert based on suffix
        switch (suffix) {
            case 'K':
                return number * 1_000;
            case 'M':
                return number * 1_000_000;
            case 'B':
                return number * 1_000_000_000;
            default:
                return number; // Return as is if no suffix
        }
    }

    function handleUSDTMoviment() {

        // let _buy = document.getElementsByClassName('tableContent')
        // let __buy = _buy[3].getElementsByClassName('contentBuy')[0].innerText;
        let _buy = document.getElementsByClassName('t-caption2')[3];
        let __buy = _buy.children[1].childNodes[1];


        let price = document.getElementsByClassName('showPrice')[0];

        let result = parseAbbreviatedNumber(__buy.textContent) * parseFloat(price.textContent.replace(/,/g, ''));
        // let result = parseFloat(__buy.replace(/,/g, '')) * parseFloat(price.innerText.replace(/,/g, ''));

        document.getElementById('par1').innerHTML = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });;

    }


    btn1.addEventListener('click', handleSearch);
    btn2.addEventListener('click', handleUSDTMoviment);
    div[0].appendChild(btn1);
    div[0].appendChild(par1);
    div[0].appendChild(btn2);
}
scrollCurrencies()

// atualizar lista de moedas usdt binance 

// use Set para não repetir moedas
let symbols = new Set();
let items = document.getElementsByClassName('item-symbol-text');


for (let i = 0; i < items.length; i++) {
    symbols.add(items[i].childNodes[0].textContent + items[i].childNodes[1].textContent)
}

Array.from(symbols);
