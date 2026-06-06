import { useMemo, useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud } from '../services/api';
import convertOpenTime from '../utils/convertOpenTime';

const LIMIT = 66;
const INTERVALS = ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];

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


function buildOption({ symbol, interval, candlesticks, ichimokuCloud, movingAverage, rsi }, colors, activeIndicators, displayLimit = LIMIT, zoomPeriod = null) {
  const showMa200    = activeIndicators.includes('ma200');
  const showIchimoku = activeIndicators.includes('ichimoku');
  const showRsi      = activeIndicators.includes('rsi');
  const DL = Math.min(displayLimit, candlesticks.length);

  const xData = (() => {
    const dates = candlesticks.map((c) => convertOpenTime(c.openTime, interval));
    const padding = new Array(24).fill('');
    return [...dates, ...padding].slice(-(DL + 24));
  })();

  // Linhas verticais suaves de início e fim do ciclo clicado
  // Usa índice numérico — convertOpenTime retorna strings curtas não únicas (ex: "22:00")
  // que o ECharts não consegue localizar com segurança no eixo de categoria.
  const periodMarkLines = (() => {
    if (!zoomPeriod) return null;
    const startMs  = new Date(zoomPeriod.startDate).getTime();
    const endMs    = new Date(zoomPeriod.endDate).getTime();
    const startIdx = candlesticks.findIndex(c => Number(c.openTime) >= startMs);
    const endIdx   = candlesticks.reduce((best, c, i) =>
      Number(c.openTime) <= endMs ? i : best, -1);
    if (startIdx === -1 && endIdx === -1) return null;
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
    return data.length ? { silent: true, symbol: 'none', data } : null;
  })();

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
      ...(periodMarkLines ? { markLine: periodMarkLines } : {}),
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

  // Modo dual-grid: candles (80%) + RSI (20%)
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
            { yAxis: 70, lineStyle: { color: '#26a69a', type: 'dashed', width: 1 },
              label: { formatter: '70', color: '#26a69a', fontSize: 9, position: 'start' } },
          ],
        },
      },
    ],
  };
}

export default function CandlestickChart() {
  const { selectedChart, setSelectedChart, chartZoom } = useCurrency();
  const { t } = useI18n();
  const chartRef = useRef(null);
  const [currentInterval, setCurrentInterval] = useState('30m');
  const [loadingInterval, setLoadingInterval] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const [activeIndicators, setActiveIndicators] = useState(['ma200', 'rsi']);

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
    if (!selectedChart?.symbol || iv === currentInterval) return;
    setCurrentInterval(iv);
    setLoadingInterval(true);
    try {
      const data = await fetchCandlesticksAndCloud(selectedChart.symbol, iv);
      setSelectedChart(data);
    } finally {
      setLoadingInterval(false);
    }
  }

  // Zoom para o período do ciclo clicado nas estatísticas
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

  const displayLimit = chartZoom ? (selectedChart?.candlesticks?.length ?? LIMIT) : LIMIT;

  const option = useMemo(() => {
    if (!selectedChart) return null;
    return buildOption(selectedChart, colors, activeIndicators, displayLimit, chartZoom);
  }, [selectedChart, colors, activeIndicators, displayLimit, chartZoom]);

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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-col px-3 pt-2 pb-1 shrink-0 gap-1 border-b border-p2/40">
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

        {/* Linha 2 — indicadores */}
        <div className="flex items-center gap-1.5">
          {INDICATOR_GROUPS.map(({ id, label, color }) => {
            const active = activeIndicators.includes(id);
            return (
              <button
                key={id}
                onClick={() => toggleIndicator(id)}
                style={active ? { borderColor: color, color } : {}}
                className={`flex items-center gap-1.5 px-2.5 py-0.5 text-xs rounded border transition-colors ${
                  active
                    ? 'bg-p2/60 border-current'
                    : 'border-p3/30 text-p5/50 hover:border-p3 hover:text-p5'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: active ? color : '#555' }}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Gráfico candlestick */}
      <div className="flex-1 min-h-0">
        <ReactECharts
          ref={chartRef}
          option={option}
          notMerge={true}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>

    </div>
  );
}
