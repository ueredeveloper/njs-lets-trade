import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

/** Atributo que marca as linhas virtualizadas (`<tr data-vrow>`) pra medir a altura REAL. */
export const VIRTUAL_ROW_ATTR = 'data-vrow';

/**
 * Fatia uma lista longa para só renderizar linhas visíveis no scroll container.
 *
 * `rowHeight` é só a estimativa inicial: depois de pintar, mede a altura média das linhas
 * renderizadas (`<tr data-vrow>`) e passa a usar ela. Sem isso, linhas mais altas que a
 * estimativa (ex.: favorito SSE, com o selo do sinal embaixo do par) faziam a tabela "tremer"
 * no fim da lista: cada linha real trocada por padding estimado encolhia a altura total → o
 * navegador puxava o scrollTop de volta → a linha voltava → loop infinito de render.
 */
export function useVirtualRows({ items, rowHeight, containerRef, overscan = 8 }) {
  const [measured, setMeasured] = useState(null);
  const rowH = Math.max(rowHeight, measured ?? 0);
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
      const start = Math.max(0, Math.floor(top / rowH) - overscan);
      const visible = Math.ceil(h / rowH) + overscan * 2;
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
  }, [items.length, rowH, overscan, containerRef]);

  // Troca de lista (outro favorito/filtro) → mede de novo do zero.
  useEffect(() => { setMeasured(null); }, [items.length, rowHeight]);

  // Altura real média das linhas pintadas. Só CRESCE (> 0.5px) dentro da mesma lista: com alturas
  // variadas a média mudaria a cada scroll e reabriria o loop; superestimar só sobra padding.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const trs = el.querySelectorAll(`tr[${VIRTUAL_ROW_ATTR}]`);
    if (!trs.length) return;
    let sum = 0;
    trs.forEach((tr) => { sum += tr.getBoundingClientRect().height; });
    const avg = sum / trs.length;
    if (avg > 0) setMeasured((prev) => (prev != null && avg <= prev + 0.5 ? prev : avg));
  });

  const slice = useMemo(
    () => items.slice(range.start, range.end),
    [items, range.start, range.end],
  );

  const paddingTop = range.start * rowH;
  const paddingBottom = Math.max(0, (items.length - range.end) * rowH);

  return { slice, paddingTop, paddingBottom, range };
}
