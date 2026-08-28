import { useMemo, useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { useI18n } from '../i18n';
import StatsAccordion from './StatsAccordion';

/**
 * Distribuição dos sinais de RSI Momentum pelas faixas de RSI 1h no instante do sinal (ver
 * RSI_1H_BANDS / computeRsi1hBreakdown em backend/utils/analyseRsiThresholdBacktest.js) —
 * responde "quantos stops tiveram RSI 1h baixo? quantos alvos tiveram RSI 1h alto?". Acordeão
 * (fechado por padrão) com barras horizontais empilhadas: faixa mais baixa embaixo subindo até a
 * mais alta, cada barra dividida em Alvo (verde) / Stop (vermelho) / resto (cinza — abertos e não
 * preenchidos). Mesmo padrão do gráfico "Sinais por faixa da nuvem D-1". Aparece sempre que há
 * ocorrências com RSI 1h resolvido (o RSI 1h é calculado em toda busca, ver REF_RSI_INTERVAL).
 */

const TARGET_COLOR = '#26a69a';
const STOP_COLOR   = '#ef5350';
const REST_COLOR   = '#64748b';

function themeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    text: s.getPropertyValue('--color-p5').trim() || '#b3aca4',
  };
}

function barsOption(bands, colors, t) {
  const rest = (b) => Math.max(0, b.signals - b.target - b.stop);
  const mk = (name, color, pick, rounded) => ({
    name,
    type: 'bar',
    stack: 'total',
    barWidth: '58%',
    data: bands.map((b) => ({ value: pick(b), itemStyle: { color, borderRadius: rounded } })),
  });
  return {
    backgroundColor: 'transparent',
    grid: { top: 6, bottom: 6, left: 58, right: 44, containLabel: false },
    legend: {
      show: true, top: 0, right: 0, itemWidth: 9, itemHeight: 9,
      textStyle: { color: colors.text, fontSize: 10 },
      data: [t('stats.rsi1h_target'), t('stats.rsi1h_stop'), t('stats.rsi1h_rest')],
    },
    xAxis: { type: 'value', show: false, max: (v) => Math.ceil(v.max * 1.15) || 1 },
    yAxis: {
      type: 'category',
      // data[0] fica embaixo → faixa mais baixa de RSI 1h embaixo, mais alta em cima.
      data: bands.map((b) => b.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 11, fontWeight: 600 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#003f69ee',
      textStyle: { color: '#fff', fontSize: 11 },
      formatter: (p) => {
        const b = bands[p[0].dataIndex];
        const wr = b.winRatePct != null ? `${b.winRatePct}%` : '—';
        const pnl = b.avgPnlPct != null ? `${b.avgPnlPct >= 0 ? '+' : ''}${b.avgPnlPct}%` : '—';
        return `<b>RSI 1h ${b.label}</b> — ${b.sharePct}%<br/>`
          + `${b.signals} ${t('stats.cloud_zone_signals').toLowerCase()} `
          + `(${b.target}✓ / ${b.stop}✗${rest(b) ? ` / ${rest(b)}·` : ''})<br/>`
          + `${t('stats.cloud_zone_winrate')}: ${wr} · ${t('stats.cloud_zone_avg_pnl')}: ${pnl}`;
      },
    },
    series: [
      mk(t('stats.rsi1h_target'), TARGET_COLOR, (b) => b.target, [3, 0, 0, 3]),
      mk(t('stats.rsi1h_stop'), STOP_COLOR, (b) => b.stop, [0, 0, 0, 0]),
      {
        ...mk(t('stats.rsi1h_rest'), REST_COLOR, rest, [0, 3, 3, 0]),
        label: {
          show: true, position: 'right', color: colors.text,
          fontSize: 12, fontWeight: 700,
          formatter: (p) => `${bands[p.dataIndex].signals}`,
        },
      },
    ],
  };
}

export default function Rsi1hBreakdownChart({ stats }) {
  const { t } = useI18n();
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const fn = () => setThemeTick((n) => n + 1);
    window.addEventListener('palette-updated', fn);
    return () => window.removeEventListener('palette-updated', fn);
  }, []);

  const colors = useMemo(() => themeColors(), [themeTick]);
  const bands = useMemo(() => stats?.bands ?? [], [stats]);
  const option = useMemo(() => (bands.length ? barsOption(bands, colors, t) : null), [bands, colors, t]);

  if (!bands.length || !bands.some((b) => b.signals > 0)) return null;

  const title = (
    <span>
      {t('stats.rsi1h_title')}
      <span className="normal-case tracking-normal text-p5/40">
        {' '}· {t('stats.rsi1h_avg')} {stats.avgRsi1h} · {stats.total} {t('stats.cloud_zone_signals').toLowerCase()}
      </span>
    </span>
  );

  return (
    <StatsAccordion title={title} titleAttr={t('stats.tip.rsi1h_breakdown')}>
      <p className="text-p5/40 text-[9px] mb-1">{t('stats.rsi1h_hint')}</p>
      <ReactECharts option={option} style={{ height: 160, width: '100%' }} opts={{ renderer: 'canvas' }} />
    </StatsAccordion>
  );
}
