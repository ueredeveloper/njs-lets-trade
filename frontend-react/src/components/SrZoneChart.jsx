import { useMemo, useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { useI18n } from '../i18n';
import StatsAccordion from './StatsAccordion';

/**
 * Distribuição dos sinais de RSI Momentum pelas 5 faixas do canal Suporte→Resistência escolhido
 * (faixa 1 = colado no suporte de entrada / "barato", faixa 5 = colado na resistência de saída /
 * "caro" — ver classifySrZone/computeSupportResistanceZoneStats em
 * backend/utils/analyseRsiThresholdBacktest.js). Aparece na aba Estatísticas → Momentum RSI
 * quando a seção "S/R" está ligada.
 */

// Faixas de distância % do preço de entrada ACIMA da linha de suporte escolhida
// (ver classifySrZone / SR_DISTANCE_BANDS em backend/utils/analyseRsiThresholdBacktest.js).
// Faixa 1 = colado no suporte (verde) → faixa 5 = longe do suporte (vermelho).
const ZONE_COLORS = ['#26a69a', '#8bc34a', '#facc15', '#fb923c', '#ef5350'];
const ZONE_LABELS = ['≤ 3%', '≤ 6%', '≤ 10%', '≤ 20%', '> 20%'];

function themeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    text: s.getPropertyValue('--color-p5').trim() || '#b3aca4',
    grid: s.getPropertyValue('--color-p2').trim() || '#003f69',
  };
}

/** Barras horizontais — faixa 1 embaixo (colado no suporte) subindo até a 5 (longe do suporte). */
function barsOption(zones, colors, t) {
  return {
    backgroundColor: 'transparent',
    grid: { top: 6, bottom: 6, left: 52, right: 40, containLabel: false },
    xAxis: { type: 'value', show: false, max: (v) => Math.ceil(v.max * 1.15) || 1 },
    yAxis: {
      type: 'category',
      data: zones.map((z) => ZONE_LABELS[z.zone - 1] ?? `${t('stats.sr_zone_part')} ${z.zone}`),
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
        return `<b>${t('stats.sr_zone_part')} ${ZONE_LABELS[z.zone - 1] ?? z.zone}</b> — ${z.sharePct}%<br/>`
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

export default function SrZoneChart({ stats, sr, blocked = 0 }) {
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

  const maxPctTag = sr
    ? (sr.entryMaxPctMode === 'adapt' ? `ADAPT ≤${sr.entryMaxPct}%` : `≤${sr.entryMaxPct}%`)
    : null;
  const srTag = sr
    ? `${sr.interval} · x${sr.candleCount} · S${sr.entrySupportRank}↓ / R${sr.exitResistanceRank}↑ · ${maxPctTag}`
    : null;

  const title = (
    <span>
      {t('stats.sr_zone_title')}
      {srTag && <span className="normal-case tracking-normal text-p5/40"> ({srTag})</span>}
      <span className="normal-case tracking-normal text-p5/40"> · {stats.total} {t('stats.cloud_zone_signals').toLowerCase()}</span>
      {blocked > 0 && <span className="normal-case tracking-normal text-p5/40"> · {blocked} {t('stats.sr_blocked')}</span>}
    </span>
  );

  return (
    <StatsAccordion title={title}>
      <p className="text-p5/40 text-[9px] mb-1">
        {t('stats.sr_zone_hint')}
      </p>
      <ReactECharts option={option} style={{ height: 150, width: '100%' }} opts={{ renderer: 'canvas' }} />
    </StatsAccordion>
  );
}
