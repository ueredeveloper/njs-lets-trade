import { useState, useEffect } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandleSetupsBacktest, fetchCandlesticksAndCloud } from '../services/api';
import { useI18n } from '../i18n';
import { CHART_VIEW } from '../utils/chartView';

/**
 * Estatísticas → aba "Setups": backtest dos "Setups Matadores para Day Trade" (só compra, 15m por
 * padrão) sobre uma moeda ou o mercado USDT inteiro. Motor: backend/utils/analyseCandleSetupsBacktest.js
 * (mesmos detectores do futuro bot). Estudo do livro: backend/trading-books/leitura.md.
 */

const SETUP_IDS = ['pfr', 'pontoContinuo', 'fechouForaDentro', 'martelinho', 'onePunch'];
const SETUP_LABEL = {
  pfr: 'PFR',
  pontoContinuo: 'Ponto Contínuo',
  fechouForaDentro: 'Fechou Fora, Fechou Dentro',
  martelinho: 'Martelinho',
  onePunch: 'One Punch',
};

const INTERVAL_OPTIONS = ['1m', '5m', '15m', '30m', '1h', '4h'];
// A retenção do cache de candles em disco é 3000 por intervalo (backend/utils/candleRetentionLimits.js).
const CANDLE_COUNT_OPTIONS = [500, 1000, 2000, 3000];
const VOLUME_OPTIONS = [0, 1_000_000, 2_000_000, 5_000_000, 30_000_000, 100_000_000];
const RISK_MIN_OPTIONS = [0, 0.3, 0.5, 0.8, 1, 1.5, 2];
const RISK_MAX_OPTIONS = [0, 1.5, 2, 3, 4, 5, 8];
const VALID_OPTIONS = [1, 2, 3, 4, 5];
const HOLD_OPTIONS = [0, 8, 16, 24, 48, 96];
const FEE_OPTIONS = [0, 0.075, 0.1];
const SLIP_OPTIONS = [0, 0.02, 0.05, 0.1];
const TOUCH_PERIOD_OPTIONS = [20, 21, 50];
const MAX_ROWS = 1500;
const DETAIL_ROWS_SHOWN = 300;

const PREFS_KEY = 'lets_trade_stats_candle_setups_prefs';
const DEFAULT_PREFS = {
  scope: 'market',
  interval: '15m',
  candleCount: 3000,
  setups: ['pfr', 'pontoContinuo', 'fechouForaDentro'],
  minVolumeUsdt: 5_000_000,
  includeGate: false,
  minRiskPct: 1,
  maxRiskPct: 3,
  validCandles: 2,
  maxHoldCandles: 48,
  feePct: 0.1,
  slippagePct: 0.05,
  positionSizeUsd: 40,
  pfrCloseAbove: 'prevClose',
  pcRequireHHHL: true,
  pcTouchPeriod: 21,
  ffStopMode: 'both',
  ffFinalTarget: '2R',
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed, setups: Array.isArray(parsed.setups) ? parsed.setups.filter((id) => SETUP_IDS.includes(id)) : DEFAULT_PREFS.setups };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage indisponível */ }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
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

function formatVolume(v) {
  if (!v) return '0';
  if (v >= 1e6) return `${v / 1e6}M`;
  return `${v / 1e3}K`;
}

const signed = (v, suffix = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${suffix}`);
const tone = (v) => (v == null || v === 0 ? 'text-p5/70' : v > 0 ? 'text-green-600' : 'text-red-600');
const price = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });

const OUTCOME_STYLE = {
  target: 'text-green-600',
  partial: 'text-amber-600',
  stop: 'text-red-600',
  time: 'text-p5/60',
  open: 'text-amber-700 italic',
};

function Field({ label, tip, children }) {
  return (
    <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[64px]" title={tip}>
      <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

export default function CandleSetupsStats({ autoCalc }) {
  const { selectedChart, setSelectedChart, setChartZoom, setChartViewSource, setChartTradeMarkers, setChartSrOverride } = useCurrency();
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [symbol, setSymbol] = useState(selectedChart?.symbol || 'BTCUSDT');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [detailSetup, setDetailSetup] = useState(null);
  const [sort, setSort] = useState({ key: 'signalDate', dir: -1 });
  const [showRules, setShowRules] = useState(false);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';

  function setPref(patch) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }

  function toggleSetup(id) {
    setPref({ setups: prefs.setups.includes(id) ? prefs.setups.filter((s) => s !== id) : [...prefs.setups, id] });
  }

  async function handleSearch(overrideSymbol) {
    if (!prefs.setups.length) { setError(t('stats.cs.no_setup')); return; }
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const params = {
      interval: prefs.interval,
      candleCount: prefs.candleCount,
      setups: SETUP_IDS.filter((id) => prefs.setups.includes(id)).join(','),
      positionSizeUsd: prefs.positionSizeUsd,
      minRiskPct: prefs.minRiskPct,
      maxRiskPct: prefs.maxRiskPct,
      validCandles: prefs.validCandles,
      maxHoldCandles: prefs.maxHoldCandles,
      feePct: prefs.feePct,
      slippagePct: prefs.slippagePct,
      pfrCloseAbove: prefs.pfrCloseAbove,
      pcRequireHHHL: prefs.pcRequireHHHL ? 1 : 0,
      pcTouchPeriod: prefs.pcTouchPeriod,
      ffStopMode: prefs.ffStopMode,
      ffFinalTarget: prefs.ffFinalTarget,
      maxRows: MAX_ROWS,
    };
    if (prefs.scope === 'symbol') {
      if (!sym) return;
      params.symbol = sym;
      if (selectedChart?.symbol === sym && selectedChart?.source === 'gate') params.source = 'gate';
    } else {
      params.minVolumeUsdt = prefs.minVolumeUsdt;
      if (prefs.includeGate) params.includeGateFavorites = 1;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchCandleSetupsBacktest(params);
      const ranked = data.bySetup.filter((b) => b.summary.trades > 0).sort((a, b) => b.summary.avgPnlPct - a.summary.avgPnlPct);
      setDetailSetup(ranked[0]?.setup ?? data.bySetup[0]?.setup ?? null);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Sincroniza o campo símbolo com o gráfico; com "Cálculo Automático" ligado, no escopo "uma moeda",
  // também recalcula (no escopo Mercado a varredura é pesada demais pra disparar sozinha).
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc && prefs.scope === 'symbol') handleSearch(selectedChart.symbol);
  }, [selectedChart?.symbol, autoCalc]);

  async function openOnChart(o) {
    const signalMs = new Date(o.signalDate).getTime();
    const entryMs = new Date(o.entryDate).getTime();
    const endMs = o.exitDate ? new Date(o.exitDate).getTime() : Date.now();
    try {
      const src = o.source === 'gate' ? 'gate' : (selectedChart?.symbol === o.symbol ? (selectedChart?.source ?? null) : null);
      // Busca ancorada no período do trade (+100 candles de folga de cada lado), como as outras abas.
      const data = await fetchCandlesticksAndCloud(o.symbol, result.interval, src, undefined, { fromMs: signalMs, toMs: endMs, pad: 100 });
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      setChartSrOverride(null);
      const risk = o.entryPrice - o.stopPrice;
      setChartTradeMarkers([
        { time: entryMs, side: 'buy', price: o.entryPrice, label: '▲ Entrada' },
        ...o.legs.filter((l) => l.reason !== 'open').map((l) => {
          const r = risk > 0 ? (l.price - o.entryPrice) / risk : 0;
          return {
            time: new Date(l.date).getTime(), side: 'sell', price: l.price,
            pnlPct: (l.price / o.entryPrice - 1) * 100, entryTime: entryMs, entryPrice: o.entryPrice,
            label: `▼ ${t(`stats.cs.out.${l.reason}`)} ${r >= 0 ? '+' : ''}${r.toFixed(1)}R`,
          };
        }),
      ]);
      setChartZoom({ source: CHART_VIEW.STATISTICS, startDate: o.signalDate, endDate: o.exitDate ?? new Date(endMs).toISOString() });
    } catch (err) {
      console.warn('[candle-setups stats click]', err.message);
    }
  }

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'symbol' ? 1 : -1 }));
  }

  const ranked = result
    ? [...result.bySetup].sort((a, b) => (b.summary.avgPnlPct ?? -Infinity) - (a.summary.avgPnlPct ?? -Infinity))
    : [];
  const detail = result?.bySetup.find((b) => b.setup === detailSetup) ?? null;
  const detailTrades = result && detailSetup
    ? result.occurrences.filter((o) => o.setup === detailSetup).sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0);
      return cmp * sort.dir;
    })
    : [];

  const sortTh = (label, k, align = 'right') => (
    <th
      key={k}
      onClick={() => toggleSort(k)}
      className={`${align === 'right' ? 'text-right' : 'text-left'} pb-1 pr-2 cursor-pointer select-none hover:text-p5`}
    >
      {label}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const th = 'text-right pb-1 pr-2';
  const td = 'py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono whitespace-nowrap';

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Controles */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap">
        <Field label={t('stats.cs.scope')} tip={t('stats.tip.cs_scope')}>
          <select className={inp} value={prefs.scope} onChange={(e) => setPref({ scope: e.target.value })}>
            <option value="market">{t('stats.cs.scope_market')}</option>
            <option value="symbol">{t('stats.cs.scope_symbol')}</option>
          </select>
        </Field>
        {prefs.scope === 'symbol' ? (
          <Field label="Símbolo">
            <input
              className={inp}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Par"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </Field>
        ) : (
          <>
            <Field label={t('stats.cs.min_volume')}>
              <select className={inp} value={prefs.minVolumeUsdt} onChange={(e) => setPref({ minVolumeUsdt: Number(e.target.value) })}>
                {VOLUME_OPTIONS.map((v) => <option key={v} value={v}>{v ? `≥ $${formatVolume(v)}` : '—'}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-1 text-[10px] text-p5/70 pb-1 cursor-pointer">
              <input type="checkbox" checked={prefs.includeGate} onChange={(e) => setPref({ includeGate: e.target.checked })} />
              {t('stats.cs.gate')}
            </label>
          </>
        )}
        <Field label={t('stats.entry_iv')}>
          <select className={inp} value={prefs.interval} onChange={(e) => setPref({ interval: e.target.value })}>
            {INTERVAL_OPTIONS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </Field>
        <Field label={t('stats.card.candles')} tip={t('stats.tip.bb_candle_count')}>
          <select className={inp} value={prefs.candleCount} onChange={(e) => setPref({ candleCount: Number(e.target.value) })}>
            {CANDLE_COUNT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <button
          onClick={() => handleSearch()}
          disabled={loading}
          className="shrink-0 flex items-center justify-center gap-1 py-1 px-2 rounded text-[11px] text-white bg-p4 hover:bg-p3 transition-colors disabled:opacity-50"
        >
          {loading
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>}
          {t('stats.search')}
        </button>
      </div>

      {/* Setups selecionados */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[9px] text-p5/50 uppercase tracking-wider mr-1">{t('stats.cs.setups')}</span>
        {SETUP_IDS.map((id) => (
          <button
            key={id}
            onClick={() => toggleSetup(id)}
            title={`${SETUP_LABEL[id]} — ${t(`stats.cs.rule.${id}`)}`}
            className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
              prefs.setups.includes(id) ? 'bg-p4 border-p4 text-white' : 'border-p3/40 text-p5/60 hover:text-p5'
            }`}
          >
            {SETUP_LABEL[id]}
          </button>
        ))}
        <button onClick={() => setShowRules((v) => !v)} className="ml-auto text-[10px] text-p5/50 hover:text-p5 underline">
          {t('stats.cs.advanced')} {showRules ? '▲' : '▼'}
        </button>
      </div>

      {/* Risco, execução, custos e regras */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap">
        <Field label={t('stats.cs.risk_min')} tip={t('stats.tip.cs_risk_min')}>
          <select className={inp} value={prefs.minRiskPct} onChange={(e) => setPref({ minRiskPct: Number(e.target.value) })}>
            {RISK_MIN_OPTIONS.map((v) => <option key={v} value={v}>{v || t('stats.cs.no_limit')}</option>)}
          </select>
        </Field>
        <Field label={t('stats.cs.risk_max')} tip={t('stats.tip.cs_risk_max')}>
          <select className={inp} value={prefs.maxRiskPct} onChange={(e) => setPref({ maxRiskPct: Number(e.target.value) })}>
            {RISK_MAX_OPTIONS.map((v) => <option key={v} value={v}>{v || t('stats.cs.no_limit')}</option>)}
          </select>
        </Field>
        <Field label={t('stats.cs.valid')} tip={t('stats.tip.cs_valid')}>
          <select className={inp} value={prefs.validCandles} onChange={(e) => setPref({ validCandles: Number(e.target.value) })}>
            {VALID_OPTIONS.map((v) => <option key={v} value={v}>{v} {t('stats.cs.candles_unit')}</option>)}
          </select>
        </Field>
        <Field label={t('stats.cs.hold')} tip={t('stats.tip.cs_hold')}>
          <select className={inp} value={prefs.maxHoldCandles} onChange={(e) => setPref({ maxHoldCandles: Number(e.target.value) })}>
            {HOLD_OPTIONS.map((v) => <option key={v} value={v}>{v ? `${v} ${t('stats.cs.candles_unit')}` : t('stats.cs.no_limit')}</option>)}
          </select>
        </Field>
        <Field label={t('stats.cs.fee')} tip={t('stats.tip.cs_fee')}>
          <select className={inp} value={prefs.feePct} onChange={(e) => setPref({ feePct: Number(e.target.value) })}>
            {FEE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label={t('stats.cs.slip')} tip={t('stats.tip.cs_slip')}>
          <select className={inp} value={prefs.slippagePct} onChange={(e) => setPref({ slippagePct: Number(e.target.value) })}>
            {SLIP_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label={t('stats.cs.size')}>
          <input
            type="number" min="1" className={inp} value={prefs.positionSizeUsd}
            onChange={(e) => setPref({ positionSizeUsd: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
      </div>

      {showRules && (
        <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap border border-p3/20 rounded p-2 bg-p2/30">
          <Field label={t('stats.cs.pfr_close')} tip={t('stats.tip.cs_pfr_close')}>
            <select className={inp} value={prefs.pfrCloseAbove} onChange={(e) => setPref({ pfrCloseAbove: e.target.value })}>
              <option value="prevClose">{t('stats.cs.pfr_close_prevClose')}</option>
              <option value="prevHigh">{t('stats.cs.pfr_close_prevHigh')}</option>
            </select>
          </Field>
          <Field label={t('stats.cs.pc_touch')} tip={t('stats.tip.cs_pc_touch')}>
            <select className={inp} value={prefs.pcTouchPeriod} onChange={(e) => setPref({ pcTouchPeriod: Number(e.target.value) })}>
              {TOUCH_PERIOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-1 text-[10px] text-p5/70 pb-1 cursor-pointer" title={t('stats.tip.cs_pc_hhhl')}>
            <input type="checkbox" checked={prefs.pcRequireHHHL} onChange={(e) => setPref({ pcRequireHHHL: e.target.checked })} />
            {t('stats.cs.pc_hhhl')}
          </label>
          <Field label={t('stats.cs.ff_stop')} tip={t('stats.tip.cs_ff_stop')}>
            <select className={inp} value={prefs.ffStopMode} onChange={(e) => setPref({ ffStopMode: e.target.value })}>
              <option value="both">{t('stats.cs.ff_stop_both')}</option>
              <option value="outside">{t('stats.cs.ff_stop_outside')}</option>
            </select>
          </Field>
          <Field label={t('stats.cs.ff_target')} tip={t('stats.tip.cs_ff_target')}>
            <select className={inp} value={prefs.ffFinalTarget} onChange={(e) => setPref({ ffFinalTarget: e.target.value })}>
              {['2R', 'middleBand', 'upperBand'].map((v) => <option key={v} value={v}>{t(`stats.cs.ff_target_${v}`)}</option>)}
            </select>
          </Field>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">{error}</p>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] text-p5/50">
            {result.scope === 'market'
              ? `${result.symbolsScanned}/${result.symbolsTotal} moedas`
              : result.symbol}
            {' · '}{result.interval} · {result.candles} {t('stats.cs.candles_unit')}
            {result.from && ` · ${formatDate(result.from)} → ${formatDate(result.to)} (BRT)`}
          </p>

          {/* Comparativo entre setups */}
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-p1">
                <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                  <th className="text-left pb-1 pr-2">{t('stats.cs.col.setup')}</th>
                  <th className={th}>{t('stats.cs.col.signals')}</th>
                  <th className={th}>{t('stats.cs.col.trades')}</th>
                  <th className={th}>{t('stats.cs.col.avg')}</th>
                  <th className={th}>{t('stats.cs.col.avg_r')}</th>
                  <th className={th}>{t('stats.cs.col.win')}</th>
                  <th className={th}>{t('stats.cs.col.pf')}</th>
                  <th className={th}>{t('stats.cs.col.t1')}</th>
                  <th className={th}>{t('stats.cs.col.tall')}</th>
                  <th className={th}>{t('stats.cs.col.stops')}</th>
                  <th className={th}>{t('stats.cs.col.pnl')}</th>
                  <th className={th}>{t('stats.cs.col.hold')}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((b) => {
                  const s = b.summary;
                  const blocked = b.blockedSmallRisk + b.blockedBigRisk;
                  const noFill = Object.values(b.notFilled).reduce((a, v) => a + v, 0);
                  return (
                    <tr
                      key={b.setup}
                      onClick={() => setDetailSetup(b.setup)}
                      className={`lt-table-row cursor-pointer hover:bg-p2/40 transition-colors ${b.setup === detailSetup ? 'bg-p2/60' : ''}`}
                    >
                      <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-bold whitespace-nowrap" title={t(`stats.cs.rule.${b.setup}`)}>{b.label}</td>
                      <td className={td} title={`${blocked} ${t('stats.cs.blocked_risk')} · ${noFill} ${t('stats.cs.not_filled')}`}>{b.signals}</td>
                      <td className={td}>{s.trades}</td>
                      <td className={`${td} font-bold ${tone(s.avgPnlPct)}`}>{signed(s.avgPnlPct, '%')}</td>
                      <td className={`${td} ${tone(s.avgR)}`}>{signed(s.avgR)}</td>
                      <td className={td}>{s.winRatePct != null ? `${s.winRatePct}%` : '—'}</td>
                      <td className={td}>{s.profitFactor ?? '—'}</td>
                      <td className={td}>{s.firstTargetPct != null ? `${s.firstTargetPct}%` : '—'}</td>
                      <td className={td}>{s.allTargetsPct != null ? `${s.allTargetsPct}%` : '—'}</td>
                      <td className={td}>{s.stop}</td>
                      <td className={`${td} ${tone(s.totalPnlUsd)}`}>{s.trades ? signed(s.totalPnlUsd) : '—'}</td>
                      <td className={td}>{formatDuration(s.avgHoldMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {detail && (
            <div className="flex flex-col gap-2 border-t border-p3/20 pt-2">
              <div>
                <p className="text-xs font-bold text-p5">{detail.label}</p>
                <p className="text-[10px] text-p5/60 leading-snug">{t(`stats.cs.rule.${detail.setup}`)}</p>
                <p className="text-[10px] text-p5/40 mt-0.5">
                  {detail.signals} {t('stats.cs.col.signals').toLowerCase()} · {detail.blockedSmallRisk + detail.blockedBigRisk} {t('stats.cs.blocked_risk')} · {Object.values(detail.notFilled).reduce((a, v) => a + v, 0)} {t('stats.cs.not_filled')}
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <div>
                  <p className="text-[9px] text-p5/50 uppercase tracking-wider mb-0.5">{t('stats.cs.by_risk')}</p>
                  <table className="border-collapse">
                    <thead>
                      <tr className="text-[9px] text-p5/40 uppercase lt-table-head">
                        <th className="text-left pb-1 pr-3">R</th>
                        <th className={th}>{t('stats.cs.col.trades')}</th>
                        <th className={th}>{t('stats.cs.col.win')}</th>
                        <th className={th}>{t('stats.cs.col.avg')}</th>
                        <th className={th}>{t('stats.cs.col.avg_r')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.riskBuckets.map((r) => (
                        <tr key={r.label} className="lt-table-row">
                          <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap">{r.label}</td>
                          <td className={td}>{r.trades}</td>
                          <td className={td}>{r.winRatePct != null ? `${r.winRatePct}%` : '—'}</td>
                          <td className={`${td} ${tone(r.avgPnlPct)}`}>{signed(r.avgPnlPct, '%')}</td>
                          <td className={`${td} ${tone(r.avgR)}`}>{signed(r.avgR)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {result.scope === 'market' && detail.bySymbol.length > 0 && (
                  <div className="max-h-48 overflow-auto">
                    <p className="text-[9px] text-p5/50 uppercase tracking-wider mb-0.5">{t('stats.cs.by_symbol')}</p>
                    <table className="border-collapse">
                      <thead className="sticky top-0 bg-p1">
                        <tr className="text-[9px] text-p5/40 uppercase lt-table-head">
                          <th className="text-left pb-1 pr-3">{t('stats.cs.col.pair')}</th>
                          <th className={th}>{t('stats.cs.col.trades')}</th>
                          <th className={th}>{t('stats.cs.col.win')}</th>
                          <th className={th}>{t('stats.cs.col.avg')}</th>
                          <th className={th}>{t('stats.cs.col.pnl')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.bySymbol.map((r) => (
                          <tr key={r.symbol} className="lt-table-row">
                            <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap">{r.symbol.replace(/USDT$/, '')}</td>
                            <td className={td}>{r.trades}</td>
                            <td className={td}>{r.winRatePct != null ? `${r.winRatePct}%` : '—'}</td>
                            <td className={`${td} ${tone(r.avgPnlPct)}`}>{signed(r.avgPnlPct, '%')}</td>
                            <td className={`${td} ${tone(r.totalPnlUsd)}`}>{signed(r.totalPnlUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {detailTrades.length === 0 ? (
                <p className="text-[11px] text-p5/50">{t('stats.cs.no_trades')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {sortTh(t('stats.cs.col.pair'), 'symbol', 'left')}
                        {sortTh(t('stats.cs.col.signal'), 'signalDate', 'left')}
                        <th className={th}>{t('stats.cs.col.entry')}</th>
                        {sortTh(t('stats.cs.col.risk'), 'riskPct')}
                        <th className="text-left pb-1 pr-2">{t('stats.cs.col.outcome')}</th>
                        {sortTh(t('stats.cs.col.r'), 'rNet')}
                        {sortTh(t('stats.cs.col.pnlpct'), 'pnlPct')}
                      </tr>
                    </thead>
                    <tbody>
                      {detailTrades.slice(0, DETAIL_ROWS_SHOWN).map((o, i) => (
                        <tr
                          key={`${o.symbol}-${o.signalDate}-${i}`}
                          title={t('stats.click_row')}
                          className="lt-table-row cursor-pointer hover:bg-p2/40 transition-colors"
                          onClick={() => openOnChart(o)}
                        >
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs whitespace-nowrap">
                            {o.symbol.replace(/USDT$/, '')}{o.source === 'gate' && <span className="ml-1 text-[8px] text-p5/40">G</span>}
                          </td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.signalDate)}</td>
                          <td className={td}>${price(o.entryPrice)}</td>
                          <td className={td}>{o.riskPct}%</td>
                          <td className={`py-0.5 pr-2 text-[10px] sm:text-xs whitespace-nowrap ${OUTCOME_STYLE[o.outcome] ?? ''}`}>
                            {t(`stats.cs.out.${o.outcome}`)}{o.outcome === 'partial' || o.outcome === 'target' ? ` ${o.targetsHit}/${o.targets.length}` : ''}
                          </td>
                          <td className={`${td} ${tone(o.rNet)}`}>{signed(o.rNet)}</td>
                          <td className={`${td} font-bold ${tone(o.pnlPct)}`}>{signed(o.pnlPct, '%')}</td>
                        </tr>
                      ))}
                      <tr className="lt-table-foot" aria-hidden="true"><td colSpan={7} className="h-px p-0 leading-none" /></tr>
                    </tbody>
                  </table>
                </div>
              )}
              {(result.occurrencesTruncated || detailTrades.length > DETAIL_ROWS_SHOWN) && (
                <p className="text-[10px] text-p5/40">{t('stats.cs.truncated')}</p>
              )}
            </div>
          )}

          {result.pending.length > 0 && (
            <div className="border-t border-p3/20 pt-2">
              <p className="text-[9px] text-p5/50 uppercase tracking-wider mb-0.5">{t('stats.cs.pending')}</p>
              <table className="border-collapse">
                <tbody>
                  {result.pending.map((p, i) => (
                    <tr key={`${p.symbol}-${p.setup}-${i}`} className="lt-table-row">
                      <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap">{p.symbol.replace(/USDT$/, '')}</td>
                      <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap" title={t(`stats.cs.rule.${p.setup}`)}>{SETUP_LABEL[p.setup]}</td>
                      <td className="py-0.5 pr-3 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(p.signalDate)}</td>
                      <td className={td}>▲ ${price(p.triggerPrice)}</td>
                      <td className={td}>▼ ${price(p.stopPrice)}</td>
                      <td className={td}>{p.riskPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[9px] text-p5/40 leading-snug">{t('stats.cs.disclaimer')}</p>
        </div>
      )}

      {!result && !error && !loading && (
        <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
      )}
    </div>
  );
}
