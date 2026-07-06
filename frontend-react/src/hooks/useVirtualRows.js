import { useEffect, useMemo, useState } from 'react';

/**
 * Fatia uma lista longa para só renderizar linhas visíveis no scroll container.
 */
export function useVirtualRows({ items, rowHeight, containerRef, overscan = 8 }) {
  const [range, setRange] = useState(() => ({
    start: 0,
    end: Math.min(items.length, 24),
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const measure = () => {
      const top = el.scrollTop;
      const h = el.clientHeight || 320;
      const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const visible = Math.ceil(h / rowHeight) + overscan * 2;
      const end = Math.min(items.length, start + visible);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [items.length, rowHeight, overscan, containerRef]);

  const slice = useMemo(
    () => items.slice(range.start, range.end),
    [items, range.start, range.end],
  );

  const paddingTop = range.start * rowHeight;
  const paddingBottom = Math.max(0, (items.length - range.end) * rowHeight);

  return { slice, paddingTop, paddingBottom, range };
}
