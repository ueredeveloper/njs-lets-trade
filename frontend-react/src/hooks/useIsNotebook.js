import { useEffect, useState } from 'react';

/** true quando a viewport é estreita demais pra caber 160 candles legíveis (telas de notebook
 *  e menores) — usado pra decidir quantos candles focar por padrão no favorito TX (ver
 *  CandlestickChart.jsx). 1600px cobre as resoluções comuns de notebook (1366/1440/1536);
 *  monitores de PC costumam passar disso (1920+). */
export function useIsNotebook() {
  const query = '(max-width: 1600px)';
  const [notebook, setNotebook] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNotebook(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return notebook;
}
