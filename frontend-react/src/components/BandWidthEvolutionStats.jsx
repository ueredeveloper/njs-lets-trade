import { useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import {
  fetchBandWidthEvolution, fetchCandlesticksAndCloud,
  saveBandWidthEvolutionSearch, getBandWidthEvolutionSearches, clearBandWidthEvolutionSearches,
} from '../services/api';
import { useI18n } from '../i18n';
import { CHART_VIEW } from '../utils/chartView';

/**
 * Estatísticas → aba "Evolução BB": evolução da largura das Bandas de Bollinger (%) candle a
 * candle ("de 1% pra 3%", "de 4% pra 10%") medida como GANHO relativo (razão atual÷fundo da
 * janela, ver computeBandWidthExpansion em backend/utils/indicatorGrowthEngines.js) — não um
 * cruzamento de patamar fixo escolhido a dedo, porque a largura "normal" varia demais de moeda pra
 * moeda pra um limiar único (ex. "2%→4%") fazer sentido no mercado inteiro; o que importa é o
 * ganho relativo (1%→2% e 5%→10% são o mesmo ganho de 100%). Aba isolada de propósito — é só um
 * instrumento de estudo pra decidir se um gatilho de "banda abriu rápido demais → afrouxa a
 * proximidade ao suporte no RSI Momentum" faz sentido, sem mexer na config validada daquela aba.
 */

const INTERVAL_OPTIONS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
const PERIOD_OPTIONS = [10, 20, 30];
const STD_DEV_OPTIONS = [1, 2, 3];
const LOOKBACK_OPTIONS = [20, 30, 40, 50, 100, 150, 200, 300, 500, 700];
const DELTA_CANDLES_OPTIONS = [1, 2, 3, 5, 8, 12, 20];
const MARKET_ROWS_SHOWN = 200;

const PREFS_KEY = 'lets_trade_stats_band_evolution_prefs';
const DEFAULT_PREFS = {
  scope: 'symbol',
  interval: '5m',
  period: 20,
  stdDev: 2,
  lookback: 200,
  deltaCandles: 3,
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage indisponível */ }
}

function formatDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const signed = (v, suffix = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${suffix}`);
const tone = (v) => (v == null || v === 0 ? 'text-p5/70' : v > 0 ? 'text-green-600' : 'text-red-600');

function Field({ label, tip, children }) {
  return (
    <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[64px]" title={tip}>
      <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function themeColors() {
  const s = getComputedStyle(document.documentElement);
  return { text: s.getPropertyValue('--color-p5').trim() || '#b3aca4' };
}

function evolutionChartOption(series, expansion, colors) {
  return {
    backgroundColor: 'transparent',
    grid: { top: 10, bottom: 24, left: 42, right: 10, containLabel: false },
    xAxis: {
      type: 'time',
      axisLabel: { color: colors.text, fontSize: 9, formatter: (v) => formatDateTime(v) },
      axisLine: { lineStyle: { color: colors.text + '40' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: colors.text, fontSize: 9, formatter: '{value}%' },
      splitLine: { lineStyle: { color: colors.text + '15' } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#003f69ee',
      textStyle: { color: '#fff', fontSize: 11 },
      formatter: (p) => `${formatDateTime(p[0].value[0])}<br/>Largura: <b>${p[0].value[1].toFixed(2)}%</b>`,
    },
    series: [
      {
        type: 'line',
        showSymbol: false,
        data: series.map((pt) => [pt.time, parseFloat(pt.widthPct.toFixed(3))]),
        lineStyle: { color: '#26a69a', width: 1.5 },
        areaStyle: { color: '#26a69a', opacity: 0.08 },
        markPoint: expansion ? {
          symbol: 'circle',
          symbolSize: 7,
          itemStyle: { color: '#f59e0b' },
          label: { show: false },
          data: [{
            name: 'fundo',
            coord: [expansion.troughTime, expansion.troughWidthPct],
          }],
        } : undefined,
        markLine: expansion ? {
          symbol: 'none',
          silent: true,
          label: { color: colors.text, fontSize: 9, formatter: () => `fundo ${expansion.troughWidthPct}%` },
          lineStyle: { type: 'dashed', color: '#f59e0b80' },
          data: [{ yAxis: expansion.troughWidthPct }],
        } : undefined,
      },
    ],
  };
}

export default function BandWidthEvolutionStats({ autoCalc, externalRequest }) {
  const { selectedChart, setSelectedChart, setChartViewSource } = useCurrency();
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [symbol, setSymbol] = useState(selectedChart?.symbol || 'BTCUSDT');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: 'gainPct', dir: -1 });
  const [themeTick, setThemeTick] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const lastExternalRequestId = useRef(null);

  useEffect(() => {
    const fn = () => setThemeTick((n) => n + 1);
    window.addEventListener('palette-updated', fn);
    return () => window.removeEventListener('palette-updated', fn);
  }, []);

  useEffect(() => {
    getBandWidthEvolutionSearches().then((arr) => setSavedCount(Array.isArray(arr) ? arr.length : 0)).catch(() => {});
  }, []);

  function handleClearLog() {
    clearBandWidthEvolutionSearches().then(() => setSavedCount(0)).catch(() => {});
  }

  const colors = useMemo(() => themeColors(), [themeTick]);
  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';

  function setPref(patch) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }

  async function handleSearch(overrideSymbol, anchor) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const scope = anchor ? 'symbol' : prefs.scope;
    const params = {
      interval: prefs.interval,
      period: prefs.period,
      stdDev: prefs.stdDev,
      lookback: prefs.lookback,
      deltaCandles: prefs.deltaCandles,
    };
    if (scope === 'symbol') {
      if (!sym) return;
      params.symbol = sym;
      if (anchor?.source) params.source = anchor.source;
      else if (selectedChart?.symbol === sym && selectedChart?.source === 'gate') params.source = 'gate';
      if (anchor?.fromMs != null && anchor?.toMs != null) {
        params.fromMs = anchor.fromMs;
        params.toMs = anchor.toMs;
      }
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchBandWidthEvolution(params);
      setResult(data);
      // Grava a pesquisa (config + resumo) no log do backend — fire-and-forget, não deve
      // quebrar a tela se o backend falhar em salvar.
      saveBandWidthEvolutionSearch({ scope, config: { ...params, symbol: scope === 'symbol' ? sym : null }, result: data })
        .then(() => setSavedCount((n) => n + 1))
        .catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Sincroniza o campo símbolo com o gráfico; com "Cálculo Automático" ligado, no escopo
  // "uma moeda" também recalcula — mesmo padrão das outras abas (a varredura de mercado é pesada
  // demais pra disparar sozinha).
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc && prefs.scope === 'symbol') handleSearch(selectedChart.symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart?.symbol, autoCalc]);

  // Pedido externo (botão "Evolução BB" do quadrado de trade no gráfico): busca ANCORADA no
  // período exato do trade em vez dos candles mais recentes até agora — ver getCandlesAroundTime.js
  // no backend. `requestId` (timestamp) garante 1 disparo por pedido, mesmo que o usuário saia e
  // volte pra esta aba sem um pedido novo (o mesmo objeto de pedido não deve rebuscar de novo).
  useEffect(() => {
    if (!externalRequest || externalRequest.requestId === lastExternalRequestId.current) return;
    lastExternalRequestId.current = externalRequest.requestId;
    setPref({ scope: 'symbol' });
    setSymbol(externalRequest.symbol);
    handleSearch(externalRequest.symbol, {
      fromMs: externalRequest.fromMs,
      toMs: externalRequest.toMs,
      source: externalRequest.source,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRequest]);

  async function openOnChart(sym, source) {
    try {
      const data = await fetchCandlesticksAndCloud(sym, prefs.interval, source ?? null);
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
    } catch (err) {
      console.warn('[band-width-evolution click]', err.message);
    }
  }

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'symbol' ? 1 : -1 }));
  }

  const EXPANSION_KEYS = new Set(['gainPct', 'ratio', 'minutesSinceTrough', 'troughWidthPct', 'velocityPpPerMin']);
  const rows = result?.rows
    ? [...result.rows].sort((a, b) => {
      const pick = (r) => (sort.key === 'symbol' ? r.symbol : (EXPANSION_KEYS.has(sort.key) ? r.expansion?.[sort.key] : r[sort.key]));
      const va = pick(a);
      const vb = pick(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
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

  const chartOption = result?.series
    ? evolutionChartOption(result.series, result.expansion, colors)
    : null;

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Controles */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap">
        <Field label="Escopo">
          <select className={inp} value={prefs.scope} onChange={(e) => setPref({ scope: e.target.value })}>
            <option value="symbol">Uma moeda</option>
            <option value="market">Mercado (todas as moedas)</option>
          </select>
        </Field>
        {prefs.scope === 'symbol' && (
          <Field label="Símbolo">
            <input
              className={inp}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Par"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </Field>
        )}
        <Field label={t('stats.entry_iv')}>
          <select className={inp} value={prefs.interval} onChange={(e) => setPref({ interval: e.target.value })}>
            {INTERVAL_OPTIONS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </Field>
        <Field label="Período BB">
          <select className={inp} value={prefs.period} onChange={(e) => setPref({ period: Number(e.target.value) })}>
            {PERIOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Desvio">
          <select className={inp} value={prefs.stdDev} onChange={(e) => setPref({ stdDev: Number(e.target.value) })}>
            {STD_DEV_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Candles" tip="Janela de candles buscada pra série/varredura.">
          <select className={inp} value={prefs.lookback} onChange={(e) => setPref({ lookback: Number(e.target.value) })}>
            {LOOKBACK_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
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
        {savedCount > 0 && (
          <button
            onClick={handleClearLog}
            title="Apaga o log de pesquisas salvas desta aba (backend/data/band-width-evolution-searches.json)"
            className="shrink-0 text-[10px] text-p5/40 hover:text-p5/70 underline"
          >
            {savedCount} salvas · Limpar log
          </button>
        )}
      </div>

      {/* Delta rápido (últimas N) */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap border border-p3/20 rounded p-2 bg-p2/30">
        <Field label="Delta últimas N" tip="Quantos candles atrás comparar com a largura atual (deltaPct = agora − N candles atrás).">
          <select className={inp} value={prefs.deltaCandles} onChange={(e) => setPref({ deltaCandles: Number(e.target.value) })}>
            {DELTA_CANDLES_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <p className="text-[9px] text-p5/40 leading-snug flex-1 min-w-[200px]">
          "Delta últimas N" é o crescimento recente instantâneo (pontos percentuais, agora − N
          candles atrás). O "ganho" abaixo é o GANHO relativo desde o fundo da janela buscada
          (atual ÷ fundo) — 1%→2% e 5%→10% contam como o mesmo ganho de 100%, independente do
          valor absoluto da moeda.
        </p>
      </div>

      {error && (
        <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">{error}</p>
      )}

      {/* Escopo símbolo: série + velocidade */}
      {result && prefs.scope === 'symbol' && result.series && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-p5/50">
            {result.symbol} · {result.interval} · BB({result.period},{result.stdDev}) · {result.series.length} amostras
            {result.anchored && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-p4/20 text-p4">
                período do quadrado: {formatDateTime(result.fromMs)} → {formatDateTime(result.toMs)}
              </span>
            )}
          </p>

          <div className="flex flex-wrap gap-3">
            <div className="border border-p3/20 rounded px-2 py-1.5">
              <p className="text-[9px] text-p5/50 uppercase tracking-wider">{result.deltaCandles} candles atrás</p>
              <p className="text-sm font-bold text-p5">{result.widthNCandlesAgo}%</p>
            </div>
            <div className="border border-p3/20 rounded px-2 py-1.5">
              <p className="text-[9px] text-p5/50 uppercase tracking-wider">Largura atual</p>
              <p className="text-sm font-bold text-p5">{result.currentWidthPct}%</p>
            </div>
            <div className="border border-p3/20 rounded px-2 py-1.5">
              <p className="text-[9px] text-p5/50 uppercase tracking-wider">Delta ({result.deltaCandles} candles)</p>
              <p className={`text-sm font-bold ${tone(result.deltaPct)}`}>{signed(result.deltaPct, ' pp')}</p>
            </div>
            <div className="border border-amber-500/40 bg-amber-500/5 rounded px-2 py-1.5">
              <p className="text-[9px] text-amber-600 uppercase tracking-wider">Fundo da janela</p>
              <p className="text-sm font-bold text-p5">
                {result.expansion?.troughWidthPct ?? '—'}% <span className="text-p5/40 font-normal">há {result.expansion?.minutesSinceTrough ?? '—'} min</span>
              </p>
            </div>
            <div className="border border-p3/20 rounded px-2 py-1.5">
              <p className="text-[9px] text-p5/50 uppercase tracking-wider">Ganho desde o fundo</p>
              <p className={`text-sm font-bold ${tone(result.expansion?.gainPct)}`}>
                {signed(result.expansion?.gainPct, '%')} {result.expansion?.ratio != null && `(${result.expansion.ratio}×)`}
              </p>
            </div>
            <div className="border border-p3/20 rounded px-2 py-1.5">
              <p className="text-[9px] text-p5/50 uppercase tracking-wider">Velocidade</p>
              <p className="text-sm font-bold text-p5">{result.expansion?.velocityPpPerMin != null ? `${result.expansion.velocityPpPerMin} pp/min` : '—'}</p>
            </div>
            {result.expansion?.rising && (
              <div className="border border-amber-500/50 bg-amber-500/10 rounded px-2 py-1.5">
                <p className="text-[9px] text-amber-600 uppercase tracking-wider">🔥 Ainda subindo</p>
                <p className="text-sm font-bold text-amber-600">{result.currentWidthPct}%</p>
              </div>
            )}
          </div>

          {chartOption && (
            <ReactECharts option={chartOption} style={{ height: 260, width: '100%' }} opts={{ renderer: 'canvas' }} />
          )}
        </div>
      )}

      {/* Escopo mercado: ranking por deltaPct */}
      {result && prefs.scope === 'market' && result.rows && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-p5/50">
            {result.rows.length} moedas · {result.interval} · BB({result.period},{result.stdDev}) · delta {result.deltaCandles} candles
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-p1">
                <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                  {sortTh('Par', 'symbol', 'left')}
                  {sortTh(`${prefs.deltaCandles} candles atrás`, 'widthNCandlesAgo')}
                  {sortTh('Larg. atual', 'currentWidthPct')}
                  {sortTh('Delta', 'deltaPct')}
                  {sortTh('Fundo (janela)', 'troughWidthPct')}
                  {sortTh('Ganho', 'gainPct')}
                  {sortTh('há (min)', 'minutesSinceTrough')}
                  <th className={th}>Subindo</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MARKET_ROWS_SHOWN).map((r) => (
                  <tr
                    key={r.symbol}
                    onClick={() => openOnChart(r.symbol)}
                    title={t('stats.click_row')}
                    className="lt-table-row cursor-pointer hover:bg-p2/40 transition-colors"
                  >
                    <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-bold whitespace-nowrap">{r.symbol.replace(/USDT$/, '')}</td>
                    <td className={td}>{r.widthNCandlesAgo}%</td>
                    <td className={td}>{r.currentWidthPct}%</td>
                    <td className={`${td} font-bold ${tone(r.deltaPct)}`}>{signed(r.deltaPct, ' pp')}</td>
                    <td className={td}>{r.expansion?.troughWidthPct ?? '—'}%</td>
                    <td className={`${td} font-bold ${tone(r.expansion?.gainPct)}`}>
                      {r.expansion?.gainPct != null ? `${signed(r.expansion.gainPct, '%')} (${r.expansion.ratio}×)` : '—'}
                    </td>
                    <td className={td}>{r.expansion?.minutesSinceTrough ?? '—'}</td>
                    <td className={td}>{r.expansion?.rising ? <span className="text-amber-600">🔥</span> : '—'}</td>
                  </tr>
                ))}
                <tr className="lt-table-foot" aria-hidden="true"><td colSpan={8} className="h-px p-0 leading-none" /></tr>
              </tbody>
            </table>
          </div>
          {result.rows.length > MARKET_ROWS_SHOWN && (
            <p className="text-[10px] text-p5/40">Mostrando as {MARKET_ROWS_SHOWN} primeiras (ordenadas por ganho desde o fundo).</p>
          )}
        </div>
      )}

      {!result && !error && !loading && (
        <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>
      )}

      <p className="text-[9px] text-p5/40 leading-snug">
        Instrumento de estudo isolado — sem ligação com o backtest/config do RSI Momentum. Serve pra
        avaliar se um gatilho de "banda abriu rápido demais → afrouxa a proximidade ao suporte" faz
        sentido antes de portar pra lá.
      </p>
    </div>
  );
}
