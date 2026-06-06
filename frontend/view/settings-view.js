import fetchReloadCandles from '../services/fetchReloadCandles';
import ShangaiChartView from './shangai-chart-view';

const SettingsView = {

    init: function () {
        this.div = $('#list-settings');
        this.render();

        $(document).on('selectCurrencyForChart', function (event, currency) {
            $('#reload-candles-symbol').val(currency[0].symbol);
        });

        $(document).on('click', '#btn-reload-candles', async function () {
            const symbol = $('#reload-candles-symbol').val().trim().toUpperCase();
            const interval = $('#reload-candles-interval').val();

            if (!symbol) {
                alert('Informe o símbolo da moeda.');
                return;
            }

            $('#btn-reload-candles').prop('disabled', true).text('Recarregando...');
            $('#reload-candles-result').text('');

            try {
                const result = await fetchReloadCandles(symbol, interval);
                const ok = result.results.filter(r => r.status === 'ok').length;
                const err = result.results.filter(r => r.status === 'error').length;
                $('#reload-candles-result').text(`✓ ${symbol}: ${ok} interval(s) recarregado(s)${err ? `, ${err} erro(s)` : ''}.`);
            } catch (e) {
                $('#reload-candles-result').text(`Erro: ${e.message}`);
            } finally {
                $('#btn-reload-candles').prop('disabled', false).text('Recarregar');
            }
        });
    },

    render: function () {
        this.div.append(`
            <div class="p-2">
                <h3 class="font-bold mb-2">Configurações</h3>

                <div class="mb-4">
                    <h4 class="font-semibold mb-1">Recarregar Candles</h4>
                    <div class="flex flex-row items-center gap-2 flex-wrap">
                        <input id="reload-candles-symbol"
                               type="text"
                               value="${ShangaiChartView.currency ? ShangaiChartView.currency.symbol : ''}"
                               placeholder="Ex: BTCUSDT"
                               class="border px-2 h-7 w-32 uppercase" />

                        <select id="reload-candles-interval" class="border h-7 px-1">
                            <option value="all">Todos os intervalos</option>
                            <option value="1m">1m</option>
                            <option value="5m">5m</option>
                            <option value="15m">15m</option>
                            <option value="30m">30m</option>
                            <option value="1h">1h</option>
                            <option value="2h">2h</option>
                            <option value="4h">4h</option>
                            <option value="8h">8h</option>
                            <option value="1d">1d</option>
                        </select>

                        <button id="btn-reload-candles"
                                class="px-3 h-7 bg-violet-500 text-white hover:bg-violet-600 active:bg-violet-700">
                            Recarregar
                        </button>

                        <span id="reload-candles-result" class="text-sm text-green-700"></span>
                    </div>
                </div>
            </div>
        `);
    }
};

export default SettingsView;
