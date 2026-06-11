import { useEffect, useRef, useState } from 'react';
import { CurrencyProvider, useCurrency } from './contexts/CurrencyContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { useI18n } from './i18n';
import { fetchAllCurrencies, fetch24hVolume, fetchStablecoins, fetchCandlesticksAndCloud, getFavorites } from './services/api';


import FilterTabs from './components/FilterTabs';
import CurrencyTable from './components/CurrencyTable';
import IndicatorPanel from './components/IndicatorPanel';
import CandlestickChart from './components/CandlestickChart';
import RsiChart from './components/RsiChart';
import SettingsSidebar from './components/SettingsSidebar';
import StatisticsPanel from './components/StatisticsPanel';

function AppContent() {
  const { setCurrencies, setFilters, addFilter, setSelectedChart, setGateFavorites, setBinanceFavorites, setTradeFavorites, setTradeConfigs } = useCurrency();
  const { t } = useI18n();
  const [activeFilter, setActiveFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [showFavorites, setShowFavorites] = useState(null); // null | 'gate' | 'binance'
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef(null);
  const [openPanels, setOpenPanels] = useState(['indicators']);

  function togglePanel(id) {
    setOpenPanels((prev) => prev.includes(id) ? ['indicators'] : [id]);
  }

  useEffect(() => {
    async function init() {
      try {
        const allCurrencies = await fetchAllCurrencies();

        setCurrencies({ name: '1h|All', list: allCurrencies });

        const binanceUsdtList = allCurrencies
          .filter((c) => c.symbol.endsWith('USDT'))
          .map((c) => c.symbol);
        setFilters([{ name: 'Mercado|USDT', list: binanceUsdtList }]);

        const volumeFilters = await fetch24hVolume();
        volumeFilters.forEach((f) => addFilter(f));

        const stableFilters = await fetchStablecoins().catch(() => []);
        stableFilters.forEach((f) => addFilter(f));

        const btcData = await fetchCandlesticksAndCloud('BTCUSDT', '1h');
        setSelectedChart(btcData);

        const [gateList, binanceList, tradeList] = await Promise.all([
          getFavorites('gate').catch(() => []),
          getFavorites('binance').catch(() => []),
          getFavorites('trade').catch(() => []),
        ]);
        setGateFavorites(new Set(gateList));
        setBinanceFavorites(new Set(binanceList));
        // tradeList é [{symbol, exchange, interval, rsiBuy, rsiSell}]
        setTradeFavorites(new Set(tradeList.map(t => t.symbol)));
        setTradeConfigs(new Map(tradeList.map(t => [t.symbol, { exchange: t.exchange ?? 'gate', interval: t.interval, rsiBuy: t.rsiBuy, rsiSell: t.rsiSell, sellInterval: t.sellInterval ?? null }])));
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
          <span className="text-p5 text-sm tracking-widest uppercase">{t('app.loading')}</span>
        </div>
      </div>
    );
  }

  function openCurrencyModal() {
    setCurrencyModalOpen(true);
    setDragY(0);
    requestAnimationFrame(() => requestAnimationFrame(() => setCurrencyModalVisible(true)));
  }

  function closeCurrencyModal() {
    setDragY(0);
    setCurrencyModalVisible(false);
    setTimeout(() => setCurrencyModalOpen(false), 320);
  }

  function handleDragStart(e) {
    dragStartY.current = e.touches[0].clientY;
  }

  function handleDragMove(e) {
    if (dragStartY.current === null) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    if (delta > 0) setDragY(delta);
  }

  function handleDragEnd() {
    if (dragY > 120) {
      closeCurrencyModal();
    } else {
      setDragY(0);
    }
    dragStartY.current = null;
  }

  function handleSelectFilter(name) {
    setActiveFilter(name);
    setShowFavorites(null);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-p1 border-b border-p2 shrink-0">
        <h1 className="text-lg font-bold tracking-widest text-p5 uppercase">
          Let&apos;s Trade
        </h1>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-p4 opacity-60">{t('app.crypto_screener')}</span>
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

      {/* Bottom sheet de moedas */}
      {currencyModalOpen && (
        <div
          className="fixed inset-0 z-50"
          onClick={closeCurrencyModal}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 transition-opacity duration-300"
            style={{ opacity: currencyModalVisible ? 1 : 0 }}
          />

          {/* Sheet — sobe de baixo */}
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col bg-p1 border-t border-p2 rounded-t-2xl shadow-2xl"
            style={{
              height: '80%',
              transform: dragY > 0
                ? `translateY(${dragY}px)`
                : currencyModalVisible ? 'translateY(0)' : 'translateY(100%)',
              transition: dragY > 0 ? 'none' : 'transform 300ms ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle — área de drag */}
            <div
              className="flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <div className="w-12 h-1.5 rounded-full bg-p3/60" />
            </div>

            {/* Cabeçalho */}
            <div
              className="flex items-center justify-between px-4 py-2 border-b border-p2 shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <span className="text-sm font-semibold text-p5 uppercase tracking-widest">{t('app.currencies')}</span>
              <button
                onClick={closeCurrencyModal}
                onTouchStart={(e) => e.stopPropagation()}
                className="text-p5 hover:text-white w-9 h-9 flex items-center justify-center rounded-full hover:bg-p2 transition-colors text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Filtros */}
            <div
              className="flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden"
              style={{ height: '40%' }}
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <FilterTabs onSelectFilter={handleSelectFilter} />
            </div>

            {/* Tabela */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <CurrencyTable
                activeFilter={activeFilter}
                showFavorites={showFavorites}
                setShowFavorites={setShowFavorites}
                onSelectCurrency={() => { closeCurrencyModal(); setOpenPanels(['stats']); }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Corpo principal */}
      <div className="flex flex-row min-h-0 flex-1 overflow-hidden">

        {/* Coluna esquerda — Gráfico + painéis */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-p1 md:border-r border-p2">
          <div className="relative flex-none h-[55vh]">
            <CandlestickChart />
            {/* Botão Moedas — só visível em mobile */}
            <button
              onClick={openCurrencyModal}
              title="Abrir lista de moedas"
              className="md:hidden absolute bottom-2 right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-p3/80 hover:bg-p4 text-white text-xs font-mono font-semibold shadow-lg backdrop-blur-sm transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
              {t('app.currencies')}
            </button>
          </div>
          {/* Barra de toggles */}
          <div className="shrink-0 border-t border-p2 flex divide-x divide-p2">
            {[
              { id: 'indicators', label: t('app.analyze') },
              { id: 'stats',      label: t('app.statistics') },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => togglePanel(id)}
                className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-1.5 text-xs uppercase tracking-widest transition-colors ${
                  openPanels.includes(id) ? 'text-white' : 'text-p5 hover:text-white'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                  strokeWidth="1.5" stroke="currentColor"
                  className={`w-3 h-3 shrink-0 transition-transform ${openPanels.includes(id) ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
                {label}
              </button>
            ))}
          </div>
          {openPanels.includes('indicators') && (
            <div className="flex-1 min-h-0 flex flex-col">
              <IndicatorPanel />
            </div>
          )}
          {openPanels.includes('stats') && (
            <div className="flex-1 min-h-0 flex flex-col">
              <StatisticsPanel />
            </div>
          )}
        </div>

        {/* Coluna direita — Moedas (só desktop) */}
        <div className="hidden md:flex flex-col w-[28rem] shrink-0 min-h-0 bg-p1">
          <div className="flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden" style={{ height: '40%' }}>
            <FilterTabs onSelectFilter={handleSelectFilter} />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <CurrencyTable
              activeFilter={activeFilter}
              showFavorites={showFavorites}
              setShowFavorites={setShowFavorites}
              onSelectCurrency={() => setOpenPanels(['stats'])}
            />
          </div>
        </div>

      </div>

    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <CurrencyProvider>
        <AppContent />
      </CurrencyProvider>
    </LanguageProvider>
  );
}
