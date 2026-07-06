import { useEffect, useRef, useState, useMemo, startTransition, useCallback } from 'react';
import { bootLog, bootError, bootTimed } from './utils/bootLog';
import {
  BOOT_STAGE,
  MAX_BOOT_STAGE,
  loadBootStage,
  saveBootStage,
  clampStage,
  bootStageAtLeast,
  bootStageLabel,
} from './utils/bootStages';
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
import BootStageBar from './components/BootStageBar';

const MOBILE_SHEET_HEIGHT = '88%';
const MOBILE_SHEET_FILTERS_HEIGHT = '45%';

function AppContent() {
  const renderCount = useRef(0);
  renderCount.current += 1;

  const { setCurrencies, setFilters, setSelectedChart, setGateFavorites, setBinanceFavorites,
    setChartInterval, uiPrefs, clearFavoriteView } = useCurrency();
  const { t } = useI18n();
  const isMobile = useIsMobile();

  const [bootStage, setBootStageState] = useState(() => loadBootStage());
  const setBootStage = useCallback((next) => {
    setBootStageState((prev) => {
      const n = typeof next === 'function' ? next(prev) : next;
      return clampStage(n);
    });
  }, []);

  const show = useCallback((min) => bootStageAtLeast(bootStage, min), [bootStage]);
  const bootDebug = bootStage < BOOT_STAGE.FULL;

  useEffect(() => {
    bootLog('AppContent montado', { isMobile, bootStage });
    return () => bootLog('AppContent desmontado');
  }, [isMobile, bootStage]);

  useEffect(() => {
    saveBootStage(bootStage);
    bootLog(`bootStage ativo → ${bootStage} (${bootStageLabel(bootStage)})`);
  }, [bootStage]);

  useEffect(() => {
    window.__bootStage = bootStage;
    window.__bootNext = () => setBootStage((s) => s + 1);
    window.__bootPrev = () => setBootStage((s) => s - 1);
    window.__bootGoto = (n) => setBootStage(n);
    window.__bootLabel = () => bootStageLabel(bootStage);
    return () => {
      delete window.__bootStage;
      delete window.__bootNext;
      delete window.__bootPrev;
      delete window.__bootGoto;
      delete window.__bootLabel;
    };
  }, [bootStage, setBootStage]);

  const [activeFilter, setActiveFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef(null);
  const [openPanels, setOpenPanels] = useState(() => []);

  const panelDefs = useMemo(() => ([
    { id: 'indicators', label: t('app.analyze') },
    { id: 'stats',      label: t('app.statistics') },
    { id: 'macross',    label: 'MA-Cross' },
  ]), [t]);

  const visiblePanelDefs = useMemo(
    () => panelDefs.filter((p) => uiPrefs.visiblePanels[p.id] !== false),
    [panelDefs, uiPrefs.visiblePanels],
  );

  useEffect(() => {
    if (bootDebug) return;
    setOpenPanels((prev) => {
      const stillVisible = prev.filter((id) => uiPrefs.visiblePanels[id] !== false);
      if (stillVisible.length) return stillVisible;
      const first = firstVisiblePanel(uiPrefs.visiblePanels);
      return first ? [first] : [];
    });
  }, [uiPrefs.visiblePanels, bootDebug]);

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
    let cancelled = false;
    async function init() {
      bootLog('App.init → start');
      try {
        const allCurrencies = await bootTimed('fetchAllCurrencies', fetchAllCurrencies);
        if (cancelled) return;
        setCurrencies({ name: '1h|All', list: allCurrencies });
        bootLog('App.init — currencies set', { count: allCurrencies.length });

        const binanceUsdtList = allCurrencies
          .filter((c) => c.symbol.endsWith('USDT'))
          .map((c) => c.symbol);

        const defaultIv = loadUiPreferences().defaultChartInterval;
        bootLog('App.init — Promise.all paralelo', { defaultIv });
        const [volumeFilters, stableFilters, btcData, gateList, binanceList] = await Promise.all([
          bootTimed('fetch24hVolume', fetch24hVolume),
          bootTimed('fetchStablecoins', () => fetchStablecoins().catch((err) => {
            bootError('fetchStablecoins (ignorado)', err);
            return [];
          })),
          bootTimed('fetchCandlesticksAndCloud', () => fetchCandlesticksAndCloud('BTCUSDT', defaultIv)),
          bootTimed('getFavorites(gate)', () => getFavorites('gate').catch((err) => {
            bootError('getFavorites(gate) (ignorado)', err);
            return [];
          })),
          bootTimed('getFavorites(binance)', () => getFavorites('binance').catch((err) => {
            bootError('getFavorites(binance) (ignorado)', err);
            return [];
          })),
        ]);
        if (cancelled) return;

        setFilters([
          { name: 'Mercado|USDT', list: binanceUsdtList },
          ...volumeFilters,
          ...stableFilters,
        ]);
        bootLog('App.init — filtros base', {
          mercado: binanceUsdtList.length,
          volume: volumeFilters.length,
          stable: stableFilters.length,
        });

        setSelectedChart({ ...btcData, interval: defaultIv, symbol: 'BTCUSDT' });
        setChartInterval(defaultIv);
        setGateFavorites(new Set(gateList));
        setBinanceFavorites(new Set(binanceList));
        bootLog('App.init — chart + favoritos OK', {
          candles: btcData?.candlesticks?.length ?? 0,
          gateFav: gateList.length,
          binanceFav: binanceList.length,
        });
      } catch (err) {
        bootError('App.init — FALHA', err);
      } finally {
        if (!cancelled) {
          bootLog('App.init — setLoading(false)');
          startTransition(() => setLoading(false));
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    if (renderCount.current <= 2) {
      bootLog('AppContent render — loading spinner', { render: renderCount.current });
    }
    return (
      <div className="flex items-center justify-center h-dvh min-h-0 bg-p1">
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

  function handleSelectCurrency() {
    const target = pickPanelOnCurrencySelect();
    if (isMobile) {
      closeCurrencyModal();
      if (target) setOpenPanels([target]);
      return;
    }
    if (target) setOpenPanels([target]);
  }

  function handleSelectFilter(name) {
    setActiveFilter(name);
    if (name) clearFavoriteView();
  }

  const showIndicator = show(BOOT_STAGE.INDICATOR_PANEL)
    && (bootDebug || (openPanels.includes('indicators') && uiPrefs.visiblePanels.indicators !== false));
  const showStats = show(BOOT_STAGE.STATS_PANEL)
    && (bootDebug || (openPanels.includes('stats') && uiPrefs.visiblePanels.stats !== false));
  const showMacross = show(BOOT_STAGE.MACROSS_PANEL)
    && (bootDebug || (openPanels.includes('macross') && uiPrefs.visiblePanels.macross !== false));

  return (
    <div className={`flex flex-col h-dvh min-h-0 overflow-hidden ${bootDebug ? 'pb-24' : ''}`}>

      {/* 1 — Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-p1 border-b border-p2 shrink-0">
        <h1 className="text-lg font-bold tracking-widest text-p5 uppercase">
          Let&apos;s Trade
        </h1>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-p4 opacity-60">{t('app.crypto_screener')}</span>
          {bootDebug && (
            <span className="text-[10px] font-mono text-amber-500/90">
              boot {bootStage}/{MAX_BOOT_STAGE}
            </span>
          )}
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

      {/* Mobile — bottom sheet */}
      {currencyModalOpen && show(BOOT_STAGE.MOBILE_BTN) && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={closeCurrencyModal}
        >
          <div
            className="absolute inset-0 bg-black/60 transition-opacity duration-300"
            style={{ opacity: currencyModalVisible ? 1 : 0 }}
          />

          <div
            className="absolute inset-x-0 bottom-0 flex flex-col bg-p1 border-t border-p2 rounded-t-2xl shadow-2xl"
            style={{
              height: MOBILE_SHEET_HEIGHT,
              transform: dragY > 0
                ? `translateY(${dragY}px)`
                : currencyModalVisible ? 'translateY(0)' : 'translateY(100%)',
              transition: dragY > 0 ? 'none' : 'transform 300ms ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <div className="w-12 h-1.5 rounded-full bg-p3/60" />
            </div>

            <div
              className="flex items-center justify-between px-4 py-2 border-b border-p2 shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <span className="text-sm font-semibold text-p5 uppercase tracking-widest">{t('app.currencies')}</span>
              <button
                type="button"
                onClick={closeCurrencyModal}
                onTouchStart={(e) => e.stopPropagation()}
                className="text-p5 hover:text-white w-9 h-9 flex items-center justify-center rounded-full hover:bg-p2 transition-colors text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {show(BOOT_STAGE.FILTER_TABS) && (
              <div
                className="flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden shrink-0"
                style={{ height: MOBILE_SHEET_FILTERS_HEIGHT }}
                onTouchStart={handleDragStart}
                onTouchMove={handleDragMove}
                onTouchEnd={handleDragEnd}
              >
                <FilterTabs activeFilter={activeFilter} onSelectFilter={handleSelectFilter} />
              </div>
            )}

            {show(BOOT_STAGE.CURRENCY_TABLE) && (
              <div className="flex-1 min-h-0 overflow-hidden">
                <CurrencyTable
                  activeFilter={activeFilter}
                  onSelectFilter={handleSelectFilter}
                  onSelectCurrency={handleSelectCurrency}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-row min-h-0 flex-1 overflow-hidden">

        {/* Coluna esquerda */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-p1 md:border-r border-p2">
          {/* 2 — Gráfico */}
          <div className="relative min-h-0 flex-1 md:shrink-0 md:flex-none md:h-[55vh] md:min-h-0">
            {show(BOOT_STAGE.CHART) ? (
              <CandlestickChart />
            ) : (
              <div className="flex items-center justify-center h-full text-p5/30 text-xs uppercase tracking-widest">
                estágio 2 → CandlestickChart
              </div>
            )}

            {/* 9 — Botão moedas mobile */}
            {show(BOOT_STAGE.MOBILE_BTN) && (
              <button
                type="button"
                onClick={openCurrencyModal}
                title="Abrir filtros e moedas"
                className="md:hidden absolute bottom-2 right-2 z-10 flex items-center gap-1.5 px-3 py-2 rounded-full bg-p3/90 hover:bg-p4 text-white text-xs font-mono font-semibold shadow-lg backdrop-blur-sm transition-colors touch-manipulation"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                  strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                </svg>
                {t('app.currencies')}
              </button>
            )}
          </div>

          {/* 3 — Barra de painéis */}
          {show(BOOT_STAGE.PANEL_BAR) && visiblePanelDefs.length > 0 && (
          <div className="shrink-0 border-t border-p2 flex divide-x divide-p2">
            {visiblePanelDefs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => togglePanel(id)}
                className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-1.5 text-xs uppercase tracking-widest transition-colors touch-manipulation ${
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

          {/* 6 — IndicatorPanel */}
          {showIndicator && (
            <div className="flex-1 min-h-0 flex flex-col">
              <IndicatorPanel />
            </div>
          )}

          {/* 7 — StatisticsPanel */}
          {showStats && (
            <div className="flex-1 min-h-0 flex flex-col">
              <StatisticsPanel />
            </div>
          )}

          {/* 8 — MultitradePanel */}
          {showMacross && (
            <div className="flex-1 min-h-0 flex flex-col">
              <MultitradePanel />
            </div>
          )}
        </div>

        {/* 4+5 — Coluna direita desktop */}
        <div className="hidden md:flex flex-col w-[28rem] shrink-0 min-h-0 bg-p1">
          {show(BOOT_STAGE.FILTER_TABS) && (
            <div className="flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden" style={{ height: '40%' }}>
              <FilterTabs activeFilter={activeFilter} onSelectFilter={handleSelectFilter} />
            </div>
          )}
          {show(BOOT_STAGE.CURRENCY_TABLE) ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <CurrencyTable
                activeFilter={activeFilter}
                onSelectFilter={handleSelectFilter}
                onSelectCurrency={handleSelectCurrency}
              />
            </div>
          ) : show(BOOT_STAGE.FILTER_TABS) ? (
            <div className="flex-1 flex items-center justify-center text-p5/30 text-xs uppercase tracking-widest">
              estágio 5 → CurrencyTable
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-p5/30 text-xs uppercase tracking-widest">
              estágio 4 → FilterTabs
            </div>
          )}
        </div>

      </div>

      {bootDebug && (
        <BootStageBar stage={bootStage} onStageChange={setBootStage} />
      )}
    </div>
  );
}

export default function App() {
  bootLog('App render — providers');
  return (
    <LanguageProvider>
      <CurrencyProvider>
        <AppContent />
      </CurrencyProvider>
    </LanguageProvider>
  );
}
