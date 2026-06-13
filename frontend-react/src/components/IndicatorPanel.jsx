import { useState, useEffect } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesAndIndicators, fetchIndicatorSearch, fetchMarketCapFilter, fetchUserPrefs, saveUserPrefs } from '../services/api';
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
import {
  createMovingAverageFilter,
  movingAverageAboveCandleClose, movingAverageBellowCandleClose,
} from '../utils/createMovingAverageFilter';
import Tooltip from './Tooltip';

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
  { type: 'relativeStrengthIndex', intervals: ['30m', '4h', '8h'], compare1: 'above', line1: '10', compare2: 'bellow', line2: '20' },
  { type: 'relativeStrengthIndex', intervals: ['30m', '4h', '8h'], compare1: 'above', line1: '20', compare2: 'bellow', line2: '30' },
  { type: 'marketCap', intervals: [], metric: 'turnover', preset: 'alto' },
  { type: 'marketCap', intervals: [], metric: 'dilution', preset: 'baixo' },
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


function IndicatorRow({ value, onChange }) {
  const { type, intervals } = value;
  const { t } = useI18n();
  const [showPicker, setShowPicker] = useState(false);

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
            onChange={(e) => onChange({ ...value, type: e.target.value, params: {} })}
            title="Escolha o indicador técnico a ser analisado"
          >
            <option value="">{t('ind.placeholder')}</option>
            <option value="ichimokuCloud">{t('ind.ichimoku')}</option>
            <option value="movingAverage">{t('ind.ma')}</option>
            <option value="relativeStrengthIndex">{t('ind.rsi')}</option>
            <option value="marketCap">{t('ind.marketcap')}</option>
          </select>
          {type && t(`ind.desc.${type === 'relativeStrengthIndex' ? 'rsi' : type === 'ichimokuCloud' ? 'ichimoku' : type === 'movingAverage' ? 'ma' : 'marketcap'}`) !== `ind.desc.${type}` && (
            <HelpIcon text={t(`ind.desc.${type === 'relativeStrengthIndex' ? 'rsi' : type === 'ichimokuCloud' ? 'ichimoku' : type === 'movingAverage' ? 'ma' : 'marketcap'}`)} />
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
      </div>

      {/* Intervalos — ocultos para Market Cap */}
      {type !== 'marketCap' && (
        <div className="flex flex-row flex-wrap gap-1 items-center">
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
  const { t } = useI18n();
  const [indicators, setIndicators] = useState(DEFAULT_INDICATORS);
  const [searching, setSearching] = useState(false);
  const [savedIntervals, setSavedIntervals] = useState(['30m', '4h', '8h']);

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
      const otherIndicators = indicators.filter((ind) => ind.type && ind.type !== 'relativeStrengthIndex' && ind.type !== 'marketCap');

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
          const filter = await fetchIndicatorSearch(query);
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

      // Outros indicadores: fluxo original (Ichimoku, MA)
      if (otherIndicators.length > 0) {
        const uniqueIntervals = [...new Set(otherIndicators.flatMap((ind) => ind.intervals))];
        const usdtCurrencies = getBinanceCurrenciesWithUsdt(currencies);
        const candlesData = await fetchCandlesAndIndicators(usdtCurrencies, uniqueIntervals);

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

          else if (type === 'movingAverage') {
            const length = ind.length ?? '200';
            const compare = ind.compare ?? 'above';
            const candle = ind.candle ?? 'close';
            const condition = `movingAverage|${length}|${compare}|${candle}`;
            const acronym = `m|${length}|${compare[0]}|${candle}`;

            const cbMap = {
              'movingAverage|200|above|close':  movingAverageAboveCandleClose,
              'movingAverage|200|bellow|close': movingAverageBellowCandleClose,
              'movingAverage|9|above|close':    movingAverageAboveCandleClose,
              'movingAverage|9|bellow|close':   movingAverageBellowCandleClose,
              'movingAverage|20|above|close':   movingAverageAboveCandleClose,
              'movingAverage|20|bellow|close':  movingAverageBellowCandleClose,
              'movingAverage|80|above|close':   movingAverageAboveCandleClose,
              'movingAverage|80|bellow|close':  movingAverageBellowCandleClose,
            };
            const cb = cbMap[condition];
            if (cb) createMovingAverageFilter(candlesData, intervals, acronym, cb, addFilter);
            else alert('Condição MA ainda não calculada!');
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
