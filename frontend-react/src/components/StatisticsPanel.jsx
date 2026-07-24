import { useState, useEffect, useRef } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchRsiOversoldRecovery, fetchMaCrossStats, fetchBollingerBandRecovery, fetchCandlesticksAndCloud } from '../services/api';
import Tooltip from './Tooltip';
import { useI18n } from '../i18n';
import { CHART_VIEW } from '../utils/chartView';
import { getEntriesForSymbol } from '../constants/strategyPresets';
import { isMaCrossEntry } from '../utils/macrossFavoritesSort';


const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];

const INTERVAL_MS = {
  '1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,
  '2h':7200000,'4h':14400000,'6h':21600000,'8h':28800000,'12h':43200000,
  '1d':86400000,'3d':259200000,'1w':604800000,
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const minutes = Math.round(ms / 60000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SummaryCard({ label, value, highlight, tooltip }) {
  const card = (
    <div className="flex flex-col items-center justify-center bg-p2/50 border border-p3/20 rounded px-0.5 py-px sm:px-2 sm:py-1.5 min-w-[38px] sm:min-w-[80px]">
      <span className={`text-[10px] sm:text-xs font-bold ${highlight ?? 'text-p5'}`}>{value}</span>
      <span className="text-[8px] sm:text-[9px] text-p5/50 text-center leading-tight">{label}</span>
    </div>
  );
  return tooltip ? <Tooltip text={tooltip} maxW={220}>{card}</Tooltip> : card;
}

const TABS = [
  { id: 'rsi', labelKey: 'stats.tab.rsi' },
  { id: 'ma_cross', labelKey: 'stats.tab.ma_cross' },
  { id: 'bollinger_bands', labelKey: 'stats.tab.bollinger_bands' },
];

const MC_INTERVAL_STORAGE_KEYS = {
  rsi: 'lets_trade_stats_mc_interval_rsi',
  ma_cross: 'lets_trade_stats_mc_interval_macross',
  bollinger_bands: 'lets_trade_stats_mc_interval_bb',
};

function loadUseMcInterval(tab, fallback) {
  try {
    const v = localStorage.getItem(MC_INTERVAL_STORAGE_KEYS[tab]);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return fallback;
}

function saveUseMcInterval(tab, value) {
  try { localStorage.setItem(MC_INTERVAL_STORAGE_KEYS[tab], value ? '1' : '0'); } catch {}
}

/** Entrada do favorito MA-Cross (multitrade_favorites) desse símbolo, se existir. */
function mcEntryFor(multitradeFavorites, symbol) {
  return getEntriesForSymbol(multitradeFavorites, symbol).find(isMaCrossEntry) ?? null;
}

/** Switch "Moeda MC" — usa o intervalo configurado no favorito MA-Cross da moeda em vez do
 *  intervalo padrão fixo da aba. Estado memorizado por aba (localStorage). */
function McIntervalSwitch({ checked, onChange }) {
  return (
    <div className="flex items-center gap-1 shrink-0 pb-1">
      <span className="hidden md:inline text-[9px] text-p5/50 uppercase tracking-wider">Moeda MC</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        title="Usa o intervalo configurado no favorito MA-Cross desta moeda em vez do padrão fixo"
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-p4' : 'bg-p3/40'}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function RsiStats() {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, multitradeFavorites } = useCurrency();
  const { t, formatPrice } = useI18n();
  const [symbol, setSymbol]         = useState(selectedChart?.symbol || 'BTCUSDT');
  const [interval, setInterval]     = useState('4h');
  const [oversold, setOversold]     = useState(30);
  const [overbought, setOverbought] = useState(70);
  const [useMcInterval, setUseMcInterval] = useState(() => loadUseMcInterval('rsi', true));
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState(null);
  const rsiSeriesRef = useRef(null); // série RSI com warmup correto das estatísticas
  const [error, setError]           = useState(null);
  const [showAll, setShowAll]       = useState(false);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';
  const inpNum = `${inp} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  async function handleSearch(overrideSymbol, updateChart = false, overrideInterval, overrideSource, overrideUseMc) {
    const sym    = (overrideSymbol ?? symbol).trim().toUpperCase();
    const useMc  = overrideUseMc ?? useMcInterval;
    const mcIv   = useMc ? mcEntryFor(multitradeFavorites, sym)?.tradeConfig?.entry?.ma1?.interval : null;
    const iv     = overrideInterval ?? mcIv ?? interval;
    if (mcIv) setInterval(mcIv);
    // Usa source do gráfico apenas quando o símbolo buscado é o mesmo do gráfico
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src    = overrideSource !== undefined ? overrideSource : chartSource;
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchRsiOversoldRecovery(sym, iv, oversold, overbought, src);
      setResult(data);
      // Guarda a série RSI calculada com warmup completo (1500 candles)
      rsiSeriesRef.current = data.rsiSeries ?? null;
      if (updateChart) {
        const chartData = await fetchCandlesticksAndCloud(sym, iv, src);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Sincroniza símbolo com o gráfico e relança a busca — intervalo fica fixo em 4h por padrão,
  // ou segue o favorito MA-Cross da moeda quando o switch "Moeda MC" está ligado.
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    const sym = selectedChart.symbol;
    const src = selectedChart.source ?? null;
    setSymbol(sym);
    handleSearch(sym, false, undefined, src);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart?.symbol]);

  function handleToggleMc(next) {
    setUseMcInterval(next);
    saveUseMcInterval('rsi', next);
    if (!next) setInterval('4h');
    handleSearch(undefined, false, undefined, undefined, next);
  }

  return (
    <div className="flex flex-col gap-2 w-full">

      {/* Formulário — sempre em linha única */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0">

        {/* Símbolo */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <div className="hidden md:flex items-center justify-between">
            <label className="text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
            {selectedChart?.symbol === symbol && (
              <span className="text-[8px] text-p4/70 italic">tabela</span>
            )}
          </div>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Par"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
          />
        </div>

        {/* Intervalo */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Intervalo</label>
          <select className={inp} value={interval} onChange={(e) => setInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>

        {/* Sobrv */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Sobrv.</label>
          <input className={inpNum} type="number" min={1} max={99}
            value={oversold} onChange={(e) => setOversold(Number(e.target.value))} />
        </div>

        {/* Sobrcp */}
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-0">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Sobrcp.</label>
          <input className={inpNum} type="number" min={1} max={99}
            value={overbought} onChange={(e) => setOverbought(Number(e.target.value))} />
        </div>

        <McIntervalSwitch checked={useMcInterval} onChange={handleToggleMc} />

        {/* Botão */}
        <button
          onClick={() => handleSearch(undefined, true)}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>
      </div>

      {/* Resultados */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">

        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            {/* Cartões de resumo */}
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label={t('stats.card.candles')}   value={result.totalCandles}     tooltip={t('stats.tip.candles')} />
              <SummaryCard label={t('stats.card.rsi_p')}    value={result.totalRsiPeriods}  tooltip={t('stats.tip.rsi_p')} />
              <SummaryCard label={t('stats.card.occur')}    value={result.totalOccurrences} highlight="text-p4" tooltip={t('stats.tip.occur')} />
              <SummaryCard
                label={t('stats.card.avg')}
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.avg')}
              />
              <SummaryCard label={t('stats.card.entry_rsi')} value={`< ${result.oversoldThreshold}`}   tooltip={t('stats.tip.entry_rsi')} />
              <SummaryCard label={t('stats.card.exit_rsi')}  value={`> ${result.overboughtThreshold}`} tooltip={t('stats.tip.exit_rsi')} />
              <SummaryCard label={t('stats.card.avg_duration')} value={formatDuration(result.avgCycleDurationMs)} tooltip={t('stats.tip.avg_duration')} />
            </div>

            {/* Tabela */}
            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">Nenhum ciclo encontrado.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {/* Toggle todas as colunas */}
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.start')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.entry_p')}</th>}
                        <th className="text-right pb-1 pr-2">RSI</th>
                        <th className="text-right pb-1 pr-2">RSI 4h</th>
                        <th className="text-right pb-1 pr-2">RSI 8h</th>
                        <th className="text-left pb-1 pr-2">{t('stats.end')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.exit_p')}</th>}
                        <th className="text-right pb-1 pr-2">RSI</th>
                        <th className="text-right pb-1">Valor.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.occurrences.map((o, i) => {
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={async () => {
                              const startMs = new Date(o.startDate).getTime();
                              const endMs   = new Date(o.endDate).getTime();
                              const msPerCandle = INTERVAL_MS[interval] ?? 1800000;
                              // Candles necessários do momento atual até o início do ciclo + padding
                              const needed = Math.min(3000, Math.max(266,
                                Math.ceil((Date.now() - startMs) / msPerCandle) + 40));
                              try {
                                const sym = (symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
                                const data = await fetchCandlesticksAndCloud(sym, interval, null, needed);

                                // Substitui o RSI recalculado pelo RSI correto das estatísticas
                                // (que usou 1500 candles com warmup completo)
                                const statsRsi = rsiSeriesRef.current;
                                if (statsRsi?.length) {
                                  const rsiByTime = new Map(statsRsi.map(r => [r.openTime, r.rsi]));
                                  data.rsi = data.candlesticks.map(c => rsiByTime.get(Number(c.openTime)) ?? null);
                                }

                                setSelectedChart(data);
                                setChartViewSource(CHART_VIEW.STATISTICS);
                                setChartZoom({
                                  source: CHART_VIEW.STATISTICS,
                                  startDate: o.startDate,
                                  endDate: o.endDate,
                                });

                                // Tabela de candles do período no console
                                const statsRsiMap = statsRsi
                                  ? new Map(statsRsi.map(r => [r.openTime, r.rsi]))
                                  : new Map();
                                const periodCandles = data.candlesticks.filter(c => {
                                  const ts = Number(c.openTime);
                                  return ts >= startMs && ts <= endMs;
                                });
                                console.group(`📊 ${sym} ${interval} — ${formatDate(o.startDate)} → ${formatDate(o.endDate)}`);
                                console.table(periodCandles.map(c => ({
                                  data:   formatDate(new Date(Number(c.openTime)).toISOString()),
                                  open:   Number(c.open),
                                  high:   Number(c.high),
                                  low:    Number(c.low),
                                  close:  Number(c.close),
                                  volume: Number(c.volume),
                                  RSI:    statsRsiMap.get(Number(c.openTime)) ?? '—',
                                })));
                                console.groupEnd();
                              } catch (err) {
                                console.warn('[cycle click]', err.message);
                              }
                            }}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-yellow-600">{o.entryRsi}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-orange-600">{o.entryRsi4h ?? '—'}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-amber-600">{o.entryRsi8h ?? '—'}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-yellow-600">{o.exitRsi}</td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })}

                      {result.openOccurrence && (() => {
                        const o   = result.openOccurrence;
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr className="border-t-2 border-amber-500/40 bg-amber-500/5">
                            {showAll && <td className="py-1 pr-2 text-[10px] text-amber-700">↓</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-700">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-700">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-yellow-600 font-bold">{o.entryRsi}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-orange-600">{o.entryRsi4h ?? '—'}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-amber-600">{o.entryRsi8h ?? '—'}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-700 italic">{t('stats.open')}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                            <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })()}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={showAll ? 10 : 7} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

function MaCrossStats() {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, multitradeFavorites } = useCurrency();
  const { t } = useI18n();
  const [symbol, setSymbol]               = useState(selectedChart?.symbol || 'BTCUSDT');
  const [entryInterval, setEntryInterval] = useState('4h');
  const [exitInterval, setExitInterval]   = useState('4h');
  const [useMcInterval, setUseMcInterval] = useState(() => loadUseMcInterval('ma_cross', false));
  const [loading, setLoading]             = useState(false);
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState(null);
  const [showAll, setShowAll]             = useState(false);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';

  async function handleSearch(overrideSymbol, updateChart = false, overrideEntryIv, overrideExitIv, overrideSource, overrideUseMc) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const useMc = overrideUseMc ?? useMcInterval;
    const mcEntry = useMc ? mcEntryFor(multitradeFavorites, sym) : null;
    const mcEntryIv = mcEntry?.tradeConfig?.entry?.ma1?.interval ?? null;
    const mcExitIv = mcEntry?.tradeConfig?.exit?.maCross?.ma1?.interval ?? null;
    const entryIv = overrideEntryIv ?? mcEntryIv ?? entryInterval;
    const exitIv = overrideExitIv ?? mcExitIv ?? exitInterval;
    if (mcEntryIv) setEntryInterval(mcEntryIv);
    if (mcExitIv) setExitInterval(mcExitIv);
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src = overrideSource !== undefined ? overrideSource : chartSource;
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchMaCrossStats(sym, {
        entryInterval: entryIv,
        exitInterval: exitIv,
        source: src,
      });
      setResult(data);
      if (updateChart) {
        const chartData = await fetchCandlesticksAndCloud(sym, entryIv, src);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedChart?.symbol) return;
    const sym = selectedChart.symbol;
    const src = selectedChart.source ?? null;
    setSymbol(sym);
    handleSearch(sym, false, undefined, undefined, src);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart?.symbol]);

  function handleToggleMc(next) {
    setUseMcInterval(next);
    saveUseMcInterval('ma_cross', next);
    if (!next) { setEntryInterval('4h'); setExitInterval('4h'); }
    handleSearch(undefined, false, undefined, undefined, undefined, next);
  }

  async function openOnChart(o, entryIv) {
    const startMs = new Date(o.startDate).getTime();
    const endMs = o.endDate ? new Date(o.endDate).getTime() : Date.now();
    const msPerCandle = INTERVAL_MS[entryIv] ?? 900_000;
    const needed = Math.min(3000, Math.max(266,
      Math.ceil((Date.now() - startMs) / msPerCandle) + 40));
    try {
      const sym = (symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
      const src = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
      const data = await fetchCandlesticksAndCloud(sym, entryIv, src, needed);
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      setChartZoom({
        source: CHART_VIEW.STATISTICS,
        startDate: o.startDate,
        endDate: o.endDate ?? new Date(endMs).toISOString(),
      });
    } catch (err) {
      console.warn('[ma-cross stats click]', err.message);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0 flex-wrap">
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[72px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Par"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
          />
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.entry_iv')}</label>
          <select className={inp} value={entryInterval} onChange={(e) => setEntryInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.exit_iv')}</label>
          <select className={inp} value={exitInterval} onChange={(e) => setExitInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>
        <McIntervalSwitch checked={useMcInterval} onChange={handleToggleMc} />
        <button
          onClick={() => handleSearch(undefined, true)}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label={t('stats.card.candles')} value={result.totalCandles} tooltip={t('stats.tip.candles')} />
              <SummaryCard label={t('stats.card.occur')} value={result.totalOccurrences} highlight="text-p4" tooltip={t('stats.tip.ma_occur')} />
              <SummaryCard
                label={t('stats.card.avg')}
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.avg')}
              />
              <SummaryCard label={t('stats.card.entry_rule')} value={result.entryLabel} tooltip={t('stats.tip.ma_entry')} />
              <SummaryCard label={t('stats.card.exit_rule')} value={result.exitLabel} tooltip={t('stats.tip.ma_exit')} />
              <SummaryCard label={t('stats.card.avg_duration')} value={formatDuration(result.avgCycleDurationMs)} tooltip={t('stats.tip.avg_duration')} />
            </div>

            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">{t('stats.no_cycles_ma')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.start')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.entry_p')}</th>}
                        <th className="text-right pb-1 pr-2">{t('stats.ma_entry_col')}</th>
                        <th className="text-left pb-1 pr-2">{t('stats.end')}</th>
                        {showAll && <th className="text-right pb-1 pr-2">{t('stats.exit_p')}</th>}
                        <th className="text-right pb-1 pr-2">{t('stats.ma_exit_col')}</th>
                        <th className="text-right pb-1">{t('stats.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.occurrences.map((o, i) => {
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={() => openOnChart(o, result.entryInterval)}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-green-600 font-mono">
                              {o.entryMa1 != null && o.entryMa2 != null ? `${o.entryMa1.toFixed(2)} / ${o.entryMa2.toFixed(2)}` : '—'}
                            </td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                            {showAll && <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-red-600 font-mono">
                              {o.exitMa1 != null && o.exitMa2 != null ? `${o.exitMa1.toFixed(2)} / ${o.exitMa2.toFixed(2)}` : '—'}
                            </td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })}

                      {result.openOccurrence && (() => {
                        const o = result.openOccurrence;
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr className="border-t-2 border-amber-500/40 bg-amber-500/5">
                            {showAll && <td className="py-1 pr-2 text-[10px] text-amber-700">↓</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-700">{formatDate(o.startDate)}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-700">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-green-600 font-mono">
                              {o.entryMa1 != null && o.entryMa2 != null ? `${o.entryMa1.toFixed(2)} / ${o.entryMa2.toFixed(2)}` : '—'}
                            </td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-700 italic">{t('stats.open')}</td>
                            {showAll && <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                            <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })()}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={showAll ? 8 : 5} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

function BollingerBandsStats() {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, multitradeFavorites } = useCurrency();
  const { t } = useI18n();
  const [symbol, setSymbol]     = useState(selectedChart?.symbol || 'BTCUSDT');
  const [interval, setInterval] = useState('4h');
  const [period, setPeriod]     = useState(20);
  const [stdDev, setStdDev]     = useState(2);
  const [useMcInterval, setUseMcInterval] = useState(() => loadUseMcInterval('bollinger_bands', false));
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [showAll, setShowAll]   = useState(false);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';
  const inpNum = `${inp} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  async function handleSearch(overrideSymbol, updateChart = false, overrideInterval, overrideSource, overrideUseMc) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const useMc = overrideUseMc ?? useMcInterval;
    const mcIv  = useMc ? mcEntryFor(multitradeFavorites, sym)?.tradeConfig?.entry?.ma1?.interval : null;
    const iv  = overrideInterval ?? mcIv ?? interval;
    if (mcIv) setInterval(mcIv);
    const chartSource = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
    const src = overrideSource !== undefined ? overrideSource : chartSource;
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchBollingerBandRecovery(sym, iv, period, stdDev, src);
      setResult(data);
      if (updateChart) {
        const chartData = await fetchCandlesticksAndCloud(sym, iv, src);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Sincroniza símbolo com o gráfico e relança a busca — intervalo fica fixo em 4h por padrão,
  // ou segue o favorito MA-Cross da moeda quando o switch "Moeda MC" está ligado.
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    const sym = selectedChart.symbol;
    const src = selectedChart.source ?? null;
    setSymbol(sym);
    handleSearch(sym, false, undefined, src);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart?.symbol]);

  function handleToggleMc(next) {
    setUseMcInterval(next);
    saveUseMcInterval('bollinger_bands', next);
    if (!next) setInterval('4h');
    handleSearch(undefined, false, undefined, undefined, next);
  }

  async function openOnChart(o, iv) {
    const startMs = new Date(o.startDate).getTime();
    const endMs   = o.endDate ? new Date(o.endDate).getTime() : Date.now();
    const msPerCandle = INTERVAL_MS[iv] ?? 14400000;
    const needed = Math.min(3000, Math.max(266,
      Math.ceil((Date.now() - startMs) / msPerCandle) + 40));
    try {
      const sym = (symbol || selectedChart?.symbol || 'BTCUSDT').trim().toUpperCase();
      const src = selectedChart?.symbol === sym ? (selectedChart?.source ?? null) : null;
      const data = await fetchCandlesticksAndCloud(sym, iv, src, needed);
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      setChartZoom({
        source: CHART_VIEW.STATISTICS,
        startDate: o.startDate,
        endDate: o.endDate ?? new Date(endMs).toISOString(),
      });
    } catch (err) {
      console.warn('[bollinger stats click]', err.message);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full md:w-auto md:shrink-0 flex-wrap">
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[72px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Par"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
          />
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[56px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">Intervalo</label>
          <select className={inp} value={interval} onChange={(e) => setInterval(e.target.value)}>
            {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bb_period')}</label>
          <input className={inpNum} type="number" min={2} max={200}
            value={period} onChange={(e) => setPeriod(Number(e.target.value))} />
        </div>
        <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[48px]">
          <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{t('stats.bb_stddev')}</label>
          <input className={inpNum} type="number" min={0.5} max={5} step={0.1}
            value={stdDev} onChange={(e) => setStdDev(Number(e.target.value))} />
        </div>
        <McIntervalSwitch checked={useMcInterval} onChange={handleToggleMc} />
        <button
          onClick={() => handleSearch(undefined, true)}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-1.5 md:flex-1 md:gap-1.5 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
          }
          {t('stats.search')}
        </button>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {error && (
          <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label={t('stats.card.candles')} value={result.totalCandles} tooltip={t('stats.tip.candles')} />
              <SummaryCard label={t('stats.card.occur')} value={result.totalOccurrences} highlight="text-p4" tooltip={t('stats.tip.bb_occur')} />
              <SummaryCard
                label={t('stats.card.avg')}
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip={t('stats.tip.avg')}
              />
              <SummaryCard label={t('stats.bb_period')} value={result.period} tooltip={t('stats.tip.bb_period')} />
              <SummaryCard label={t('stats.bb_stddev')} value={result.stdDev} tooltip={t('stats.tip.bb_stddev')} />
              <SummaryCard label={t('stats.card.avg_duration')} value={formatDuration(result.avgCycleDurationMs)} tooltip={t('stats.tip.avg_duration')} />
            </div>

            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">{t('stats.no_cycles_bb')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-p5/50">{t('stats.details')}</span>
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showAll ? 'bg-p4' : 'bg-p3/40'}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-3' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {showAll && <th className="text-left pb-1 pr-2">#</th>}
                        <th className="text-left pb-1 pr-2">{t('stats.start')}</th>
                        <th className="text-right pb-1 pr-2">{t('stats.entry_p')}</th>
                        <th className="text-left pb-1 pr-2">{t('stats.end')}</th>
                        <th className="text-right pb-1 pr-2">{t('stats.exit_p')}</th>
                        <th className="text-right pb-1">{t('stats.value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.occurrences.map((o, i) => {
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr
                            key={i}
                            title={t('stats.click_row')}
                            className="lt-table-row hover:bg-p2/40 transition-colors cursor-pointer"
                            onClick={() => openOnChart(o, result.interval)}
                          >
                            {showAll && <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>}
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                            <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                            <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })}

                      {result.openOccurrence && (() => {
                        const o = result.openOccurrence;
                        const pos = o.appreciationPercent >= 0;
                        return (
                          <tr className="border-t-2 border-amber-500/40 bg-amber-500/5">
                            {showAll && <td className="py-1 pr-2 text-[10px] text-amber-700">↓</td>}
                            <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-700">{formatDate(o.startDate)}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-700">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-700 italic">{t('stats.open')}</td>
                            <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                            <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-600' : 'text-red-600'}`}>
                              {pos ? '+' : ''}{o.appreciationPercent}%
                            </td>
                          </tr>
                        );
                      })()}

                      <tr className="lt-table-foot" aria-hidden="true">
                        <td colSpan={showAll ? 6 : 5} className="h-px p-0 leading-none" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
        )}
      </div>
    </div>
  );
}

export default function StatisticsPanel() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('rsi');

  return (
    <div className="flex flex-col h-full">

      {/* Abas */}
      <div className="flex gap-1 border-b border-p3/20 px-4 pt-3 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs rounded-t transition-colors ${
              activeTab === tab.id ? 'bg-p4 text-white' : 'text-p5/60 hover:text-p5'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 pb-3 pt-2">
        {activeTab === 'rsi' && <RsiStats />}
        {activeTab === 'ma_cross' && <MaCrossStats />}
        {activeTab === 'bollinger_bands' && <BollingerBandsStats />}
      </div>
    </div>
  );
}
