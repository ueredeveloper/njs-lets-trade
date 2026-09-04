import { useState, useEffect } from 'react';
import { reloadCandles, getMaCrossScreenerConfig, saveMaCrossScreenerConfig,
  getBollingerMedianTrendConfig, saveBollingerMedianTrendConfig,
  getRsiMomentumConfig, saveRsiMomentumConfig,
  getCacheSettings, saveCacheSettings } from '../services/api';
import { RSI_MOMENTUM_ALL_INTERVALS, RSI_MOMENTUM_BB_PERIODS, RSI_MOMENTUM_BB_STD_DEVS, RSI_MOMENTUM_TRAILING_TARGET_STEP_OPTIONS, RSI_MOMENTUM_BANDWIDTH_LOOKBACK_OPTIONS,
  RSI_MOMENTUM_TARGET_MODE_OPTIONS, RSI_MOMENTUM_STOP_MODE_OPTIONS, RSI_MOMENTUM_TARGET_PCT_OPTIONS, RSI_MOMENTUM_COIN_STEP_OPTIONS, RSI_MOMENTUM_STOP_STEP_OPTIONS, RSI_MOMENTUM_STOP_PCT_OPTIONS,
  RSI_MOMENTUM_PIVOT_PCT_OPTIONS, RSI_MOMENTUM_PIVOT_GAIN_OPTIONS, RSI_MOMENTUM_WIDTH_PCT_OPTIONS, RSI_MOMENTUM_ATR_MULT_OPTIONS, RSI_MOMENTUM_HARD_TP_OPTIONS,
  RSI_MOMENTUM_SR_INTERVAL_OPTIONS, RSI_MOMENTUM_SR_CANDLE_COUNT_OPTIONS, RSI_MOMENTUM_SR_RANK_OPTIONS, RSI_MOMENTUM_SR_ENTRY_MAX_PCT_OPTIONS,
  RSI_MOMENTUM_REINFORCE_DROP_OPTIONS, RSI_MOMENTUM_REINFORCE_RISE_OPTIONS, RSI_MOMENTUM_REINFORCE_USD_OPTIONS,
  RSI_MOMENTUM_REINFORCE_MODE_OPTIONS, RSI_MOMENTUM_REINFORCE_REARM_STOP_OPTIONS, RSI_MOMENTUM_REINFORCE_REARM_TARGET_OPTIONS,
  RSI_MOMENTUM_EARLY_CONFIRM_RSI_OPTIONS, RSI_MOMENTUM_MIN_VOLUME_OPTIONS,
  RSI_MOMENTUM_CAPITAL_USD_OPTIONS }
  from '../constants/rsiMomentumConfigSchema';
import { useLanguage } from '../contexts/LanguageContext';
import { useI18n } from '../i18n';
import { useCurrency } from '../contexts/CurrencyContext';
import { PERIOD_DEFAULT_COLORS, MAX_OVERLAY_SLOTS,
  CURRENCY_PANEL_WIDTH_MIN, CURRENCY_PANEL_WIDTH_MAX, CURRENCY_PANEL_WIDTH_DEFAULT,
  VWAP_SLOPE_HIGHLIGHT_LOOKBACKS, CANDLE_COUNT_DISPLAY_OPTIONS, VALID_ACTIVE_INDICATORS,
  FONT_SCALE_DEFAULT, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP } from '../utils/uiPreferences';

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

const RELOAD_INTERVALS = ['all', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

/** Monta um subtítulo legível (intervalo · período/desvio · candles) a partir do meta de
 *  preset devolvido por /services/cache-settings — só os caches com preset granular por id
 *  (ver PRESET_MODULES em backend/services/fetchCacheSettings.js) têm esse detalhe; os demais
 *  ficam só com o rótulo, sem quebrar nada. */
function formatCacheMeta(meta) {
  if (!meta) return null;
  const parts = [];
  if (meta.interval) parts.push(meta.interval);
  if (meta.period != null && meta.stdDev != null) parts.push(`BB(${meta.period},${meta.stdDev})`);
  if (meta.lookbacks?.length) parts.push(`${meta.lookbacks.join('/')} candles`);
  return parts.length ? parts.join(' · ') : null;
}

/** Linha "− [valor%] +" pra uma escala de fonte. `value` é multiplicador (1 = 100%). */
function FontStepper({ label, hint, value, onChange, disabled }) {
  const v = Number(value) || 1;
  const pct = Math.round(v * 100);
  const set = (next) => onChange(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(next * 100) / 100)));
  const btn = 'flex items-center justify-center w-6 h-6 rounded border border-p3/40 text-p5/70 hover:text-p4 hover:border-p4 disabled:opacity-30 disabled:cursor-default transition-colors';
  return (
    <div className={`flex items-center justify-between gap-2 py-1.5 ${disabled ? 'opacity-40' : ''}`}>
      <div className="min-w-0">
        <div className="text-[11px] text-p5/80">{label}</div>
        {hint && <div className="text-[9px] text-p5/40 leading-tight">{hint}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" className={btn} disabled={disabled || v <= FONT_SCALE_MIN + 1e-9}
          onClick={() => set(v - FONT_SCALE_STEP)} aria-label="menor">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3"><path strokeLinecap="round" d="M5 12h14" /></svg>
        </button>
        <span className={`text-[11px] tabular-nums w-10 text-center ${pct === 100 ? 'text-p5/50' : 'text-p4 font-semibold'}`}>{pct}%</span>
        <button type="button" className={btn} disabled={disabled || v >= FONT_SCALE_MAX - 1e-9}
          onClick={() => set(v + FONT_SCALE_STEP)} aria-label="maior">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    </div>
  );
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
    setCandleCountDisplayDefault, setDefaultActiveIndicator, setFontScale,
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
    if (!Number.isFinite(n)) { setBbMedianInput(String(bbMedianConfig.minAvgDiffPct)); return; }
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

  const [rsiMomentumConfig, setRsiMomentumConfig]         = useState(null);
  const [rsiMomentumLoaded, setRsiMomentumLoaded]         = useState(false);
  const [rsiMomentumLoadError, setRsiMomentumLoadError]   = useState('');
  const [rsiMomentumSaveState, setRsiMomentumSaveState]   = useState(null); // null | 'saving' | 'saved' | 'error'

  useEffect(() => {
    if (!open || rsiMomentumLoaded) return;
    getRsiMomentumConfig()
      .then((cfg) => { setRsiMomentumConfig(cfg); setRsiMomentumLoaded(true); })
      .catch((err) => { setRsiMomentumLoadError(err.message); setRsiMomentumLoaded(true); });
  }, [open, rsiMomentumLoaded]);

  function patchRsiMomentum(section, patch) {
    setRsiMomentumConfig((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));
  }

  function patchRsiMomentumNested(section, sub, patch) {
    setRsiMomentumConfig((prev) => ({
      ...prev,
      [section]: { ...prev[section], [sub]: { ...prev[section][sub], ...patch } },
    }));
  }

  async function persistRsiMomentumConfig() {
    setRsiMomentumSaveState('saving');
    try {
      const saved = await saveRsiMomentumConfig(rsiMomentumConfig);
      setRsiMomentumConfig(saved);
      setRsiMomentumSaveState('saved');
      setTimeout(() => setRsiMomentumSaveState((s) => (s === 'saved' ? null : s)), 2000);
    } catch {
      setRsiMomentumSaveState('error');
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

          {/* Quantidade de candles padrão ao abrir o gráfico */}
          <AccordionItem id="defaultCandleCount" title={t('settings.chart_default_candle_count')} hint={t('settings.chart_default_candle_count_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            <div className="flex flex-wrap gap-1.5">
              {CANDLE_COUNT_DISPLAY_OPTIONS.map((n) => {
                const active = (uiPrefs.candleCountDisplayDefault ?? 40) === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCandleCountDisplayDefault(n)}
                    className={`px-2.5 py-1 text-[10px] font-mono rounded border transition-colors ${
                      active
                        ? 'border-p4 bg-p4/20 text-p5 font-semibold'
                        : 'border-p2/40 text-p5/60 hover:border-p3 hover:bg-p2/30'
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
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

          {/* Tamanho da fonte */}
          <AccordionItem id="fontSize" title={t('settings.font_size')} hint={t('settings.font_size_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>
            {(() => {
              const fs = { ...FONT_SCALE_DEFAULT, ...(uiPrefs.fontScale ?? {}) };
              const isLw = (uiPrefs.chartEngineDefault ?? 'lw') !== 'echarts';
              return (
                <div className="flex flex-col divide-y divide-p2/20">
                  <FontStepper label={t('settings.font_site')} hint={t('settings.font_site_hint')}
                    value={fs.site} onChange={(v) => setFontScale({ site: v })} />
                  <FontStepper label={t('settings.font_chart')} hint={t('settings.font_chart_hint')}
                    value={fs.chart} onChange={(v) => setFontScale({ chart: v })} />
                  <div className="pt-2">
                    <div className="text-[9px] uppercase tracking-wider text-p5/40 mb-0.5">{t('settings.font_chart_fine')}</div>
                    {isLw && <div className="text-[9px] text-amber-500/80 mb-1 leading-tight">{t('settings.font_chart_fine_lw')}</div>}
                    <FontStepper label={t('settings.font_chart_price')} value={fs.chartPrice}
                      onChange={(v) => setFontScale({ chartPrice: v })} disabled={isLw} />
                    <FontStepper label={t('settings.font_chart_pct')} value={fs.chartPct}
                      onChange={(v) => setFontScale({ chartPct: v })} disabled={isLw} />
                    <FontStepper label={t('settings.font_chart_oco')} value={fs.chartOco}
                      onChange={(v) => setFontScale({ chartOco: v })} disabled={isLw} />
                  </div>
                  <button type="button" onClick={() => setFontScale(null)}
                    className="mt-2 text-[10px] text-p5/50 hover:text-p4 self-start transition-colors">
                    {t('settings.font_reset')}
                  </button>
                </div>
              );
            })()}
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
                const visible = chartPanelButtons[key] !== false;
                const canDefaultActive = VALID_ACTIVE_INDICATORS.includes(key);
                return (
                  <div key={key} className="flex items-start justify-between gap-2.5">
                    <label className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={visible}
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
                    {canDefaultActive && (
                      <label className={`flex items-center gap-1.5 shrink-0 cursor-pointer group ${!visible ? 'opacity-30 pointer-events-none' : ''}`}>
                        <span className="text-[10px] text-p5/50 group-hover:text-white transition-colors whitespace-nowrap">
                          {t('settings.chart_btn_default_active')}
                        </span>
                        <input
                          type="checkbox"
                          checked={!!uiPrefs.defaultActiveIndicators?.[key]}
                          disabled={!visible}
                          onChange={(e) => setDefaultActiveIndicator(key, e.target.checked)}
                          className="shrink-0 accent-p4"
                        />
                      </label>
                    )}
                  </div>
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

          {/* Regras globais do bot RSI Momentum (scanner + entrada + saída) */}
          <AccordionItem id="rsiMomentum" title={t('settings.rsimomentum_title')} hint={t('settings.rsimomentum_hint')}
            openSection={openSection} setOpenSection={setOpenSection}>

            {!rsiMomentumLoaded && !rsiMomentumLoadError && (
              <p className="text-[10px] text-p5/40">{t('settings.loading')}</p>
            )}
            {rsiMomentumLoadError && (
              <p className="text-[10px] text-red-400">{t('settings.rsimomentum_load_error')}: {rsiMomentumLoadError}</p>
            )}

            {rsiMomentumConfig && (
              <div className="flex flex-col gap-3">
                {/* Quanto investir por trade — grava em multitrade_favorites.capital / rsi_multi_bot_state.capital
                    no favorito automático; não afeta o reforço no stop (esse tem valor próprio). */}
                <div className="rounded-md p-2.5" style={{ background: '#0f1a14', border: '1px solid #2a4a3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_capital_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.rsimomentum_capital_hint')}</p>
                  <select
                    className={`${inp} w-1/2`}
                    value={rsiMomentumConfig.capitalUsdt ?? 20}
                    onChange={(e) => setRsiMomentumConfig((prev) => ({ ...prev, capitalUsdt: Number(e.target.value) }))}
                  >
                    {RSI_MOMENTUM_CAPITAL_USD_OPTIONS.map((v) => <option key={v} value={v}>${v}</option>)}
                  </select>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={rsiMomentumConfig.entry.enabled}
                    onChange={(e) => patchRsiMomentum('entry', { enabled: e.target.checked })}
                    className="mt-0.5 shrink-0 accent-p4"
                  />
                  <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                    {t('settings.rsimomentum_entry_enabled')}
                    <span className="block text-[10px] text-p5/40 mt-0.5 font-normal">{t('settings.rsimomentum_entry_enabled_hint')}</span>
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-p5/50">{t('settings.rsimomentum_interval')}</span>
                    <select
                      className={inp}
                      value={rsiMomentumConfig.entry.interval}
                      onChange={(e) => patchRsiMomentum('entry', { interval: e.target.value })}
                    >
                      {RSI_MOMENTUM_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-p5/50">{t('settings.rsimomentum_rsi_threshold')}</span>
                    <input
                      type="number" min={50} max={95}
                      className={inp}
                      value={rsiMomentumConfig.entry.rsiThreshold}
                      onChange={(e) => patchRsiMomentum('entry', { rsiThreshold: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_prior_rsi_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.rsimomentum_prior_rsi_hint')}</p>
                  <label className="flex items-start gap-2.5 cursor-pointer group mb-2">
                    <input
                      type="checkbox"
                      checked={rsiMomentumConfig.entry.priorRsiFilter.enabled}
                      onChange={(e) => patchRsiMomentumNested('entry', 'priorRsiFilter', { enabled: e.target.checked })}
                      className="mt-0.5 shrink-0 accent-p4"
                    />
                    <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                      {t('settings.rsimomentum_prior_rsi_enabled')}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1 w-1/2">
                    <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_prior_rsi_count')}</span>
                    <input
                      type="number" min={1} max={10}
                      className={`${inp} w-full`}
                      value={rsiMomentumConfig.entry.priorRsiFilter.count}
                      onChange={(e) => patchRsiMomentumNested('entry', 'priorRsiFilter', { count: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_pullback_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.rsimomentum_pullback_hint')}</p>
                  <label className="flex items-start gap-2.5 cursor-pointer group mb-2">
                    <input
                      type="checkbox"
                      checked={rsiMomentumConfig.entry.pullback.enabled}
                      onChange={(e) => patchRsiMomentumNested('entry', 'pullback', { enabled: e.target.checked })}
                      className="mt-0.5 shrink-0 accent-p4"
                    />
                    <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                      {t('settings.rsimomentum_pullback_enabled')}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_pullback_below_pct')}</span>
                      <input
                        type="number" min={0.1} max={20} step={0.1}
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.pullback.belowPct}
                        onChange={(e) => patchRsiMomentumNested('entry', 'pullback', { belowPct: Number(e.target.value) })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_limit_wait_candles')}</span>
                      <input
                        type="number" min={1} max={300}
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.limitWaitCandles}
                        onChange={(e) => patchRsiMomentum('entry', { limitWaitCandles: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                </div>

                {/* RSI de 5min — dois usos opostos, lado a lado pra não confundir:
                    Confirmação adiantada ANTECIPA o sinal; Filtro RSI 5min VETA sinais fracos. */}
                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_rsi5m_group_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2.5 leading-relaxed">{t('settings.rsimomentum_rsi5m_group_hint')}</p>

                  {/* Confirmação adiantada — ANTECIPA */}
                  <div className="rounded p-2 mb-2" style={{ background: '#0b0e14', border: '1px solid #23283a' }}>
                    <label className="flex items-start gap-2.5 cursor-pointer group mb-1.5">
                      <input
                        type="checkbox"
                        checked={rsiMomentumConfig.entry.earlyConfirm.enabled}
                        onChange={(e) => patchRsiMomentumNested('entry', 'earlyConfirm', { enabled: e.target.checked })}
                        className="mt-0.5 shrink-0 accent-p4"
                      />
                      <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                        <span className="text-emerald-400 font-semibold">⏩ {t('settings.rsimomentum_earlyconfirm_title')}</span> — {t('settings.rsimomentum_earlyconfirm_enabled')}
                      </span>
                    </label>
                    <p className="text-[9px] text-p5/40 mb-1.5 leading-relaxed">{t('settings.rsimomentum_earlyconfirm_hint')}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_earlyconfirm_interval')}</span>
                        <select
                          className={`${inp} w-full`}
                          value={rsiMomentumConfig.entry.earlyConfirm.interval}
                          onChange={(e) => patchRsiMomentumNested('entry', 'earlyConfirm', { interval: e.target.value })}
                        >
                          {RSI_MOMENTUM_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_earlyconfirm_rsi')}</span>
                        <select
                          className={`${inp} w-full`}
                          value={rsiMomentumConfig.entry.earlyConfirm.rsiThreshold ?? 70}
                          onChange={(e) => patchRsiMomentumNested('entry', 'earlyConfirm', { rsiThreshold: Number(e.target.value) })}
                        >
                          {RSI_MOMENTUM_EARLY_CONFIRM_RSI_OPTIONS.map((v) => <option key={v} value={v}>{`RSI > ${v}`}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>

                  {/* Filtro RSI 5min — VETA */}
                  <div className="rounded p-2" style={{ background: '#0b0e14', border: '1px solid #23283a' }}>
                    <label className="flex items-start gap-2.5 cursor-pointer group mb-1.5">
                      <input
                        type="checkbox"
                        checked={rsiMomentumConfig.entry.rsi5mFilter.enabled}
                        onChange={(e) => patchRsiMomentumNested('entry', 'rsi5mFilter', { enabled: e.target.checked })}
                        className="mt-0.5 shrink-0 accent-p4"
                      />
                      <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                        <span className="text-amber-400 font-semibold">⛔ {t('settings.rsimomentum_rsi5m_title')}</span> — {t('settings.rsimomentum_rsi5m_enabled')}
                      </span>
                    </label>
                    <p className="text-[9px] text-p5/40 mb-1.5 leading-relaxed">{t('settings.rsimomentum_rsi5m_hint')}</p>
                    <label className="flex flex-col gap-1 w-1/2">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_rsi5m_threshold')}</span>
                      <input
                        type="number" min={50} max={95}
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.rsi5mFilter.threshold}
                        onChange={(e) => patchRsiMomentumNested('entry', 'rsi5mFilter', { threshold: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-p5/50">{t('settings.rsimomentum_reentry_cooldown')}</span>
                  <input
                    type="number" min={0} max={100}
                    className={`w-24 ${inp}`}
                    value={rsiMomentumConfig.entry.reentryCooldownCandles}
                    onChange={(e) => patchRsiMomentum('entry', { reentryCooldownCandles: Number(e.target.value) })}
                  />
                  <span className="text-[10px] text-p5/40">{t('settings.rsimomentum_reentry_cooldown_hint')}</span>
                </label>

                {/* ALVO — independente do stop */}
                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">{t('settings.rsimomentum_target_title')}</p>
                  {(() => {
                    const targetMode = rsiMomentumConfig.exit.targetMode ?? 'fixed';
                    const tt = rsiMomentumConfig.exit.trailingTarget ?? { coinStepPct: 3, stepPct: 3 };
                    return (
                      <>
                        <label className="flex flex-col gap-1 mb-2">
                          <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_target_mode')}</span>
                          <select
                            className={`${inp} w-full`}
                            value={targetMode}
                            onChange={(e) => patchRsiMomentum('exit', { targetMode: e.target.value })}
                          >
                            {RSI_MOMENTUM_TARGET_MODE_OPTIONS.map((m) => (
                              <option key={m} value={m}>{t(`settings.rsimomentum_target_mode_${m}`)}</option>
                            ))}
                          </select>
                        </label>
                        {targetMode === 'off' && (
                          <p className="text-[9px] text-p5/40 leading-relaxed">{t('settings.rsimomentum_target_off_hint')}</p>
                        )}
                        {targetMode === 'fixed' && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_target_pct')}</span>
                            <select
                              className={`${inp} w-full`}
                              value={rsiMomentumConfig.exit.restingBracket.targetPct}
                              onChange={(e) => patchRsiMomentumNested('exit', 'restingBracket', { targetPct: Number(e.target.value) })}
                            >
                              {RSI_MOMENTUM_TARGET_PCT_OPTIONS.map((v) => <option key={v} value={v}>+{v}%</option>)}
                            </select>
                          </label>
                        )}
                        {targetMode === 'continuous' && (
                          <>
                            <div className="grid grid-cols-3 gap-2">
                              <label className="flex flex-col gap-1">
                                <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_target_base_pct')}</span>
                                <select
                                  className={`${inp} w-full`}
                                  value={rsiMomentumConfig.exit.restingBracket.targetPct}
                                  onChange={(e) => patchRsiMomentumNested('exit', 'restingBracket', { targetPct: Number(e.target.value) })}
                                >
                                  {RSI_MOMENTUM_TARGET_PCT_OPTIONS.map((v) => <option key={v} value={v}>+{v}%</option>)}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_target_step_pp')}</span>
                                <select
                                  className={`${inp} w-full`}
                                  value={tt.stepPct ?? 3}
                                  onChange={(e) => patchRsiMomentumNested('exit', 'trailingTarget', { stepPct: Number(e.target.value) })}
                                >
                                  {RSI_MOMENTUM_TRAILING_TARGET_STEP_OPTIONS.map((v) => <option key={v} value={v}>{v} pp</option>)}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_target_coin_step')}</span>
                                <select
                                  className={`${inp} w-full`}
                                  value={tt.coinStepPct ?? 3}
                                  onChange={(e) => patchRsiMomentumNested('exit', 'trailingTarget', { coinStepPct: Number(e.target.value) })}
                                >
                                  {RSI_MOMENTUM_COIN_STEP_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
                                </select>
                              </label>
                            </div>
                            <p className="text-[9px] text-p5/40 mt-1 leading-relaxed">{t('settings.rsimomentum_target_continuous_hint')}</p>
                          </>
                        )}

                        {/* Teto de lucro — venda forçada, independente do modo do alvo */}
                        {(() => {
                          const htp = rsiMomentumConfig.exit.hardTakeProfit ?? { enabled: true, pct: 15 };
                          return (
                            <div className="mt-2 pt-2 border-t border-p3/30">
                              <label className="flex items-start gap-2.5 cursor-pointer group mb-1">
                                <input
                                  type="checkbox"
                                  checked={htp.enabled}
                                  onChange={(e) => patchRsiMomentumNested('exit', 'hardTakeProfit', { enabled: e.target.checked })}
                                  className="mt-0.5 shrink-0 accent-p4"
                                />
                                <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                                  {t('settings.rsimomentum_hardtp_enabled')}
                                </span>
                              </label>
                              {htp.enabled && (
                                <label className="flex flex-col gap-1 w-1/2">
                                  <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_hardtp_pct')}</span>
                                  <select
                                    className={`${inp} w-full`}
                                    value={htp.pct}
                                    onChange={(e) => patchRsiMomentumNested('exit', 'hardTakeProfit', { pct: Number(e.target.value) })}
                                  >
                                    {RSI_MOMENTUM_HARD_TP_OPTIONS.map((v) => <option key={v} value={v}>+{v}%</option>)}
                                  </select>
                                </label>
                              )}
                              <p className="text-[9px] text-p5/40 mt-1 leading-relaxed">{t('settings.rsimomentum_hardtp_hint')}</p>
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()}
                </div>

                {/* STOP — independente do alvo */}
                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-2">{t('settings.rsimomentum_stop_title')}</p>
                  {(() => {
                    const ts = rsiMomentumConfig.exit.trailingStop;
                    const stopMode = !ts.enabled ? 'fixed' : (ts.mode ?? 'continuous');
                    const patchTs = (patch) => patchRsiMomentumNested('exit', 'trailingStop', patch);
                    const onModeChange = (v) => patchTs(v === 'fixed' ? { enabled: false } : { enabled: true, mode: v });
                    const Fld = ({ label, value, opts, onChange, fmt = (x) => x }) => (
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{label}</span>
                        <select className={`${inp} w-full`} value={value} onChange={(e) => onChange(Number(e.target.value))}>
                          {opts.map((v) => <option key={v} value={v}>{fmt(v)}</option>)}
                        </select>
                      </label>
                    );
                    return (
                      <>
                        <label className="flex flex-col gap-1 mb-2">
                          <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_stop_mode')}</span>
                          <select className={`${inp} w-full`} value={stopMode} onChange={(e) => onModeChange(e.target.value)}>
                            {RSI_MOMENTUM_STOP_MODE_OPTIONS.map((m) => (
                              <option key={m} value={m}>{t(`settings.rsimomentum_stop_mode_${m}`)}</option>
                            ))}
                          </select>
                        </label>

                        {stopMode === 'fixed' && (
                          <Fld label={t('settings.rsimomentum_stop_loss_pct')}
                            value={rsiMomentumConfig.stopLoss.maxLossPct}
                            opts={RSI_MOMENTUM_STOP_PCT_OPTIONS}
                            onChange={(v) => patchRsiMomentum('stopLoss', { maxLossPct: v })}
                            fmt={(v) => `-${v}%`} />
                        )}

                        {stopMode === 'continuous' && (
                          <>
                            <div className="grid grid-cols-3 gap-2">
                              <Fld label={t('settings.rsimomentum_trailingstop_start_pct')} value={ts.startPct} opts={RSI_MOMENTUM_STOP_PCT_OPTIONS} onChange={(v) => patchTs({ startPct: v })} fmt={(v) => `-${v}%`} />
                              <Fld label={t('settings.rsimomentum_trailingstop_stop_step')} value={ts.stopStepPct} opts={RSI_MOMENTUM_STOP_STEP_OPTIONS} onChange={(v) => patchTs({ stopStepPct: v })} fmt={(v) => `${v} pp`} />
                              <Fld label={t('settings.rsimomentum_trailingstop_coin_step')} value={ts.coinStepPct} opts={RSI_MOMENTUM_COIN_STEP_OPTIONS} onChange={(v) => patchTs({ coinStepPct: v })} fmt={(v) => `${v}%`} />
                            </div>
                            <p className="text-[9px] text-p5/40 mt-1 leading-relaxed">{t('settings.rsimomentum_trailingstop_hint')}</p>
                          </>
                        )}

                        {stopMode === 'twoPhase' && (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <Fld label={t('settings.rsimomentum_trailingstop_start_pct')} value={ts.startPct} opts={RSI_MOMENTUM_STOP_PCT_OPTIONS} onChange={(v) => patchTs({ startPct: v })} fmt={(v) => `-${v}%`} />
                              <Fld label={t('settings.rsimomentum_ts_pivot_pct')} value={ts.pivotPct} opts={RSI_MOMENTUM_PIVOT_PCT_OPTIONS} onChange={(v) => patchTs({ pivotPct: v })} fmt={(v) => (v === 0 ? '0 (BE)' : `${v > 0 ? '+' : ''}${v}%`)} />
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                              <Fld label={t('settings.rsimomentum_ts_phase_a_stop')} value={ts.aStopStepPct} opts={RSI_MOMENTUM_STOP_STEP_OPTIONS} onChange={(v) => patchTs({ aStopStepPct: v })} fmt={(v) => `${v} pp`} />
                              <Fld label={t('settings.rsimomentum_ts_phase_a_coin')} value={ts.aCoinStepPct} opts={RSI_MOMENTUM_COIN_STEP_OPTIONS} onChange={(v) => patchTs({ aCoinStepPct: v })} fmt={(v) => `/ ${v}%`} />
                              <Fld label={t('settings.rsimomentum_ts_phase_b_stop')} value={ts.bStopStepPct} opts={RSI_MOMENTUM_STOP_STEP_OPTIONS} onChange={(v) => patchTs({ bStopStepPct: v })} fmt={(v) => `${v} pp`} />
                              <Fld label={t('settings.rsimomentum_ts_phase_b_coin')} value={ts.bCoinStepPct} opts={RSI_MOMENTUM_COIN_STEP_OPTIONS} onChange={(v) => patchTs({ bCoinStepPct: v })} fmt={(v) => `/ ${v}%`} />
                            </div>
                            <p className="text-[9px] text-p5/40 mt-1 leading-relaxed">{t('settings.rsimomentum_ts_twophase_hint')}</p>
                          </>
                        )}

                        {(stopMode === 'peakTrail' || stopMode === 'atrTrail') && (
                          <>
                            <div className="grid grid-cols-3 gap-2">
                              <Fld label={t('settings.rsimomentum_trailingstop_start_pct')} value={ts.startPct} opts={RSI_MOMENTUM_STOP_PCT_OPTIONS} onChange={(v) => patchTs({ startPct: v })} fmt={(v) => `-${v}%`} />
                              <Fld label={t('settings.rsimomentum_ts_pivot_gain')} value={ts.pivotGainPct} opts={RSI_MOMENTUM_PIVOT_GAIN_OPTIONS} onChange={(v) => patchTs({ pivotGainPct: v })} fmt={(v) => `+${v}%`} />
                              <Fld label={t('settings.rsimomentum_ts_w_near')} value={ts.wNearPct} opts={RSI_MOMENTUM_WIDTH_PCT_OPTIONS} onChange={(v) => patchTs({ wNearPct: v })} fmt={(v) => `-${v}%`} />
                            </div>
                            {stopMode === 'peakTrail' && (
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                <Fld label={t('settings.rsimomentum_ts_w_far')} value={ts.wFarPct} opts={RSI_MOMENTUM_WIDTH_PCT_OPTIONS} onChange={(v) => patchTs({ wFarPct: v })} fmt={(v) => `-${v}%`} />
                              </div>
                            )}
                            {stopMode === 'atrTrail' && (
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                <Fld label={t('settings.rsimomentum_ts_atr_mult')} value={ts.atrMult} opts={RSI_MOMENTUM_ATR_MULT_OPTIONS} onChange={(v) => patchTs({ atrMult: v })} fmt={(v) => `${v}×`} />
                                <Fld label={t('settings.rsimomentum_ts_atr_max')} value={ts.atrMaxPct} opts={RSI_MOMENTUM_WIDTH_PCT_OPTIONS} onChange={(v) => patchTs({ atrMaxPct: v })} fmt={(v) => `-${v}%`} />
                              </div>
                            )}
                            <p className="text-[9px] text-p5/40 mt-1 leading-relaxed">
                              {t(stopMode === 'atrTrail' ? 'settings.rsimomentum_ts_atrtrail_hint' : 'settings.rsimomentum_ts_peaktrail_hint')}
                            </p>
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* REFORÇO NO STOP (martingale) — averaging-down quando a compra inicial bate o stop */}
                {(() => {
                  const rf = rsiMomentumConfig.exit.reinforceOnStop ?? { enabled: false, mode: 'ladder', addDropPct: 10, exitRisePct: 15, rearmStopPct: 10, rearmTargetPct: 10, buyUsd: 40 };
                  const rfMode = rf.mode === 'rearm' ? 'rearm' : 'ladder';
                  const patchRf = (patch) => patchRsiMomentumNested('exit', 'reinforceOnStop', patch);
                  return (
                    <div className="rounded-md p-2.5" style={{ background: '#1a1210', border: '1px solid #4a2d2a' }}>
                      <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_reinforce_title')}</p>
                      <p className="text-[10px] text-red-400/80 mb-2 leading-relaxed">{t('settings.rsimomentum_reinforce_hint')}</p>
                      <label className="flex items-start gap-2.5 cursor-pointer group mb-2">
                        <input
                          type="checkbox"
                          checked={rf.enabled}
                          onChange={(e) => patchRf({ enabled: e.target.checked })}
                          className="mt-0.5 shrink-0 accent-p4"
                        />
                        <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                          {t('settings.rsimomentum_reinforce_enabled')}
                        </span>
                      </label>
                      {rf.enabled && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1 col-span-2">
                            <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_reinforce_mode')}</span>
                            <select className={`${inp} w-full`}
                              value={rfMode}
                              onChange={(e) => patchRf({ mode: e.target.value })}>
                              {RSI_MOMENTUM_REINFORCE_MODE_OPTIONS.map((v) => <option key={v} value={v}>{t(`settings.rsimomentum_reinforce_mode_${v}`)}</option>)}
                            </select>
                          </label>
                          {rfMode === 'ladder' ? (
                            <>
                              <label className="flex flex-col gap-1">
                                <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_reinforce_drop')}</span>
                                <select className={`${inp} w-full`}
                                  value={rf.addDropPct}
                                  onChange={(e) => patchRf({ addDropPct: Number(e.target.value) })}>
                                  {RSI_MOMENTUM_REINFORCE_DROP_OPTIONS.map((v) => <option key={v} value={v}>−{v}%</option>)}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_reinforce_rise')}</span>
                                <select className={`${inp} w-full`}
                                  value={rf.exitRisePct}
                                  onChange={(e) => patchRf({ exitRisePct: Number(e.target.value) })}>
                                  {RSI_MOMENTUM_REINFORCE_RISE_OPTIONS.map((v) => <option key={v} value={v}>+{v}%</option>)}
                                </select>
                              </label>
                            </>
                          ) : (
                            <>
                              <label className="flex flex-col gap-1">
                                <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_reinforce_rearm_stop')}</span>
                                <select className={`${inp} w-full`}
                                  value={rf.rearmStopPct ?? 10}
                                  onChange={(e) => patchRf({ rearmStopPct: Number(e.target.value) })}>
                                  {RSI_MOMENTUM_REINFORCE_REARM_STOP_OPTIONS.map((v) => <option key={v} value={v}>−{v}%</option>)}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_reinforce_rearm_target')}</span>
                                <select className={`${inp} w-full`}
                                  value={rf.rearmTargetPct ?? 10}
                                  onChange={(e) => patchRf({ rearmTargetPct: Number(e.target.value) })}>
                                  {RSI_MOMENTUM_REINFORCE_REARM_TARGET_OPTIONS.map((v) => <option key={v} value={v}>+{v}%</option>)}
                                </select>
                              </label>
                            </>
                          )}
                          <label className="flex flex-col gap-1">
                            <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_reinforce_usd')}</span>
                            <select className={`${inp} w-full`}
                              value={rf.buyUsd ?? 40}
                              onChange={(e) => patchRf({ buyUsd: Number(e.target.value) })}>
                              {RSI_MOMENTUM_REINFORCE_USD_OPTIONS.map((v) => <option key={v} value={v}>${v}</option>)}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_bandwidth_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.rsimomentum_bandwidth_hint')}</p>
                  <label className="flex items-start gap-2.5 cursor-pointer group mb-2">
                    <input
                      type="checkbox"
                      checked={rsiMomentumConfig.entry.bandWidth.enabled}
                      onChange={(e) => patchRsiMomentumNested('entry', 'bandWidth', { enabled: e.target.checked })}
                      className="mt-0.5 shrink-0 accent-p4"
                    />
                    <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                      {t('settings.rsimomentum_bandwidth_enabled')}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_bandwidth_interval')}</span>
                      <select
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.bandWidth.interval}
                        onChange={(e) => patchRsiMomentumNested('entry', 'bandWidth', { interval: e.target.value })}
                      >
                        {RSI_MOMENTUM_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_bandwidth_period')}</span>
                      <select
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.bandWidth.period}
                        onChange={(e) => patchRsiMomentumNested('entry', 'bandWidth', { period: Number(e.target.value) })}
                      >
                        {RSI_MOMENTUM_BB_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_bandwidth_stddev')}</span>
                      <select
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.bandWidth.stdDev}
                        onChange={(e) => patchRsiMomentumNested('entry', 'bandWidth', { stdDev: Number(e.target.value) })}
                      >
                        {RSI_MOMENTUM_BB_STD_DEVS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_bandwidth_lookback')}</span>
                      <select
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.bandWidth.lookback}
                        onChange={(e) => patchRsiMomentumNested('entry', 'bandWidth', { lookback: Number(e.target.value) })}
                      >
                        {RSI_MOMENTUM_BANDWIDTH_LOOKBACK_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_bandwidth_min_pct')}</span>
                      <input
                        type="number" min={0.1} step={0.1}
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.bandWidth.minPct}
                        onChange={(e) => patchRsiMomentumNested('entry', 'bandWidth', { minPct: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                </div>



                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_macdfilter_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.rsimomentum_macdfilter_hint')}</p>
                  <label className="flex items-start gap-2.5 cursor-pointer group mb-2">
                    <input
                      type="checkbox"
                      checked={rsiMomentumConfig.entry.macdFilter.enabled}
                      onChange={(e) => patchRsiMomentumNested('entry', 'macdFilter', { enabled: e.target.checked })}
                      className="mt-0.5 shrink-0 accent-p4"
                    />
                    <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                      {t('settings.rsimomentum_macdfilter_enabled')}
                    </span>
                  </label>
                  {rsiMomentumConfig.entry.macdFilter.enabled && (
                    <label className="flex flex-col gap-1 w-1/2">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_macdfilter_interval')}</span>
                      <select
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.macdFilter.interval}
                        onChange={(e) => patchRsiMomentumNested('entry', 'macdFilter', { interval: e.target.value })}
                      >
                        {RSI_MOMENTUM_ALL_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                      </select>
                    </label>
                  )}
                </div>

                {/* Filtro RSI 1h — confirmação multi-timeframe (intervalo fixo 1h) */}
                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_higherrsi_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.rsimomentum_higherrsi_hint')}</p>
                  <label className="flex items-start gap-2.5 cursor-pointer group mb-2">
                    <input
                      type="checkbox"
                      checked={rsiMomentumConfig.entry.higherRsiFilter?.enabled ?? false}
                      onChange={(e) => patchRsiMomentumNested('entry', 'higherRsiFilter', { enabled: e.target.checked })}
                      className="mt-0.5 shrink-0 accent-p4"
                    />
                    <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                      {t('settings.rsimomentum_higherrsi_enabled')}
                    </span>
                  </label>
                  {(rsiMomentumConfig.entry.higherRsiFilter?.enabled ?? false) && (
                    <label className="flex flex-col gap-1 w-1/2">
                      <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_higherrsi_min')}</span>
                      <select
                        className={`${inp} w-full`}
                        value={rsiMomentumConfig.entry.higherRsiFilter?.minRsi ?? 50}
                        onChange={(e) => patchRsiMomentumNested('entry', 'higherRsiFilter', { minRsi: Number(e.target.value) })}
                      >
                        {[40, 45, 50, 55, 60, 65, 70].map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                  )}
                </div>

                {/* Suporte / Resistência — filtro de desconto na entrada + alvo na resistência */}
                <div className="rounded-md p-2.5" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
                  <p className="text-p5/70 text-[10px] font-semibold uppercase tracking-wider mb-1">{t('settings.rsimomentum_sr_title')}</p>
                  <p className="text-[10px] text-p5/40 mb-2 leading-relaxed">{t('settings.rsimomentum_sr_hint')}</p>
                  <label className="flex items-start gap-2.5 cursor-pointer group mb-2">
                    <input
                      type="checkbox"
                      checked={rsiMomentumConfig.entry.supportResistance?.enabled ?? false}
                      onChange={(e) => patchRsiMomentumNested('entry', 'supportResistance', { enabled: e.target.checked })}
                      className="mt-0.5 shrink-0 accent-p4"
                    />
                    <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                      {t('settings.rsimomentum_sr_enabled')}
                    </span>
                  </label>
                  {(rsiMomentumConfig.entry.supportResistance?.enabled ?? false) && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_sr_interval')}</span>
                        <select className={`${inp} w-full`}
                          value={rsiMomentumConfig.entry.supportResistance?.interval ?? '4h'}
                          onChange={(e) => patchRsiMomentumNested('entry', 'supportResistance', { interval: e.target.value })}>
                          {RSI_MOMENTUM_SR_INTERVAL_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_sr_candle_count')}</span>
                        <select className={`${inp} w-full`}
                          value={rsiMomentumConfig.entry.supportResistance?.candleCount ?? 50}
                          onChange={(e) => patchRsiMomentumNested('entry', 'supportResistance', { candleCount: Number(e.target.value) })}>
                          {RSI_MOMENTUM_SR_CANDLE_COUNT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_sr_entry_rank')}</span>
                        <select className={`${inp} w-full`}
                          value={rsiMomentumConfig.entry.supportResistance?.entrySupportRank ?? 1}
                          onChange={(e) => patchRsiMomentumNested('entry', 'supportResistance', { entrySupportRank: Number(e.target.value) })}>
                          {RSI_MOMENTUM_SR_RANK_OPTIONS.map((v) => <option key={v} value={v}>{v}º</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_sr_exit_rank')}</span>
                        <select className={`${inp} w-full`}
                          value={rsiMomentumConfig.entry.supportResistance?.exitResistanceRank ?? 1}
                          onChange={(e) => patchRsiMomentumNested('entry', 'supportResistance', { exitResistanceRank: Number(e.target.value) })}>
                          {RSI_MOMENTUM_SR_RANK_OPTIONS.map((v) => <option key={v} value={v}>{v}ª</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[9px] text-p5/40">{t('settings.rsimomentum_sr_entry_max_pct')}</span>
                        <select className={`${inp} w-full`}
                          value={rsiMomentumConfig.entry.supportResistance?.entryMaxPct ?? 5}
                          onChange={(e) => patchRsiMomentumNested('entry', 'supportResistance', { entryMaxPct: Number(e.target.value) })}>
                          {RSI_MOMENTUM_SR_ENTRY_MAX_PCT_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-p5/50">{t('settings.rsimomentum_min_volume')}</span>
                  <select
                    className={inp}
                    value={rsiMomentumConfig.volume.minVolumeUsdt}
                    onChange={(e) => patchRsiMomentum('volume', { minVolumeUsdt: Number(e.target.value) })}
                  >
                    {RSI_MOMENTUM_MIN_VOLUME_OPTIONS.map((v) => (
                      <option key={v} value={v}>{`${v / 1_000_000}M USDT`}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-p5/40">{t('settings.rsimomentum_min_volume_hint')}</span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-p5/50">{t('settings.rsimomentum_entry_cooldown_hours')}</span>
                  <input
                    type="number" min={0} step={0.5}
                    className={`w-24 ${inp}`}
                    value={rsiMomentumConfig.entryCooldownHours}
                    onChange={(e) => setRsiMomentumConfig((prev) => ({ ...prev, entryCooldownHours: Number(e.target.value) }))}
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-p5/50">{t('settings.rsimomentum_poll_seconds')}</span>
                    <input
                      type="number" min={5}
                      className={inp}
                      value={Math.round(rsiMomentumConfig.polling.pollMs / 1000)}
                      onChange={(e) => patchRsiMomentum('polling', { pollMs: Number(e.target.value) * 1000 })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-p5/50">{t('settings.rsimomentum_fast_poll_seconds')}</span>
                    <input
                      type="number" min={5}
                      className={inp}
                      value={Math.round(rsiMomentumConfig.polling.fastPollMs / 1000)}
                      onChange={(e) => patchRsiMomentum('polling', { fastPollMs: Number(e.target.value) * 1000 })}
                    />
                  </label>
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={persistRsiMomentumConfig}
                    disabled={rsiMomentumSaveState === 'saving'}
                    className="px-3 py-1.5 rounded text-xs text-white bg-p3 hover:bg-p4 transition-colors disabled:opacity-50"
                  >
                    {rsiMomentumSaveState === 'saving' ? t('settings.rsimomentum_saving') : t('settings.rsimomentum_save')}
                  </button>
                  {rsiMomentumSaveState === 'saved' && (
                    <span className="text-[10px] text-emerald-400">{t('settings.rsimomentum_saved')}</span>
                  )}
                  {rsiMomentumSaveState === 'error' && (
                    <span className="text-[10px] text-red-400">{t('settings.rsimomentum_save_error')}</span>
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
