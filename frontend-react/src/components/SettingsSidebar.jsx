import { useState } from 'react';
import { reloadCandles } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { useI18n } from '../i18n';

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
  const [activeId, setActiveId]           = useState('default');
  const [reloadSymbol, setReloadSymbol]   = useState('');
  const [reloadInterval, setReloadInterval] = useState('all');
  const [reloadState, setReloadState]     = useState(null);
  const [reloadError, setReloadError]     = useState('');

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
      <div className={`fixed top-0 right-0 h-full w-72 z-50 flex flex-col bg-p1 border-l border-p2 transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}>

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
