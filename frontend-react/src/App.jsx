import { useEffect, useState, useMemo } from 'react';
import { CurrencyProvider, useCurrency } from './contexts/CurrencyContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { useI18n } from './i18n';
import { fetchAllCurrencies, fetch24hVolume, fetchStablecoins, fetchCandlesticksAndCloud, getFavorites } from './services/api';
import { loadUiPreferences, firstVisiblePanel } from './utils/uiPreferences';
import { useIsMobile } from './hooks/useIsMobile';
import FilterTabs from './components/FilterTabs';
import CurrencyTable from './components/CurrencyTable';
import IndicatorPanel from './components/IndicatorPanel';
import CandlestickChart from './components/CandlestickChart';
import SettingsSidebar from './components/SettingsSidebar';
import StatisticsPanel from './components/StatisticsPanel';
import MultitradePanel from './components/MultitradePanel';

function AppContent() {
  const { setCurrencies, setFilters, addFilter, setSelectedChart, setGateFavorites, setBinanceFavorites,
    setChartInterval, uiPrefs, clearFavoriteView } = useCurrency();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [activeFilter, setActiveFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Mobile: moedas | indicators | stats | macross */
  const [mobileSection, setMobileSection] = useState('moedas');
  const [openPanels, setOpenPanels] = useState(() => {
    const first = firstVisiblePanel(loadUiPreferences().visiblePanels);
    return first ? [first] : [];
  });
  const panelDefs = useMemo(() => ([
    { id: 'indicators', label: t('app.analyze') },
    { id: 'stats',      label: t('app.statistics') },
    { id: 'macross',    label: 'MA-Cross' },
  ]), [t]);

  const visiblePanelDefs = useMemo(
    () => panelDefs.filter((p) => uiPrefs.visiblePanels[p.id] !== false),
    [panelDefs, uiPrefs.visiblePanels],
  );

  const mobileTabs = useMemo(
    () => [{ id: 'moedas', label: t('app.currencies') }, ...visiblePanelDefs],
    [visiblePanelDefs, t],
  );

  useEffect(() => {
    setOpenPanels((prev) => {
      const stillVisible = prev.filter((id) => uiPrefs.visiblePanels[id] !== false);
      if (stillVisible.length) return stillVisible;
      const first = firstVisiblePanel(uiPrefs.visiblePanels);
      return first ? [first] : [];
    });
  }, [uiPrefs.visiblePanels]);

  function pickPanelOnCurrencySelect() {
    if (uiPrefs.visiblePanels.stats !== false) return 'stats';
    return firstVisiblePanel(uiPrefs.visiblePanels);
  }

  function togglePanel(id) {
    setOpenPanels((prev) => {
      if (prev.includes(id)) {
        const fallback = visiblePanelDefs.find((p) => p.id !== id)?.id;
        return fallback ? [fallback] : [];
      }
      return [id];
    });
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

        const defaultIv = loadUiPreferences().defaultChartInterval;
        const [volumeFilters, stableFilters, btcData, gateList, binanceList] = await Promise.all([
          fetch24hVolume(),
          fetchStablecoins().catch(() => []),
          fetchCandlesticksAndCloud('BTCUSDT', defaultIv),
          getFavorites('gate').catch(() => []),
          getFavorites('binance').catch(() => []),
        ]);

        volumeFilters.forEach((f) => addFilter(f));
        stableFilters.forEach((f) => addFilter(f));
        setSelectedChart({ ...btcData, interval: defaultIv, symbol: 'BTCUSDT' });
        setChartInterval(defaultIv);
        setGateFavorites(new Set(gateList));
        setBinanceFavorites(new Set(binanceList));
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
      <div className="flex items-center justify-center h-dvh min-h-0 bg-p1">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-p4 border-t-transparent rounded-full animate-spin" />
          <span className="text-p5 text-sm tracking-widest uppercase">{t('app.loading')}</span>
        </div>
      </div>
    );
  }

  function handleSelectCurrency() {
    const target = pickPanelOnCurrencySelect();
    if (isMobile) {
      if (target) setMobileSection(target);
      return;
    }
    if (target) setOpenPanels([target]);
  }

  function handleSelectFilter(name) {
    setActiveFilter(name);
    // Só limpa a view de favoritos (TN/MC/G/B) ao escolher um filtro de indicador;
    // onSelectFilter(null) vindo da toolbar não deve desfazer o toggle.
    if (name) clearFavoriteView();
  }

  return (
    <div className="flex flex-col h-dvh min-h-0 overflow-hidden">

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

      {/* Corpo principal */}
      <div className="flex flex-row min-h-0 flex-1 overflow-hidden">

        {/* Coluna esquerda — Gráfico + painéis / moedas (mobile) */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-p1 md:border-r border-p2">
          {/* Mobile: ~42% da coluna (flex), não dvh — evita toolbar esmagar o canvas */}
          <div className="relative min-h-0 flex-[5] min-h-[170px] md:shrink-0 md:flex-none md:h-[55vh] md:min-h-0">
            <CandlestickChart />
          </div>

          {/* Mobile — filtros + favoritos inline (sem bottom sheet) */}
          <div className="md:hidden flex flex-col flex-[7] min-h-0 border-t border-p2">
            <div className="shrink-0 flex border-b border-p2 divide-x divide-p2 overflow-x-auto touch-pan-x">
              {mobileTabs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMobileSection(id)}
                  className={`flex-1 min-w-[4.5rem] px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap touch-manipulation ${
                    mobileSection === id ? 'text-white bg-p2/70' : 'text-p5/70'
                  }`}
                  style={mobileSection === id && id === 'macross' ? { color: '#22d3ee' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>

            {mobileSection === 'moedas' ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="shrink-0 px-2 py-1 border-b border-p2 overflow-hidden h-36 min-h-[8rem]">
                  <FilterTabs activeFilter={activeFilter} onSelectFilter={handleSelectFilter} />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <CurrencyTable
                    activeFilter={activeFilter}
                    onSelectFilter={handleSelectFilter}
                    onSelectCurrency={handleSelectCurrency}
                  />
                </div>
              </div>
            ) : mobileSection === 'indicators' && uiPrefs.visiblePanels.indicators !== false ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <IndicatorPanel />
              </div>
            ) : mobileSection === 'stats' && uiPrefs.visiblePanels.stats !== false ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <StatisticsPanel />
              </div>
            ) : mobileSection === 'macross' && uiPrefs.visiblePanels.macross !== false ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <MultitradePanel />
              </div>
            ) : null}
          </div>

          {/* Desktop — barra de toggles + painéis */}
          {visiblePanelDefs.length > 0 && (
          <div className="hidden md:flex shrink-0 border-t border-p2 divide-x divide-p2">
            {visiblePanelDefs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => togglePanel(id)}
                className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-1.5 text-xs uppercase tracking-widest transition-colors ${
                  openPanels.includes(id) ? 'text-white' : 'text-p5 hover:text-white'
                }`}
                style={
                  openPanels.includes(id) && id === 'macross' ? { color: '#22d3ee' }
                  : {}
                }
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
          )}
          {openPanels.includes('indicators') && uiPrefs.visiblePanels.indicators !== false && (
            <div className="hidden md:flex flex-1 min-h-0 flex-col">
              <IndicatorPanel />
            </div>
          )}
          {openPanels.includes('stats') && uiPrefs.visiblePanels.stats !== false && (
            <div className="hidden md:flex flex-1 min-h-0 flex-col">
              <StatisticsPanel />
            </div>
          )}
          {openPanels.includes('macross') && uiPrefs.visiblePanels.macross !== false && (
            <div className="hidden md:flex flex-1 min-h-0 flex-col">
              <MultitradePanel />
            </div>
          )}
        </div>

        {/* Coluna direita — Moedas (desktop) */}
        <div className="hidden md:flex flex-col w-[28rem] shrink-0 min-h-0 bg-p1">
          <div className="flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden" style={{ height: '40%' }}>
            <FilterTabs activeFilter={activeFilter} onSelectFilter={handleSelectFilter} />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <CurrencyTable
              activeFilter={activeFilter}
              onSelectFilter={handleSelectFilter}
              onSelectCurrency={handleSelectCurrency}
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
