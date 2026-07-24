import {
  getMacmpSortOption, cycleMacmpTableSort, MACMP_SORT_OPTIONS,
} from '../utils/macmpTableSort';
import { useI18n } from '../i18n';

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="block shrink-0">
      {dir === 'left' ? (
        <path d="M10.5 3.5 5.5 8l5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M5.5 3.5 10.5 8l-5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

const ARROW_BTN =
  'inline-flex items-center justify-center w-4 h-full text-p5/70 hover:text-p5 active:text-white transition-colors shrink-0';

export default function MacmpTableSortSelect({ value, onChange, className = '' }) {
  const { t } = useI18n();
  const opt = getMacmpSortOption(value);
  const idx = MACMP_SORT_OPTIONS.findIndex(o => o.id === value);
  const pos = `${(idx < 0 ? 0 : idx) + 1}/${MACMP_SORT_OPTIONS.length}`;

  function step(direction) {
    onChange(cycleMacmpTableSort(value, direction));
  }

  return (
    <div
      className={`inline-flex items-center h-5 rounded border border-p3 bg-p2/80 ${className}`}
      title={`${t('macmp.sort.label')}: ${t(opt.labelKey)} (${pos})`}
    >
      <button
        type="button"
        className={ARROW_BTN}
        aria-label={t('macmp.sort.prev')}
        title={t('macmp.sort.prev')}
        onClick={(e) => { e.stopPropagation(); step(-1); }}
      >
        <Chevron dir="left" />
      </button>
      <button
        type="button"
        className="inline-flex items-center justify-center text-[8px] font-semibold leading-none text-p5/90 whitespace-nowrap min-w-[1.75rem] max-w-[3rem] truncate px-0.5 h-full hover:text-p5"
        title={`${t(opt.labelKey)} — ${t('macmp.sort.next')}`}
        onClick={(e) => { e.stopPropagation(); step(1); }}
      >
        {t(opt.shortKey)}
      </button>
      <button
        type="button"
        className={ARROW_BTN}
        aria-label={t('macmp.sort.next')}
        title={t('macmp.sort.next')}
        onClick={(e) => { e.stopPropagation(); step(1); }}
      >
        <Chevron dir="right" />
      </button>
    </div>
  );
}
