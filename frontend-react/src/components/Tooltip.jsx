/**
 * Tooltip leve, CSS-only.
 * Evita clipping em containers com overflow usando posição relativa ao trigger.
 * Para containers com overflow-y-auto, use `title` nativo no lugar.
 */
export default function Tooltip({ text, children, position = 'top', maxW = 220 }) {
  const above = position === 'top';
  const bubblePos = above
    ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
    : 'top-full left-1/2 -translate-x-1/2 mt-2';
  const arrowPos = above
    ? 'top-full left-1/2 -translate-x-1/2 border-t-[#0d1117] border-x-transparent border-b-transparent'
    : 'bottom-full left-1/2 -translate-x-1/2 border-b-[#0d1117] border-x-transparent border-t-transparent';

  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span
        className={`pointer-events-none absolute ${bubblePos} z-[9999] hidden group-hover/tip:block rounded px-2.5 py-1.5 bg-[#0d1117] border border-white/10 text-[#c9d1d9] text-xs leading-snug shadow-2xl whitespace-normal text-left`}
        style={{ width: 'max-content', maxWidth: `${maxW}px` }}
      >
        {text}
        <span className={`absolute border-4 ${arrowPos}`} />
      </span>
    </span>
  );
}
