import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const GAP = 8;

function portalCoords(rect, position) {
  switch (position) {
    case 'left':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - GAP,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2,
        left: rect.right + GAP,
        transform: 'translate(0, -50%)',
      };
    case 'bottom':
      return {
        top: rect.bottom + GAP,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, 0)',
      };
  }
  return {
    top: rect.top - GAP,
    left: rect.left + rect.width / 2,
    transform: 'translate(-50%, -100%)',
  };
}

const bubbleClass =
  'pointer-events-none rounded px-2.5 py-1.5 bg-[#0d1117] border border-white/10 text-[#c9d1d9] text-xs leading-snug shadow-2xl whitespace-normal text-left';

/**
 * Tooltip leve.
 * - padrão: CSS-only (hover no trigger)
 * - portal: renderiza em document.body — use dentro de overflow-y-auto / overflow-hidden
 */
export default function Tooltip({ text, children, position = 'top', maxW = 220, portal = false, fill = false }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, transform: '' });
  const triggerRef = useRef(null);

  const show = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setCoords(portalCoords(el.getBoundingClientRect(), position));
    setVisible(true);
  }, [position]);

  const hide = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!visible || !portal) return undefined;
    const onScroll = () => setVisible(false);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [visible, portal]);

  if (portal) {
    return (
      <>
        <span
          ref={triggerRef}
          className={fill ? 'flex w-full h-full min-h-0 min-w-0 flex-1 items-stretch' : 'inline-flex'}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
        >
          {children}
        </span>
        {visible && createPortal(
          <div
            role="tooltip"
            className={bubbleClass}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              transform: coords.transform,
              zIndex: 99999,
              width: 'max-content',
              maxWidth: maxW,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
      </>
    );
  }

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
        className={`pointer-events-none absolute ${bubblePos} z-[9999] hidden group-hover/tip:block ${bubbleClass}`}
        style={{ width: 'max-content', maxWidth: maxW }}
      >
        {text}
        <span className={`absolute border-4 ${arrowPos}`} />
      </span>
    </span>
  );
}
