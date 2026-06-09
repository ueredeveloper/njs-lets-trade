import { useMemo, useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import convertOpenTime from '../utils/convertOpenTime';

const LIMIT = 66;
const C_UP   = '#26a69a';
const C_DOWN = '#ef5350';

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    bg:    style.getPropertyValue('--color-p1').trim() || '#1a0a25',
    panel: style.getPropertyValue('--color-p2').trim() || '#003f69',
    text:  style.getPropertyValue('--color-p5').trim() || '#b3aca4',
    axis:  style.getPropertyValue('--color-p4').trim() || '#157a8c',
  };
}

function buildRsiOption({ interval, candlesticks, rsi }, colors, show50) {
  const xData = (() => {
    const dates = candlesticks.slice(-LIMIT).map((c) => convertOpenTime(c.openTime, interval));
    return [...dates, ...new Array(24).fill('')];
  })();

  return {
    backgroundColor: colors.bg,
    grid: { top: 8, bottom: 20, left: 12, right: 64 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#003f69ee',
      borderColor: colors.axis,
      textStyle: { color: colors.text, fontSize: 11 },
      axisPointer: { type: 'cross', lineStyle: { color: colors.axis, width: 1, opacity: 0.6 } },
    },
    xAxis: {
      type: 'category',
      data: xData,
      axisLine: { lineStyle: { color: colors.panel } },
      axisLabel: { color: colors.text, fontSize: 9 },
      splitLine: { show: false },
    },
    yAxis: {
      min: 0, max: 100, scale: false,
      position: 'right',
      axisLine: { lineStyle: { color: colors.panel } },
      axisLabel: { color: colors.text, fontSize: 9 },
      splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } },
    },
    dataZoom: [{ type: 'inside' }],
    series: [{
      name: 'RSI(14)',
      type: 'line',
      data: (rsi ?? []).slice(-LIMIT),
      smooth: true,
      showSymbol: false,
      lineStyle: { color: '#a78bfa', width: 1.5 },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { type: 'dashed', opacity: 0.5 },
        data: [
          { yAxis: 30, lineStyle: { color: C_UP } },
          ...(show50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', opacity: 0.4 } }] : []),
          { yAxis: 70, lineStyle: { color: C_DOWN } },
        ],
        label: { show: true, formatter: '{c}', color: colors.text, fontSize: 9 },
      },
    }],
  };
}

export default function RsiChart() {
  const { selectedChart } = useCurrency();
  const [themeTick, setThemeTick] = useState(0);
  const [show50, setShow50] = useState(false);

  useEffect(() => {
    const fn = () => setThemeTick(t => t + 1);
    window.addEventListener('palette-updated', fn);
    return () => window.removeEventListener('palette-updated', fn);
  }, []);

  const colors    = useMemo(() => getThemeColors(), [themeTick]);
  const rsiOption = useMemo(() => selectedChart ? buildRsiOption(selectedChart, colors, show50) : null, [selectedChart, colors, show50]);

  if (!rsiOption) return null;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <ReactECharts
        option={rsiOption}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
      <button
        onClick={() => setShow50(v => !v)}
        style={{
          position: 'absolute', top: 4, left: 8,
          fontSize: 10, padding: '1px 7px', borderRadius: 4, cursor: 'pointer',
          background: show50 ? '#facc15' : 'transparent',
          color: show50 ? '#000' : '#facc15',
          border: '1px solid #facc15',
          opacity: show50 ? 1 : 0.55,
          transition: 'all 0.15s',
        }}
      >
        50
      </button>
    </div>
  );
}
