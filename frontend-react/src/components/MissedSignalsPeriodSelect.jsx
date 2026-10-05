/** Seletor de período do favorito SSE (Sinais sem entrada do RSI Momentum) — mesmo visual
 *  ‹ rótulo › do ActiveFavSortSelect. Filtra no cliente os sinais já carregados (até 31 dias). */

import { MISSED_PERIOD_OPTIONS } from '../utils/missedSignalsPeriod';

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" className="block shrink-0">
      <path
        d={dir === 'left' ? 'M10.5 3.5 5.5 8l5 4.5' : 'M5.5 3.5 10.5 8l-5 4.5'}
        fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

const ARROW_BTN =
  'inline-flex items-center justify-center w-3 h-full text-p5/70 hover:text-p5 active:text-white transition-colors shrink-0';

export default function MissedSignalsPeriodSelect({ value, onChange, className = '' }) {
  const idx = Math.max(0, MISSED_PERIOD_OPTIONS.findIndex(o => o.id === value));
  const opt = MISSED_PERIOD_OPTIONS[idx];
  const n = MISSED_PERIOD_OPTIONS.length;

  function step(direction) {
    onChange(MISSED_PERIOD_OPTIONS[(idx + direction + n) % n].id);
  }

  return (
    <div
      className={`inline-flex items-center h-4 rounded border border-p3 bg-p2/80 ${className}`}
      title={`Período dos sinais: ${opt.label} (${idx + 1}/${n})`}
    >
      <button type="button" className={ARROW_BTN} aria-label="Período anterior" title="Período anterior"
        onClick={(e) => { e.stopPropagation(); step(-1); }}>
        <Chevron dir="left" />
      </button>
      <button
        type="button"
        className="inline-flex items-center justify-center text-[7px] font-semibold leading-none text-p5/90 whitespace-nowrap w-9 truncate px-0.5 h-full hover:text-p5"
        title={`${opt.label} — próximo período`}
        onClick={(e) => { e.stopPropagation(); step(1); }}
      >
        {opt.short}
      </button>
      <button type="button" className={ARROW_BTN} aria-label="Próximo período" title="Próximo período"
        onClick={(e) => { e.stopPropagation(); step(1); }}>
        <Chevron dir="right" />
      </button>
    </div>
  );
}
