import { BOOT_STAGE_SEQUENCE, MAX_BOOT_STAGE, bootStageLabel } from '../utils/bootStages';

/**
 * Barra fixa para avançar/retroceder estágios de boot (debug).
 * Console: __bootNext(), __bootPrev(), __bootGoto(n)
 */
export default function BootStageBar({ stage, onStageChange }) {
  const current = BOOT_STAGE_SEQUENCE.find((s) => s.stage === stage)
    ?? BOOT_STAGE_SEQUENCE[BOOT_STAGE_SEQUENCE.length - 1];

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[200] bg-amber-950/95 border-t border-amber-600/50 text-amber-100 text-[11px] font-mono shadow-lg"
      data-boot-stage={stage}
    >
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 max-w-full">
        <span className="text-amber-400/90 uppercase tracking-wider shrink-0">Boot</span>
        <span className="text-white font-semibold shrink-0">
          {stage}/{MAX_BOOT_STAGE}
        </span>
        <span className="text-amber-200/80 truncate min-w-0 flex-1">
          {bootStageLabel(stage)}
        </span>
        <button
          type="button"
          disabled={stage <= 1}
          onClick={() => onStageChange(stage - 1)}
          className="px-2 py-1 rounded bg-amber-900/80 border border-amber-700 disabled:opacity-30"
        >
          ←
        </button>
        <button
          type="button"
          disabled={stage >= MAX_BOOT_STAGE}
          onClick={() => onStageChange(stage + 1)}
          className="px-2 py-1 rounded bg-amber-600 text-black font-bold disabled:opacity-30"
        >
          Próximo →
        </button>
      </div>
      <div className="flex gap-1 px-2 pb-2 overflow-x-auto touch-pan-x">
        {BOOT_STAGE_SEQUENCE.map(({ stage: s, label }) => (
          <button
            key={s}
            type="button"
            onClick={() => onStageChange(s)}
            className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] ${
              stage === s
                ? 'bg-amber-500 text-black border-amber-400'
                : stage > s
                  ? 'bg-amber-900/40 border-amber-800 text-amber-300/70'
                  : 'bg-transparent border-amber-900 text-amber-700'
            }`}
            title={`Estágio ${s}: ${label}`}
          >
            {s}. {label}
          </button>
        ))}
      </div>
    </div>
  );
}
