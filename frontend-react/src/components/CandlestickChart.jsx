import { useMemo, useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud, fetchUserPrefs, saveUserPrefs, fetchGateTrades, fetchBinanceTrades } from '../services/api';
import convertOpenTime from '../utils/convertOpenTime';

const LIMIT = 76;
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
const DEFAULT_INTERVAL = '30m';

const C_UP   = '#26a69a';
const C_DOWN = '#ef5350';

const INDICATOR_GROUPS = [
  { id: 'ma200',    label: 'MA200',    color: '#f59e0b' },
  { id: 'ichimoku', label: 'Ichimoku', color: '#60a5fa' },
  { id: 'rsi',      label: 'RSI',      color: '#a78bfa' },
];

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue('--color-p1').trim() || '#1a0a25',
    panel: style.getPropertyValue('--color-p2').trim() || '#003f69',
    text: style.getPropertyValue('--color-p5').trim() || '#b3aca4',
    axis: style.getPropertyValue('--color-p4').trim() || '#157a8c',
  };
}


function buildOption({ symbol, interval, candlesticks, ichimokuCloud, movingAverage, rsi }, colors, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = []) {
  const showMa200    = activeIndicators.includes('ma200');
  const showIchimoku = activeIndicators.includes('ichimoku');
  const showRsi      = activeIndicators.includes('rsi');
  const showRsi50    = activeIndicators.includes('rsi50');
  const DL = Math.min(displayLimit, candlesticks.length);

  const xData = (() => {
    const dates = candlesticks.map((c) => convertOpenTime(c.openTime, interval));
    const padding = new Array(24).fill('');
    return [...dates, ...padding].slice(-(DL + 24));
  })();

  // Separadores de dia — só faz sentido em intervalos intraday (< 1d)
  const INTRADAY = !['1d', '3d', '1w'].includes(interval);

  const dayBreakData = (() => {
    if (!INTRADAY) return [];
    const visible = candlesticks.slice(-DL);
    const result  = [];
    let prevDay   = null;
    visible.forEach((c, i) => {
      const day = new Date(Number(c.openTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (prevDay !== null && day !== prevDay) {
        result.push({
          xAxis: i,
          lineStyle: { color: 'rgba(255,255,255,0.07)', width: 1, type: 'solid' },
          label: {
            show: true,
            formatter: day.slice(0, 5),     // "07/06"
            color: 'rgba(255,255,255,0.22)',
            fontSize: 9,
            position: 'insideEndTop',
            padding: [2, 3],
          },
        });
      }
      prevDay = day;
    });
    return result;
  })();

  const periodMarkData = (() => {
    if (!zoomPeriod) return [];
    const startMs  = new Date(zoomPeriod.startDate).getTime();
    const endMs    = new Date(zoomPeriod.endDate).getTime();
    const startIdx = candlesticks.findIndex(c => Number(c.openTime) >= startMs);
    const endIdx   = candlesticks.reduce((best, c, i) =>
      Number(c.openTime) <= endMs ? i : best, -1);
    const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).replace(',', '');
    const line = (idx, label) => ({
      xAxis: idx,
      lineStyle: { color: 'rgba(255,255,255,0.45)', width: 1, type: 'dashed' },
      label: { show: true, formatter: label, color: 'rgba(255,255,255,0.75)',
               fontSize: 12, fontWeight: 'bold', position: 'insideEndTop', padding: [2, 4] },
    });
    const data = [];
    if (startIdx !== -1) data.push(line(startIdx, fmt(zoomPeriod.startDate)));
    if (endIdx   !== -1) data.push(line(endIdx,   fmt(zoomPeriod.endDate)));
    return data;
  })();

  const fmtTradeDate = (ms) => {
    const d = new Date(ms);
    const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  };

  const tradeMarkData = (() => {
    if (!tradeTimes.length) return [];
    const offset = candlesticks.length - DL;
    return tradeTimes.flatMap(tradeMs => {
      const idx = candlesticks.reduce((best, c, i) =>
        Math.abs(Number(c.openTime) - tradeMs) < Math.abs(Number(candlesticks[best].openTime) - tradeMs)
          ? i : best
      , 0);
      const localIdx = idx - offset;
      if (localIdx < 0) return [];
      return [{
        xAxis: localIdx,
        lineStyle: { color: '#3b82f6', width: 1.5, type: 'solid' },
        label: {
          show: true,
          formatter: `compra ${fmtTradeDate(tradeMs)}`,
          color: '#3b82f6',
          fontSize: 9,
          position: 'insideStartTop',
          padding: [3, 5],
        },
      }];
    });
  })();

  // Todas as markLines unificadas: separadores de dia + zoom + compras
  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData];
  const markLineConfig   = allMarkLineData.length
    ? { silent: true, symbol: 'none', data: allMarkLineData }
    : null;

  const axisBase = (gridIndex) => ({
    gridIndex,
    type: 'category',
    data: xData,
    axisLine: { lineStyle: { color: colors.panel } },
    axisLabel: { color: colors.text, fontSize: 10, show: gridIndex === (showRsi ? 1 : 0) },
    splitLine: { show: false },
  });

  const candleSeries = (idx) => [
    {
      name: 'Candles',
      type: 'candlestick',
      xAxisIndex: idx, yAxisIndex: idx,
      data: candlesticks.slice(-DL).map((c) => [c.open, c.close, c.low, c.high]),
      itemStyle: { color: C_UP, color0: C_DOWN, borderColor: C_UP, borderColor0: C_DOWN },
      ...(markLineConfig ? { markLine: markLineConfig } : {}),
    },
    ...(showMa200 ? [{
      name: 'MA200',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: movingAverage.slice(-DL),
      smooth: true, showSymbol: false,
      lineStyle: { color: '#f59e0b', width: 1.5 },
    }] : []),
    ...(showIchimoku ? [
      { name: 'CL', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: ichimokuCloud.slice(-DL).map((c) => c.conversion),
        smooth: true, showSymbol: false, lineStyle: { color: '#60a5fa', width: 1 } },
      { name: 'BL', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: ichimokuCloud.slice(-DL).map((c) => c.base),
        smooth: true, showSymbol: false, lineStyle: { color: '#94a3b8', width: 1 } },
      { name: 'Span A', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: ichimokuCloud.slice(-(DL + 24)).map((c) => c.spanA),
        showSymbol: false, lineStyle: { color: C_UP, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(38,166,154,0.05)' } },
      { name: 'Span B', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: ichimokuCloud.slice(-(DL + 24)).map((c) => c.spanB),
        smooth: true, showSymbol: false, lineStyle: { color: C_DOWN, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(239,83,80,0.05)' } },
    ] : []),
  ];

  if (!showRsi) {
    return {
      backgroundColor: colors.bg,
      title: {
        text: symbol, subtext: interval, left: 12, top: 8,
        textStyle: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
        subtextStyle: { color: colors.axis, fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis', backgroundColor: '#003f69ee', borderColor: colors.axis,
        textStyle: { color: colors.text, fontSize: 11 },
        axisPointer: { animation: false, type: 'cross', lineStyle: { color: colors.axis, width: 1, opacity: 0.8 } },
      },
      xAxis: { type: 'category', data: xData,
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { show: false } },
      yAxis: { scale: true, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      grid: { top: 40, bottom: 12, left: 12, right: 64 },
      dataZoom: [{ type: 'inside' }],
      series: candleSeries(0),
    };
  }

  const rsiData = rsi ? rsi.slice(-DL) : [];

  return {
    backgroundColor: colors.bg,
    title: {
      text: symbol, subtext: interval, left: 12, top: 8,
      textStyle: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
      subtextStyle: { color: colors.axis, fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis', backgroundColor: '#003f69ee', borderColor: colors.axis,
      textStyle: { color: colors.text, fontSize: 11 },
      axisPointer: { animation: false, type: 'cross', lineStyle: { color: colors.axis, width: 1, opacity: 0.8 } },
    },
    grid: [
      { top: 40, bottom: '24%', left: 12, right: 64 },
      { top: '79%', bottom: 20, left: 12, right: 64 },
    ],
    xAxis: [
      { ...axisBase(0), axisLabel: { show: false } },
      { ...axisBase(1) },
    ],
    yAxis: [
      { gridIndex: 0, scale: true, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      { gridIndex: 1, min: 0, max: 100, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 9 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.2 } },
        interval: 30 },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }],
    series: [
      ...candleSeries(0),
      {
        name: 'RSI',
        type: 'line',
        xAxisIndex: 1, yAxisIndex: 1,
        data: rsiData,
        showSymbol: false,
        lineStyle: { color: '#a78bfa', width: 1.5 },
        markLine: {
          silent: true, symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef5350', type: 'dashed', width: 1 },
              label: { formatter: '30', color: '#ef5350', fontSize: 9, position: 'start' } },
            ...(showRsi50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.6 },
              label: { formatter: '50', color: '#facc15', fontSize: 9, position: 'start' } }] : []),
            { yAxis: 70, lineStyle: { color: '#26a69a', type: 'dashed', width: 1 },
              label: { formatter: '70', color: '#26a69a', fontSize: 9, position: 'start' } },
          ],
        },
      },
    ],
  };
}

// ── Gráfico Matrix: área de preço + RSI, tema terminal verde ─────────────────

function buildMatrixOption({ symbol, interval, candlesticks, rsi }, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = []) {
  const showRsi   = activeIndicators.includes('rsi');
  const showRsi50 = activeIndicators.includes('rsi50');
  const DL      = Math.min(displayLimit, candlesticks.length);
  const INTRADAY = !['1d', '3d', '1w'].includes(interval);

  const G        = '#22c55e';                       // verde Matrix
  const G_DIM    = 'rgba(34,197,94,0.08)';
  const G_LABEL  = 'rgba(34,197,94,0.38)';
  const BG       = '#050d0a';

  // xData com padding (igual ao buildOption)
  const xData = (() => {
    const dates   = candlesticks.map(c => convertOpenTime(c.openTime, interval));
    const padding = new Array(24).fill('');
    return [...dates, ...padding].slice(-(DL + 24));
  })();

  // separadores de dia (em tom verde)
  const dayBreakData = (() => {
    if (!INTRADAY) return [];
    const visible = candlesticks.slice(-DL);
    const result  = [];
    let prevDay   = null;
    visible.forEach((c, i) => {
      const day = new Date(Number(c.openTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (prevDay !== null && day !== prevDay) {
        result.push({
          xAxis: i,
          lineStyle: { color: 'rgba(34,197,94,0.10)', width: 1, type: 'solid' },
          label: { show: true, formatter: day.slice(0, 5), color: 'rgba(34,197,94,0.28)', fontSize: 9, position: 'insideEndTop', padding: [2, 3] },
        });
      }
      prevDay = day;
    });
    return result;
  })();

  // linhas de zoom de período
  const periodMarkData = (() => {
    if (!zoomPeriod) return [];
    const startMs  = new Date(zoomPeriod.startDate).getTime();
    const endMs    = new Date(zoomPeriod.endDate).getTime();
    const startIdx = candlesticks.findIndex(c => Number(c.openTime) >= startMs);
    const endIdx   = candlesticks.reduce((best, c, i) => Number(c.openTime) <= endMs ? i : best, -1);
    const fmt = iso => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    const mk  = (idx, label) => ({ xAxis: idx, lineStyle: { color: 'rgba(255,255,255,0.35)', width: 1, type: 'dashed' }, label: { show: true, formatter: label, color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 'bold', position: 'insideEndTop', padding: [2, 4] } });
    const data = [];
    if (startIdx !== -1) data.push(mk(startIdx, fmt(zoomPeriod.startDate)));
    if (endIdx   !== -1) data.push(mk(endIdx,   fmt(zoomPeriod.endDate)));
    return data;
  })();

  // linhas de compra
  const fmtTradeDate = ms => {
    const d    = new Date(ms);
    const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  };
  const tradeMarkData = (() => {
    if (!tradeTimes.length) return [];
    const offset = candlesticks.length - DL;
    return tradeTimes.flatMap(tradeMs => {
      const idx      = candlesticks.reduce((best, c, i) => Math.abs(Number(c.openTime) - tradeMs) < Math.abs(Number(candlesticks[best].openTime) - tradeMs) ? i : best, 0);
      const localIdx = idx - offset;
      if (localIdx < 0) return [];
      return [{ xAxis: localIdx, lineStyle: { color: '#3b82f6', width: 1.5, type: 'solid' }, label: { show: true, formatter: `compra ${fmtTradeDate(tradeMs)}`, color: '#3b82f6', fontSize: 9, position: 'insideStartTop', padding: [3, 5] } }];
    });
  })();

  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData];
  const markLineConfig   = allMarkLineData.length ? { silent: true, symbol: 'none', data: allMarkLineData } : null;

  const closes  = candlesticks.slice(-DL).map(c => c.close);
  const rsiData = rsi ? rsi.slice(-DL) : [];

  const axisBase = (gridIndex, showLabel) => ({
    gridIndex,
    type: 'category',
    data: xData,
    boundaryGap: false,
    axisLine:  { lineStyle: { color: G_DIM } },
    axisLabel: { show: showLabel, color: G_LABEL, fontSize: 9 },
    splitLine: { show: false },
    axisTick:  { show: false },
  });

  const yAxisBase = (gridIndex, extra = {}) => ({
    gridIndex,
    scale: true,
    position: 'right',
    axisLine:  { lineStyle: { color: G_DIM } },
    axisLabel: { color: G_LABEL, fontSize: 9 },
    splitLine: { lineStyle: { color: G_DIM, type: 'dashed' } },
    ...extra,
  });

  return {
    backgroundColor: BG,
    title: {
      text: symbol, subtext: interval, left: 12, top: 8,
      textStyle:    { color: G,         fontSize: 15, fontWeight: 'bold', fontFamily: 'monospace' },
      subtextStyle: { color: G_LABEL,   fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0d1f14ee',
      borderColor: G_DIM,
      textStyle: { color: G, fontSize: 11 },
      axisPointer: { animation: false, type: 'cross', lineStyle: { color: 'rgba(34,197,94,0.3)', width: 1 } },
    },
    grid: showRsi
      ? [{ top: 40, bottom: '26%', left: 12, right: 64 }, { top: '78%', bottom: 20, left: 12, right: 64 }]
      : [{ top: 40, bottom: 20,    left: 12, right: 64 }],
    xAxis: showRsi
      ? [{ ...axisBase(0, false) }, { ...axisBase(1, true) }]
      : { ...axisBase(0, true) },
    yAxis: showRsi
      ? [yAxisBase(0), yAxisBase(1, { scale: false, min: 0, max: 100, interval: 30 })]
      : yAxisBase(0),
    dataZoom: [{ type: 'inside', xAxisIndex: showRsi ? [0, 1] : [0] }],
    series: [
      {
        name: 'Preço',
        type: 'line',
        xAxisIndex: 0, yAxisIndex: 0,
        data: closes,
        showSymbol: false,
        lineStyle: { color: G, width: 1.5 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(34,197,94,0.28)' }, { offset: 1, color: 'rgba(34,197,94,0.02)' }] },
        },
        ...(markLineConfig ? { markLine: markLineConfig } : {}),
      },
      ...(showRsi && rsiData.length ? [{
        name: 'RSI',
        type: 'line',
        xAxisIndex: 1, yAxisIndex: 1,
        data: rsiData,
        showSymbol: false,
        lineStyle: { color: '#4ade80', width: 1.2 },
        markLine: {
          silent: true, symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef5350', type: 'dashed', width: 1 }, label: { formatter: '30', color: '#ef5350', fontSize: 9, position: 'start' } },
            ...(showRsi50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.6 }, label: { formatter: '50', color: '#facc15', fontSize: 9, position: 'start' } }] : []),
            { yAxis: 70, lineStyle: { color: G,         type: 'dashed', width: 1 }, label: { formatter: '70', color: G,         fontSize: 9, position: 'start' } },
          ],
        },
      }] : []),
    ],
  };
}

// ── Painel de histórico de trades (aba Matrix) ───────────────────────────────

function fmtDate(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return p;
  return n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2);
}

function TradeHistoryPanel({ symbol, gateFavorites }) {
  const { allTrades, setAllTrades, setTradePurchases } = useCurrency();
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    if (!symbol) return;
    doRefresh();
    const id = setInterval(doRefresh, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  async function doRefresh() {
    if (!symbol || refreshing) return;
    setRefreshing(true);
    try {
      const useGate = gateFavorites.has(symbol);
      const trades  = await (useGate ? fetchGateTrades(symbol) : fetchBinanceTrades(symbol));
      setAllTrades(trades);
      setTradePurchases(trades.filter(t => t.isBuyer));
      setLastUpdate(new Date());
    } catch (e) {
      console.warn('[TradeHistoryPanel] refresh:', e.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Apenas trades executados (buys + sells), do mais recente ao mais antigo
  const sorted = [...allTrades].sort((a, b) => Number(b.time) - Number(a.time));

  const base = symbol
    ? (symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol)
    : '';

  const buys  = allTrades.filter(t =>  t.isBuyer);
  const sells = allTrades.filter(t => !t.isBuyer);
  const totalBuy  = buys.reduce((s, t)  => s + parseFloat(t.price) * parseFloat(t.qty), 0);
  const totalSell = sells.reduce((s, t) => s + parseFloat(t.price) * parseFloat(t.qty), 0);

  return (
    <div className="flex flex-col h-full bg-[#050d0a] border-l border-[#0a2a1a] font-mono select-none">

      {/* Header — compacto em mobile, completo em sm+ */}
      <div className="flex items-center justify-between px-1.5 sm:px-3 py-1.5 sm:py-2 border-b border-[#0a2a1a] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="hidden sm:inline text-green-400 tracking-widest text-[10px] font-bold uppercase">
            Executados
          </span>
          {base && (
            <span className="hidden sm:inline text-green-700 text-[10px]">/ {base}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {lastUpdate && (
            <span className="hidden sm:inline text-green-900 text-[9px]">
              {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={doRefresh}
            disabled={refreshing}
            title="Atualizar"
            className="text-green-700 hover:text-green-400 transition-colors disabled:opacity-30 text-base leading-none"
          >
            {refreshing ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {!symbol && (
          <p className="text-green-900 text-center mt-8 text-[10px]">—</p>
        )}
        {symbol && sorted.length === 0 && !refreshing && (
          <p className="text-green-900 text-center mt-8 text-[10px]">vazio</p>
        )}

        {sorted.map((tr, i) => {
          const isBuy    = tr.isBuyer;
          const price    = parseFloat(tr.price);
          const qty      = parseFloat(tr.qty);
          const usdt     = (price * qty).toFixed(2);
          const color    = isBuy ? '#22c55e' : '#ef4444';
          const dimColor = isBuy ? '#14532d' : '#450a0a';
          const timeOnly = fmtDate(Number(tr.time)).slice(-5); // "14:32"

          return (
            <div key={i} className="px-1.5 sm:px-3 py-1 sm:py-2 border-b" style={{ borderColor: '#0a1f14' }}>

              {/* Linha topo: badge + data */}
              <div className="flex items-center justify-between gap-1">
                <span
                  className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0"
                  style={{ color, background: dimColor }}
                >
                  {isBuy ? '▲' : '▼'}
                  <span className="hidden sm:inline"> {isBuy ? 'COMPRA' : 'VENDA'}</span>
                </span>
                {/* Mobile: só hora | sm+: data completa */}
                <span className="text-[9px] sm:text-[10px] truncate" style={{ color: '#1a5c32' }}>
                  <span className="sm:hidden">{timeOnly}</span>
                  <span className="hidden sm:inline">{fmtDate(Number(tr.time))}</span>
                </span>
              </div>

              {/* Preço (sempre visível) */}
              <div className="mt-0.5 text-[10px] sm:text-[12px] font-semibold" style={{ color }}>
                {fmtPrice(tr.price)}
              </div>

              {/* Qty e USDT — só em sm+ */}
              <div className="hidden sm:flex items-baseline gap-1.5 mt-0.5" style={{ color }}>
                <span className="text-[10px] opacity-50">×</span>
                <span className="text-[10px] opacity-80">{qty.toFixed(4)}</span>
              </div>
              <div className="hidden sm:block text-[10px] mt-0.5" style={{ color: '#1a6b38' }}>
                ≈ ${usdt} USDT
              </div>

            </div>
          );
        })}
      </div>

      {/* Rodapé */}
      {sorted.length > 0 && (
        <div className="border-t px-1.5 sm:px-3 py-1 sm:py-2 shrink-0 space-y-0.5" style={{ borderColor: '#0a2a1a' }}>
          {/* Mobile: contagens compactas */}
          <div className="flex justify-between text-[9px] sm:hidden">
            <span style={{ color: '#1a5c32' }}>▲{buys.length}</span>
            <span style={{ color: '#5c1a1a' }}>▼{sells.length}</span>
          </div>
          {/* sm+: totais completos */}
          <div className="hidden sm:flex justify-between text-[10px]">
            <span style={{ color: '#1a5c32' }}>Compras ({buys.length})</span>
            <span style={{ color: '#22c55e' }}>${totalBuy.toFixed(2)}</span>
          </div>
          <div className="hidden sm:flex justify-between text-[10px]">
            <span style={{ color: '#5c1a1a' }}>Vendas ({sells.length})</span>
            <span style={{ color: '#ef4444' }}>${totalSell.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CandlestickChart() {
  const { selectedChart, setSelectedChart, chartZoom, tradePurchases, gateFavorites } = useCurrency();
  const { t } = useI18n();
  const chartRef = useRef(null);
  const [currentInterval, setCurrentInterval] = useState(DEFAULT_INTERVAL);
  const [loadingInterval, setLoadingInterval] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const [activeIndicators, setActiveIndicators] = useState(['ma200', 'rsi']);
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'matrix'

  useEffect(() => {
    fetchUserPrefs().then(prefs => {
      if (prefs?.chartInterval && INTERVALS.includes(prefs.chartInterval)) {
        setCurrentInterval(prefs.chartInterval);
      }
    });
  }, []);

  // Sincroniza o botão de intervalo ativo quando o chart muda externamente
  // (ex: seleção de moeda Trade Now com intervalo próprio)
  useEffect(() => {
    if (selectedChart?.interval && INTERVALS.includes(selectedChart.interval)) {
      setCurrentInterval(selectedChart.interval);
    }
  }, [selectedChart]);

  function toggleIndicator(id) {
    setActiveIndicators((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  useEffect(() => {
    const handleThemeChange = () => setThemeTick(t => t + 1);
    window.addEventListener('palette-updated', handleThemeChange);
    return () => window.removeEventListener('palette-updated', handleThemeChange);
  }, []);

  const colors = useMemo(() => getThemeColors(), [themeTick]);

  async function handleIntervalChange(iv) {
    if (iv === currentInterval) return;
    setCurrentInterval(iv);
    saveUserPrefs({ chartInterval: iv });
    if (!selectedChart?.symbol) return;
    setLoadingInterval(true);
    try {
      const data = await fetchCandlesticksAndCloud(selectedChart.symbol, iv);
      setSelectedChart(data);
    } finally {
      setLoadingInterval(false);
    }
  }

  useEffect(() => {
    if (!chartZoom || !chartRef.current || !selectedChart?.candlesticks?.length) return;
    const candles = selectedChart.candlesticks;
    const startMs = new Date(chartZoom.startDate).getTime();
    const endMs   = new Date(chartZoom.endDate).getTime();
    const startIdx = candles.findIndex(c => Number(c.openTime) >= startMs);
    let   endIdx   = candles.findIndex(c => Number(c.openTime) >= endMs);
    if (startIdx === -1) return;
    if (endIdx === -1) endIdx = candles.length - 1;
    const s = Math.max(0, startIdx - 10);
    const e = Math.min(candles.length - 1, endIdx + 10);
    const startPct = (s / candles.length) * 100;
    const endPct   = (e / candles.length) * 100;
    const instance = chartRef.current.getEchartsInstance();
    instance.dispatchAction({ type: 'dataZoom', start: startPct, end: endPct });
  }, [chartZoom, selectedChart]);

  const tradeTimes = tradePurchases.map(t => Number(t.time));

  const displayLimit = (() => {
    const candles = selectedChart?.candlesticks;
    if (chartZoom) return candles?.length ?? LIMIT;
    if (!candles?.length || !tradeTimes.length) return LIMIT;
    const oldest = Math.min(...tradeTimes);
    const idx = candles.findIndex(c => Number(c.openTime) >= oldest);
    if (idx === -1 || idx >= candles.length - LIMIT) return LIMIT;
    return Math.min(candles.length, candles.length - idx + 5);
  })();

  const option = useMemo(() => {
    if (!selectedChart) return null;
    if (activeTab === 'matrix') {
      return buildMatrixOption(selectedChart, activeIndicators, displayLimit, chartZoom, tradeTimes);
    }
    return buildOption(selectedChart, colors, activeIndicators, displayLimit, chartZoom, tradeTimes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart, colors, activeIndicators, chartZoom, tradePurchases, activeTab]);

  if (!selectedChart || !option) {
    return (
      <div className="flex flex-1 items-center justify-center h-full text-p5 opacity-30">
        <div className="flex flex-col items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth="1" stroke="currentColor" className="w-16 h-16">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          <span className="text-sm tracking-wider">{t('chart.select')}</span>
        </div>
      </div>
    );
  }

  // ── Chart ECharts (usado em ambas as abas) ───────────────────────────────────
  const chartNode = (
    <ReactECharts
      ref={chartRef}
      option={option}
      notMerge={true}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-col px-3 pt-2 pb-1 shrink-0 gap-1 border-b border-p2/40">
        {/* Linha 0 — abas */}
        <div className="flex items-center gap-1 border-b border-p2/20 pb-1 mb-0.5">
          {[
            { id: 'chart',  label: 'Chart' },
            { id: 'matrix', label: 'Matrix' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-3 py-0.5 text-xs rounded font-mono transition-colors ${
                activeTab === id
                  ? 'bg-p4 text-white'
                  : 'text-p5/60 hover:text-p5 hover:bg-p3/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Linha 1 — intervalos */}
        <div className="flex items-center gap-1 flex-wrap">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => handleIntervalChange(iv)}
              disabled={loadingInterval}
              className={`px-2 py-0.5 text-xs rounded font-mono transition-colors disabled:opacity-40 ${
                currentInterval === iv
                  ? 'bg-p4 text-white'
                  : 'text-p5 hover:bg-p3/40 hover:text-white'
              }`}
            >
              {iv}
            </button>
          ))}
          {loadingInterval && (
            <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin ml-1" />
          )}
        </div>

      </div>

      {/* Conteúdo da aba */}
      {activeTab === 'chart' ? (
        <div className="flex-1 min-h-0 relative">
          {chartNode}
          {/* Botões de indicadores — canto superior direito do chart */}
          <div style={{ position: 'absolute', top: 6, right: 68, display: 'flex', flexDirection: 'column', gap: 3, zIndex: 10 }}>
            {INDICATOR_GROUPS.map(({ id, label, color }) => {
              const active = activeIndicators.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleIndicator(id)}
                  style={{
                    fontSize: 10, padding: '1px 7px', borderRadius: 4, cursor: 'pointer',
                    background: active ? color : 'transparent',
                    color:      active ? (id === 'ma200' ? '#000' : '#fff') : color,
                    border: `1px solid ${color}`,
                    opacity: active ? 1 : 0.5,
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? (id === 'ma200' ? '#000' : '#fff') : color, flexShrink: 0 }} />
                  {label}
                </button>
              );
            })}
          </div>
          {/* Botão RSI 50 — canto superior direito do painel RSI */}
          <button
            onClick={() => toggleIndicator('rsi50')}
            style={{
              position: 'absolute', top: 'calc(79% + 4px)', right: 68,
              fontSize: 10, padding: '1px 7px', borderRadius: 4, cursor: 'pointer',
              background: activeIndicators.includes('rsi50') ? '#facc15' : 'transparent',
              color:      activeIndicators.includes('rsi50') ? '#000' : '#facc15',
              border: '1px solid #facc15',
              opacity: activeIndicators.includes('rsi50') ? 1 : 0.5,
              transition: 'all 0.15s',
              zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: activeIndicators.includes('rsi50') ? '#000' : '#facc15', flexShrink: 0 }} />
            RSI 50
          </button>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Gráfico (lado esquerdo) */}
          <div className="flex-1 min-w-0 min-h-0 relative">
            {chartNode}
            {/* Botões de indicadores — canto superior direito */}
            <div style={{ position: 'absolute', top: 6, right: 68, display: 'flex', flexDirection: 'column', gap: 3, zIndex: 10 }}>
              {INDICATOR_GROUPS.map(({ id, label, color }) => {
                const active = activeIndicators.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleIndicator(id)}
                    style={{
                      fontSize: 10, padding: '1px 7px', borderRadius: 4, cursor: 'pointer',
                      background: active ? color : 'transparent',
                      color:      active ? (id === 'ma200' ? '#000' : '#fff') : color,
                      border: `1px solid ${color}`,
                      opacity: active ? 1 : 0.5,
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? (id === 'ma200' ? '#000' : '#fff') : color, flexShrink: 0 }} />
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => toggleIndicator('rsi50')}
              style={{
                position: 'absolute', top: 'calc(79% + 4px)', right: 68,
                fontSize: 10, padding: '1px 7px', borderRadius: 4, cursor: 'pointer',
                background: activeIndicators.includes('rsi50') ? '#facc15' : 'transparent',
                color:      activeIndicators.includes('rsi50') ? '#000' : '#facc15',
                border: '1px solid #facc15',
                opacity: activeIndicators.includes('rsi50') ? 1 : 0.5,
                transition: 'all 0.15s',
                zIndex: 10,
              }}
            >
              50
            </button>
          </div>
          {/* Painel de histórico (lado direito) */}
          <div className="w-24 sm:w-64 shrink-0 min-h-0 overflow-hidden">
            <TradeHistoryPanel
              symbol={selectedChart?.symbol}
              gateFavorites={gateFavorites}
            />
          </div>
        </div>
      )}
    </div>
  );
}
