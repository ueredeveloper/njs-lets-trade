
const onHandleClick = ()=> {
    console.log('on click')
}


const renderCurrencies = () => {

    let currencies = [
        {
            "id": null,
            "symbol": "ETHBTC",
            "price": "0.05510000",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "LTCBTC",
            "price": "0.00131400",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "BNBBTC",
            "price": "0.00647700",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "NEOBTC",
            "price": "0.00023130",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "QTUMETH",
            "price": "0.00108900",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "EOSETH",
            "price": "0.00025590",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "SNTETH",
            "price": "0.00001314",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "BNTETH",
            "price": "0.00025630",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "BCCBTC",
            "price": "0.07908100",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "GASBTC",
            "price": "0.00010550",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "BNBETH",
            "price": "0.11750000",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "BTCUSDT",
            "price": "63103.31000000",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "ETHUSDT",
            "price": "3476.95000000",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "HSRBTC",
            "price": "0.00041400",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "OAXETH",
            "price": "0.00017780",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "DNTETH",
            "price": "0.00002801",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "MCOETH",
            "price": "0.00577200",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "ICNETH",
            "price": "0.00166300",
            "currency_collections": [
                []
            ]
        },
        {
            "id": null,
            "symbol": "MCOBTC",
            "price": "0.00021140",
            "currency_collections": [
                []
            ]
        }
    ];

    const container = document.createElement('div');
    container.innerHTML = table();

    currencies.forEach(currencie => {
        let tr = document.createElement('tr')
        tr.addEventListener('click', onHandleClick)
        let tdSymbol = document.createElement('td')
        tdSymbol.innerHTML = currencie.symbol
        tr.appendChild(tdSymbol)
        let tdPrice = document.createElement('td')
        tdPrice.innerHTML = currencie.price
        tr.appendChild(tdPrice)

        container.getElementsByTagName('tbody')[0].appendChild(tr)
    })

    return container.innerHTML

}

const table = () => {
    return `
    <table>
        <tbody>
            <tr>
                <th>Symbol</th>
                <th>Price</th>
            </tr>
        </tbody>
    </table>
  `
}





export default renderCurrencies;
