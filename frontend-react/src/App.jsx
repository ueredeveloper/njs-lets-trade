import { useEffect, useRef, useState, useMemo, startTransition, useCallback } from 'react';
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
import { loadUiPreferences, firstVisiblePanel, CURRENCY_PANEL_WIDTH_MIN, CURRENCY_PANEL_WIDTH_MAX } from './utils/uiPreferences';
import { useIsMobile } from './hooks/useIsMobile';
import FilterTabs from './components/FilterTabs';
import CurrencyTable from './components/CurrencyTable';
import IndicatorPanel from './components/IndicatorPanel';
import CandlestickChart from './components/CandlestickChart';
import SettingsSidebar from './components/SettingsSidebar';
import StatisticsPanel from './components/StatisticsPanel';
import BootStageBar from './components/BootStageBar';
import MaximizeIcon from './components/MaximizeIcon';

const MOBILE_SHEET_HEIGHT = '88%';
const MOBILE_SHEET_FILTERS_HEIGHT = '30%';

function AppContent() {
  const { setCurrencies, setFilters, setSelectedChart, setGateFavorites, setBinanceFavorites,
    setChartInterval, uiPrefs, clearFavoriteView, setCurrencyPanelWidth } = useCurrency();
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
    saveBootStage(bootStage);
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

  // Redimensionamento da coluna de moedas/filtros (desktop) por arraste
  const [panelWidthDrag, setPanelWidthDrag] = useState(null);
  const currencyPanelWidth = panelWidthDrag ?? uiPrefs.currencyPanelWidth;

  function handlePanelResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = uiPrefs.currencyPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      const delta = startX - ev.clientX; // arrastar para a esquerda alarga o painel
      const next = Math.min(CURRENCY_PANEL_WIDTH_MAX, Math.max(CURRENCY_PANEL_WIDTH_MIN, startWidth + delta));
      setPanelWidthDrag(next);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // setTimeout evita colidir com um render de AppContent ainda em andamento
      // vindo da última rajada de mousemove (setPanelWidthDrag síncrono).
      setTimeout(() => {
        setPanelWidthDrag((w) => {
          if (w !== null) setCurrencyPanelWidth(w);
          return null;
        });
      }, 0);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const panelDefs = useMemo(() => ([
    { id: 'indicators', label: t('app.analyze') },
    { id: 'stats',      label: t('app.statistics') },
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

  // Aba de painel: sempre seleciona QUAL painel mostrar (indicadores/estatísticas),
  // nunca fecha sozinha — separado do layout (split/chart/panel) abaixo.
  function selectPanel(id) {
    setOpenPanels([id]);
  }

  // Layout vertical da coluna esquerda: 'split' (padrão, gráfico + painel dividem
  // altura), 'chart' (gráfico 100%, painel escondido) ou 'panel' (painel 100%,
  // gráfico reduzido a uma tira). Cada lado tem seu próprio botão de maximizar —
  // clicar de novo no lado já maximizado volta pro split.
  const [layoutMode, setLayoutMode] = useState('split'); // 'split' | 'chart' | 'panel'

  function toggleMaximizeChart() {
    setLayoutMode((m) => (m === 'chart' ? 'split' : 'chart'));
  }
  function toggleMaximizePanel() {
    setLayoutMode((m) => (m === 'panel' ? 'split' : 'panel'));
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const allCurrencies = await fetchAllCurrencies();
        if (cancelled) return;
        setCurrencies({ name: '1h|All', list: allCurrencies });

        const binanceUsdtList = allCurrencies
          .filter((c) => c.symbol.endsWith('USDT'))
          .map((c) => c.symbol);

        const defaultIv = loadUiPreferences().defaultChartInterval;
        const [volumeFilters, stableFilters, btcData, gateList, binanceList] = await Promise.all([
          fetch24hVolume(),
          fetchStablecoins().catch(() => []),
          fetchCandlesticksAndCloud('BTCUSDT', defaultIv),
          getFavorites('gate').catch(() => []),
          getFavorites('binance').catch(() => []),
        ]);
        if (cancelled) return;

        setFilters([
          { name: 'Mercado|USDT', list: binanceUsdtList },
          ...volumeFilters,
          ...stableFilters,
        ]);

        setSelectedChart({ ...btcData, interval: defaultIv, symbol: 'BTCUSDT' });
        setChartInterval(defaultIv);
        setGateFavorites(new Set(gateList));
        setBinanceFavorites(new Set(binanceList));
      } catch (err) {
        console.error('Erro ao inicializar:', err);
      } finally {
        if (!cancelled) {
          startTransition(() => setLoading(false));
        }
      }
    }
    init();
    return () => { cancelled = true; };
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
          id="currency-panel-overlay"
          className="currency-panel-overlay fixed inset-0 z-50 md:hidden"
          onClick={closeCurrencyModal}
        >
          <div
            className="currency-panel-backdrop absolute inset-0 bg-black/60 transition-opacity duration-300"
            style={{ opacity: currencyModalVisible ? 1 : 0 }}
          />

          <div
            id="currency-panel-mobile"
            className="currency-panel currency-panel--mobile absolute inset-x-0 bottom-0 flex flex-col bg-p1 border-t border-p2 rounded-t-2xl shadow-2xl"
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
              id="currency-panel-mobile-handle"
              className="currency-panel-handle flex justify-center pt-1.5 pb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <div className="w-12 h-1.5 rounded-full bg-p3/60" />
            </div>

            <div
              id="currency-panel-mobile-header"
              className="currency-panel-header flex items-center justify-between px-3 py-1 border-b border-p2 shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
            >
              <span className="text-xs font-semibold text-p5 uppercase tracking-widest">{t('app.currencies')}</span>
              <button
                type="button"
                id="currency-panel-mobile-close"
                onClick={closeCurrencyModal}
                onTouchStart={(e) => e.stopPropagation()}
                className="currency-panel-close text-p5 hover:text-white w-7 h-7 flex items-center justify-center rounded-full hover:bg-p2 transition-colors text-xl leading-none"
              >
                ×
              </button>
            </div>

            {show(BOOT_STAGE.FILTER_TABS) && (
              <div
                id="currency-panel-filters"
                className="currency-panel-filters flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden shrink-0"
                style={{ height: MOBILE_SHEET_FILTERS_HEIGHT }}
                onTouchStart={handleDragStart}
                onTouchMove={handleDragMove}
                onTouchEnd={handleDragEnd}
              >
                <FilterTabs activeFilter={activeFilter} onSelectFilter={handleSelectFilter} />
              </div>
            )}

            {show(BOOT_STAGE.CURRENCY_TABLE) && (
              <div id="currency-panel-table" className="currency-panel-table flex-1 min-h-0 overflow-hidden">
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
          {/* 2 — Gráfico e painel de análise dividem a altura (55/45) por padrão;
               maximizar um leva a 100% e anima o outro até sumir — mesma técnica de
               flex-basis + transition da referência (Tela Dividida). */}
          <div
            className="relative min-h-0"
            style={{
              flex: `1 1 ${layoutMode === 'chart' ? 100 : layoutMode === 'panel' ? 0 : 55}%`,
              opacity: layoutMode === 'panel' ? 0 : 1,
              overflow: 'hidden',
              transition: 'flex-basis 0.4s ease-in-out, opacity 0.3s ease-in-out',
            }}
          >
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
                id="currency-panel-open-btn"
                onClick={openCurrencyModal}
                title="Abrir filtros e moedas"
                className="currency-panel-open-btn md:hidden absolute bottom-2 right-2 z-10 flex items-center gap-1.5 px-3 py-2 rounded-full bg-p3/90 hover:bg-p4 text-white text-xs font-mono font-semibold shadow-lg backdrop-blur-sm transition-colors touch-manipulation"
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

          {/* 3a — Linha divisória fininha (1px) entre gráfico e painel. Os botões não
               moram dentro dela — flutuam por cima (overlay), ancorados na mesma
               posição vertical, então continuam sempre juntos, no mesmo lugar, sem
               precisar de uma barra grossa pra caber. Ancoragem muda com o layout
               pra nunca ficar "pendurada" sobre um lado com altura zero (some/corta
               ao maximizar): fica dentro do gráfico quando ele tem altura, dentro do
               painel quando é o painel que está maximizado. No mobile sobe acima do
               botão flutuante "Moedas" (que fica no canto do gráfico) pra não colidir. */}
          <div className="relative shrink-0 h-px bg-p2 z-20">
            <div className={`absolute right-1.5 flex items-center gap-1 ${
              layoutMode === 'panel' ? 'top-1' : 'bottom-11 md:bottom-1'
            }`}>
              <button
                type="button"
                onClick={toggleMaximizeChart}
                title={layoutMode === 'chart' ? 'Dividir tela' : 'Maximizar gráfico'}
                aria-label={layoutMode === 'chart' ? 'Dividir tela' : 'Maximizar gráfico'}
                className={`flex items-center justify-center w-5 h-5 rounded border transition-colors touch-manipulation shadow ${
                  layoutMode === 'chart'
                    ? 'bg-p4 text-white border-p4'
                    : 'text-p4 bg-p1/90 border-p2 hover:text-white hover:bg-p3/50'
                }`}
              >
                <MaximizeIcon active={layoutMode === 'chart'} kind="chart" className="w-3 h-3 shrink-0" />
              </button>
              <button
                type="button"
                onClick={toggleMaximizePanel}
                title={layoutMode === 'panel' ? 'Dividir tela' : 'Maximizar painel'}
                aria-label={layoutMode === 'panel' ? 'Dividir tela' : 'Maximizar painel'}
                className={`flex items-center justify-center w-5 h-5 rounded border transition-colors touch-manipulation shadow ${
                  layoutMode === 'panel'
                    ? 'bg-p4 text-white border-p4'
                    : 'text-p4 bg-p1/90 border-p2 hover:text-white hover:bg-p3/50'
                }`}
              >
                <MaximizeIcon active={layoutMode === 'panel'} kind="panel" className="w-3 h-3 shrink-0" />
              </button>
            </div>
          </div>

          {/* 3b+6+7 — Painel de análise (Indicadores/Estatísticas): mesma técnica de
               flex-basis animado do gráfico acima, em espelho. Abas só escolhem QUAL
               painel ver (o maximizar/restaurar mora na barra compartilhada acima). */}
          <div
            className="flex flex-col min-h-0"
            style={{
              flex: `1 1 ${layoutMode === 'panel' ? 100 : layoutMode === 'chart' ? 0 : 45}%`,
              opacity: layoutMode === 'chart' ? 0 : 1,
              overflow: 'hidden',
              transition: 'flex-basis 0.4s ease-in-out, opacity 0.3s ease-in-out',
            }}
          >
            {show(BOOT_STAGE.PANEL_BAR) && visiblePanelDefs.length > 0 && (
            <div className="shrink-0 border-b border-p2 flex items-stretch divide-x divide-p2">
              {visiblePanelDefs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectPanel(id)}
                  title={`Mostrar ${label.toLowerCase()}`}
                  className={`flex-1 justify-center px-3 py-1.5 text-xs uppercase tracking-widest transition-colors touch-manipulation ${
                    openPanels.includes(id)
                      ? 'bg-p3/50 text-white font-semibold'
                      : 'text-p5 hover:text-white hover:bg-p3/20'
                  }`}
                >
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
          </div>
        </div>

        {/* Handle de redimensionamento da coluna direita (desktop) */}
        <div
          id="currency-panel-resize-handle"
          className="hidden md:flex shrink-0 w-1.5 cursor-col-resize items-stretch bg-p2 hover:bg-p4/60 active:bg-p4 transition-colors touch-none"
          onMouseDown={handlePanelResizeStart}
          title="Arrastar para redimensionar"
        />

        {/* 4+5 — Coluna direita desktop */}
        <div
          id="currency-panel-desktop"
          className="currency-panel currency-panel--desktop hidden md:flex flex-col shrink-0 min-h-0 bg-p1"
          style={{ width: `${currencyPanelWidth}px` }}
        >
          {show(BOOT_STAGE.FILTER_TABS) && (
            <div
              id="currency-panel-filters"
              className="currency-panel-filters flex flex-col min-h-0 px-2 py-1 border-b border-p2 overflow-hidden shrink-0 h-[44%] lg:h-[42%]"
            >
              <FilterTabs activeFilter={activeFilter} onSelectFilter={handleSelectFilter} />
            </div>
          )}
          {show(BOOT_STAGE.CURRENCY_TABLE) ? (
            <div id="currency-panel-table" className="currency-panel-table flex-1 min-h-0 overflow-hidden">
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
  return (
    <LanguageProvider>
      <CurrencyProvider>
        <AppContent />
      </CurrencyProvider>
    </LanguageProvider>
  );
}
