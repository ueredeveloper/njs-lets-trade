import { useState } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesAndIndicators } from '../services/api';
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
import { createLowestIndexFilter } from '../utils/createLowestIndexFilter';
import { createHighLowFilter } from '../utils/createHighLowFilter';
import Tooltip from './Tooltip';

const INTERVALS = ['1m', '5m', '15m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];

const INTERVAL_LABELS = {
  '1m': '1 minuto', '5m': '5 minutos', '15m': '15 minutos',
  '1h': '1 hora', '2h': '2 horas', '4h': '4 horas',
  '6h': '6 horas', '8h': '8 horas', '12h': '12 horas',
  '1d': '1 dia', '3d': '3 dias', '1w': '1 semana',
};

const INDICATOR_DESCRIPTIONS = {
  ichimokuCloud: 'Sistema japonês com 5 linhas que indica tendência, suporte/resistência e momentum. Muito usado em análise técnica avançada.',
  movingAverage: 'Média Móvel Simples (SMA) — média dos últimos N preços de fechamento. Quando o preço cruza a MA, sinaliza mudança de tendência.',
  relativeStrengthIndex: 'RSI — oscilador de 0 a 100 que mede força do movimento. Abaixo de 30 = sobrevendido (possível alta). Acima de 70 = sobrecomprado (possível queda).',
  lowestIndex: 'Filtra moedas que atingiram o menor preço recente dentro do período analisado. Útil para encontrar moedas em suporte histórico.',
  highLowVariation: 'Filtra moedas com maior variação percentual entre a máxima e a mínima do período. Útil para encontrar moedas com alta volatilidade.',
};

const ICHIMOKU_LINE_LABELS = {
  conversion: 'Conversion (Tenkan-sen) — média das últimas 9 barras',
  base: 'Base (Kijun-sen) — média das últimas 26 barras',
  spanA: 'Span A — borda superior/inferior da nuvem',
  spanB: 'Span B — borda oposta da nuvem',
  'spanA+B': 'Span A + B — acima de ambas as bordas da nuvem',
  high: 'High — máxima do candle',
  close: 'Close — fechamento do candle',
  low: 'Low — mínima do candle',
};

const EMPTY_INDICATOR = { type: '', intervals: ['8h'] };

/** Gera um resumo legível da configuração do indicador */
function buildSummary(value) {
  const { type, intervals } = value;
  if (!type) return null;
  const ivLabel = intervals.length ? intervals.join(', ') : '—';

  if (type === 'relativeStrengthIndex') {
    const c1 = (value.compare1 ?? 'above') === 'above' ? 'acima de' : 'abaixo de';
    const v1 = value.line1 ?? '70';
    const c2 = (value.compare2 ?? 'bellow') === 'above' ? 'acima de' : 'abaixo de';
    const v2 = value.line2 ?? '99';
    return `RSI ${c1} ${v1} e ${c2} ${v2} → ${ivLabel}`;
  }
  if (type === 'ichimokuCloud') {
    const l1 = value.line1 ?? 'conversion';
    const cmp = (value.compare ?? 'above') === 'above' ? 'acima de' : 'abaixo de';
    const l2 = value.line2 ?? 'base';
    return `Ichimoku: ${l1} ${cmp} ${l2} → ${ivLabel}`;
  }
  if (type === 'movingAverage') {
    const len = value.length ?? '200';
    const cmp = (value.compare ?? 'above') === 'above' ? 'acima' : 'abaixo';
    const cdl = value.candle ?? 'close';
    return `MA${len}: preço (${cdl}) ${cmp} da média → ${ivLabel}`;
  }
  if (type === 'lowestIndex') return `Menor preço recente → ${ivLabel}`;
  if (type === 'highLowVariation') return `Maior variação máxima/mínima → ${ivLabel}`;
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

  function toggleInterval(iv) {
    onChange({
      ...value,
      intervals: intervals.includes(iv)
        ? intervals.filter((i) => i !== iv)
        : [...intervals, iv],
    });
  }

  const sel = 'bg-p2 border border-p3/40 text-p5 text-xs rounded px-2 py-1 focus:outline-none focus:border-p4';
  const summary = buildSummary(value);

  return (
    <div className="flex w-full flex-col bg-p2/50 border border-p3/20 rounded p-2 gap-2">
      <div className="flex w-full items-center flex-wrap gap-2">
        {/* Tipo */}
        <div className="flex items-center gap-1">
          <select
            className={sel}
            value={type}
            onChange={(e) => onChange({ ...value, type: e.target.value, params: {} })}
            title="Escolha o indicador técnico a ser analisado"
          >
            <option value="">Indicador</option>
            <option value="ichimokuCloud">Ichimoku Cloud</option>
            <option value="movingAverage">Moving Average</option>
            <option value="relativeStrengthIndex">RSI</option>
            <option value="lowestIndex">Índice de Menor Preço</option>
            <option value="highLowVariation">Variação de Valor</option>
          </select>
          {type && INDICATOR_DESCRIPTIONS[type] && (
            <HelpIcon text={INDICATOR_DESCRIPTIONS[type]} />
          )}
        </div>

        {type === 'relativeStrengthIndex' && (
          <>
            <select
              className={sel}
              value={value.compare1 ?? 'above'}
              onChange={(e) => onChange({ ...value, compare1: e.target.value })}
              title="Primeira condição: Above = RSI acima do valor | Below = RSI abaixo do valor"
            >
              <option value="above">Above</option>
              <option value="bellow">Below</option>
            </select>
            <select
              className={sel}
              value={value.line1 ?? '70'}
              onChange={(e) => onChange({ ...value, line1: e.target.value })}
              title="Valor da primeira condição do RSI (0–100)"
            >
              {[10,20,30,40,50,60,70,80,90,99].map(v => <option key={v} value={String(v)}>{v}</option>)}
            </select>
            <select
              className={sel}
              value={value.compare2 ?? 'bellow'}
              onChange={(e) => onChange({ ...value, compare2: e.target.value })}
              title="Segunda condição adicional: Above = RSI acima | Below = RSI abaixo"
            >
              <option value="above">Above</option>
              <option value="bellow">Below</option>
            </select>
            <select
              className={sel}
              value={value.line2 ?? '99'}
              onChange={(e) => onChange({ ...value, line2: e.target.value })}
              title="Valor da segunda condição do RSI (0–100)"
            >
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
              <option value="conversion">Conversion</option>
              <option value="base">Base</option>
              <option value="spanA">Span A</option>
              <option value="spanB">Span B</option>
              <option value="spanA+B">Span A+B</option>
              <option value="high">High</option>
              <option value="close">Close</option>
              <option value="low">Low</option>
            </select>
            <select
              className={sel}
              value={value.compare ?? 'above'}
              onChange={(e) => onChange({ ...value, compare: e.target.value })}
              title="Above = linha 1 está acima de linha 2 | Below = linha 1 está abaixo de linha 2"
            >
              <option value="above">Above</option>
              <option value="bellow">Below</option>
            </select>
            <select
              className={sel}
              value={value.line2 ?? 'base'}
              onChange={(e) => onChange({ ...value, line2: e.target.value })}
              title="Linha de referência para a comparação"
            >
              <option value="conversion">Conversion</option>
              <option value="base">Base</option>
              <option value="spanA">Span A</option>
              <option value="spanB">Span B</option>
              <option value="spanA+B">Span A+B</option>
              <option value="high">High</option>
              <option value="close">Close</option>
              <option value="low">Low</option>
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
              <option value="above">Above</option>
              <option value="bellow">Below</option>
            </select>
            <select
              className={sel}
              value={value.candle ?? 'close'}
              onChange={(e) => onChange({ ...value, candle: e.target.value })}
              title="Qual preço do candle comparar com a média: Close = fechamento | High = máxima | Low = mínima"
            >
              <option value="high">High</option>
              <option value="close">Close</option>
              <option value="low">Low</option>
            </select>
          </>
        )}

        {/* Intervalos */}
        <div className="flex flex-row flex-wrap gap-x-2 gap-y-1">
          {INTERVALS.map((iv) => (
            <label
              key={iv}
              className="flex items-center gap-1 text-xs text-p5 cursor-pointer"
              title={`Timeframe: ${INTERVAL_LABELS[iv] ?? iv}`}
            >
              <input
                type="checkbox"
                checked={intervals.includes(iv)}
                onChange={() => toggleInterval(iv)}
                className="accent-p4 cursor-pointer"
              />
              {iv}
            </label>
          ))}
        </div>
      </div>

      {/* Sumário da configuração atual */}
      {summary && (
        <p className="text-[10px] text-p4/70 font-mono leading-none pl-0.5">
          ▶ {summary}
        </p>
      )}
    </div>
  );
}

export default function IndicatorPanel() {
  const { currencies, getBinanceCurrenciesWithUsdt, addFilter } = useCurrency();
  const [indicators, setIndicators] = useState([{ ...EMPTY_INDICATOR }]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(true);

  function updateIndicator(index, newVal) {
    setIndicators((prev) => prev.map((item, i) => (i === index ? newVal : item)));
  }

  function addRow() {
    setIndicators((prev) => [...prev, { ...EMPTY_INDICATOR }]);
  }

  function removeLastRow() {
    setIndicators((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  async function handleSearch() {
    setSearching(true);
    try {
      const uniqueIntervals = [...new Set(indicators.flatMap((ind) => ind.intervals))];
      const usdtCurrencies = getBinanceCurrenciesWithUsdt(currencies);
      const candlesData = await fetchCandlesAndIndicators(usdtCurrencies, uniqueIntervals);

      for (const ind of indicators) {
        const { type, intervals } = ind;
        if (!type) continue;

        if (type === 'relativeStrengthIndex') {
          const compare1 = ind.compare1 ?? 'above';
          const line1 = ind.line1 ?? '70';
          const compare2 = ind.compare2 ?? 'bellow';
          const line2 = ind.line2 ?? '99';
          const condition = `relativeStrengthIndex|${compare1}|${line1}|${compare2}|${line2}`;
          const acronym = `r|${compare1[0]}|${line1}|${compare2[0]}|${line2}`;

          const cbMap = {
            'relativeStrengthIndex|above|10|bellow|20': lastRsiAbove10Bellow20,
            'relativeStrengthIndex|above|20|bellow|30': lastRsiAbove20Bellow30,
            'relativeStrengthIndex|above|30|bellow|40': lastRsiAbove30Bellow40,
            'relativeStrengthIndex|above|40|bellow|50': lastRsiAbove40Bellow50,
            'relativeStrengthIndex|above|50|bellow|60': lastRsiAbove50Bellow60,
            'relativeStrengthIndex|above|60|bellow|70': lastRsiAbove60Bellow70,
            'relativeStrengthIndex|above|70|bellow|80': lastRsiAbove70Bellow80,
            'relativeStrengthIndex|above|80|bellow|90': lastRsiAbove80Bellow90,
            'relativeStrengthIndex|above|70|bellow|99': lastRsiAbove70Bellow99,
          };
          const cb = cbMap[condition];
          if (cb) createRsiFilter(candlesData, intervals, acronym, cb, addFilter);
          else alert('Condição RSI ainda não calculada!');
        }

        else if (type === 'ichimokuCloud') {
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
            'movingAverage|200|above|close': movingAverageAboveCandleClose,
            'movingAverage|200|bellow|close': movingAverageBellowCandleClose,
            'movingAverage|9|above|close':   movingAverageAboveCandleClose,
            'movingAverage|9|bellow|close':  movingAverageBellowCandleClose,
            'movingAverage|20|above|close':  movingAverageAboveCandleClose,
            'movingAverage|20|bellow|close': movingAverageBellowCandleClose,
            'movingAverage|80|above|close':  movingAverageAboveCandleClose,
            'movingAverage|80|bellow|close': movingAverageBellowCandleClose,
          };
          const cb = cbMap[condition];
          if (cb) createMovingAverageFilter(candlesData, intervals, acronym, cb, addFilter);
          else alert('Condição MA ainda não calculada!');
        }

        else if (type === 'lowestIndex') {
          createLowestIndexFilter(candlesData, intervals, 'lowestIndex', addFilter);
        }

        else if (type === 'highLowVariation') {
          createHighLowFilter(candlesData, intervals, 'highLowVariation', addFilter);
        }
      }
    } catch (err) {
      console.error('Erro na busca de indicadores:', err);
    } finally {
      setSearching(false);
    }
  }

  const btnIcon = 'p-1.5 rounded text-p5 transition-colors hover:text-white hover:bg-p3 disabled:opacity-40';

  return (
    <div className="flex flex-col">
      {/* Barra de toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 text-xs text-p5 uppercase tracking-widest hover:text-white transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
          strokeWidth="1.5" stroke="currentColor"
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
        Analisar Indicadores
        <Tooltip
          text="Busca moedas que atendem às condições de indicadores técnicos nos timeframes selecionados. Os resultados aparecem como filtros na lista acima."
          maxW={260}
        >
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-p3/60 text-p5/40 hover:text-p5 hover:border-p4 transition-colors text-[9px] font-bold leading-none select-none ml-0.5">
            ?
          </span>
        </Tooltip>
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: '18vh' }}>
            {indicators.map((ind, i) => (
              <IndicatorRow key={i} value={ind} onChange={(v) => updateIndicator(i, v)} />
            ))}
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Tooltip text="Adicionar outra condição de indicador para a mesma busca">
              <button onClick={addRow} className={btnIcon}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                  strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip text="Remover o último indicador da lista">
              <button onClick={removeLastRow} className={btnIcon}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                  strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                </svg>
              </button>
            </Tooltip>

            <Tooltip text="Executar a busca — pode demorar alguns segundos dependendo da quantidade de moedas e intervalos">
              <button
                onClick={handleSearch}
                disabled={searching}
                className={`${btnIcon} ${!searching ? 'bg-p3 hover:bg-p4 text-white' : ''}`}
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
      )}
    </div>
  );
}
