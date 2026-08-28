import { useMemo, useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { useI18n } from '../i18n';
import StatsAccordion from './StatsAccordion';

/**
 * Distribuição dos sinais de RSI Momentum pelas 5 faixas horizontais de mesma altura da nuvem D-1
 * (faixa 1 = fundo da nuvem, faixa 5 = topo — ver classifyCloudZone/computeCloudZoneStats em
 * backend/utils/analyseRsiThresholdBacktest.js). Acordeão (fechado por padrão) com um gráfico de
 * barras: faixa 1 embaixo subindo até a 5, comprimento = nº de sinais. Aparece na aba
 * Estatísticas → Momentum RSI quando o filtro "Nuvem D-1" está ligado.
 */

// Fundo (faixa 1, maior desconto) → topo (faixa 5, mais caro).
const ZONE_COLORS = ['#26a69a', '#8bc34a', '#facc15', '#fb923c', '#ef5350'];

function themeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    text: s.getPropertyValue('--color-p5').trim() || '#b3aca4',
    grid: s.getPropertyValue('--color-p2').trim() || '#003f69',
  };
}

/** Barras horizontais — faixa 1 embaixo subindo até a 5, comprimento = nº de sinais. */
function barsOption(zones, colors, t) {
  return {
    backgroundColor: 'transparent',
    grid: { top: 6, bottom: 6, left: 52, right: 40, containLabel: false },
    xAxis: { type: 'value', show: false, max: (v) => Math.ceil(v.max * 1.15) || 1 },
    yAxis: {
      type: 'category',
      // data[0] fica embaixo no eixo Y de categoria do ECharts → Faixa 1 embaixo, Faixa 5 em cima.
      data: zones.map((z) => `${t('stats.cloud_zone_part')} ${z.zone}`),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 11, fontWeight: 600 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#003f69ee',
      textStyle: { color: '#fff', fontSize: 11 },
      formatter: (p) => {
        const z = zones[p[0].dataIndex];
        const wr = z.winRatePct != null ? `${z.winRatePct}%` : '—';
        const pnl = z.avgPnlPct != null ? `${z.avgPnlPct >= 0 ? '+' : ''}${z.avgPnlPct}%` : '—';
        return `<b>${t('stats.cloud_zone_part')} ${z.zone}</b> — ${z.sharePct}%<br/>`
          + `${z.signals} ${t('stats.cloud_zone_signals').toLowerCase()}<br/>`
          + `${t('stats.cloud_zone_winrate')}: ${wr} · ${t('stats.cloud_zone_avg_pnl')}: ${pnl}`;
      },
    },
    series: [{
      type: 'bar',
      barWidth: '58%',
      data: zones.map((z, i) => ({
        value: z.signals,
        itemStyle: { color: ZONE_COLORS[i], borderRadius: [0, 3, 3, 0] },
      })),
      label: {
        show: true, position: 'right', color: colors.text,
        fontSize: 13, fontWeight: 700, formatter: (p) => `${p.value}`,
      },
    }],
  };
}

export default function CloudZoneChart({ stats, prevDayCloud }) {
  const { t } = useI18n();
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const fn = () => setThemeTick((n) => n + 1);
    window.addEventListener('palette-updated', fn);
    return () => window.removeEventListener('palette-updated', fn);
  }, []);

  const colors = useMemo(() => themeColors(), [themeTick]);
  const zones = useMemo(() => stats?.zones ?? [], [stats]);
  const option = useMemo(() => (zones.length ? barsOption(zones, colors, t) : null), [zones, colors, t]);

  if (!zones.length) return null;

  const cloudTag = prevDayCloud
    ? `${prevDayCloud.interval} · x${prevDayCloud.candleCount} · ${prevDayCloud.useHighLow ? t('stats.prevday_cloud_source_hl') : t('stats.prevday_cloud_source_oc')}`
    : null;

  const title = (
    <span>
      {t('stats.cloud_zone_title')}
      {cloudTag && <span className="normal-case tracking-normal text-p5/40"> ({cloudTag})</span>}
      <span className="normal-case tracking-normal text-p5/40"> · {stats.total} {t('stats.cloud_zone_signals').toLowerCase()}</span>
    </span>
  );

  return (
    <StatsAccordion title={title}>
      <p className="text-p5/40 text-[9px] mb-1">
        {t('stats.cloud_zone_part')} 1 = {t('stats.cloud_zone_bottom')} · {t('stats.cloud_zone_part')} 5 = {t('stats.cloud_zone_top')}
      </p>
      <ReactECharts option={option} style={{ height: 150, width: '100%' }} opts={{ renderer: 'canvas' }} />
    </StatsAccordion>
  );
}
