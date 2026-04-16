import { useEffect, useState } from 'react';
import { CurrencyProvider, useCurrency } from './contexts/CurrencyContext';
import { fetchAllCurrencies, fetch24hVolume, fetchCandlesticksAndCloud } from './services/api';

import FilterTabs from './components/FilterTabs';
import CurrencyTable from './components/CurrencyTable';
import IndicatorPanel from './components/IndicatorPanel';
import CandlestickChart from './components/CandlestickChart';
import SettingsSidebar from './components/SettingsSidebar';

function AppContent() {
  const { setCurrencies, setFilters, addFilter, setSelectedChart } = useCurrency();
  const [activeFilter, setActiveFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const allCurrencies = await fetchAllCurrencies();
        setCurrencies({ name: '1h|All', list: allCurrencies });

        const binanceUsdtList = allCurrencies
          .filter((c) => c.symbol.endsWith('USDT'))
          .map((c) => c.symbol);
        setFilters([{ name: '1h|Binance|USDT', list: binanceUsdtList }]);

        const volumeFilters = await fetch24hVolume();
        volumeFilters.forEach((f) => addFilter(f));

        // Carrega gráfico do BTC por padrão
        const btcData = await fetchCandlesticksAndCloud('BTCUSDT', '1h');
        setSelectedChart(btcData);
      } catch (err) {
        console.error('Erro ao inicializar:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-p4 border-t-transparent rounded-full animate-spin" />
          <span className="text-p5 text-sm tracking-widest uppercase">Carregando moedas...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-p1 border-b border-p2 shrink-0">
        <h1 className="text-lg font-bold tracking-widest text-p5 uppercase">
          Let&apos;s Trade
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-p4 opacity-60">crypto screener</span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-p5 hover:text-white p-1 rounded hover:bg-p2 transition-colors"
            title="Configurações"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </button>
        </div>
      </header>

      <SettingsSidebar open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Corpo principal: gráfico esquerda | painel direita */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* Coluna esquerda — Gráfico */}
        <div className="flex flex-col flex-1 min-w-0 bg-p1 border-r border-p2">
          <CandlestickChart />
        </div>

        {/* Coluna direita — Lista de moedas */}
        <div className="flex flex-col w-80 shrink-0 bg-p1">

          {/* Filtros — 40% vertical */}
          <div className="flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden" style={{ height: '40%' }}>
            <FilterTabs onSelectFilter={setActiveFilter} />
          </div>

          {/* Tabela — 60% vertical */}
          <div className="min-h-0 overflow-hidden" style={{ height: '60%' }}>
            <CurrencyTable activeFilter={activeFilter} />
          </div>
        </div>
      </div>

      {/* Rodapé — Painel de indicadores */}
      <div className="shrink-0 border-t border-p2 bg-p1">
        <IndicatorPanel />
      </div>

    </div>
  );
}

export default function App() {
  return (
    <CurrencyProvider>
      <AppContent />
    </CurrencyProvider>
  );
}
