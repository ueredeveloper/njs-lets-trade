import { useI18n } from '../i18n';
import StatsAccordion from './StatsAccordion';
import Tooltip from './Tooltip';

/**
 * Acordeão "MACD — e se confirmasse a entrada?" na aba Estatísticas → Momentum RSI, logo abaixo
 * do card "Volume 24h". Consome result.macdWhatIf (ver computeMacdWhatIf em
 * backend/utils/analyseRsiThresholdBacktest.js): análise contrafactual que, pra cada trade
 * fechado já simulado, olha o histograma do MACD (12/26/9) no instante do sinal e separa os
 * trades entre "o MACD teria vetado" (histograma ≤ 0) e "o MACD teria confirmado" (> 0).
 *
 * Responde direto: quantos stops o MACD evitaria, quantos ganhos ele confirmaria e quantos
 * ganhos ele deixaria de fora. Só aparece no modo moeda única (onde o card Volume 24h existe) e
 * quando há ao menos 1 trade fechado avaliado.
 */

function Cell({ value, label, tone, tip }) {
  const toneClass =
    tone === 'good' ? 'text-emerald-500' : tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-500' : 'text-p5';
  const cell = (
    <div className="flex flex-col items-center justify-center bg-p2/50 border border-p3/20 rounded px-1 py-1 min-w-[64px]">
      <span className={`text-sm font-bold ${toneClass}`}>{value}</span>
      <span className="text-[9px] text-p5/50 text-center leading-tight">{label}</span>
    </div>
  );
  return tip ? <Tooltip text={tip} maxW={240}>{cell}</Tooltip> : cell;
}

export default function MacdWhatIfAccordion({ stats }) {
  const { t } = useI18n();
  if (!stats) return null;

  const title = (
    <span>
      {t('stats.macd_wi.title')}
      <span className="normal-case tracking-normal text-p5/40">
        {' '}· {t('stats.macd_wi.sub')(stats.interval, stats.macdPeriods, stats.evaluated)}
      </span>
    </span>
  );

  if (!stats.evaluated) {
    return (
      <StatsAccordion title={title} titleAttr={t('stats.macd_wi.tip')}>
        <p className="text-p5/50 text-[10px]">
          {stats.warmupSkipped > 0 ? t('stats.macd_wi.warmup')(stats.warmupSkipped) : t('stats.macd_wi.empty')}
        </p>
      </StatsAccordion>
    );
  }

  return (
    <StatsAccordion title={title} titleAttr={t('stats.macd_wi.tip')}>
      <p className="text-p5/40 text-[9px] mb-1.5">{t('stats.macd_wi.hint')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
        <Cell value={stats.stopsAvoided} label={t('stats.macd_wi.stops_avoided')} tone="good" tip={t('stats.macd_wi.tip_stops_avoided')} />
        <Cell value={stats.gainsBlocked} label={t('stats.macd_wi.gains_blocked')} tone="warn" tip={t('stats.macd_wi.tip_gains_blocked')} />
        <Cell value={stats.gainsConfirmed} label={t('stats.macd_wi.gains_confirmed')} tone="good" tip={t('stats.macd_wi.tip_gains_confirmed')} />
        <Cell value={stats.stopsKept} label={t('stats.macd_wi.stops_kept')} tone="bad" tip={t('stats.macd_wi.tip_stops_kept')} />
      </div>

      <div className="mt-1.5 flex flex-col gap-0.5 text-[10px] text-p5/70 font-mono">
        <span>{t('stats.macd_wi.winrate')(stats.winRateWithoutMacdPct, stats.winRateWithMacdPct)}</span>
        <span>{t('stats.macd_wi.pnl')(stats.pnlWithoutMacdUsd, stats.pnlWithMacdUsd, stats.pnlBlockedUsd)}</span>
        {stats.warmupSkipped > 0 && (
          <span className="text-p5/40">{t('stats.macd_wi.warmup')(stats.warmupSkipped)}</span>
        )}
      </div>
    </StatsAccordion>
  );
}
