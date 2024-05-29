const getAllCurrencies = require("../binance/getAllCurrencies");

describe('print all currencies', () => {
    it('deve imprimir todas as moedas da plataforma binance', async () => {
        // Mock da função console.log para verificar se foi chamada corretamente
       // console.log = jest.fn();

        let currencies = await getAllCurrencies();

        // Log the output for debugging purposes
        console.log(currencies);

        // Check if the mock was called
       // expect(console.log).toHaveBeenCalled();
        //expect(console.log).toHaveBeenCalledWith(currencies);
    });
});


/*
console.log
    [
      {
        id: null,
        symbol: 'ETHBTC',
        price: '0.05702000',
        currency_collections: [ [] ]
      },
      */
