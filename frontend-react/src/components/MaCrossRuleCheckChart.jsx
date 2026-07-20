import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { fetchMultitradeBacktest } from '../services/api';
import { INTERVAL_MS } from '../utils/chartView';
import { fetchEmaLine, fetchAdaptiveBandLine, fetchAdaptiveBandLineAuto, fetchBollingerLines, strategyLineDefsFromTradeConfig } from '../utils/overlayIndicators';
import { BB_PERIOD_OPTIONS, BB_STDDEV_OPTIONS } from '../utils/uiPreferences';

const RULE_CHECK_CANDLES = 50;

const MANUAL_EMA_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d'];
const MANUAL_EMA_PERIODS = ['9', '21', '50', '200'];
const MANUAL_BAND_PCT_OPTIONS = [4, 3, 2, 1];
const MANUAL_BAND_ADAPTIVE = 'adaptive';
const MANUAL_LINE_PALETTE = ['#e879f9', '#38bdf8', '#a3e635', '#fca5a5', '#fdba74', '#67e8f9'];
const BAND_SIDE_COLOR = { floor: '#2bb3a3', ceiling: '#e0653f' };

const LINE_SELECT_STYLE = {
  background: '#111', color: '#c3c2b7', border: '1px solid #383835',
  borderRadius: 3, padding: '1px 3px', fontFamily: 'monospace', fontSize: 10,
};
const LINE_ADD_BTN_STYLE = {
  background: '#2a2d3a', color: '#94a3b8', border: '1px solid #3a3d4a',
  borderRadius: 3, padding: '2px 6px', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer',
};

function lineChipStyle(active, color) {
  return {
    fontFamily: 'monospace', fontSize: 10, padding: '2px 6px', borderRadius: 3,
    cursor: 'pointer', border: `1px solid ${color}`,
    background: active ? `${color}33` : 'transparent',
    color: active ? color : '#666',
  };
}

/**
 * Conferência visual das regras de entrada do ma-cross: para cada cruzamento
 * EMA9↑EMA21 (15m) num período escolhido, mostra um ponto colorido pela regra
 * que decidiu o resultado (permitida / tendência / aproximação / candle de
 * reversão / outros filtros), junto com a linha de preço e os trades reais
 * executados nessa simulação.
 */

const BUCKET_COLOR = {
  allowed:    '#008300',
  trend:      '#3987e5',
  approach:   '#d55181',
  candle:     '#8a5fd1',
  pullback:   '#e0a030',
  maFloor:    '#2bb3a3',
  maCeiling:  '#e0653f',
  cooldown:   '#7a8699',
  bb:         '#d4c62a',
  timeout:    '#a9682e',
  other:      '#999999',
};

const BUCKET_SYMBOL = {
  allowed:    'circle',
  trend:      'triangle',
  approach:   'diamond',
  candle:     'pin',
  pullback:   'roundRect',
  maFloor:    'triangle',
  maCeiling:  'pin',
  cooldown:   'rect',
  bb:         'diamond',
  timeout:    'roundRect',
  other:      'rect',
};

const BUCKET_ROTATE = {
  maFloor:   180,
  maCeiling: 180,
  bb:        45,
  timeout:   45,
  other:     45,
};

const BUCKET_LABEL = {
  allowed:   'Entrada permitida',
  trend:     'Bloqueada — tendência EMA9×21 (4h)',
  approach:  'Bloqueada — aproximação EMA9/21 (4h)',
  candle:    'Bloqueada — candle de exaustão (reversão 1h)',
  pullback:  'Bloqueada — sem pullback (recuo insuficiente)',
  maFloor:   'Bloqueada — piso adapt. MA',
  maCeiling: 'Bloqueada — teto adapt. MA',
  cooldown:  'Bloqueada — cooldown pós-venda',
  bb:        'Bloqueada — filtro Bollinger Bands',
  timeout:   'Cancelada — pullback expirou',
  other:     'Bloqueada — outros filtros',
};

const BUCKET_ORDER = ['allowed', 'trend', 'approach', 'candle', 'pullback', 'maFloor', 'maCeiling', 'cooldown', 'bb', 'timeout', 'other'];

const TRADE_GOOD = '#0ca30c';
const TRADE_CRITICAL = '#d03b3b';

function bucketOutcome(outcome) {
  switch (outcome) {
    case 'BOUGHT':
    case 'POSITION_OPEN':
      return 'allowed';
    case 'NO_PULLBACK':
      return 'pullback';
    case 'BELOW_ADAPTIVE_FLOOR':
    case 'NOT_ABOVE_MA':
    case 'FILTER_NO_MA':
      return 'maFloor';
    case 'ABOVE_ADAPTIVE_CEILING':
    case 'NOT_BELOW_MA':
    case 'ABOVE_MA2_MAX':
      return 'maCeiling';
    case 'ENTRY_COOLDOWN':
      return 'cooldown';
    case 'BB_FILTER_ABOVE':
    case 'BB_FILTER_NO_DATA':
      return 'bb';
    case 'PENDING_TIMEOUT':
    case 'ENTRY_WINDOW_PASSED':
      return 'timeout';
    default:
      if (outcome?.startsWith('HTF_TREND')) return 'trend';
      if (outcome?.startsWith('EMA_APPROACH')) return 'approach';
      if (outcome?.startsWith('REVERSAL_')) return 'candle';
      return 'other';
  }
}

/** Filtro de MA que efetivamente bloqueou a linha (primeiro maCheck com ok:false). */
function failedMaCheck(row) {
  return (row.maChecks ?? []).find(m => m.ok === false) ?? null;
}

/** "EMA50 1h" → "1h" — intervalo do filtro de MA que bloqueou. */
function maCheckInterval(check) {
  const parts = check?.label?.split(' ');
  return parts?.length > 1 ? parts[1] : null;
}

/**
 * Chave de agrupamento do ponto: bucket base + intervalo do filtro MA quando
 * aplicável — o mesmo bucket (piso/teto adaptativo) pode ter filtros em
 * intervalos diferentes (ex.: EMA50 1h e EMA50 4h), então cada um vira uma
 * série/cor distinta na legenda em vez de ficar tudo indistinguível.
 */
function bucketKeyForRow(row) {
  const base = bucketOutcome(row.outcome);
  if (base === 'maFloor' || base === 'maCeiling') {
    const iv = maCheckInterval(failedMaCheck(row));
    if (iv) return `${base}@${iv}`;
  }
  return base;
}

function bucketKeyBase(key) {
  return key.split('@')[0];
}

function bucketKeyInterval(key) {
  const i = key.indexOf('@');
  return i === -1 ? null : key.slice(i + 1);
}

function bucketLabelForKey(key) {
  const base = bucketKeyBase(key);
  const iv = bucketKeyInterval(key);
  return iv ? `${BUCKET_LABEL[base]} (${iv})` : BUCKET_LABEL[base];
}

function compareBucketKeys(a, b) {
  const ai = BUCKET_ORDER.indexOf(bucketKeyBase(a));
  const bi = BUCKET_ORDER.indexOf(bucketKeyBase(b));
  return ai !== bi ? ai - bi : (bucketKeyInterval(a) ?? '').localeCompare(bucketKeyInterval(b) ?? '');
}

function fmtDateTime(ms) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtPrice(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p < 0.01 ? p.toFixed(6) : p < 1 ? p.toFixed(4) : p.toFixed(2);
}

function fmtPct(p) {
  return p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

/** input datetime-local (hora local do navegador) → ISO. */
function localInputToISO(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Desde" default: volta o suficiente pra cobrir as últimas N candles do timeframe de entrada. */
function defaultSinceForCandles(interval = '15m', count = RULE_CHECK_CANDLES) {
  const ms = INTERVAL_MS[interval] ?? INTERVAL_MS['15m'];
  const d = new Date(Date.now() - count * ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function buildTooltip(row) {
  const lines = [
    `<b>${fmtDateTime(row.timeISO ?? row.time)}</b>`,
    `close: ${fmtPrice(row.price)}`,
  ];
  if (row.ma1 != null && row.ma2 != null) {
    lines.push(`EMA9(15m): ${fmtPrice(row.ma1)} · EMA21(15m): ${fmtPrice(row.ma2)}`);
  }
  if (row.trendMa1 != null && row.trendMa2 != null) {
    const gap = ((row.trendMa1 / row.trendMa2) - 1) * 100;
    lines.push(`tendência: gap ${fmtPct(gap)}`);
  }
  if (row.approachGapPct != null) {
    lines.push(`aproximação: gap ${fmtPct(row.approachGapPct)}${row.approachTroughGapPct != null ? ` (fundo ${fmtPct(row.approachTroughGapPct)})` : ''}`);
  }
  const blockedMa = failedMaCheck(row);
  const maSuffix = ['maFloor', 'maCeiling'].includes(bucketOutcome(row.outcome)) && blockedMa?.label
    ? ` — ${blockedMa.label}`
    : '';
  lines.push(`<b>${row.outcomeLabel ?? row.outcome}${maSuffix}</b>`);
  if (row.outcome === 'BOUGHT' && row.exitDetail) {
    lines.push(row.exitDetail);
  } else if (row.outcome !== 'BOUGHT') {
    const detail = row.outcomeDetail ?? row.outcomeShort;
    if (detail && detail !== row.outcomeLabel) lines.push(detail);
  }
  if (row.pnlPct != null) {
    lines.push(`PnL: ${fmtPct(row.pnlPct)}`);
  }
  return lines.join('<br/>');
}

/** Linhas de EMA/Bollinger buscadas pra sobrepor ao preço (ver overlayIndicators.js). */
function buildIndicatorSeries(lineData) {
  return Object.values(lineData).flatMap((entry) => {
    if (entry.kind === 'ema') {
      return [{
        name: entry.label,
        type: 'line',
        data: entry.points,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: entry.color, width: 1.3, type: 'dashed' },
        z: 2,
      }];
    }
    if (entry.kind === 'band') {
      return [{
        name: entry.label,
        type: 'line',
        data: entry.points,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: entry.color, width: 1.2, type: 'dotted', opacity: 0.85 },
        z: 2,
      }];
    }
    return [
      {
        name: `${entry.label} sup`,
        type: 'line',
        data: entry.upper,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: entry.color, width: 1, type: 'dotted', opacity: 0.6 },
        z: 2,
      },
      {
        name: entry.label,
        type: 'line',
        data: entry.middle,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: entry.color, width: 1.3, type: 'dashed' },
        z: 2,
      },
      {
        name: `${entry.label} inf`,
        type: 'line',
        data: entry.lower,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: entry.color, width: 1, type: 'dotted', opacity: 0.6 },
        z: 2,
      },
    ];
  });
}

export default function MaCrossRuleCheckChart({ symbol, exchange, capital = 40, strategyId, tradeConfig, fillHeight = false }) {
  const [sinceInput, setSinceInput] = useState(() => defaultSinceForCandles(tradeConfig?.entry?.ma1?.interval));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);
  const chartWrapRef = useRef(null);
  const summaryChartRef = useRef(null);
  const summaryWrapRef = useRef(null);

  // Linhas de indicador (EMA/Bollinger) sobrepostas ao preço — as da própria
  // estratégia entram ligadas por padrão (podem ser desligadas), mais um
  // manipulador pra adicionar EMAs/BB manuais além das que a regra usa.
  const strategyLineDefs = useMemo(() => strategyLineDefsFromTradeConfig(tradeConfig), [tradeConfig]);
  const strategyLineIdsKey = strategyLineDefs.map(d => d.id).join(',');
  const [manualLines, setManualLines] = useState([]);
  const [activeLineIds, setActiveLineIds] = useState(() => new Set(strategyLineDefs.map(d => d.id)));
  const [lineData, setLineData] = useState({});
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesPanelCollapsed, setLinesPanelCollapsed] = useState(false);
  const [addEmaInterval, setAddEmaInterval] = useState('1h');
  const [addEmaPeriod, setAddEmaPeriod] = useState('50');
  const [addEmaBandAbove, setAddEmaBandAbove] = useState(null);
  const [addEmaBandBelow, setAddEmaBandBelow] = useState(null);
  const [addBbInterval, setAddBbInterval] = useState('4h');
  const [addBbPeriod, setAddBbPeriod] = useState(BB_PERIOD_OPTIONS[1]);
  const [addBbStdDev, setAddBbStdDev] = useState(BB_STDDEV_OPTIONS[1]);

  // Ao trocar de moeda/estratégia as linhas da regra mudam — volta todas pro padrão (ligadas)
  // e limpa as manuais, que pertenciam ao símbolo anterior.
  useEffect(() => {
    setActiveLineIds(new Set(strategyLineDefs.map(d => d.id)));
    setManualLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, strategyLineIdsKey]);

  const toggleLine = useCallback((id) => {
    setActiveLineIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const addManualEma = useCallback(() => {
    const period = Number(addEmaPeriod);
    const interval = addEmaInterval;
    const baseId = `manual-ema-${period}-${interval}`;

    const bandDef = (side, sel) => {
      if (sel == null) return null;
      const isAdaptive = sel === MANUAL_BAND_ADAPTIVE;
      return {
        id: `manual-band-${side}-${period}-${interval}-${sel}`,
        kind: 'band',
        side, period, interval,
        pct: isAdaptive ? null : Number(sel),
        mode: isAdaptive ? 'adaptive' : 'fixed',
        color: BAND_SIDE_COLOR[side],
        label: isAdaptive
          ? `${side === 'floor' ? 'Piso' : 'Teto'} ADAPT EMA${period} ${interval}`
          : `${side === 'floor' ? 'Piso' : 'Teto'} manual EMA${period} ${interval} (${side === 'floor' ? '−' : '+'}${sel}%)`,
      };
    };
    const newBands = [bandDef('floor', addEmaBandBelow), bandDef('ceiling', addEmaBandAbove)].filter(Boolean);

    setManualLines(prev => {
      const next = [...prev];
      if (!next.some(l => l.id === baseId)) {
        next.push({
          id: baseId, kind: 'ema', period, interval,
          color: MANUAL_LINE_PALETTE[next.length % MANUAL_LINE_PALETTE.length],
          label: `EMA${period} ${interval}`,
        });
      }
      for (const band of newBands) {
        if (!next.some(l => l.id === band.id)) next.push(band);
      }
      return next;
    });
    setActiveLineIds(prev => {
      const next = new Set(prev).add(baseId);
      for (const band of newBands) next.add(band.id);
      return next;
    });
  }, [addEmaPeriod, addEmaInterval, addEmaBandAbove, addEmaBandBelow]);

  const addManualBb = useCallback(() => {
    const period = Number(addBbPeriod);
    const stdDev = Number(addBbStdDev);
    const interval = addBbInterval;
    const id = `manual-bb-${period}-${interval}-${stdDev}`;
    setManualLines(prev => prev.some(l => l.id === id) ? prev : [...prev, {
      id, kind: 'bb', period, stdDev, interval,
      color: '#a78bfa',
      label: `BB${period}@${interval} ±${stdDev}σ`,
    }]);
    setActiveLineIds(prev => new Set(prev).add(id));
  }, [addBbPeriod, addBbStdDev, addBbInterval]);

  const removeManualLine = useCallback((id) => {
    setManualLines(prev => prev.filter(l => l.id !== id));
    setActiveLineIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const allLineDefs = useMemo(() => [...strategyLineDefs, ...manualLines], [strategyLineDefs, manualLines]);
  const activeLineIdsKey = [...activeLineIds].sort().join(',');

  // Busca os pontos reais de EMA/Bollinger (candles + indicador no backend) pras
  // linhas ligadas, cobrindo a janela do backtest (data.priceSeries) + warmup do período.
  useEffect(() => {
    if (!data || !symbol) { setLineData({}); return undefined; }
    const activeDefs = allLineDefs.filter(d => activeLineIds.has(d.id));
    if (!activeDefs.length) { setLineData({}); return undefined; }

    const fromMs = data.priceSeries?.[0]?.time ?? Date.now();
    let cancelled = false;
    setLinesLoading(true);
    (async () => {
      const entries = await Promise.all(activeDefs.map(async (d) => {
        try {
          if (d.kind === 'ema') {
            const points = await fetchEmaLine(symbol, d.interval, d.period, exchange, fromMs);
            return [d.id, { kind: 'ema', points, color: d.color, label: d.label }];
          }
          if (d.kind === 'band') {
            if (d.mode === 'adaptive') {
              const { points, pct } = await fetchAdaptiveBandLineAuto(symbol, d.interval, d.period, d.side, exchange, fromMs);
              const label = Number.isFinite(pct) ? `${d.label} (${d.side === 'floor' ? '−' : '+'}${pct.toFixed(2)}%)` : d.label;
              return [d.id, { kind: 'band', points, color: d.color, label }];
            }
            const points = await fetchAdaptiveBandLine(symbol, d.interval, d.period, d.side, d.pct, exchange, fromMs);
            return [d.id, { kind: 'band', points, color: d.color, label: d.label }];
          }
          const bb = await fetchBollingerLines(symbol, d.interval, d.period, d.stdDev, exchange, fromMs);
          return bb ? [d.id, { kind: 'bb', ...bb, color: d.color, label: d.label }] : null;
        } catch {
          return null;
        }
      }));
      if (!cancelled) {
        setLineData(Object.fromEntries(entries.filter(Boolean)));
        setLinesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, symbol, exchange, activeLineIdsKey]);

  const runWithSince = useCallback(async (sinceValue) => {
    if (!symbol) return;
    const since = localInputToISO(sinceValue);
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMultitradeBacktest({
        symbol, exchange, capital, strategyId, tradeConfig, since,
      });
      setData(result);
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, exchange, capital, strategyId, tradeConfig]);

  const run = useCallback(() => runWithSince(sinceInput), [runWithSince, sinceInput]);

  // Ao trocar de moeda com a aba Regras aberta, refaz a janela (últimas 50 candles)
  // e roda a simulação automaticamente, sem esperar o clique em "Verificar regras".
  useEffect(() => {
    if (!symbol) return;
    const since = defaultSinceForCandles(tradeConfig?.entry?.ma1?.interval);
    setSinceInput(since);
    runWithSince(since);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, exchange]);

  const option = useMemo(() => {
    if (!data) return null;

    const priceData = (data.priceSeries ?? []).map(p => [p.time, p.close]);

    // Chave por bucket base + intervalo do filtro MA que bloqueou (piso/teto
    // adaptativo podem ter filtros em 1h e 4h simultaneamente — cada um vira
    // uma série própria em vez de ficar tudo com a mesma cor/rótulo).
    const buckets = {};
    for (const row of data.entryLog ?? []) {
      const key = bucketKeyForRow(row);
      (buckets[key] ??= []).push({
        value: [row.timeISO ? new Date(row.timeISO).getTime() : row.time, row.price],
        row,
      });
    }

    const buys = (data.trades ?? []).filter(t => t.type === 'BUY');
    const sells = (data.trades ?? []).filter(t => t.type === 'SELL');

    // Só entra na legenda/série quem realmente tem pontos nessa janela — evita
    // poluir o gráfico com categorias vazias quando poucos filtros bloquearam.
    const ruleSeries = Object.keys(buckets).sort(compareBucketKeys).map(key => {
      const base = bucketKeyBase(key);
      return {
        name: bucketLabelForKey(key),
        type: 'scatter',
        data: buckets[key],
        symbol: BUCKET_SYMBOL[base],
        symbolRotate: BUCKET_ROTATE[base] ?? 0,
        symbolSize: 10,
        itemStyle: { color: BUCKET_COLOR[base], opacity: 0.9 },
        emphasis: { scale: 1.4 },
        z: 3,
      };
    });

    const tradeSeries = [
      {
        name: 'Compra executada',
        type: 'scatter',
        data: buys.map(t => ({ value: [t.time, t.price], row: t })),
        symbol: 'arrow',
        symbolSize: 13,
        itemStyle: { color: 'transparent', borderColor: TRADE_GOOD, borderWidth: 2 },
        z: 4,
      },
      {
        name: 'Venda executada',
        type: 'scatter',
        data: sells.map(t => ({
          value: [t.time, t.price],
          row: t,
        })),
        symbol: 'arrow',
        symbolRotate: 180,
        symbolSize: 13,
        itemStyle: { color: 'transparent', borderWidth: 2 },
        z: 4,
      },
    ];
    // itemStyle por ponto de venda (ganho = good, perda = critical)
    tradeSeries[1].data = tradeSeries[1].data.map(d => ({
      ...d,
      itemStyle: { color: 'transparent', borderColor: (d.row.pnlUsdt ?? 0) >= 0 ? TRADE_GOOD : TRADE_CRITICAL, borderWidth: 2 },
    }));

    return {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'monospace', color: '#c3c2b7' },
      grid: { left: 56, right: 16, top: 36, bottom: 60 },
      legend: {
        top: 0,
        textStyle: { color: '#c3c2b7', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 10,
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1a1a19',
        borderColor: '#383835',
        textStyle: { color: '#ffffff', fontSize: 11 },
        formatter: (p) => {
          const row = p.data?.row;
          if (!row) return '';
          if (row.type === 'BUY' || row.type === 'SELL') {
            return [
              `<b>${row.type === 'BUY' ? 'Compra' : 'Venda'}</b> ${fmtDateTime(row.time)}`,
              `preço: ${fmtPrice(row.price)}`,
              row.pnlPct != null ? `PnL: ${fmtPct(row.pnlPct)}` : null,
            ].filter(Boolean).join('<br/>');
          }
          return buildTooltip(row);
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#383835' } },
        axisLabel: {
          color: '#898781',
          fontSize: 10,
          hideOverlap: true,
          formatter: (v) => fmtDateTime(v),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { lineStyle: { color: '#383835' } },
        axisLabel: { color: '#898781', fontSize: 10, formatter: (v) => fmtPrice(v) },
        splitLine: { lineStyle: { color: '#2c2c2a' } },
      },
      series: [
        {
          name: 'Preço',
          type: 'line',
          data: priceData,
          showSymbol: false,
          lineStyle: { color: '#c3c2b7', width: 1 },
          z: 1,
        },
        ...buildIndicatorSeries(lineData),
        ...ruleSeries,
        ...tradeSeries,
      ],
    };
  }, [data, lineData]);

  // Segundo gráfico: barra horizontal com a contagem de sinais por regra —
  // complementa o scatter/preço (que mostra QUANDO/ONDE) respondendo QUANTO
  // cada filtro está bloqueando nessa janela, sem precisar passar o mouse em
  // cada ponto.
  const summaryOption = useMemo(() => {
    const entryLog = data?.entryLog ?? [];
    if (!entryLog.length) return null;

    const counts = new Map();
    for (const row of entryLog) {
      const key = bucketKeyForRow(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = entryLog.length;
    const rows = [...counts.keys()]
      .sort(compareBucketKeys)
      .map(key => ({ key, count: counts.get(key), pct: (counts.get(key) / total) * 100 }))
      .sort((a, b) => a.count - b.count); // ECharts categoria: primeiro item fica embaixo

    return {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'monospace', color: '#c3c2b7' },
      grid: { left: 168, right: 44, top: 4, bottom: 4 },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1a1a19',
        borderColor: '#383835',
        textStyle: { color: '#ffffff', fontSize: 11 },
        formatter: (p) => `${bucketLabelForKey(rows[p.dataIndex].key)}<br/><b>${rows[p.dataIndex].count}</b> de ${total} sinais (${rows[p.dataIndex].pct.toFixed(0)}%)`,
      },
      xAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#383835' } },
        axisLabel: { color: '#898781', fontSize: 10 },
        splitLine: { lineStyle: { color: '#2c2c2a' } },
      },
      yAxis: {
        type: 'category',
        data: rows.map(r => bucketLabelForKey(r.key)),
        axisLine: { lineStyle: { color: '#383835' } },
        axisLabel: { color: '#c3c2b7', fontSize: 10 },
      },
      series: [{
        type: 'bar',
        data: rows.map(r => ({ value: r.count, itemStyle: { color: BUCKET_COLOR[bucketKeyBase(r.key)] } })),
        barWidth: 14,
        label: {
          show: true, position: 'right', color: '#c3c2b7', fontSize: 10,
          formatter: (p) => `${rows[p.dataIndex].count} (${rows[p.dataIndex].pct.toFixed(0)}%)`,
        },
      }],
    };
  }, [data]);

  // Reajusta o canvas do ECharts quando o container muda de tamanho (maximizar
  // gráfico/painel, arrastar o divisor entre colunas, redimensionar a janela) —
  // CSS/flex por si só não redesenha o canvas já renderizado.
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el || !option) return undefined;
    const resize = () => chartRef.current?.getEchartsInstance()?.resize();
    resize();
    const raf = requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [option]);

  useEffect(() => {
    const el = summaryWrapRef.current;
    if (!el || !summaryOption) return undefined;
    const resize = () => summaryChartRef.current?.getEchartsInstance()?.resize();
    resize();
    const raf = requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [summaryOption]);

  return (
    <div className={fillHeight ? 'flex flex-col h-full min-h-0' : ''} style={fillHeight ? undefined : { marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
        <span style={{ color: '#c3c2b7', fontWeight: 'bold' }}>{symbol ?? '—'}</span>
        <span style={{ color: '#898781' }}>Desde:</span>
        <input
          type="datetime-local"
          value={sinceInput}
          onChange={e => setSinceInput(e.target.value)}
          style={{
            background: '#111', color: '#c3c2b7', border: '1px solid #383835',
            borderRadius: 3, padding: '2px 4px', fontFamily: 'monospace', fontSize: 11,
          }}
        />
        <button
          type="button"
          onClick={run}
          disabled={loading || !symbol}
          style={{
            background: loading ? '#333' : '#1c5cab', color: '#fff', border: 'none',
            borderRadius: 3, padding: '3px 10px', cursor: loading ? 'default' : 'pointer',
            fontFamily: 'monospace', fontSize: 11,
          }}
        >
          {loading ? 'verificando…' : 'Verificar regras'}
        </button>
        {data?.summary && (
          <span style={{ color: '#898781' }}>
            {data.summary.entrySignals} cruzamento(s) · {data.summary.trades} trade(s) · PnL {fmtPct(data.summary.totalPnlPct)}
          </span>
        )}
      </div>

      {error && <div style={{ color: '#e66767', fontSize: 11, marginTop: 6, fontFamily: 'monospace', flexShrink: 0 }}>{error}</div>}

      {option && (
        <div
          ref={chartWrapRef}
          className={fillHeight ? 'flex-1 min-h-0' : ''}
          style={{
            marginTop: 8, background: '#1a1a19', borderRadius: 4, border: '1px solid #2c2c2a',
            position: 'relative',
            ...(fillHeight ? { minHeight: 200 } : { height: 340 }),
          }}
        >
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: fillHeight ? '100%' : 340, width: '100%' }}
            notMerge
            lazyUpdate
          />

          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 10,
            display: 'flex', flexDirection: 'row', alignItems: 'stretch', pointerEvents: 'none',
          }}>
            <button
              type="button"
              onClick={() => setLinesPanelCollapsed(v => !v)}
              title={linesPanelCollapsed ? 'Mostrar linhas' : 'Recolher linhas'}
              style={{
                pointerEvents: 'auto', alignSelf: 'center', flexShrink: 0,
                fontSize: 11, lineHeight: 1, width: 14, height: 30,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', borderRadius: 4, color: '#94a3b8',
                background: 'rgba(0,0,0,0.55)', border: '1px solid #334155',
              }}
            >
              {linesPanelCollapsed ? '‹' : '›'}
            </button>

            {!linesPanelCollapsed && (
              <div style={{
                pointerEvents: 'auto', width: 148, minWidth: 148, height: '100%',
                overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch',
                background: 'rgba(10,10,10,0.75)', borderLeft: '1px solid #2c2c2a',
                padding: 4, display: 'flex', flexDirection: 'column', gap: 3,
                fontFamily: 'monospace', fontSize: 9,
              }}>
                <div style={{ textAlign: 'center', fontSize: 7, color: '#64748b', letterSpacing: 1.5, textTransform: 'uppercase', paddingBottom: 2 }}>
                  Linhas
                </div>

                {strategyLineDefs.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleLine(d.id)}
                    title={d.label}
                    style={{ ...lineChipStyle(activeLineIds.has(d.id), d.color), width: '100%', textAlign: 'left', whiteSpace: 'normal', lineHeight: 1.25 }}
                  >
                    {d.label}
                  </button>
                ))}

                {manualLines.map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'stretch', gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => toggleLine(d.id)}
                      title={d.label}
                      style={{ ...lineChipStyle(activeLineIds.has(d.id), d.color), flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'normal', lineHeight: 1.25 }}
                    >
                      {d.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeManualLine(d.id)}
                      title="Remover linha"
                      style={{ fontFamily: 'monospace', fontSize: 11, color: '#e66767', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {linesLoading && <span style={{ color: '#898781', fontSize: 8 }}>carregando…</span>}

                <div style={{ borderTop: '1px solid #2c2c2a', marginTop: 2, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: '#898781', fontSize: 8 }}>+ EMA manual</span>
                  <select value={addEmaPeriod} onChange={e => setAddEmaPeriod(e.target.value)} style={{ ...LINE_SELECT_STYLE, width: '100%' }}>
                    {MANUAL_EMA_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={addEmaInterval} onChange={e => setAddEmaInterval(e.target.value)} style={{ ...LINE_SELECT_STYLE, width: '100%' }}>
                    {MANUAL_EMA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                  <select
                    value={addEmaBandAbove ?? 'off'}
                    onChange={e => setAddEmaBandAbove(e.target.value === 'off' ? null : (e.target.value === MANUAL_BAND_ADAPTIVE ? MANUAL_BAND_ADAPTIVE : Number(e.target.value)))}
                    style={{ ...LINE_SELECT_STYLE, width: '100%', color: addEmaBandAbove != null ? BAND_SIDE_COLOR.ceiling : LINE_SELECT_STYLE.color }}
                  >
                    <option value="off">teto: off</option>
                    <option value={MANUAL_BAND_ADAPTIVE}>teto: ADAPT</option>
                    {MANUAL_BAND_PCT_OPTIONS.map(p => <option key={p} value={p}>teto: +{p}%</option>)}
                  </select>
                  <select
                    value={addEmaBandBelow ?? 'off'}
                    onChange={e => setAddEmaBandBelow(e.target.value === 'off' ? null : (e.target.value === MANUAL_BAND_ADAPTIVE ? MANUAL_BAND_ADAPTIVE : Number(e.target.value)))}
                    style={{ ...LINE_SELECT_STYLE, width: '100%', color: addEmaBandBelow != null ? BAND_SIDE_COLOR.floor : LINE_SELECT_STYLE.color }}
                  >
                    <option value="off">piso: off</option>
                    <option value={MANUAL_BAND_ADAPTIVE}>piso: ADAPT</option>
                    {MANUAL_BAND_PCT_OPTIONS.map(p => <option key={p} value={p}>piso: −{p}%</option>)}
                  </select>
                  <button type="button" onClick={addManualEma} style={{ ...LINE_ADD_BTN_STYLE, width: '100%' }}>+ EMA</button>
                </div>

                <div style={{ borderTop: '1px solid #2c2c2a', marginTop: 2, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: '#898781', fontSize: 8 }}>+ BB manual</span>
                  <select value={addBbPeriod} onChange={e => setAddBbPeriod(e.target.value)} style={{ ...LINE_SELECT_STYLE, width: '100%' }}>
                    {BB_PERIOD_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={addBbStdDev} onChange={e => setAddBbStdDev(Number(e.target.value))} style={{ ...LINE_SELECT_STYLE, width: '100%' }}>
                    {BB_STDDEV_OPTIONS.map(s => <option key={s} value={s}>±{s}σ</option>)}
                  </select>
                  <select value={addBbInterval} onChange={e => setAddBbInterval(e.target.value)} style={{ ...LINE_SELECT_STYLE, width: '100%' }}>
                    {MANUAL_EMA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
                  </select>
                  <button type="button" onClick={addManualBb} style={{ ...LINE_ADD_BTN_STYLE, width: '100%' }}>+ BB</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {summaryOption && (() => {
        const rowCount = summaryOption.series[0].data.length;
        const barsHeight = Math.min(300, Math.max(70, rowCount * 24 + 30));
        return (
          <div style={{ marginTop: 8, flexShrink: 0 }}>
            <div style={{ color: '#898781', fontSize: 10, fontFamily: 'monospace', marginBottom: 4 }}>
              Resumo por regra — {data.entryLog.length} sinal(is) na janela
            </div>
            <div
              ref={summaryWrapRef}
              style={{
                background: '#1a1a19', borderRadius: 4, border: '1px solid #2c2c2a',
                height: barsHeight,
              }}
            >
              <ReactECharts
                ref={summaryChartRef}
                option={summaryOption}
                style={{ height: barsHeight, width: '100%' }}
                notMerge
                lazyUpdate
              />
            </div>
          </div>
        );
      })()}

      {!data && !loading && !error && (
        <div style={{ color: '#898781', fontSize: 11, marginTop: 6, fontFamily: 'monospace', flexShrink: 0 }}>
          Escolha a data/hora inicial e clique em "Verificar regras" pra ver os pontos de cruzamento coloridos pela regra que bloqueou (ou permitiu) cada um.
        </div>
      )}
    </div>
  );
}
