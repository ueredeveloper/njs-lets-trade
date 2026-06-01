import { useMemo, useState, useEffect } from 'react';
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


function buildOption({ symbol, interval, candlesticks, ichimokuCloud, movingAverage }, colors, activeIndicators) {
  const showMa200    = activeIndicators.includes('ma200');
  const showIchimoku = activeIndicators.includes('ichimoku');

  const xData = (() => {
    const dates = candlesticks.map((c) => convertOpenTime(c.openTime, interval));
    const padding = new Array(24).fill('');
    return [...dates, ...padding].slice(-(LIMIT + 24));
  })();

  const series = [
    {
      name: 'Candles',
      type: 'candlestick',
      data: candlesticks.slice(-LIMIT).map((c) => [c.open, c.close, c.low, c.high]),
      itemStyle: {
        color: C_UP, color0: C_DOWN,
        borderColor: C_UP, borderColor0: C_DOWN,
      },
    },
  ];

  if (showMa200) {
    series.push({
      name: 'MA200',
      type: 'line',
      data: movingAverage.slice(-LIMIT),
      smooth: true, showSymbol: false,
      lineStyle: { color: '#f59e0b', width: 1.5 },
    });
  }

  if (showIchimoku) {
    series.push(
      {
        name: 'CL',
        type: 'line',
        data: ichimokuCloud.slice(-LIMIT).map((c) => c.conversion),
        smooth: true, showSymbol: false,
        lineStyle: { color: '#60a5fa', width: 1 },
      },
      {
        name: 'BL',
        type: 'line',
        data: ichimokuCloud.slice(-LIMIT).map((c) => c.base),
        smooth: true, showSymbol: false,
        lineStyle: { color: '#94a3b8', width: 1 },
      },
      {
        name: 'Span A',
        type: 'line',
        data: ichimokuCloud.slice(-(LIMIT + 24)).map((c) => c.spanA),
        showSymbol: false,
        lineStyle: { color: C_UP, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(38,166,154,0.05)' },
      },
      {
        name: 'Span B',
        type: 'line',
        data: ichimokuCloud.slice(-(LIMIT + 24)).map((c) => c.spanB),
        smooth: true, showSymbol: false,
        lineStyle: { color: C_DOWN, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(239,83,80,0.05)' },
      },
    );
  }

  return {
    backgroundColor: colors.bg,
    title: {
      text: symbol,
      subtext: interval,
      left: 12,
      top: 8,
      textStyle: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
      subtextStyle: { color: colors.axis, fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#003f69ee',
      borderColor: colors.axis,
      textStyle: { color: colors.text, fontSize: 11 },
      axisPointer: {
        animation: false,
        type: 'cross',
        lineStyle: { color: colors.axis, width: 1, opacity: 0.8 },
      },
    },
    xAxis: {
      type: 'category',
      data: xData,
      axisLine: { lineStyle: { color: colors.panel } },
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      scale: true,
      position: 'right',
      axisLine: { lineStyle: { color: colors.panel } },
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } },
    },
    grid: { top: 40, bottom: 12, left: 12, right: 64 },
    dataZoom: [{ type: 'inside' }],
    series,
  };
}

export default function CandlestickChart() {
  const { selectedChart, setSelectedChart } = useCurrency();
  const [currentInterval, setCurrentInterval] = useState('1h');
  const [loadingInterval, setLoadingInterval] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const [activeIndicators, setActiveIndicators] = useState(['ma200']);

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

  // Quando o símbolo muda externamente (ex: click na tabela), sincroniza o intervalo
  useEffect(() => {
    if (selectedChart?.interval) {
      setCurrentInterval(selectedChart.interval);
    }
  }, [selectedChart?.symbol]);

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

  const option = useMemo(() => {
    if (!selectedChart) return null;
    return buildOption(selectedChart, colors, activeIndicators);
  }, [selectedChart, colors, activeIndicators]);

  if (!selectedChart || !option) {
    return (
      <div className="flex flex-1 items-center justify-center h-full text-p5 opacity-30">
        <div className="flex flex-col items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth="1" stroke="currentColor" className="w-16 h-16">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          <span className="text-sm tracking-wider">Selecione uma moeda para ver o gráfico</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barra de intervalos + indicadores */}
      <div className="flex items-center gap-1 px-3 pt-2 shrink-0 flex-wrap">
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

        <span className="ml-2 text-p3/60 select-none">|</span>

        {INDICATOR_GROUPS.map(({ id, label, color }) => {
          const active = activeIndicators.includes(id);
          return (
            <button
              key={id}
              onClick={() => toggleIndicator(id)}
              className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors ${
                active
                  ? 'text-white bg-p3/40'
                  : 'text-p5/40 hover:text-p5'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full inline-block shrink-0"
                style={{ backgroundColor: active ? color : '#555' }}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* Gráfico candlestick */}
      <div className="flex-1 min-h-0">
        <ReactECharts
          option={option}
          notMerge={true}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>

    </div>
  );
}
