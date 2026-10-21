import { useState, useEffect } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchFlagBacktest, fetchCandlesticksAndCloud } from '../services/api';
import { useI18n } from '../i18n';
import { CHART_VIEW } from '../utils/chartView';

/**
 * Estatísticas → aba "Bandeiras": estudo de entrada por bandeira de alta e de baixa (4h por padrão).
 * Motor: backend/utils/analyseFlagBacktest.js (mesmas regras do botão "Band." do gráfico —
 * backend/bot/flags/detectFlags.js espelha frontend-react/src/utils/detectFlags.js).
 *
 * Compara, lado a lado, 3 momentos de entrada (fechamento do rompimento / abertura seguinte /
 * reteste do nível rompido), o alvo ideal em frações do measured move e onde o padrão funciona
 * (tamanho do mastro, retração, duração da bandeira, HTF). Bandeira de baixa = short TEÓRICO.
 */

const DIRS = ['bull', 'bear'];
const DIR_LABEL = { bull: 'Alta', bear: 'Baixa' };
const MODES = ['close', 'nextOpen', 'retest'];
const MODE_LABEL = { close: 'Fechamento do rompimento', nextOpen: 'Abertura seguinte', retest: 'Reteste do rompimento' };
const MODE_TIP = {
  close: 'Entra no FECHAMENTO do candle que rompeu o canal da bandeira (o gatilho clássico de Edwards & Magee / Bulkowski).',
  nextOpen: 'Entra na ABERTURA do candle seguinte ao rompimento — o que um bot que decide no fechamento consegue executar de fato.',
  retest: 'Ordem LIMITE no nível rompido (topo da bandeira na alta / fundo na baixa), esperando o pullback por N candles. Preço melhor, mas perde os rompimentos que disparam sem voltar.',
};

const INTERVAL_OPTIONS = ['15m', '30m', '1h', '4h', '8h', '1d'];
const CANDLE_COUNT_OPTIONS = [500, 1000, 2000, 3000];
const VOLUME_OPTIONS = [0, 1_000_000, 2_000_000, 5_000_000, 30_000_000, 100_000_000];
const TARGET_OPTIONS = [0.5, 0.75, 1, 1.5, 2];
const HOLD_OPTIONS = [0, 12, 30, 60, 120];
const RETEST_OPTIONS = [2, 3, 6, 12];
const STOP_PCT_OPTIONS = [2, 3, 5, 8, 10];
const FEE_OPTIONS = [0, 0.075, 0.1];
const SLIP_OPTIONS = [0, 0.02, 0.05, 0.1];
const POLE_GAIN_OPTIONS = [4, 6, 8, 10, 15, 20];
const POLE_BARS_OPTIONS = [6, 8, 12, 16, 20];
const RETRACE_OPTIONS = [0.38, 0.5, 0.62];
const MAX_FLAG_BARS_OPTIONS = [10, 15, 20, 30];
const DETAIL_ROWS_SHOWN = 300;

const PREFS_KEY = 'lets_trade_stats_flags_prefs';
const DEFAULT_PREFS = {
  scope: 'market',
  interval: '4h',
  candleCount: 3000,
  minVolumeUsdt: 5_000_000,
  includeGate: false,
  directions: ['bull', 'bear'],
  entryModes: ['close', 'nextOpen', 'retest'],
  retestCandles: 6,
  stopMode: 'flag',
  stopPct: 5,
  targetFrac: 1,
  maxHoldCandles: 30,
  feePct: 0.1,
  slippagePct: 0.05,
  positionSizeUsd: 40,
  minPoleGainPct: 6,
  maxPoleBars: 12,
  maxRetracePct: 0.5,
  maxFlagBars: 20,
  onlyTight: false,
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      directions: Array.isArray(parsed.directions) ? parsed.directions.filter((d) => DIRS.includes(d)) : DEFAULT_PREFS.directions,
      entryModes: Array.isArray(parsed.entryModes) ? parsed.entryModes.filter((m) => MODES.includes(m)) : DEFAULT_PREFS.entryModes,
    };
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
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${minutes % 60}m`;
}

function formatVolume(v) {
  if (!v) return '0';
  if (v >= 1e6) return `${v / 1e6}M`;
  return `${v / 1e3}K`;
}

const signed = (v, suffix = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${suffix}`);
const tone = (v) => (v == null || v === 0 ? 'text-p5/70' : v > 0 ? 'text-green-600' : 'text-red-600');
const price = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
const pct = (v) => (v != null ? `${v}%` : '—');

const OUTCOME = {
  target: { label: 'Alvo', cls: 'text-green-600' },
  stop: { label: 'Stop', cls: 'text-red-600' },
  time: { label: 'Tempo', cls: 'text-p5/60' },
  open: { label: 'Aberto', cls: 'text-amber-700 italic' },
};

const BUCKET_TITLES = {
  poleGain: 'Por tamanho do mastro',
  retrace: 'Por retração da bandeira',
  flagBars: 'Por duração da bandeira (candles)',
  tight: 'HTF × comum',
};

function Field({ label, tip, children }) {
  return (
    <div className="flex flex-col gap-0 md:gap-0.5 flex-1 min-w-[64px]" title={tip}>
      <label className="hidden md:block text-[9px] text-p5/50 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function Chip({ active, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
        active ? 'bg-p4 border-p4 text-white' : 'border-p3/40 text-p5/60 hover:text-p5'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Cartão do trade clicado: como a entrada, o stop e o alvo foram calculados (o mesmo OCO que o
 * gráfico desenha), com distâncias em % e a relação risco:retorno planejada.
 */
function TradeOcoCard({ o, reasons, onClose }) {
  const entry = o.forming ? o.triggerPrice : o.entryPrice;
  const dist = (p) => signed(Number((((p / entry) - 1) * 100).toFixed(2)), '%');
  const risk = Math.abs(entry - o.stopPrice);
  const reward = Math.abs(o.targetPrice - entry);
  const rr = risk > 0 ? (reward / risk).toFixed(2) : '—';
  const isBull = o.dir === 'bull';
  const breakout = o.flag.breakout?.price;
  const row = 'flex flex-wrap gap-x-2 items-baseline';
  return (
    <div className="border border-p3/30 rounded p-2 bg-p2/40 text-[10px] sm:text-xs flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className={`font-bold ${isBull ? 'text-green-600' : 'text-red-600'}`}>
          {isBull ? '▲' : '▼'} {o.symbol.replace(/USDT$/, '')} · {isBull ? 'Bandeira de alta' : 'Bandeira de baixa (short teórico)'}{o.tight ? ' · HTF' : ''}
        </span>
        <span className="text-p5/50">{o.forming ? 'em formação — OCO planejado' : `${MODE_LABEL[o.mode]} · ${formatDate(o.signalDate)}`}</span>
        <button onClick={onClose} className="ml-auto text-p5/40 hover:text-p5" title="Fechar">✕</button>
      </div>
      <div className={row}>
        <span className="text-p5/50 w-12">Padrão</span>
        <span>mastro {o.poleGainPct}% (altura ${price(reasons.poleH)}) · bandeira {o.flagBars} candles devolvendo {o.retracePct}% do mastro</span>
      </div>
      <div className={row}>
        <span className="text-p5/50 w-12">{o.forming ? 'Gatilho' : 'Entrada'}</span>
        <span className="font-mono">${price(entry)}</span>
        <span className="text-p5/60">
          {o.forming
            ? `fechamento ${isBull ? 'acima' : 'abaixo'} do canal e do ${isBull ? 'topo' : 'fundo'} da bandeira`
            : o.mode === 'retest' ? `limite no ${isBull ? 'topo' : 'fundo'} rompido da bandeira`
              : o.mode === 'nextOpen' ? 'abertura do candle seguinte ao rompimento' : 'fechamento do candle de rompimento'}
          {!o.forming && breakout != null && o.mode !== 'close' && ` (rompeu em $${price(breakout)})`}
        </span>
      </div>
      <div className={row}>
        <span className="text-red-600 w-12">Stop</span>
        <span className="font-mono">${price(o.stopPrice)}</span>
        <span className="text-red-600">{dist(o.stopPrice)}</span>
        <span className="text-p5/60">= {reasons.stopWhy}</span>
      </div>
      <div className={row}>
        <span className="text-green-600 w-12">Alvo</span>
        <span className="font-mono">${price(o.targetPrice)}</span>
        <span className="text-green-600">{dist(o.targetPrice)}</span>
        <span className="text-p5/60">
          = rompimento {breakout != null ? `$${price(breakout)} ` : ''}{isBull ? '+' : '−'} {reasons.targetWhy} (measured move)
        </span>
      </div>
      <div className={row}>
        <span className="text-p5/50 w-12">R:R</span>
        <span className="font-mono">1 : {rr}</span>
        {!o.forming && (
          <span className={OUTCOME[o.outcome]?.cls ?? ''}>
            → {OUTCOME[o.outcome]?.label ?? o.outcome} {o.exitDate ? `em ${formatDate(o.exitDate)}` : ''} a ${price(o.exitPrice)} · {signed(o.pnlPct, '%')} ({signed(o.rNet)}R, já com taxas) · alcançou {o.reachMM}× do mastro
          </span>
        )}
      </div>
    </div>
  );
}

export default function FlagStats({ autoCalc }) {
  const {
    selectedChart, setSelectedChart, setChartZoom, setChartViewSource, setChartTradeMarkers, setChartSrOverride, setChartFlagsOverride,
  } = useCurrency();
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [symbol, setSymbol] = useState(selectedChart?.symbol || 'BTCUSDT');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [detailKey, setDetailKey] = useState(null);
  const [sort, setSort] = useState({ key: 'signalDate', dir: -1 });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-1 focus:outline-none focus:border-p4 w-full';

  function setPref(patch) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }

  const toggleIn = (key, id) => setPref({ [key]: prefs[key].includes(id) ? prefs[key].filter((x) => x !== id) : [...prefs[key], id] });

  async function handleSearch(overrideSymbol) {
    if (!prefs.directions.length || !prefs.entryModes.length) { setError('Escolha ao menos uma direção e um modo de entrada.'); return; }
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    const params = {
      interval: prefs.interval,
      candleCount: prefs.candleCount,
      directions: DIRS.filter((d) => prefs.directions.includes(d)).join(','),
      entryModes: MODES.filter((m) => prefs.entryModes.includes(m)).join(','),
      retestCandles: prefs.retestCandles,
      stopMode: prefs.stopMode,
      stopPct: prefs.stopPct,
      targetFrac: prefs.targetFrac,
      maxHoldCandles: prefs.maxHoldCandles,
      feePct: prefs.feePct,
      slippagePct: prefs.slippagePct,
      positionSizeUsd: prefs.positionSizeUsd,
      minPoleGainPct: prefs.minPoleGainPct,
      maxPoleBars: prefs.maxPoleBars,
      maxRetracePct: prefs.maxRetracePct,
      maxFlagBars: prefs.maxFlagBars,
      onlyTight: prefs.onlyTight ? 1 : 0,
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
    setSelectedTrade(null);
    try {
      const data = await fetchFlagBacktest(params);
      const best = [...data.groups].filter((g) => g.summary.trades > 0).sort((a, b) => b.summary.avgPnlPct - a.summary.avgPnlPct)[0];
      setDetailKey(best?.key ?? data.groups[0]?.key ?? null);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Mesma regra da aba Setups: autoCalc só recalcula sozinho no escopo "uma moeda".
  useEffect(() => {
    if (!selectedChart?.symbol) return;
    setSymbol(selectedChart.symbol);
    if (autoCalc && prefs.scope === 'symbol') handleSearch(selectedChart.symbol);
  }, [selectedChart?.symbol, autoCalc]);

  /** Por que o stop/alvo ficaram onde ficaram — mesmo texto no gráfico (OCO) e no cartão. */
  function levelReasons(o) {
    const opts = result.options;
    const poleH = Math.abs(o.flag.poleEnd.price - o.flag.poleStart.price);
    const stopWhy = opts.stopMode === 'pct'
      ? `${opts.stopPct}% fixo`
      : opts.stopMode === 'channel'
        ? `linha ${o.dir === 'bull' ? 'inferior' : 'superior'} do canal`
        : `${o.dir === 'bull' ? 'fundo' : 'topo'} da bandeira`;
    return { poleH, stopWhy, targetWhy: `${opts.targetFrac}× mastro` };
  }

  /** Abre no gráfico a bandeira EXATA do backtest (override) + OCO alvo/stop + marcadores. */
  async function openOnChart(o, { forming = false } = {}) {
    const fromMs = new Date(o.poleStartDate).getTime();
    const toMs = o.lastDate ? new Date(o.lastDate).getTime() : Date.now();
    const { stopWhy, targetWhy } = levelReasons(o);
    setSelectedTrade({ ...o, forming });
    try {
      const src = o.source === 'gate' ? 'gate' : (selectedChart?.symbol === o.symbol ? (selectedChart?.source ?? null) : null);
      const data = await fetchCandlesticksAndCloud(o.symbol, result.interval, src, undefined, { fromMs, toMs, pad: 100 });
      setSelectedChart(data);
      setChartViewSource(CHART_VIEW.STATISTICS);
      setChartSrOverride(null);
      let markers = [];
      let oco;
      if (!forming) {
        const entryMs = new Date(o.entryDate).getTime();
        const side = o.dir === 'bull' ? ['buy', 'sell'] : ['sell', 'buy'];
        markers = [{ time: entryMs, side: side[0], price: o.entryPrice, label: o.dir === 'bull' ? '▲ Entrada' : '▼ Entrada (short)' }];
        if (o.exitDate) {
          // Sem entryTime/entryPrice: o retângulo do trade é o OCO abaixo (o quadrado genérico
          // entrada→saída pinta pelo sentido da compra e ficaria errado no short).
          markers.push({
            time: new Date(o.exitDate).getTime(), side: side[1], price: o.exitPrice,
            label: `${OUTCOME[o.outcome]?.label ?? o.outcome} ${signed(o.pnlPct, '%')}`,
          });
        }
        oco = {
          entryMs, exitMs: new Date(o.lastDate).getTime(),
          entryPrice: o.entryPrice, stopPrice: o.stopPrice, targetPrice: o.targetPrice,
          outcome: o.outcome, pnlPct: o.pnlPct, stopWhy, targetWhy,
        };
      } else {
        // Bandeira em formação: OCO PLANEJADO a partir do gatilho, cobrindo a bandeira até o último
        // candle (começa no início da bandeira pra não ficar fino quando ela termina no último candle).
        oco = {
          entryMs: o.flag.channel[0].time, exitMs: new Date(o.lastDate).getTime(),
          entryPrice: o.triggerPrice, stopPrice: o.stopPrice, targetPrice: o.targetPrice,
          outcome: 'planned', pnlPct: null, stopWhy, targetWhy,
        };
      }
      setChartTradeMarkers(markers);
      setChartFlagsOverride({ flags: [o.flag], markers, oco });
      setChartZoom({ source: CHART_VIEW.STATISTICS, startDate: o.poleStartDate, endDate: new Date(toMs).toISOString() });
    } catch (err) {
      console.warn('[flag stats click]', err.message);
    }
  }

  const isSelected = (o) => !!selectedTrade && selectedTrade.symbol === o.symbol && selectedTrade.dir === o.dir
    && selectedTrade.mode === o.mode && selectedTrade.signalDate === o.signalDate && selectedTrade.flagStartDate === o.flagStartDate;

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'symbol' ? 1 : -1 }));
  }

  const ranked = result ? [...result.groups].sort((a, b) => (b.summary.avgPnlPct ?? -Infinity) - (a.summary.avgPnlPct ?? -Infinity)) : [];
  const detail = result?.groups.find((g) => g.key === detailKey) ?? null;
  const detailTrades = result && detail
    ? result.occurrences.filter((o) => o.group === detail.key).sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0);
      return cmp * sort.dir;
    })
    : [];
  const bestTarget = detail
    ? [...detail.targetStudy].filter((r) => r.avgPnlPct != null).sort((a, b) => b.avgPnlPct - a.avgPnlPct)[0]
    : null;

  const sortTh = (label, k, align = 'right') => (
    <th key={k} onClick={() => toggleSort(k)} className={`${align === 'right' ? 'text-right' : 'text-left'} pb-1 pr-2 cursor-pointer select-none hover:text-p5`}>
      {label}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const th = 'text-right pb-1 pr-2';
  const td = 'py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono whitespace-nowrap';
  const skipCount = (g) => Object.values(g.notFilled).reduce((a, v) => a + v, 0);

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Controles */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap">
        <Field label="Escopo">
          <select className={inp} value={prefs.scope} onChange={(e) => setPref({ scope: e.target.value })}>
            <option value="market">Mercado USDT</option>
            <option value="symbol">Uma moeda</option>
          </select>
        </Field>
        {prefs.scope === 'symbol' ? (
          <Field label="Símbolo">
            <input className={inp} value={symbol} placeholder="Par"
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          </Field>
        ) : (
          <>
            <Field label="Volume 24h mín.">
              <select className={inp} value={prefs.minVolumeUsdt} onChange={(e) => setPref({ minVolumeUsdt: Number(e.target.value) })}>
                {VOLUME_OPTIONS.map((v) => <option key={v} value={v}>{v ? `≥ $${formatVolume(v)}` : '—'}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-1 text-[10px] text-p5/70 pb-1 cursor-pointer">
              <input type="checkbox" checked={prefs.includeGate} onChange={(e) => setPref({ includeGate: e.target.checked })} />
              + Gate (G)
            </label>
          </>
        )}
        <Field label="Intervalo" tip="Padrão do estudo: 4h.">
          <select className={inp} value={prefs.interval} onChange={(e) => setPref({ interval: e.target.value })}>
            {INTERVAL_OPTIONS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
          </select>
        </Field>
        <Field label="Candles" tip="Histórico por moeda (3000 × 4h ≈ 500 dias).">
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

      {/* Direções e momentos de entrada */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[9px] text-p5/50 uppercase tracking-wider mr-1">Bandeira</span>
        {DIRS.map((d) => (
          <Chip key={d} active={prefs.directions.includes(d)} onClick={() => toggleIn('directions', d)}
            title={d === 'bear' ? 'Bandeira de baixa = venda a descoberto TEÓRICA (spot não opera short). Serve pra medir o padrão e como alerta de saída.' : 'Bandeira de alta = compra.'}>
            {d === 'bull' ? '▲ Alta' : '▼ Baixa'}
          </Chip>
        ))}
        <span className="text-[9px] text-p5/50 uppercase tracking-wider ml-3 mr-1">Entrada</span>
        {MODES.map((m) => (
          <Chip key={m} active={prefs.entryModes.includes(m)} onClick={() => toggleIn('entryModes', m)} title={MODE_TIP[m]}>
            {MODE_LABEL[m]}
          </Chip>
        ))}
        <button onClick={() => setShowHelp((v) => !v)} className="ml-auto text-[10px] text-p5/50 hover:text-p5 underline">
          Como funciona {showHelp ? '▲' : '▼'}
        </button>
        <button onClick={() => setShowAdvanced((v) => !v)} className="text-[10px] text-p5/50 hover:text-p5 underline">
          Padrão {showAdvanced ? '▲' : '▼'}
        </button>
      </div>

      {/* Saída, custos */}
      <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap">
        <Field label="Stop" tip="Fundo da bandeira (alta) / topo (baixa) · linha oposta do canal no rompimento · % fixo da entrada.">
          <select className={inp} value={prefs.stopMode} onChange={(e) => setPref({ stopMode: e.target.value })}>
            <option value="flag">Extremo da bandeira</option>
            <option value="channel">Linha do canal</option>
            <option value="pct">% fixo</option>
          </select>
        </Field>
        {prefs.stopMode === 'pct' && (
          <Field label="Stop %">
            <select className={inp} value={prefs.stopPct} onChange={(e) => setPref({ stopPct: Number(e.target.value) })}>
              {STOP_PCT_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
          </Field>
        )}
        <Field label="Alvo (× mastro)" tip="Measured move: altura do mastro × fração, projetada a partir do preço de rompimento.">
          <select className={inp} value={prefs.targetFrac} onChange={(e) => setPref({ targetFrac: Number(e.target.value) })}>
            {TARGET_OPTIONS.map((v) => <option key={v} value={v}>{v}×</option>)}
          </select>
        </Field>
        <Field label="Máx. candles" tip="Fecha a mercado após N candles sem alvo/stop (30 × 4h = 5 dias).">
          <select className={inp} value={prefs.maxHoldCandles} onChange={(e) => setPref({ maxHoldCandles: Number(e.target.value) })}>
            {HOLD_OPTIONS.map((v) => <option key={v} value={v}>{v || 'sem limite'}</option>)}
          </select>
        </Field>
        <Field label="Espera reteste" tip="Quantos candles a ordem limite do reteste fica armada.">
          <select className={inp} value={prefs.retestCandles} onChange={(e) => setPref({ retestCandles: Number(e.target.value) })}>
            {RETEST_OPTIONS.map((v) => <option key={v} value={v}>{v} candles</option>)}
          </select>
        </Field>
        <Field label="Taxa %" tip="Por lado.">
          <select className={inp} value={prefs.feePct} onChange={(e) => setPref({ feePct: Number(e.target.value) })}>
            {FEE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Slippage %" tip="Por lado.">
          <select className={inp} value={prefs.slippagePct} onChange={(e) => setPref({ slippagePct: Number(e.target.value) })}>
            {SLIP_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Posição $">
          <input type="number" min="1" className={inp} value={prefs.positionSizeUsd}
            onChange={(e) => setPref({ positionSizeUsd: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
      </div>

      {showAdvanced && (
        <div className="flex flex-row gap-1 md:gap-2 items-end w-full flex-wrap border border-p3/20 rounded p-2 bg-p2/30">
          <Field label="Mastro mín. %" tip="Impulso mínimo do mastro.">
            <select className={inp} value={prefs.minPoleGainPct} onChange={(e) => setPref({ minPoleGainPct: Number(e.target.value) })}>
              {POLE_GAIN_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
          </Field>
          <Field label="Mastro em até" tip="Candles máximos do mastro (tem que ser íngreme: ≥1,1%/candle).">
            <select className={inp} value={prefs.maxPoleBars} onChange={(e) => setPref({ maxPoleBars: Number(e.target.value) })}>
              {POLE_BARS_OPTIONS.map((v) => <option key={v} value={v}>{v} candles</option>)}
            </select>
          </Field>
          <Field label="Retração máx." tip="Quanto do mastro a bandeira pode devolver (Bulkowski: ideal ≤ 38%).">
            <select className={inp} value={prefs.maxRetracePct} onChange={(e) => setPref({ maxRetracePct: Number(e.target.value) })}>
              {RETRACE_OPTIONS.map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
            </select>
          </Field>
          <Field label="Bandeira até" tip="Duração máxima da bandeira (mín. 4 candles).">
            <select className={inp} value={prefs.maxFlagBars} onChange={(e) => setPref({ maxFlagBars: Number(e.target.value) })}>
              {MAX_FLAG_BARS_OPTIONS.map((v) => <option key={v} value={v}>{v} candles</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-1 text-[10px] text-p5/70 pb-1 cursor-pointer" title="Só high, tight flag (O'Neil/Bulkowski): mastro ≥ 40% com retração ≤ 25%.">
            <input type="checkbox" checked={prefs.onlyTight} onChange={(e) => setPref({ onlyTight: e.target.checked })} />
            Só HTF
          </label>
        </div>
      )}

      {showHelp && (
        <div className="text-[10px] text-p5/70 leading-snug border border-p3/20 rounded p-2 bg-p2/30 flex flex-col gap-1">
          <p><b>Padrão</b> (mesmo do botão "Band." do gráfico): mastro = impulso ≥ X% em poucos candles, quase reto; bandeira = 4–20 candles de consolidação levemente contra a tendência, devolvendo ≤ 50% do mastro, com volume menor que o do mastro. Confirma quando um candle FECHA rompendo o canal e o extremo da bandeira.</p>
          <p><b>Momento de entrada</b>: cada bandeira confirmada é simulada nos 3 modos marcados — a tabela de cima mostra qual paga mais por trade.</p>
          <p><b>Estudo de alvo</b>: o mesmo trade é refeito com o alvo em 0,25× … 2× a altura do mastro — mostra quantos chegam lá antes do stop e qual fração rende mais na média.</p>
          <p><b>Execução conservadora</b>: no mesmo candle o stop vence o alvo; gap executa na abertura. A bandeira de baixa é simulada como short teórico — no spot, use como sinal pra não comprar / sair.</p>
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">{error}</p>}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] text-p5/50">
            {result.scope === 'market' ? `${result.symbolsScanned}/${result.symbolsTotal} moedas` : result.symbol}
            {' · '}{result.interval} · {result.candles} candles
            {result.from && ` · ${formatDate(result.from)} → ${formatDate(result.to)} (BRT)`}
            {' · '}{result.patterns.bull} bandeiras de alta · {result.patterns.bear} de baixa
          </p>
          {result.studyFile ? (
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-p5/50 -mt-2">
              <a
                href={`/services/flag-backtest/studies/${encodeURIComponent(result.studyFile)}`}
                download={result.studyFile}
                className="px-2 py-0.5 rounded border border-p3/40 text-p5/80 hover:text-p5 hover:border-p4"
                title="Todas as moedas simuladas: config, agregados e, por moeda, cada bandeira com o resultado de cada momento de entrada e o estudo de alvo."
              >
                ⬇ Baixar JSON
              </a>
              <span>salvo em backend/data/flag-studies/{result.studyFile}</span>
            </div>
          ) : (
            <p className="text-[10px] text-amber-600 -mt-2">Não foi possível gravar o JSON de estudo no servidor (veja o log do backend).</p>
          )}

          {/* Comparativo: direção × momento de entrada */}
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-p1">
                <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                  <th className="text-left pb-1 pr-2">Bandeira</th>
                  <th className="text-left pb-1 pr-2">Entrada</th>
                  <th className={th}>Trades</th>
                  <th className={th} title="P&L médio por trade, já com taxas.">Média</th>
                  <th className={th}>Mediana</th>
                  <th className={th}>Média R</th>
                  <th className={th}>Acerto</th>
                  <th className={th}>PF</th>
                  <th className={th}>Alvos</th>
                  <th className={th}>Stops</th>
                  <th className={th}>Tempo</th>
                  <th className={th} title="Quanto do measured move o preço andou a favor antes do stop, em média.">Alcance</th>
                  <th className={th}>Risco</th>
                  <th className={th}>Duração</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((g) => {
                  const s = g.summary;
                  return (
                    <tr key={g.key} onClick={() => setDetailKey(g.key)}
                      className={`lt-table-row cursor-pointer hover:bg-p2/40 transition-colors ${g.key === detailKey ? 'bg-p2/60' : ''}`}>
                      <td className={`py-0.5 pr-2 text-[10px] sm:text-xs font-bold whitespace-nowrap ${g.dir === 'bull' ? 'text-green-600' : 'text-red-600'}`}>
                        {g.dir === 'bull' ? '▲' : '▼'} {DIR_LABEL[g.dir]}
                      </td>
                      <td className="py-0.5 pr-2 text-[10px] sm:text-xs whitespace-nowrap" title={MODE_TIP[g.mode]}>{MODE_LABEL[g.mode]}</td>
                      <td className={td} title={`${g.patterns} bandeiras · ${skipCount(g)} sem entrada`}>{s.trades}</td>
                      <td className={`${td} font-bold ${tone(s.avgPnlPct)}`}>{signed(s.avgPnlPct, '%')}</td>
                      <td className={`${td} ${tone(s.medianPnlPct)}`}>{signed(s.medianPnlPct, '%')}</td>
                      <td className={`${td} ${tone(s.avgR)}`}>{signed(s.avgR)}</td>
                      <td className={td}>{pct(s.winRatePct)}</td>
                      <td className={td}>{s.profitFactor ?? '—'}</td>
                      <td className={td}>{s.target}</td>
                      <td className={td}>{s.stop}</td>
                      <td className={td}>{s.time}</td>
                      <td className={td}>{s.avgReachMM != null ? `${s.avgReachMM}×` : '—'}</td>
                      <td className={td}>{pct(s.avgRiskPct)}</td>
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
                <p className="text-[10px] text-p5/60 leading-snug">{MODE_TIP[detail.mode]}</p>
                <p className="text-[10px] text-p5/40 mt-0.5">
                  {detail.patterns} bandeiras confirmadas · {detail.summary.trades} entradas
                  {detail.mode === 'retest' && ` · ${detail.notFilled.expired} sem pullback no prazo · ${detail.notFilled.ran} foram ao alvo sem voltar`}
                  {detail.notFilled.invalid > 0 && ` · ${detail.notFilled.invalid} descartadas (gap além do stop/alvo)`}
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                {/* Estudo de alvo */}
                <div>
                  <p className="text-[9px] text-p5/50 uppercase tracking-wider mb-0.5">Alvo ideal (× altura do mastro)</p>
                  <table className="border-collapse">
                    <thead>
                      <tr className="text-[9px] text-p5/40 uppercase lt-table-head">
                        <th className="text-left pb-1 pr-3">Alvo</th>
                        <th className={th} title="% dos trades que chegaram ao alvo antes do stop.">Chegou</th>
                        <th className={th}>Acerto</th>
                        <th className={th}>Média</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.targetStudy.map((r) => (
                        <tr key={r.frac} className={`lt-table-row ${bestTarget?.frac === r.frac ? 'bg-green-500/10' : ''}`}>
                          <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap">{r.frac}×{bestTarget?.frac === r.frac ? ' ★' : ''}</td>
                          <td className={td}>{pct(r.hitPct)}</td>
                          <td className={td}>{pct(r.winRatePct)}</td>
                          <td className={`${td} ${tone(r.avgPnlPct)}`}>{signed(r.avgPnlPct, '%')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {Object.entries(detail.buckets).map(([k, rows]) => (
                  <div key={k}>
                    <p className="text-[9px] text-p5/50 uppercase tracking-wider mb-0.5">{BUCKET_TITLES[k]}</p>
                    <table className="border-collapse">
                      <thead>
                        <tr className="text-[9px] text-p5/40 uppercase lt-table-head">
                          <th className="text-left pb-1 pr-3">Faixa</th>
                          <th className={th}>Trades</th>
                          <th className={th}>Acerto</th>
                          <th className={th}>Média</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.label} className="lt-table-row">
                            <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap">{r.label}</td>
                            <td className={td}>{r.trades}</td>
                            <td className={td}>{pct(r.winRatePct)}</td>
                            <td className={`${td} ${tone(r.avgPnlPct)}`}>{signed(r.avgPnlPct, '%')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

                {result.scope === 'market' && detail.bySymbol.length > 0 && (
                  <div className="max-h-48 overflow-auto">
                    <p className="text-[9px] text-p5/50 uppercase tracking-wider mb-0.5">Por moeda</p>
                    <table className="border-collapse">
                      <thead className="sticky top-0 bg-p1">
                        <tr className="text-[9px] text-p5/40 uppercase lt-table-head">
                          <th className="text-left pb-1 pr-3">Par</th>
                          <th className={th}>Trades</th>
                          <th className={th}>Acerto</th>
                          <th className={th}>Média</th>
                          <th className={th}>P&L $</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.bySymbol.map((r) => (
                          <tr key={r.symbol} className="lt-table-row">
                            <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap">{r.symbol.replace(/USDT$/, '')}</td>
                            <td className={td}>{r.trades}</td>
                            <td className={td}>{pct(r.winRatePct)}</td>
                            <td className={`${td} ${tone(r.avgPnlPct)}`}>{signed(r.avgPnlPct, '%')}</td>
                            <td className={`${td} ${tone(r.totalPnlUsd)}`}>{signed(r.totalPnlUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {selectedTrade && !selectedTrade.forming && (
                <TradeOcoCard o={selectedTrade} reasons={levelReasons(selectedTrade)} onClose={() => setSelectedTrade(null)} />
              )}
              {detailTrades.length === 0 ? (
                <p className="text-[11px] text-p5/50">Nenhuma entrada nesse grupo.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-p1">
                      <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider lt-table-head">
                        {sortTh('Par', 'symbol', 'left')}
                        {sortTh('Rompimento', 'signalDate', 'left')}
                        {sortTh('Mastro', 'poleGainPct')}
                        {sortTh('Retr.', 'retracePct')}
                        {sortTh('Band.', 'flagBars')}
                        <th className={th}>Entrada</th>
                        {sortTh('Risco', 'riskPct')}
                        <th className="text-left pb-1 pr-2">Saída</th>
                        {sortTh('Alcance', 'reachMM')}
                        {sortTh('R', 'rNet')}
                        {sortTh('P&L %', 'pnlPct')}
                      </tr>
                    </thead>
                    <tbody>
                      {detailTrades.slice(0, DETAIL_ROWS_SHOWN).map((o, i) => (
                        <tr key={`${o.symbol}-${o.signalDate}-${i}`} title={t('stats.click_row')}
                          className={`lt-table-row cursor-pointer hover:bg-p2/40 transition-colors ${isSelected(o) ? 'bg-p2/70' : ''}`} onClick={() => openOnChart(o)}>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs whitespace-nowrap">
                            {o.symbol.replace(/USDT$/, '')}
                            {o.source === 'gate' && <span className="ml-1 text-[8px] text-p5/40">G</span>}
                            {o.tight && <span className="ml-1 text-[8px] text-amber-600" title="High, tight flag">HTF</span>}
                          </td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.signalDate)}</td>
                          <td className={td}>{o.poleGainPct}%</td>
                          <td className={td}>{o.retracePct}%</td>
                          <td className={td}>{o.flagBars}</td>
                          <td className={td}>${price(o.entryPrice)}</td>
                          <td className={td}>{o.riskPct}%</td>
                          <td className={`py-0.5 pr-2 text-[10px] sm:text-xs whitespace-nowrap ${OUTCOME[o.outcome]?.cls ?? ''}`}>{OUTCOME[o.outcome]?.label ?? o.outcome}</td>
                          <td className={td}>{o.reachMM}×</td>
                          <td className={`${td} ${tone(o.rNet)}`}>{signed(o.rNet)}</td>
                          <td className={`${td} font-bold ${tone(o.pnlPct)}`}>{signed(o.pnlPct, '%')}</td>
                        </tr>
                      ))}
                      <tr className="lt-table-foot" aria-hidden="true"><td colSpan={11} className="h-px p-0 leading-none" /></tr>
                    </tbody>
                  </table>
                </div>
              )}
              {(detail.truncated || detailTrades.length > DETAIL_ROWS_SHOWN) && (
                <p className="text-[10px] text-p5/40">Lista limitada às ocorrências mais recentes — os agregados usam todas.</p>
              )}
            </div>
          )}

          {result.forming.length > 0 && (
            <div className="border-t border-p3/20 pt-2">
              {selectedTrade?.forming && (
                <div className="mb-1"><TradeOcoCard o={selectedTrade} reasons={levelReasons(selectedTrade)} onClose={() => setSelectedTrade(null)} /></div>
              )}
              <p className="text-[9px] text-p5/50 uppercase tracking-wider mb-0.5">Em formação agora — gatilho no rompimento (clique pra ver no gráfico)</p>
              <div className="overflow-x-auto">
                <table className="border-collapse">
                  <thead>
                    <tr className="text-[9px] text-p5/40 uppercase lt-table-head">
                      <th className="text-left pb-1 pr-3">Par</th>
                      <th className="text-left pb-1 pr-3">Tipo</th>
                      <th className={th}>Mastro</th>
                      <th className={th}>Retr.</th>
                      <th className={th}>Gatilho</th>
                      <th className={th} title="Distância do último fechamento até o gatilho.">Falta</th>
                      <th className={th}>Stop</th>
                      <th className={th}>Alvo</th>
                      <th className={th}>Risco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.forming.map((f, i) => (
                      <tr key={`${f.symbol}-${f.dir}-${i}`} className={`lt-table-row cursor-pointer hover:bg-p2/40 ${isSelected(f) ? 'bg-p2/70' : ''}`} onClick={() => openOnChart(f, { forming: true })}>
                        <td className="py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap">
                          {f.symbol.replace(/USDT$/, '')}{f.source === 'gate' && <span className="ml-1 text-[8px] text-p5/40">G</span>}
                        </td>
                        <td className={`py-0.5 pr-3 text-[10px] sm:text-xs whitespace-nowrap ${f.dir === 'bull' ? 'text-green-600' : 'text-red-600'}`}>
                          {f.dir === 'bull' ? '▲ Alta' : '▼ Baixa'}{f.tight ? ' HTF' : ''}
                        </td>
                        <td className={td}>{f.poleGainPct}%</td>
                        <td className={td}>{f.retracePct}%</td>
                        <td className={td}>${price(f.triggerPrice)}</td>
                        <td className={`${td} ${tone(f.dir === 'bull' ? -f.distToTriggerPct : f.distToTriggerPct)}`}>{signed(f.distToTriggerPct, '%')}</td>
                        <td className={td}>${price(f.stopPrice)}</td>
                        <td className={td}>${price(f.targetPrice)}</td>
                        <td className={td}>{f.riskPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[9px] text-p5/40 leading-snug">
            Simulação de sinal (não verifica saldo). Bandeira de baixa = short teórico. Cada bandeira é uma ocorrência independente; resultados passados não garantem os futuros.
          </p>
        </div>
      )}

      {!result && !error && !loading && <p className="text-[11px] text-p5/30 italic">{t('stats.configure')}</p>}
    </div>
  );
}
