import { useState, useEffect } from 'react';
import { reloadCandles, getMaCrossScreenerConfig, saveMaCrossScreenerConfig,
  getBollingerMedianTrendConfig, saveBollingerMedianTrendConfig,
  getCacheSettings, saveCacheSettings } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { useI18n } from '../i18n';
import { useCurrency } from '../contexts/CurrencyContext';
import { PERIOD_DEFAULT_COLORS, MAX_OVERLAY_SLOTS,
  CURRENCY_PANEL_WIDTH_MIN, CURRENCY_PANEL_WIDTH_MAX, CURRENCY_PANEL_WIDTH_DEFAULT,
  VWAP_SLOPE_HIGHLIGHT_LOOKBACKS } from '../utils/uiPreferences';

const OVERLAY_SETTING_INTERVALS = ['15m', '30m', '1h', '4h', '1d'];
const OVERLAY_SETTING_PERIODS   = ['9', '21', '50', '200'];

const PALETTES = [
  { id: 'default',    name: 'Padrão / Default',
    colors: { p1: '#260d33', p2: '#003f69', p3: '#106b87', p4: '#157a8c', p5: '#b3aca4' } },
  { id: 'dracula',   name: 'Dracula',
    colors: { p1: '#13131f', p2: '#1e1e2e', p3: '#2d2d44', p4: '#bd93f9', p5: '#f8f8f2' } },
  { id: 'tokyo',     name: 'Tokyo Night',
    colors: { p1: '#0a0c16', p2: '#13152a', p3: '#1e2035', p4: '#7aa2f7', p5: '#c0caf5' } },
  { id: 'light',     name: 'Claro / Light',
    colors: { p1: '#f1f5f9', p2: '#dde3ec', p3: '#94a3b8', p4: '#0369a1', p5: '#0f172a' } },
  { id: 'light-warm',name: 'Claro Quente / Warm Light',
    colors: { p1: '#faf7f2', p2: '#ede8df', p3: '#a8a29e', p4: '#b45309', p5: '#1c1917' } },
];

function applyPalette(colors) {
  const root = document.documentElement;
  Object.entries(colors).forEach(([k, v]) => root.style.setProperty(`--color-${k}`, v));
  document.body.style.backgroundColor = colors.p1;
  window.dispatchEvent(new Event('palette-updated'));
}

const RELOAD_INTERVALS = ['all', '1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

/** Monta um subtítulo legível (intervalo · período/desvio · candles) a partir do meta de
 *  preset devolvido por /services/cache-settings — só os caches com preset granular por id
 *  (ver PRESET_MODULES em backend/services/fetchCacheSettings.js) têm esse detalhe; os demais
 *  ficam só com o rótulo, sem quebrar nada. */
function formatCacheMeta(meta) {
  if (!meta) return null;
  const parts = [];
  if (meta.interval) parts.push(meta.interval);
  if (meta.period != null && meta.stdDev != null) parts.push(`BB(${meta.period},${meta.stdDev})`);
  if (meta.lookback != null) parts.push(`${meta.lookback} candles`);
  return parts.length ? parts.join(' · ') : null;
}

function AccordionItem({ id, title, hint, openSection, setOpenSection, children }) {
  const isOpen = openSection === id;
  return (
    <div className="border-b border-p2/30 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpenSection(isOpen ? null : id)}
        className="w-full flex items-center justify-between py-3 text-left group"
      >
        <span className="text-p5 text-xs uppercase tracking-widest opacity-50 group-hover:opacity-80 transition-opacity">{title}</span>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"
          className={`w-3.5 h-3.5 text-p5/40 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {isOpen && (
        <div className="pb-4">
          {hint && <p className="text-[10px] text-p5/50 mb-3 leading-relaxed">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

export default function SettingsSidebar({ open, onClose }) {
  const { lang, setLang } = useLanguage();
  const { t } = useI18n();
  const { selectedChart, assetDisplay, setAssetDisplayCategory, assetCategoryKeys,
    chartPanelButtons, setChartPanelButton, chartPanelButtonKeys,
    uiPrefs, setDefaultChartInterval, setCommonChartIntervals, setPanelVisible,
    setFavoriteButtonVisible, favoriteButtonKeys,
    setOverlaySlotsPreference, setCurrencyPanelWidth,
    setStatsDefaults, setVwapAnchorDefault, setVwapSlopeHighlightDefault, setChartEngineDefault,
    chartIntervalOptions, panelKeys,
    activeTrades, activeTradesSettings, updateActiveTradesSettings,
    ignoredActiveTrades, dismissActiveTrade, restoreActiveTrade } = useCurrency();

  function toggleCommonChartInterval(interval) {
    const current = uiPrefs.commonChartIntervals ?? [];
    const active = current.includes(interval);
    if (active && current.length <= 1) return; // pelo menos um intervalo rápido precisa ficar visível
    setCommonChartIntervals(
      active ? current.filter((iv) => iv !== interval) : [...current, interval],
    );
  }

  function isOverlayActive(period, interval) {
    return uiPrefs.overlaySlots.some(s => s.period === period && s.interval === interval);
  }

  function toggleOverlaySlot(period, interval) {
    const active = isOverlayActive(period, interval);
    if (active) {
      setOverlaySlotsPreference(uiPrefs.overlaySlots.filter(
        s => !(s.period === period && s.interval === interval),
      ));
    } else {
      if (uiPrefs.overlaySlots.length >= MAX_OVERLAY_SLOTS) return;
      const maxNum = uiPrefs.overlaySlots.reduce((max, s) => {
        const n = parseInt(s.id.replace('slot', ''), 10);
        return isNaN(n) ? max : Math.max(max, n);
      }, 0);
      const color = PERIOD_DEFAULT_COLORS[period] ?? '#94a3b8';
      setOverlaySlotsPreference([
        ...uiPrefs.overlaySlots,
        { id: `slot${maxNum + 1}`, period, interval, enabled: true, color },
      ]);
    }
  }

  const [openSection, setOpenSection]     = useState(null);
  const [activeId, setActiveId]           = useState('default');
  const [reloadSymbol, setReloadSymbol]   = useState('');
  const [reloadInterval, setReloadInterval] = useState('all');
  const [reloadState, setReloadState]     = useState(null);
  const [reloadError, setReloadError]     = useState('');

  const [screenerConfig, setScreenerConfig] = useState(null);
  const [screenerLoaded, setScreenerLoaded] = useState(false);
  const [screenerLoadError, setScreenerLoadError] = useState('');
  const [screenerSaveState, setScreenerSaveState] = useState(null); // null | 'saving' | 'saved' | 'error'
  const [screenerBlacklistInput, setScreenerBlacklistInput] = useState('');

  useEffect(() => {
    if (!open || screenerLoaded) return;
    getMaCrossScreenerConfig()
      .then((cfg) => { setScreenerConfig(cfg); setScreenerLoaded(true); })
      .catch((err) => { setScreenerLoadError(err.message); setScreenerLoaded(true); });
  }, [open, screenerLoaded]);

  function patchScreenerConfig(patch) {
    setScreenerConfig((prev) => ({ ...prev, ...patch }));
  }

  async function persistScreenerConfig(next) {
    setScreenerSaveState('saving');
    try {
      const saved = await saveMaCrossScreenerConfig(next);
      setScreenerConfig(saved);
      setScreenerSaveState('saved');
      setTimeout(() => setScreenerSaveState((s) => (s === 'saved' ? null : s)), 2000);
    } catch {
      setScreenerSaveState('error');
    }
  }

  function addScreenerBlacklistSymbol() {
    const sym = screenerBlacklistInput.trim().toUpperCase();
    if (!sym || !screenerConfig || screenerConfig.blacklist.includes(sym)) { setScreenerBlacklistInput(''); return; }
    patchScreenerConfig({ blacklist: [...screenerConfig.blacklist, sym].sort() });
    setScreenerBlacklistInput('');
  }

  function removeScreenerBlacklistSymbol(sym) {
    patchScreenerConfig({ blacklist: screenerConfig.blacklist.filter((s) => s !== sym) });
  }

  const [bbMedianConfig, setBbMedianConfig]         = useState(null); // { minAvgDiffPct }
  const [bbMedianLoaded, setBbMedianLoaded]         = useState(false);
  const [bbMedianLoadError, setBbMedianLoadError]   = useState('');
  const [bbMedianSaveState, setBbMedianSaveState]   = useState(null); // null | 'saving' | 'saved' | 'error'
  const [bbMedianInput, setBbMedianInput]           = useState('');

  useEffect(() => {
    if (!open || bbMedianLoaded) return;
    getBollingerMedianTrendConfig()
      .then((cfg) => { setBbMedianConfig(cfg); setBbMedianInput(String(cfg.minAvgDiffPct)); setBbMedianLoaded(true); })
      .catch((err) => { setBbMedianLoadError(err.message); setBbMedianLoaded(true); });
  }, [open, bbMedianLoaded]);

  async function saveBbMedianConfig() {
    const n = Number(bbMedianInput);
    if (!Number.isFinite(n) || n < 0) { setBbMedianInput(String(bbMedianConfig.minAvgDiffPct)); return; }
    setBbMedianSaveState('saving');
    try {
      const saved = await saveBollingerMedianTrendConfig({ minAvgDiffPct: n });
      setBbMedianConfig(saved);
      setBbMedianInput(String(saved.minAvgDiffPct));
      setBbMedianSaveState('saved');
      setTimeout(() => setBbMedianSaveState((s) => (s === 'saved' ? null : s)), 2000);
    } catch {
      setBbMedianSaveState('error');
    }
  }

  const [cacheSettingsState, setCacheSettingsState] = useState(null); // { ids, enabled }
  const [cacheSettingsLoaded, setCacheSettingsLoaded] = useState(false);
  const [cacheSettingsLoadError, setCacheSettingsLoadError] = useState('');
  const [cacheToggleSaving, setCacheToggleSaving] = useState(null);

  useEffect(() => {
    if (!open || cacheSettingsLoaded) return;
    getCacheSettings()
      .then((cfg) => { setCacheSettingsState(cfg); setCacheSettingsLoaded(true); })
      .catch((err) => { setCacheSettingsLoadError(err.message); setCacheSettingsLoaded(true); });
  }, [open, cacheSettingsLoaded]);

  async function toggleCache(id, value) {
    const prevEnabled = cacheSettingsState.enabled;
    const nextEnabled = { ...prevEnabled, [id]: value };
    setCacheSettingsState((prev) => ({ ...prev, enabled: nextEnabled }));
    setCacheToggleSaving(id);
    try {
      const saved = await saveCacheSettings(nextEnabled);
      setCacheSettingsState(saved);
    } catch {
      setCacheSettingsState((prev) => ({ ...prev, enabled: prevEnabled }));
    } finally {
      setCacheToggleSaving(null);
    }
  }

  const [minValueInput, setMinValueInput] = useState(String(activeTradesSettings.minHoldingUsdt));
  useEffect(() => {
    setMinValueInput(String(activeTradesSettings.minHoldingUsdt));
  }, [activeTradesSettings.minHoldingUsdt]);

  function commitMinValue() {
    const n = Number(minValueInput);
    if (Number.isFinite(n) && n >= 0) updateActiveTradesSettings({ minHoldingUsdt: n });
    else setMinValueInput(String(activeTradesSettings.minHoldingUsdt));
  }

  const activeTradeSymbols = [...activeTrades.keys()].sort();

  useEffect(() => {
    if (open && selectedChart?.symbol) {
      setReloadSymbol(selectedChart.symbol);
    }
  }, [open, selectedChart]);

  async function handleReload() {
    if (!reloadSymbol.trim()) return;
    setReloadState('loading');
    setReloadError('');
    try {
      const data = await reloadCandles(reloadSymbol.trim().toUpperCase(), reloadInterval);
      setReloadState(data);
    } catch (err) {
      setReloadError(err.message);
      setReloadState('error');
    }
  }

  const inp = 'bg-p2 border border-p3/40 text-p5 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-p4';

  return (
    <>
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-200 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div className={`fixed top-0 right-0 h-full w-80 z-50 flex flex-col bg-p1 border-l border-p2 transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-p2 shrink-0">
          <span className="text-p5 text-xs font-semibold uppercase tracking-widest">{t('settings.title')}</span>
          <button onClick={onClose} className="text-p5 hover:text-white p-1 rounded hover:bg-p2 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-1 flex flex-col">

          {/* Exibição de ativos */}
          <AccordionItem id="assets" title={t('settings.asset_display')} hint={t('settings.asset_display_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-col gap-2">
              {assetCategoryKeys.map((key) => (
                <label
                  key={key}
                  className="flex items-start gap-2.5 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={assetDisplay[key] === true}
                    onChange={(e) => setAssetDisplayCategory(key, e.target.checked)}
                    className="mt-0.5 shrink-0 accent-p4"
                  />
                  <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                    {t(`settings.category.${key}`)}
                  </span>
                </label>
              ))}
            </div>
          </AccordionItem>

          {/* Saldos Ativos (saldos reais nas exchanges) */}
          <AccordionItem id="activeTrades" title={t('settings.active_trades')} hint={t('settings.active_trades_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>

            <label className="flex items-start gap-2.5 cursor-pointer group mb-3">
              <input
                type="checkbox"
                checked={activeTradesSettings.showCash}
                onChange={(e) => updateActiveTradesSettings({ showCash: e.target.checked })}
                className="mt-0.5 shrink-0 accent-p4"
              />
              <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                {t('settings.active_trades_show_cash')}
              </span>
            </label>

            <div className="flex items-center gap-2 mb-3">
              <span className="text-p5 text-xs shrink-0">{t('settings.active_trades_min_value')}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={minValueInput}
                onChange={(e) => setMinValueInput(e.target.value)}
                onBlur={commitMinValue}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className={`w-20 ${inp}`}
              />
            </div>

            {activeTradeSymbols.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-p5/40 mb-1.5">{t('settings.active_trades_current')}</p>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {activeTradeSymbols.map((symbol) => (
                    <div key={symbol} className="flex items-center justify-between text-xs text-p5/80">
                      <span className="font-mono">{symbol}</span>
                      <button
                        type="button"
                        onClick={() => dismissActiveTrade(symbol)}
                        className="text-[10px] text-p5/50 hover:text-red-400 transition-colors"
                      >
                        {t('settings.active_trades_ignore_btn')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ignoredActiveTrades.length > 0 && (
              <div>
                <p className="text-[10px] text-p5/40 mb-1.5">{t('settings.active_trades_ignored')}</p>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {ignoredActiveTrades.map((asset) => (
                    <div key={asset} className="flex items-center justify-between text-xs text-p5/80">
                      <span className="font-mono">{asset}</span>
                      <button
                        type="button"
                        onClick={() => restoreActiveTrade(asset)}
                        className="text-[10px] text-p5/50 hover:text-emerald-400 transition-colors"
                      >
                        {t('settings.active_trades_restore')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AccordionItem>

          {/* Intervalo padrão do gráfico */}
          <AccordionItem id="defaultInterval" title={t('settings.chart_default_interval')} hint={t('settings.chart_default_interval_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <select
              className={`w-full ${inp}`}
              value={uiPrefs.defaultChartInterval}
              onChange={(e) => setDefaultChartInterval(e.target.value)}
            >
              {chartIntervalOptions.map((iv) => (
                <option key={iv} value={iv}>{iv}</option>
              ))}
            </select>
          </AccordionItem>

          {/* Intervalos rápidos do gráfico */}
          <AccordionItem id="quickIntervals" title={t('settings.chart_quick_intervals')} hint={t('settings.chart_quick_intervals_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-wrap gap-1.5">
              {chartIntervalOptions.map((iv) => {
                const active = (uiPrefs.commonChartIntervals ?? []).includes(iv);
                return (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => toggleCommonChartInterval(iv)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                      active
                        ? 'border-p4 bg-p4/20 text-p5 font-semibold'
                        : 'border-p2/40 text-p5/60 hover:border-p3 hover:bg-p2/30'
                    }`}
                  >
                    {iv}
                  </button>
                );
              })}
            </div>
          </AccordionItem>

          {/* VWAP padrão (ancorada em calendário vs rolante/contínua) */}
          <AccordionItem id="vwapAnchor" title={t('settings.vwap_anchor')} hint={t('settings.vwap_anchor_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex gap-2">
              {[
                { value: 'session', label: t('settings.vwap_anchor_session') },
                { value: 'rolling', label: t('settings.vwap_anchor_rolling') },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setVwapAnchorDefault(value)}
                  className={`flex-1 py-1.5 rounded text-xs border transition-all ${
                    uiPrefs.vwapAnchorDefault === value
                      ? 'border-p4 bg-p4/20 text-p5 font-semibold'
                      : 'border-p2/40 text-p5/60 hover:border-p3 hover:bg-p2/30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </AccordionItem>

          {/* Destaque visual (rosa) dos trechos com a VWAP em queda acentuada */}
          <AccordionItem id="vwapSlope" title={t('settings.vwap_slope_highlight')} hint={t('settings.vwap_slope_highlight_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <label className="flex items-center gap-2.5 cursor-pointer group mb-3">
              <input
                type="checkbox"
                checked={uiPrefs.vwapSlopeHighlightDefault?.enabled === true}
                onChange={(e) => setVwapSlopeHighlightDefault({ enabled: e.target.checked })}
                className="shrink-0 accent-p4"
              />
              <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                {t('settings.vwap_slope_highlight_on')}
              </span>
            </label>
            {uiPrefs.vwapSlopeHighlightDefault?.enabled === true && (
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-p5/50">{t('settings.vwap_slope_highlight_lookback')}</span>
                  <select
                    className={inp}
                    value={uiPrefs.vwapSlopeHighlightDefault?.lookback ?? 6}
                    onChange={(e) => setVwapSlopeHighlightDefault({ lookback: Number(e.target.value) })}
                  >
                    {VWAP_SLOPE_HIGHLIGHT_LOOKBACKS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-p5/50">{t('settings.vwap_slope_highlight_min_slope')}</span>
                  <input
                    type="number"
                    step="0.5"
                    min="-20"
                    max="5"
                    className={`w-20 ${inp}`}
                    value={uiPrefs.vwapSlopeHighlightDefault?.minSlopePct ?? -3}
                    onChange={(e) => setVwapSlopeHighlightDefault({ minSlopePct: Number(e.target.value) })}
                  />
                </div>
              </div>
            )}
          </AccordionItem>

          {/* Motor de renderização do gráfico principal */}
          <AccordionItem id="chartEngine" title={t('settings.chart_engine')} hint={t('settings.chart_engine_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex gap-2">
              {[
                { value: 'lw', label: t('settings.chart_engine_lw') },
                { value: 'echarts', label: t('settings.chart_engine_echarts') },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChartEngineDefault(value)}
                  className={`flex-1 py-1.5 rounded text-xs border transition-all ${
                    (uiPrefs.chartEngineDefault ?? 'lw') === value
                      ? 'border-p4 bg-p4/20 text-p5 font-semibold'
                      : 'border-p2/40 text-p5/60 hover:border-p3 hover:bg-p2/30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </AccordionItem>

          {/* Painéis inferiores */}
          <AccordionItem id="panels" title={t('settings.visible_panels')} hint={t('settings.visible_panels_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-col gap-2">
              {panelKeys.map((key) => (
                <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={uiPrefs.visiblePanels[key] !== false}
                    onChange={(e) => setPanelVisible(key, e.target.checked)}
                    className="mt-0.5 shrink-0 accent-p4"
                  />
                  <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                    {t(`settings.panel.${key}`)}
                  </span>
                </label>
              ))}
            </div>
          </AccordionItem>

          {/* Botões de favoritos visíveis (toolbar + linhas da tabela) */}
          <AccordionItem id="favButtons" title={t('settings.favorite_buttons')} hint={t('settings.favorite_buttons_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-col gap-2">
              {favoriteButtonKeys.map((key) => (
                <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={uiPrefs.visibleFavoriteButtons[key] !== false}
                    onChange={(e) => setFavoriteButtonVisible(key, e.target.checked)}
                    className="mt-0.5 shrink-0 accent-p4"
                  />
                  <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                    {t(`settings.favbtn.${key}`)}
                  </span>
                </label>
              ))}
            </div>
          </AccordionItem>

          {/* Estatísticas — padrões */}
          <AccordionItem id="statsDefaults" title={t('settings.stats_defaults')} hint={t('settings.stats_defaults_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>

            <div className="flex flex-col gap-3">
              {/* RSI */}
              <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">{t('stats.tab.rsi')}</p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_interval')}</span>
                    <select
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.rsi.interval}
                      onChange={(e) => setStatsDefaults('rsi', { interval: e.target.value })}
                    >
                      {chartIntervalOptions.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_oversold')}</span>
                    <input
                      type="number" min={1} max={99}
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.rsi.oversold}
                      onChange={(e) => setStatsDefaults('rsi', { oversold: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_overbought')}</span>
                    <input
                      type="number" min={1} max={99}
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.rsi.overbought}
                      onChange={(e) => setStatsDefaults('rsi', { overbought: e.target.value })}
                    />
                  </label>
                </div>
              </div>

              {/* Cruzamento de EMAs */}
              <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">{t('stats.tab.ma_cross')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_entry_interval')}</span>
                    <select
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.maCross.entryInterval}
                      onChange={(e) => setStatsDefaults('maCross', { entryInterval: e.target.value })}
                    >
                      {chartIntervalOptions.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_exit_interval')}</span>
                    <select
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.maCross.exitInterval}
                      onChange={(e) => setStatsDefaults('maCross', { exitInterval: e.target.value })}
                    >
                      {chartIntervalOptions.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              {/* Bandas de Bollinger */}
              <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">{t('stats.tab.bollinger_bands')}</p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_interval')}</span>
                    <select
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.bollingerBands.interval}
                      onChange={(e) => setStatsDefaults('bollingerBands', { interval: e.target.value })}
                    >
                      {chartIntervalOptions.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_period')}</span>
                    <input
                      type="number" min={2} max={200}
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.bollingerBands.period}
                      onChange={(e) => setStatsDefaults('bollingerBands', { period: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] text-p5/40">{t('settings.stats_stddev')}</span>
                    <input
                      type="number" min={1} max={5}
                      className={`${inp} w-full`}
                      value={uiPrefs.statsDefaults.bollingerBands.stdDev}
                      onChange={(e) => setStatsDefaults('bollingerBands', { stdDev: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </AccordionItem>

          {/* Largura da coluna de moedas/filtros */}
          <AccordionItem id="panelWidth" title={t('settings.currency_panel_width')} hint={t('settings.currency_panel_width_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={CURRENCY_PANEL_WIDTH_MIN}
                max={CURRENCY_PANEL_WIDTH_MAX}
                step={8}
                value={uiPrefs.currencyPanelWidth}
                onChange={(e) => setCurrencyPanelWidth(Number(e.target.value))}
                className="flex-1 accent-p4"
              />
              <span className="text-p5 text-xs font-mono w-12 text-right shrink-0">{uiPrefs.currencyPanelWidth}px</span>
            </div>
            <button
              type="button"
              onClick={() => setCurrencyPanelWidth(CURRENCY_PANEL_WIDTH_DEFAULT)}
              className="mt-2 text-[10px] text-p5/60 hover:text-white underline transition-colors"
            >
              {t('settings.currency_panel_width_reset')}
            </button>
          </AccordionItem>

          {/* Botões do gráfico */}
          <AccordionItem id="chartButtons" title={t('settings.chart_panel')} hint={t('settings.chart_panel_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-col gap-2">
              {chartPanelButtonKeys.map((key) => {
                const hintKey = `settings.chart_btn_hint.${key}`;
                const hint = t(hintKey);
                const showHint = hint !== hintKey;
                return (
                  <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={chartPanelButtons[key] !== false}
                      onChange={(e) => setChartPanelButton(key, e.target.checked)}
                      className="mt-0.5 shrink-0 accent-p4"
                    />
                    <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                      {t(`settings.chart_btn.${key}`)}
                      {showHint && (
                        <span className="block text-[10px] text-p5/40 mt-0.5 font-normal">{hint}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </AccordionItem>

          {/* Overlay MA — padrão */}
          <AccordionItem id="overlaySlots" title={t('settings.overlay_slots')} hint={t('settings.overlay_slots_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="overflow-x-auto">
              <table className="text-[10px] w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-normal text-p5/40 pb-1.5 w-7" />
                    {OVERLAY_SETTING_INTERVALS.map(iv => (
                      <th key={iv} className="text-center font-mono font-normal text-p5/40 pb-1.5">{iv}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {OVERLAY_SETTING_PERIODS.map(period => {
                    const color = PERIOD_DEFAULT_COLORS[period] ?? '#94a3b8';
                    return (
                      <tr key={period} className="border-t border-p2/20">
                        <td className="py-1.5 pr-1">
                          <span className="font-mono font-semibold text-xs" style={{ color }}>{period}</span>
                        </td>
                        {OVERLAY_SETTING_INTERVALS.map(iv => {
                          const active = isOverlayActive(period, iv);
                          const atMax = !active && uiPrefs.overlaySlots.length >= MAX_OVERLAY_SLOTS;
                          return (
                            <td key={iv} className="text-center py-1.5">
                              <input
                                type="checkbox"
                                checked={active}
                                disabled={atMax}
                                onChange={() => toggleOverlaySlot(period, iv)}
                                className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                                style={{ accentColor: color }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {uiPrefs.overlaySlots.length >= MAX_OVERLAY_SLOTS && (
              <p className="text-[10px] text-amber-400/70 mt-2">{t('settings.overlay_slots_max', MAX_OVERLAY_SLOTS)}</p>
            )}
          </AccordionItem>

          {/* Screener automático MA-Cross (exaustão BB+VWAP 4h) */}
          <AccordionItem id="screener" title={t('settings.screener_title')} hint={t('settings.screener_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>

            {!screenerLoaded && !screenerLoadError && (
              <p className="text-[10px] text-p5/40">{t('settings.loading')}</p>
            )}
            {screenerLoadError && (
              <p className="text-[10px] text-red-400">{t('settings.screener_load_error')}: {screenerLoadError}</p>
            )}

            {screenerConfig && (
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={screenerConfig.enabled}
                    onChange={(e) => patchScreenerConfig({ enabled: e.target.checked })}
                    className="mt-0.5 shrink-0 accent-p4"
                  />
                  <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                    {t('settings.screener_enabled')}
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-p5/50">{t('settings.screener_min_volume')}</span>
                  <select
                    className={inp}
                    value={String(screenerConfig.minVolume24h)}
                    onChange={(e) => patchScreenerConfig({ minVolume24h: Number(e.target.value) })}
                  >
                    {[1_000_000, 3_000_000, 5_000_000, 10_000_000].map((v) => (
                      <option key={v} value={v}>{v / 1_000_000}M</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-p5/50">{t('settings.screener_max_new')}</span>
                    <input
                      type="number" min={1} max={50}
                      className={inp}
                      value={screenerConfig.maxNewPerCycle}
                      onChange={(e) => patchScreenerConfig({ maxNewPerCycle: Number(e.target.value) })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-p5/50">{t('settings.screener_capital')}</span>
                    <input
                      type="number" min={0} step={5}
                      className={inp}
                      value={screenerConfig.capitalPerSymbol}
                      onChange={(e) => patchScreenerConfig({ capitalPerSymbol: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <div>
                  <p className="text-[10px] text-p5/50 mb-1.5">{t('settings.screener_blacklist')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.screener_blacklist_hint')}</p>
                  <div className="flex gap-2 mb-2">
                    <input
                      className={`flex-1 ${inp} placeholder-p5/30`}
                      placeholder={t('settings.screener_blacklist_ph')}
                      value={screenerBlacklistInput}
                      onChange={(e) => setScreenerBlacklistInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && addScreenerBlacklistSymbol()}
                    />
                    <button
                      type="button"
                      onClick={addScreenerBlacklistSymbol}
                      className="px-3 py-1.5 rounded text-xs text-white bg-p3 hover:bg-p4 transition-colors"
                    >
                      {t('settings.screener_blacklist_add')}
                    </button>
                  </div>
                  {screenerConfig.blacklist.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {screenerConfig.blacklist.map((sym) => (
                        <span
                          key={sym}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-p2/40 text-p5/70"
                        >
                          {sym}
                          <button
                            type="button"
                            onClick={() => removeScreenerBlacklistSymbol(sym)}
                            className="text-p5/40 hover:text-red-400 transition-colors"
                            title={t('settings.screener_remove')}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-p5/30">{t('settings.screener_blacklist_empty')}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => persistScreenerConfig(screenerConfig)}
                    disabled={screenerSaveState === 'saving'}
                    className="px-3 py-1.5 rounded text-xs text-white bg-p3 hover:bg-p4 transition-colors disabled:opacity-50"
                  >
                    {screenerSaveState === 'saving' ? t('settings.screener_saving') : t('settings.screener_save')}
                  </button>
                  {screenerSaveState === 'saved' && (
                    <span className="text-[10px] text-emerald-400">{t('settings.screener_saved')}</span>
                  )}
                  {screenerSaveState === 'error' && (
                    <span className="text-[10px] text-red-400">{t('settings.screener_save_error')}</span>
                  )}
                </div>
              </div>
            )}
          </AccordionItem>

          {/* Filtro de tendência da mediana da Bollinger — limiar padrão global */}
          <AccordionItem id="bbMedian" title={t('settings.bbmedian_title')} hint={t('settings.bbmedian_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>

            {!bbMedianLoaded && !bbMedianLoadError && (
              <p className="text-[10px] text-p5/40">{t('settings.loading')}</p>
            )}
            {bbMedianLoadError && (
              <p className="text-[10px] text-red-400">{t('settings.bbmedian_load_error')}: {bbMedianLoadError}</p>
            )}

            {bbMedianConfig && (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-p5/50">{t('settings.bbmedian_min_avg_diff')}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className={`w-24 ${inp}`}
                    value={bbMedianInput}
                    onChange={(e) => setBbMedianInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveBbMedianConfig()}
                  />
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={saveBbMedianConfig}
                    disabled={bbMedianSaveState === 'saving'}
                    className="px-3 py-1.5 rounded text-xs text-white bg-p3 hover:bg-p4 transition-colors disabled:opacity-50"
                  >
                    {bbMedianSaveState === 'saving' ? t('settings.bbmedian_saving') : t('settings.bbmedian_save')}
                  </button>
                  {bbMedianSaveState === 'saved' && (
                    <span className="text-[10px] text-emerald-400">{t('settings.bbmedian_saved')}</span>
                  )}
                  {bbMedianSaveState === 'error' && (
                    <span className="text-[10px] text-red-400">{t('settings.bbmedian_save_error')}</span>
                  )}
                </div>
              </div>
            )}
          </AccordionItem>

          {/* Caches de filtros/estatísticas (liga/desliga por cache) */}
          <AccordionItem id="caches" title={t('settings.cache_title')} hint={t('settings.cache_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>

            {!cacheSettingsLoaded && !cacheSettingsLoadError && (
              <p className="text-[10px] text-p5/40">{t('settings.loading')}</p>
            )}
            {cacheSettingsLoadError && (
              <p className="text-[10px] text-red-400">{t('settings.screener_load_error')}: {cacheSettingsLoadError}</p>
            )}

            {cacheSettingsState && (
              <div className="flex flex-col gap-2">
                {(cacheSettingsState.ids ?? []).map((id) => {
                  const isOn = cacheSettingsState.enabled?.[id] !== false;
                  const saving = cacheToggleSaving === id;
                  const metaLabel = formatCacheMeta(cacheSettingsState.meta?.[id]);
                  return (
                    <label key={id} className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isOn}
                        disabled={saving}
                        onChange={(e) => toggleCache(id, e.target.checked)}
                        className="mt-0.5 shrink-0 accent-p4 disabled:opacity-50"
                      />
                      <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                        {t(`settings.cache.${id}`)}
                        {metaLabel && (
                          <span className="block text-[10px] text-p5/40 mt-0.5 font-mono font-normal">{metaLabel}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </AccordionItem>

          {/* Idioma */}
          <AccordionItem id="language" title={t('settings.language')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex gap-2">
              {[{ code: 'pt', label: '🇧🇷 Português' }, { code: 'en', label: '🇺🇸 English' }].map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`flex-1 py-1.5 rounded text-xs border transition-all ${
                    lang === code
                      ? 'border-p4 bg-p4/20 text-p5 font-semibold'
                      : 'border-p2/40 text-p5/60 hover:border-p3 hover:bg-p2/30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </AccordionItem>

          {/* Recarregar candles */}
          <AccordionItem id="reload" title={t('settings.reload')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  className={`flex-1 ${inp} placeholder-p5/30`}
                  placeholder={t('settings.symbol_ph')}
                  value={reloadSymbol}
                  onChange={(e) => { setReloadSymbol(e.target.value.toUpperCase()); setReloadState(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleReload()}
                />
                <select className={inp} value={reloadInterval} onChange={(e) => setReloadInterval(e.target.value)}>
                  {RELOAD_INTERVALS.map((iv) => (
                    <option key={iv} value={iv}>{iv === 'all' ? t('settings.all') : iv}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleReload}
                disabled={reloadState === 'loading' || !reloadSymbol.trim()}
                className="flex items-center justify-center gap-2 w-full py-1.5 rounded text-xs text-white bg-p3 hover:bg-p4 transition-colors disabled:opacity-50"
              >
                {reloadState === 'loading'
                  ? <><div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />{t('settings.loading')}</>
                  : <><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>{t('settings.reload_btn')}</>
                }
              </button>
              {reloadState && reloadState !== 'loading' && reloadState !== 'error' && (
                <div className="flex flex-col gap-1 mt-1">
                  {reloadState.results.map((r) => (
                    <div key={r.interval} className="flex items-center justify-between text-[10px]">
                      <span className="text-p5/60 font-mono">{r.interval}</span>
                      {r.status === 'ok'
                        ? <span className="text-green-400">{r.candles} candles ✓</span>
                        : <span className="text-red-400">{t('settings.error')}</span>
                      }
                    </div>
                  ))}
                </div>
              )}
              {reloadState === 'error' && <p className="text-[10px] text-red-400">{reloadError}</p>}
            </div>
          </AccordionItem>

          {/* Paleta de cores */}
          <AccordionItem id="palette" title={t('settings.palette')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-col gap-2">
              {PALETTES.map((palette) => {
                const isActive = activeId === palette.id;
                return (
                  <button key={palette.id} onClick={() => { setActiveId(palette.id); applyPalette(palette.colors); }}
                    className={`flex flex-col gap-2 p-3 rounded border text-left transition-all ${isActive ? 'border-p4 bg-p2/60' : 'border-p2/40 hover:border-p3 hover:bg-p2/30'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-p5 text-xs font-medium">{palette.name}</span>
                      {isActive && <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5 text-p4"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                    </div>
                    <div className="flex gap-1.5">
                      {Object.values(palette.colors).map((color, i) => (
                        <div key={i} className="flex-1 h-5 rounded-sm border border-white/10" style={{ backgroundColor: color }} title={color} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </AccordionItem>

        </div>
      </div>
    </>
  );
}
