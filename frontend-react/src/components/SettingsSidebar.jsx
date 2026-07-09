import { useState, useEffect } from 'react';
import { reloadCandles } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { useI18n } from '../i18n';
import { useCurrency } from '../contexts/CurrencyContext';
import { BAND_PCT_OPTIONS, PERIOD_DEFAULT_COLORS, MAX_OVERLAY_SLOTS } from '../utils/uiPreferences';

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

export default function SettingsSidebar({ open, onClose }) {
  const { lang, setLang } = useLanguage();
  const { t } = useI18n();
  const { selectedChart, assetDisplay, setAssetDisplayCategory, assetCategoryKeys,
    chartPanelButtons, setChartPanelButton, chartPanelButtonKeys,
    uiPrefs, setDefaultChartInterval, setPanelVisible, setMaBandsDefaults,
    setOverlaySlotsPreference,
    chartIntervalOptions, panelKeys } = useCurrency();

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

  const [activeId, setActiveId]           = useState('default');
  const [reloadSymbol, setReloadSymbol]   = useState('');
  const [reloadInterval, setReloadInterval] = useState('all');
  const [reloadState, setReloadState]     = useState(null);
  const [reloadError, setReloadError]     = useState('');

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

  const section = 'text-p5 text-xs uppercase tracking-widest opacity-50 mb-3';
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

        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">

          {/* Exibição de ativos */}
          <div>
            <p className={section}>{t('settings.asset_display')}</p>
            <p className="text-[10px] text-p5/50 mb-3 leading-relaxed">{t('settings.asset_display_hint')}</p>
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
          </div>

          {/* Intervalo padrão do gráfico */}
          <div>
            <p className={section}>{t('settings.chart_default_interval')}</p>
            <p className="text-[10px] text-p5/50 mb-3 leading-relaxed">{t('settings.chart_default_interval_hint')}</p>
            <select
              className={`w-full ${inp}`}
              value={uiPrefs.defaultChartInterval}
              onChange={(e) => setDefaultChartInterval(e.target.value)}
            >
              {chartIntervalOptions.map((iv) => (
                <option key={iv} value={iv}>{iv}</option>
              ))}
            </select>
          </div>

          {/* Painéis inferiores */}
          <div>
            <p className={section}>{t('settings.visible_panels')}</p>
            <p className="text-[10px] text-p5/50 mb-3 leading-relaxed">{t('settings.visible_panels_hint')}</p>
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
          </div>

          {/* Botões do gráfico */}
          <div>
            <p className={section}>{t('settings.chart_panel')}</p>
            <p className="text-[10px] text-p5/50 mb-3 leading-relaxed">{t('settings.chart_panel_hint')}</p>
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
          </div>

          {/* Overlay MA — padrão */}
          <div>
            <p className={section}>{t('settings.overlay_slots')}</p>
            <p className="text-[10px] text-p5/50 mb-3 leading-relaxed">{t('settings.overlay_slots_hint')}</p>
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
          </div>

          {/* Bandas % — estado padrão */}
          <div>
            <p className={section}>{t('settings.ma_bands_defaults')}</p>
            <p className="text-[10px] text-p5/50 mb-3 leading-relaxed">{t('settings.ma_bands_defaults_hint')}</p>
            <div className="flex flex-col gap-3">
              <div>
                <span className="text-[10px] text-p5/60 block mb-1.5">{t('settings.ma_bands_pct')}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {BAND_PCT_OPTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setMaBandsDefaults({ pct: p })}
                      className={`min-w-[2.25rem] py-1 rounded text-xs font-mono border transition-all ${
                        uiPrefs.maBandsDefaults.pct === p
                          ? 'border-p4 bg-p4/20 text-p5 font-semibold'
                          : 'border-p2/40 text-p5/60 hover:border-p3 hover:bg-p2/30'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={uiPrefs.maBandsDefaults.showAbove === true}
                  onChange={(e) => setMaBandsDefaults({ showAbove: e.target.checked })}
                  className="mt-0.5 shrink-0 accent-p4"
                />
                <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                  {t('settings.ma_bands_above')}
                  <span className="block text-[10px] text-p5/40 mt-0.5">
                    {t('settings.ma_bands_above_detail', uiPrefs.maBandsDefaults.pct)}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={uiPrefs.maBandsDefaults.showBelow !== false}
                  onChange={(e) => setMaBandsDefaults({ showBelow: e.target.checked })}
                  className="mt-0.5 shrink-0 accent-p4"
                />
                <span className="text-p5 text-xs leading-snug group-hover:text-white transition-colors">
                  {t('settings.ma_bands_below')}
                  <span className="block text-[10px] text-p5/40 mt-0.5">
                    {t('settings.ma_bands_below_detail', uiPrefs.maBandsDefaults.pct)}
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Idioma */}
          <div>
            <p className={section}>{t('settings.language')}</p>
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
          </div>

          {/* Recarregar candles */}
          <div>
            <p className={section}>{t('settings.reload')}</p>
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
          </div>

          {/* Paleta de cores */}
          <div>
            <p className={section}>{t('settings.palette')}</p>
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
          </div>

        </div>
      </div>
    </>
  );
}
