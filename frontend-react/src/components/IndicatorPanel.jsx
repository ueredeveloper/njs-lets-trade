import { useState, useEffect } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesAndIndicators, fetchIndicatorSearch, fetchMaFilter, fetchMaTimeAboveFilter, fetchMaCrossoverFilter, fetchMaCompareFilter, fetchMarketCapFilter, fetchUserPrefs, saveUserPrefs } from '../services/api';
import { useI18n } from '../i18n';
import {
  createRsiFilter,
  lastRsiAbove10Bellow20, lastRsiAbove20Bellow30, lastRsiAbove30Bellow40,
  lastRsiAbove40Bellow50, lastRsiAbove50Bellow60, lastRsiAbove60Bellow70,
  lastRsiAbove70Bellow80, lastRsiAbove80Bellow90, lastRsiAbove70Bellow99,
} from '../utils/createRsiFilter';
import {
  createIchimokuFilter,
  conversionAboveBase, conversionBellowBase,
  conversionAboveSpanA, conversionAboveSpanB, conversionAboveSpanAAndSpanB,
  conversionAboveHighCandle, conversionAboveLowCandle, conversionAboveCloseCandle,
} from '../utils/createIchimokuFilter';
import Tooltip from './Tooltip';
import { MA_CROSS_PERIOD_MIN, MA_CROSS_PERIOD_MAX } from '../constants/maCrossConfigSchema';
import { buildMaCrossFilterName, buildMaCompareFilterName } from '../utils/filterNames';

const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000,
};

function finestInterval(a, b) {
  return (INTERVAL_MS[a] ?? 3_600_000) <= (INTERVAL_MS[b] ?? 3_600_000) ? a : b;
}

/** Intervalos de candle das MAs (uma busca por intervalo). */
function resolveMacrossIntervalPairs(ind) {
  if (ind.mixedIntervals) {
    const iv1 = ind.ma1Interval ?? ind.intervals?.[0] ?? '15m';
    const iv2 = ind.ma2Interval ?? ind.intervals?.[0] ?? '15m';
    return [{ iv1, iv2 }];
  }
  const list = ind.intervals?.length ? ind.intervals : ['15m'];
  return list.map((iv) => ({ iv1: iv, iv2: iv }));
}

/** Janelas temporais “cruzou há” (uma busca por id; independente do intervalo de candle). */
function resolveMacrossAgeWindows(ind) {
  if (ind.ageWindows?.length) return ind.ageWindows;
  if (ind.maxAgeMin != null && ind.maxAgeMin !== '') return [ind.maxAgeMin];
  return ['last'];
}

function macrossAgeLabel(id, t) {
  const opt = MA_CROSS_AGE_OPTIONS.find((a) => a.id === id);
  return opt ? t(opt.labelKey) : id;
}

const MA_CROSS_MODES = [
  { id: 'cross_up',   labelKey: 'macross.mode.cross_up' },
  { id: 'cross_down', labelKey: 'macross.mode.cross_down' },
  { id: 'near_up',    labelKey: 'macross.mode.near_up' },
  { id: 'near_down',  labelKey: 'macross.mode.near_down' },
];

const MA_CROSS_AGE_OPTIONS = [
  { id: 'last', labelKey: 'macross.age.last' },
  { id: '1',    labelKey: 'macross.age.1' },
  { id: '5',    labelKey: 'macross.age.5' },
  { id: '15',   labelKey: 'macross.age.15' },
  { id: '30',   labelKey: 'macross.age.30' },
  { id: '60',   labelKey: 'macross.age.60' },
  { id: '240',  labelKey: 'macross.age.240' },
  { id: '1440', labelKey: 'macross.age.1440' },
];

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];

const INTERVAL_LABELS = {
  '1m': '1 minuto', '5m': '5 minutos', '15m': '15 minutos',
  '1h': '1 hora', '2h': '2 horas', '4h': '4 horas',
  '6h': '6 horas', '8h': '8 horas', '12h': '12 horas',
  '1d': '1 dia', '3d': '3 dias', '1w': '1 semana',
};

// Descrições e labels traduzidos via t() dentro dos componentes

const EMPTY_INDICATOR = { type: '', intervals: ['8h'] };

const DEFAULT_INDICATORS = [
  { type: 'maCompare', intervals: ['1h'], ma1Period: '9', ma2Period: '21', compare: 'above', tolerancePct: '0.5' },
  { type: 'maCompare', intervals: ['1h'], ma1Period: '9', ma2Period: '21', compare: 'bellow', tolerancePct: '0.5' },
  { type: 'movingAverage', intervals: ['1h', '4h'], length: '50', compare: 'above', candle: 'close' },
  { type: 'maCrossover', intervals: ['15m'], ma1Period: '9', ma2Period: '21', signalMode: 'cross_up', ageWindows: ['last', '1', '5'], tolerancePct: '0.5', mixedIntervals: false },
];

/** Gera um resumo legível da configuração do indicador */
function buildSummary(value, t) {
  const { type, intervals } = value;
  if (!type) return null;
  const ivLabel = intervals.length ? intervals.join(', ') : '—';

  if (type === 'relativeStrengthIndex') {
    const c1 = (value.compare1 ?? 'above') === 'above' ? t('sum.above') : t('sum.bellow');
    const v1 = value.line1 ?? '70';
    const c2 = (value.compare2 ?? 'bellow') === 'above' ? t('sum.above') : t('sum.bellow');
    const v2 = value.line2 ?? '99';
    return t('sum.rsi', c1, v1, c2, v2, ivLabel);
  }
  if (type === 'ichimokuCloud') {
    const l1  = value.line1 ?? 'conversion';
    const cmp = (value.compare ?? 'above') === 'above' ? t('sum.above') : t('sum.bellow');
    const l2  = value.line2 ?? 'base';
    return t('sum.ichimoku', l1, cmp, l2, ivLabel);
  }
  if (type === 'marketCap') {
    const metricLabel = value.metric === 'dilution' ? t('mcap.dilution') : t('mcap.turnover');
    const presetLabel = { baixo: 'baixo', medio: 'médio', alto: 'alto' }[value.preset ?? 'baixo'] ?? '';
    return t('sum.mcap', metricLabel, presetLabel);
  }
  if (type === 'movingAverage') {
    const len = value.length ?? '200';
    const cmp = (value.compare ?? 'above') === 'above' ? t('sum.above_short') : t('sum.bellow_short');
    const cdl = value.candle ?? 'close';
    return t('sum.ma', len, cmp, cdl, ivLabel);
  }
  if (type === 'maTimeAbove') {
    const pct = value.minPct ?? '70';
    const per = value.period ?? '50';
    return t('sum.ma_time_above', per, pct, ivLabel);
  }
  if (type === 'maCompare') {
    const p1 = value.ma1Period ?? '9';
    const p2 = value.ma2Period ?? '21';
    const cmpRaw = value.compare ?? 'above';
    if (cmpRaw === 'near_up' || cmpRaw === 'near_down') {
      const mode = MA_CROSS_MODES.find(m => m.id === cmpRaw);
      const modeLabel = mode ? t(mode.labelKey) : cmpRaw;
      return t('sum.ma_compare_near', p1, p2, modeLabel, ivLabel, value.proximityPct ?? '0.5');
    }
    const cmp = cmpRaw === 'above' ? t('sum.above_short') : t('sum.bellow_short');
    const tol = value.tolerancePct ?? '0.5';
    return t('sum.ma_compare', p1, p2, cmp, ivLabel, Number(tol) > 0 ? tol : '');
  }
  if (type === 'maCrossover') {
    const p1 = value.ma1Period ?? '9';
    const p2 = value.ma2Period ?? '21';
    const mode = MA_CROSS_MODES.find(m => m.id === (value.signalMode ?? 'cross_up'));
    const modeLabel = mode ? t(mode.labelKey) : value.signalMode;
    const ivDisplay = value.mixedIntervals
      ? `${value.ma1Interval ?? intervals[0] ?? '15m'} / ${value.ma2Interval ?? intervals[0] ?? '15m'}`
      : ivLabel;
    const ageLabel = resolveMacrossAgeWindows(value).map((id) => macrossAgeLabel(id, t)).join(', ');
    const extra = (value.signalMode ?? '').startsWith('near')
      ? t('sum.macross_prox', value.proximityPct ?? '1')
      : t('sum.macross_age', ageLabel, value.tolerancePct ?? '0');
    return t('sum.macross', p1, ivDisplay, p2, ivDisplay, modeLabel, extra);
  }
  return null;
}

function HelpIcon({ text }) {
  return (
    <Tooltip text={text} maxW={260}>
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-p3/60 text-p5/50 hover:text-p5 hover:border-p4 transition-colors cursor-default text-[9px] font-bold leading-none select-none">
        ?
      </span>
    </Tooltip>
  );
}


function indDescKey(type) {
  if (type === 'relativeStrengthIndex') return 'rsi';
  if (type === 'ichimokuCloud') return 'ichimoku';
  if (type === 'movingAverage') return 'ma';
  if (type === 'maTimeAbove') return 'ma_time_above';
  if (type === 'maCrossover') return 'ma_crossover';
  if (type === 'maCompare') return 'ma_compare';
  return 'marketcap';
}

function IndicatorRow({ value, onChange }) {
  const { type, intervals } = value;
  const { t } = useI18n();
  const [showPicker, setShowPicker] = useState(false);
  const [showAgePicker, setShowAgePicker] = useState(false);
  const ageWindows = resolveMacrossAgeWindows(value);
  const isMacrossCross = type === 'maCrossover' && !(value.signalMode ?? 'cross_up').startsWith('near');

  function toggleInterval(iv) {
    onChange({
      ...value,
      intervals: intervals.includes(iv)
        ? intervals.filter((i) => i !== iv)
        : [...intervals, iv],
    });
  }

  function addInterval(iv) {
    if (!intervals.includes(iv)) onChange({ ...value, intervals: [...intervals, iv] });
    setShowPicker(false);
  }

  function toggleAgeWindow(id) {
    const next = ageWindows.includes(id)
      ? ageWindows.filter((a) => a !== id)
      : [...ageWindows, id];
    onChange({ ...value, ageWindows: next, maxAgeMin: undefined });
  }

  function addAgeWindow(id) {
    if (!ageWindows.includes(id)) {
      onChange({ ...value, ageWindows: [...ageWindows, id], maxAgeMin: undefined });
    }
    setShowAgePicker(false);
  }

  const sel = 'bg-p2 border border-p3/40 text-p5 text-[10px] sm:text-xs rounded px-1 sm:px-2 py-0.5 sm:py-1 focus:outline-none focus:border-p4 min-w-0';
  const summary = buildSummary(value, t);

  return (
    <div className="flex w-full flex-col bg-p2/50 border border-p3/20 rounded p-2 gap-2">
      {/* Seletores — linha única no mobile */}
      <div className="flex w-full items-center gap-1 sm:gap-2 flex-nowrap sm:flex-wrap">
        {/* Tipo */}
        <div className="flex items-center gap-1 min-w-0 shrink-0">
          <select
            className={sel}
            value={type}
            onChange={(e) => {
              const newType = e.target.value;
              const next = { ...value, type: newType, params: {} };
              if (newType === 'maCompare') {
                next.intervals = ['1h'];
                next.ma1Period = '9';
                next.ma2Period = '21';
                next.compare = next.compare ?? 'above';
                next.tolerancePct = '0.5';
              }
              onChange(next);
            }}
            title="Escolha o indicador técnico a ser analisado"
          >
            <option value="">{t('ind.placeholder')}</option>
            <option value="ichimokuCloud">{t('ind.ichimoku')}</option>
            <option value="movingAverage">{t('ind.ma')}</option>
            <option value="maTimeAbove">{t('ind.ma_time_above')}</option>
            <option value="maCrossover">{t('ind.ma_crossover')}</option>
            <option value="maCompare">{t('ind.ma_compare')}</option>
            <option value="relativeStrengthIndex">{t('ind.rsi')}</option>
            <option value="marketCap">{t('ind.marketcap')}</option>
          </select>
          {type && t(`ind.desc.${indDescKey(type)}`) !== `ind.desc.${indDescKey(type)}` && (
            <HelpIcon text={t(`ind.desc.${indDescKey(type)}`)} />
          )}
        </div>


        {type === 'marketCap' && (
          <>
            <select className={sel} value={value.metric ?? 'turnover'}
              onChange={(e) => onChange({ ...value, metric: e.target.value })}
              title="Giro: volume÷market cap. Baixo = preço sem sustentação real. Diluição: tokens ainda não emitidos vs. cap atual.">
              <option value="turnover">{t('mcap.turnover')}</option>
              <option value="dilution">{t('mcap.dilution')}</option>
            </select>
            <select className={sel} value={value.preset ?? 'baixo'}
              onChange={(e) => onChange({ ...value, preset: e.target.value })}
              title={(value.metric ?? 'turnover') === 'turnover' ? t('mcap.tip_t') : t('mcap.tip_d')}>
              <option value="baixo">{(value.metric ?? 'turnover') === 'turnover' ? t('mcap.low_t') : t('mcap.low_d')}</option>
              <option value="medio">{(value.metric ?? 'turnover') === 'turnover' ? t('mcap.mid_t') : t('mcap.mid_d')}</option>
              <option value="alto">{(value.metric ?? 'turnover') === 'turnover'  ? t('mcap.high_t') : t('mcap.high_d')}</option>
            </select>
          </>
        )}

        {type === 'relativeStrengthIndex' && (
          <>
            <select className={sel} value={value.compare1 ?? 'above'}
              onChange={(e) => onChange({ ...value, compare1: e.target.value })}
              title="Primeira condição: Above = RSI acima do valor | Below = RSI abaixo do valor">
              <option value="above">{t('cmp.above')}</option>
              <option value="bellow">{t('cmp.bellow')}</option>
            </select>
            <select className={sel} value={value.line1 ?? '70'}
              onChange={(e) => {
                const v1 = Number(e.target.value);
                const RSI_VALUES = [10,20,30,40,50,60,70,80,90,99];
                const nextIdx = RSI_VALUES.indexOf(v1) + 1;
                const suggested = nextIdx < RSI_VALUES.length ? String(RSI_VALUES[nextIdx]) : '99';
                onChange({ ...value, line1: e.target.value, line2: suggested });
              }}
              title="Valor da primeira condição do RSI (0–100)">
              {[10,20,30,40,50,60,70,80,90,99].map(v => <option key={v} value={String(v)}>{v}</option>)}
            </select>
            <select className={sel} value={value.compare2 ?? 'bellow'}
              onChange={(e) => onChange({ ...value, compare2: e.target.value })}
              title="Segunda condição: Above = RSI acima | Below = RSI abaixo">
              <option value="above">{t('cmp.above')}</option>
              <option value="bellow">{t('cmp.bellow')}</option>
            </select>
            <select className={sel} value={value.line2 ?? '99'}
              onChange={(e) => onChange({ ...value, line2: e.target.value })}
              title="Valor da segunda condição do RSI (0–100)">
              {[10,20,30,40,50,60,70,80,90,99].map(v => <option key={v} value={String(v)}>{v}</option>)}
            </select>
          </>
        )}

        {type === 'ichimokuCloud' && (
          <>
            <select
              className={sel}
              value={value.line1 ?? 'conversion'}
              onChange={(e) => onChange({ ...value, line1: e.target.value })}
              title={Object.entries(ICHIMOKU_LINE_LABELS).map(([k,v]) => `${k}: ${v}`).join('\n')}
            >
              <option value="conversion">{t('ichi.conversion')}</option>
              <option value="base">{t('ichi.base')}</option>
              <option value="spanA">{t('ichi.spanA')}</option>
              <option value="spanB">{t('ichi.spanB')}</option>
              <option value="spanA+B">{t('ichi.spanAB')}</option>
              <option value="high">{t('ichi.high')}</option>
              <option value="close">{t('ichi.close')}</option>
              <option value="low">{t('ichi.low')}</option>
            </select>
            <select
              className={sel}
              value={value.compare ?? 'above'}
              onChange={(e) => onChange({ ...value, compare: e.target.value })}
              title="Above = linha 1 está acima de linha 2 | Below = linha 1 está abaixo de linha 2"
            >
              <option value="above">{t('cmp.above')}</option>
              <option value="bellow">{t('cmp.bellow')}</option>
            </select>
            <select
              className={sel}
              value={value.line2 ?? 'base'}
              onChange={(e) => onChange({ ...value, line2: e.target.value })}
              title="Linha de referência para a comparação"
            >
              <option value="conversion">{t('ichi.conversion')}</option>
              <option value="base">{t('ichi.base')}</option>
              <option value="spanA">{t('ichi.spanA')}</option>
              <option value="spanB">{t('ichi.spanB')}</option>
              <option value="spanA+B">{t('ichi.spanAB')}</option>
              <option value="high">{t('ichi.high')}</option>
              <option value="close">{t('ichi.close')}</option>
              <option value="low">{t('ichi.low')}</option>
            </select>
          </>
        )}

        {type === 'maTimeAbove' && (
          <>
            <select
              className={sel}
              value={value.period ?? '50'}
              onChange={(e) => onChange({ ...value, period: e.target.value })}
              title="Período da média móvel">
              <option value="50">MA50</option>
            </select>
            <select
              className={sel}
              value={value.minPct ?? '70'}
              onChange={(e) => onChange({ ...value, minPct: e.target.value })}
              title="% mínimo do histórico com close acima da MA (igual ao gráfico Binance)">
              {[30, 40, 50, 60, 70, 80, 90].map(v => (
                <option key={v} value={String(v)}>≥{v}%</option>
              ))}
            </select>
          </>
        )}

        {type === 'movingAverage' && (
          <>
            <select
              className={sel}
              value={value.length ?? '200'}
              onChange={(e) => onChange({ ...value, length: e.target.value })}
              title="Número de períodos (candles) para calcular a média móvel. Ex: MA200 = média dos últimos 200 candles."
            >
              <option value="9">9</option>
              <option value="20">20</option>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="80">80</option>
              <option value="200">200</option>
            </select>
            <select
              className={sel}
              value={value.compare ?? 'above'}
              onChange={(e) => onChange({ ...value, compare: e.target.value })}
              title="Above = preço do candle acima da média (tendência de alta) | Below = preço abaixo da média (tendência de baixa)"
            >
              <option value="above">{t('cmp.above')}</option>
              <option value="bellow">{t('cmp.bellow')}</option>
            </select>
            <select
              className={sel}
              value={value.candle ?? 'close'}
              onChange={(e) => onChange({ ...value, candle: e.target.value })}
              title="Qual preço do candle comparar com a média: Close = fechamento | High = máxima | Low = mínima"
            >
              <option value="high">{t('candle.high_full')}</option>
              <option value="close">{t('candle.close_full')}</option>
              <option value="low">{t('candle.low_full')}</option>
            </select>
          </>
        )}

        {type === 'maCompare' && (
          <>
            <input
              type="number"
              className={sel}
              style={{ width: '3.25rem' }}
              min={MA_CROSS_PERIOD_MIN}
              max={MA_CROSS_PERIOD_MAX}
              value={value.ma1Period ?? '9'}
              onChange={(e) => onChange({ ...value, ma1Period: e.target.value })}
              title={t('macross.tip.ma1')}
            />
            <select
              className={sel}
              value={value.compare ?? 'above'}
              onChange={(e) => onChange({ ...value, compare: e.target.value })}
              title="EMA rápida acima, abaixo ou próxima da EMA lenta"
            >
              <option value="above">{t('cmp.above')}</option>
              <option value="bellow">{t('cmp.bellow')}</option>
              <option value="near_up">{t('macross.mode.near_up')}</option>
              <option value="near_down">{t('macross.mode.near_down')}</option>
            </select>
            <input
              type="number"
              className={sel}
              style={{ width: '3.25rem' }}
              min={MA_CROSS_PERIOD_MIN}
              max={MA_CROSS_PERIOD_MAX}
              value={value.ma2Period ?? '21'}
              onChange={(e) => onChange({ ...value, ma2Period: e.target.value })}
              title={t('macross.tip.ma2')}
            />
            {(value.compare ?? 'above').startsWith('near') ? (
              <select
                className={sel}
                value={value.proximityPct ?? '0.5'}
                onChange={(e) => onChange({ ...value, proximityPct: e.target.value })}
                title={t('macross.tip.proximity')}
              >
                {[0.2, 0.3, 0.5, 1, 1.5, 2, 3].map(v => (
                  <option key={v} value={String(v)}>≤{v}%</option>
                ))}
              </select>
            ) : (
              <select
                className={sel}
                value={value.tolerancePct ?? '0.5'}
                onChange={(e) => onChange({ ...value, tolerancePct: e.target.value })}
                title={t('macross.tip.tolerance')}
              >
                {[0, 0.1, 0.3, 0.5, 1, 2].map(v => (
                  <option key={v} value={String(v)}>±{v}%</option>
                ))}
              </select>
            )}
          </>
        )}

        {type === 'maCrossover' && (
          <>
            <input
              type="number"
              className={sel}
              style={{ width: '3.25rem' }}
              min={MA_CROSS_PERIOD_MIN}
              max={MA_CROSS_PERIOD_MAX}
              value={value.ma1Period ?? '9'}
              onChange={(e) => onChange({ ...value, ma1Period: e.target.value })}
              title={t('macross.tip.ma1')}
            />
            <span className="text-p5/50 text-[10px] shrink-0">×</span>
            <input
              type="number"
              className={sel}
              style={{ width: '3.25rem' }}
              min={MA_CROSS_PERIOD_MIN}
              max={MA_CROSS_PERIOD_MAX}
              value={value.ma2Period ?? '21'}
              onChange={(e) => onChange({ ...value, ma2Period: e.target.value })}
              title={t('macross.tip.ma2')}
            />
            <select
              className={sel}
              value={value.signalMode ?? 'cross_up'}
              onChange={(e) => onChange({ ...value, signalMode: e.target.value })}
              title={t('macross.tip.mode')}
            >
              {MA_CROSS_MODES.map(m => (
                <option key={m.id} value={m.id}>{t(m.labelKey)}</option>
              ))}
            </select>
            {(value.signalMode ?? 'cross_up').startsWith('near') ? (
              <select
                className={sel}
                value={value.proximityPct ?? '0.5'}
                onChange={(e) => onChange({ ...value, proximityPct: e.target.value })}
                title={t('macross.tip.proximity')}
              >
                {[0.2, 0.3, 0.5, 1, 1.5, 2, 3].map(v => (
                  <option key={v} value={String(v)}>≤{v}%</option>
                ))}
              </select>
            ) : (
              <select
                className={sel}
                value={value.tolerancePct ?? '0.5'}
                onChange={(e) => onChange({ ...value, tolerancePct: e.target.value })}
                title={t('macross.tip.tolerance')}
              >
                {[0, 0.1, 0.3, 0.5, 1, 2].map(v => (
                  <option key={v} value={String(v)}>±{v}%</option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      {type === 'maCrossover' && (
        <div className="flex flex-row flex-wrap gap-2 items-center text-[10px]">
          <label className="flex items-center gap-1 text-p5/70 cursor-pointer">
            <input
              type="checkbox"
              checked={!!value.mixedIntervals}
              onChange={(e) => onChange({
                ...value,
                mixedIntervals: e.target.checked,
                ma1Interval: value.ma1Interval ?? intervals[0] ?? '15m',
                ma2Interval: value.ma2Interval ?? intervals[0] ?? '15m',
              })}
              className="accent-p4"
            />
            {t('macross.mixed_intervals')}
          </label>
          {value.mixedIntervals && (
            <>
              <select
                className={sel}
                value={value.ma1Interval ?? intervals[0] ?? '15m'}
                onChange={(e) => onChange({ ...value, ma1Interval: e.target.value })}
                title={t('macross.tip.iv1')}
              >
                {INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
              <span className="text-p5/40">→</span>
              <select
                className={sel}
                value={value.ma2Interval ?? intervals[0] ?? '15m'}
                onChange={(e) => onChange({ ...value, ma2Interval: e.target.value })}
                title={t('macross.tip.iv2')}
              >
                {INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
            </>
          )}
        </div>
      )}

      {/* Intervalos de candle das MAs (≠ tempo desde o cruzamento) */}
      {type !== 'marketCap' && !(type === 'maCrossover' && value.mixedIntervals) && (
        <div className="flex flex-row flex-wrap gap-1 items-center">
          {type === 'maCrossover' && (
            <span className="text-[10px] text-p5/60 shrink-0 mr-1" title={t('macross.tip.candle_iv')}>
              {t('macross.label.candles')}:
            </span>
          )}
          {/* Intervalos selecionados como pills removíveis */}
          {intervals.map((iv) => (
            <button
              key={iv}
              onClick={() => toggleInterval(iv)}
              title={`Remover ${INTERVAL_LABELS[iv] ?? iv}`}
              className="text-[10px] px-1.5 py-0.5 rounded bg-p4/25 border border-p4/50 text-p5 hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
            >
              {iv} ×
            </button>
          ))}

          {/* Botão + ou picker horizontal */}
          {!showPicker ? (
            <button
              onClick={() => setShowPicker(true)}
              title="Adicionar intervalo"
              className="text-[10px] px-1.5 py-0.5 rounded bg-p2 border border-p3/40 text-p5 hover:bg-p3/60 transition-colors leading-none"
            >
              +
            </button>
          ) : (
            <div className="flex flex-row flex-wrap gap-1 items-center border border-p3/30 rounded px-1.5 py-1 bg-p1/60">
              {INTERVALS.filter(iv => !intervals.includes(iv)).map(iv => (
                <button
                  key={iv}
                  onClick={() => addInterval(iv)}
                  title={`Adicionar ${INTERVAL_LABELS[iv] ?? iv}`}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-p2 border border-p3/40 text-p5 hover:bg-p4/30 hover:border-p4 transition-colors"
                >
                  {iv}
                </button>
              ))}
              <button
                onClick={() => setShowPicker(false)}
                className="text-[10px] px-1 text-p5/40 hover:text-p5 transition-colors ml-1"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* Janelas temporais “cruzou há” (≠ intervalo de candle) */}
      {isMacrossCross && (
        <div className="flex flex-row flex-wrap gap-1 items-center">
          <span className="text-[10px] text-p5/60 shrink-0 mr-1" title={t('macross.tip.age')}>
            {t('macross.label.age')}:
          </span>
          {ageWindows.map((id) => (
            <button
              key={id}
              onClick={() => toggleAgeWindow(id)}
              title={`${t('macross.remove_age')} ${macrossAgeLabel(id, t)}`}
              className="text-[10px] px-1.5 py-0.5 rounded bg-p4/25 border border-p4/50 text-p5 hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
            >
              {macrossAgeLabel(id, t)} ×
            </button>
          ))}
          {!showAgePicker ? (
            <button
              onClick={() => setShowAgePicker(true)}
              title={t('macross.add_age')}
              className="text-[10px] px-1.5 py-0.5 rounded bg-p2 border border-p3/40 text-p5 hover:bg-p3/60 transition-colors leading-none"
            >
              +
            </button>
          ) : (
            <div className="flex flex-row flex-wrap gap-1 items-center border border-p3/30 rounded px-1.5 py-1 bg-p1/60">
              {MA_CROSS_AGE_OPTIONS.filter((a) => !ageWindows.includes(a.id)).map((a) => (
                <button
                  key={a.id}
                  onClick={() => addAgeWindow(a.id)}
                  title={`${t('macross.add_age')} ${t(a.labelKey)}`}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-p2 border border-p3/40 text-p5 hover:bg-p4/30 hover:border-p4 transition-colors"
                >
                  {t(a.labelKey)}
                </button>
              ))}
              <button
                onClick={() => setShowAgePicker(false)}
                className="text-[10px] px-1 text-p5/40 hover:text-p5 transition-colors ml-1"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sumário da configuração atual */}
      {summary && (
        <p className="text-[10px] text-p4/70 font-mono leading-none pl-0.5">
          ▶ {summary}
        </p>
      )}
    </div>
  );
}

export default function IndicatorPanel({ open, onToggle }) {
  const { currencies, getBinanceCurrenciesWithUsdt, addFilter } = useCurrency();
  const { t, lang } = useI18n();
  const [indicators, setIndicators] = useState(DEFAULT_INDICATORS);
  const [searching, setSearching] = useState(false);
  const [savedIntervals, setSavedIntervals] = useState(['15m', '1h', '4h']);

  // Carrega preferências do backend na montagem
  useEffect(() => {
    fetchUserPrefs().then(prefs => {
      if (prefs?.intervals?.length) setSavedIntervals(prefs.intervals);
    });
  }, []);

  function updateIndicator(index, newVal) {
    setIndicators((prev) => prev.map((item, i) => (i === index ? newVal : item)));
  }

  function addRow() {
    setIndicators((prev) => [...prev, { type: '', intervals: [...savedIntervals] }]);
  }

  function removeLastRow() {
    setIndicators((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  async function handleSearch() {
    setSearching(true);
    try {
      const rsiIndicators   = indicators.filter((ind) => ind.type === 'relativeStrengthIndex');
      const mcapIndicators  = indicators.filter((ind) => ind.type === 'marketCap');
      const maIndicators    = indicators.filter((ind) => ind.type === 'movingAverage');
      const maTimeIndicators = indicators.filter((ind) => ind.type === 'maTimeAbove');
      const maCrossIndicators = indicators.filter((ind) => ind.type === 'maCrossover');
      const maCompareIndicators = indicators.filter((ind) => ind.type === 'maCompare');
      const otherIndicators = indicators.filter((ind) => ind.type && ind.type !== 'relativeStrengthIndex' && ind.type !== 'marketCap' && ind.type !== 'movingAverage' && ind.type !== 'maTimeAbove' && ind.type !== 'maCrossover' && ind.type !== 'maCompare');

      // Salva intervalos e análises usadas nas preferências
      const allIntervals = [...new Set(indicators.flatMap(ind => ind.intervals ?? []))];
      if (allIntervals.length) {
        setSavedIntervals(allIntervals);
        saveUserPrefs({ intervals: allIntervals });
      }
      indicators.filter(ind => ind.type).forEach(ind => saveUserPrefs({ indicator: ind }));

      // RSI: pesquisa via novo endpoint do backend (sem enviar candlesticks)
      for (const ind of rsiIndicators) {
        const compare1 = ind.compare1 ?? 'above';
        const line1 = ind.line1 ?? '70';
        const compare2 = ind.compare2 ?? 'bellow';
        const line2 = ind.line2 ?? '99';

        for (const interval of ind.intervals) {
          const query = `${interval}|rsi|${compare1}|${line1}|${compare2}|${line2}`;
          console.log('[frontend-react] RSI query montada:', query);
          const filter = await fetchIndicatorSearch(query, lang);
          console.log('[frontend-react] resultado recebido:', filter.name, '—', filter.list.length, 'moedas:', filter.list);
          addFilter(filter);
        }
      }

      // Market Cap: chama endpoint direto, sem candles
      for (const ind of mcapIndicators) {
        const metric = ind.metric ?? 'turnover';
        const preset = ind.preset ?? 'baixo';
        const filter = await fetchMarketCapFilter(metric, preset);
        addFilter(filter);
      }

      // MA50: cache rsiCache (intervalos 15m/1h/4h aquecidos no servidor)
      for (const ind of maIndicators) {
        const length  = ind.length ?? '50';
        const compare = ind.compare ?? 'above';
        const candle  = ind.candle ?? 'close';
        for (const interval of ind.intervals) {
          const filter = await fetchMaFilter({ interval, period: length, compare, candle, lang });
          addFilter(filter);
        }
      }

      // % tempo acima da MA — cache maTimeAboveCache no servidor
      for (const ind of maTimeIndicators) {
        const period = ind.period ?? '50';
        const minPct = ind.minPct ?? '70';
        for (const interval of ind.intervals) {
          const filter = await fetchMaTimeAboveFilter({ interval, period, minPct });
          console.log('[frontend-react] MA tempo acima:', filter.name, '—', filter.list.length, 'moedas',
            filter.cache ? `(cache: ${filter.cache.cached} frescos, ${filter.cache.computed} calculados)` : '');
          addFilter(filter);
        }
      }

      // Posição EMA vs EMA (ex.: EMA9 acima/abaixo EMA21)
      for (const ind of maCompareIndicators) {
        const p1 = ind.ma1Period ?? '9';
        const p2 = ind.ma2Period ?? '21';
        const compare = ind.compare ?? 'above';
        const isNear = compare === 'near_up' || compare === 'near_down';
        const tolerancePct = ind.tolerancePct ?? '0.5';
        const proximityPct = ind.proximityPct ?? '0.5';
        for (const interval of ind.intervals) {
          const filter = await fetchMaCompareFilter({
            period1: p1, period2: p2, interval, compare,
            tolerancePct, proximityPct, lang,
          });
          const nameOpts = isNear ? { proximityPct } : { tolerancePct };
          const expectedName = buildMaCompareFilterName(interval, p1, p2, compare, lang, nameOpts);
          addFilter({
            name: filter.name ?? expectedName,
            list: filter.list,
            meta: filter.details,
            scannedAt: filter.scannedAt,
          });
          if (filter.cache) {
            console.log('[frontend-react] MA compare:', filter.name, '—', filter.list.length, 'moedas',
              `(cache: ${filter.cache.hit ? 'hit' : 'miss'}, preset ${filter.cache.preset ?? '—'})`);
          }
        }
      }

      // Cruzamento / proximidade de MAs
      for (const ind of maCrossIndicators) {
        const p1 = ind.ma1Period ?? '9';
        const p2 = ind.ma2Period ?? '21';
        const mode = ind.signalMode ?? 'cross_up';
        const tolerancePct = ind.tolerancePct ?? '0.5';
        const proximityPct = ind.proximityPct ?? '0.5';
        const ageList = mode.startsWith('near') ? ['last'] : resolveMacrossAgeWindows(ind);

        for (const { iv1, iv2 } of resolveMacrossIntervalPairs(ind)) {
          for (const maxAgeMin of ageList) {
            const filter = await fetchMaCrossoverFilter({
              period1: p1, interval1: iv1, period2: p2, interval2: iv2,
              mode, maxAgeMin, tolerancePct, proximityPct, live: true,
            });
            const sigIv = finestInterval(iv1, iv2);
            const nameOpts = mode.startsWith('near')
              ? { proximityPct }
              : { maxAgeMin, tolerancePct };
            const expectedName = buildMaCrossFilterName(sigIv, p1, iv1, p2, iv2, mode, nameOpts);
            const name = filter.name?.includes(`|${iv1}|`) ? filter.name : expectedName;
            addFilter({
              name,
              list: filter.list,
              meta: filter.details,
              scannedAt: filter.scannedAt,
            });
          }
        }
      }

      // Outros indicadores: fluxo original (Ichimoku)
      if (otherIndicators.length > 0) {
        const uniqueIntervals = [...new Set(otherIndicators.flatMap((ind) => ind.intervals))];
        const usdtCurrencies = getBinanceCurrenciesWithUsdt(currencies);
        const candlesData = await fetchCandlesAndIndicators(usdtCurrencies, uniqueIntervals, 200);

        for (const ind of otherIndicators) {
          const { type, intervals } = ind;

          if (type === 'ichimokuCloud') {
            const line1 = ind.line1 ?? 'conversion';
            const compare = ind.compare ?? 'above';
            const line2 = ind.line2 ?? 'base';
            const condition = `ichimokuCloud|${line1}|${compare}|${line2}`;
            const acronym = `i|${line1}|${compare[0]}|${line2}`;

            const cbMap = {
              'ichimokuCloud|conversion|above|high':    conversionAboveHighCandle,
              'ichimokuCloud|conversion|above|close':   conversionAboveCloseCandle,
              'ichimokuCloud|conversion|above|low':     conversionAboveLowCandle,
              'ichimokuCloud|conversion|above|base':    conversionAboveBase,
              'ichimokuCloud|conversion|bellow|base':   conversionBellowBase,
              'ichimokuCloud|conversion|above|spanA':   conversionAboveSpanA,
              'ichimokuCloud|conversion|above|spanB':   conversionAboveSpanB,
              'ichimokuCloud|conversion|above|spanA+B': conversionAboveSpanAAndSpanB,
            };
            const cb = cbMap[condition];
            if (cb) createIchimokuFilter(candlesData, intervals, acronym, cb, addFilter);
            else alert('Ichimoku Cloud ainda não calculado!');
          }
        }
      }
    } catch (err) {
      console.error('Erro na busca de indicadores:', err);
    } finally {
      setSearching(false);
    }
  }

  const btnIcon = 'p-1.5 rounded text-p5 transition-colors hover:text-white hover:bg-p4 disabled:opacity-40';

  return (
    <div className="flex flex-col gap-2 px-4 py-3 h-full">
      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 content-start">
        {indicators.map((ind, i) => (
          <IndicatorRow key={i} value={ind} onChange={(v) => updateIndicator(i, v)} />
        ))}
      </div>

      <div className="flex gap-2 justify-end pt-1 shrink-0">
        <Tooltip text={t('ip.add_row')}>
          <button onClick={addRow} className={btnIcon}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth="2" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </Tooltip>

        <Tooltip text={t('ip.remove_row')}>
          <button onClick={removeLastRow} className={btnIcon}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth="2" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
            </svg>
          </button>
        </Tooltip>

        <Tooltip text={t('ip.search')}>
          <button
            onClick={handleSearch}
            disabled={searching}
            className={`${btnIcon} ${!searching ? 'bg-p4 hover:bg-p3 text-white' : ''}`}
          >
            {searching ? (
              <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
