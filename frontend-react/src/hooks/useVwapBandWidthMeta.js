import { useEffect, useState } from 'react';
import { fetchVwapBandWidthFilter } from '../services/api';

/**
 * Busca a largura média das bandas de VWAP (±2σ) pra todos os pares ativos — mesma
 * fonte usada pelo filtro de indicadores "largura da banda" — pra ordenar a lista de
 * favoritos VWAP Bands por distância entre as bandas. Params default batem com um dos
 * presets pré-aquecidos no backend (vwapBandWidthCache), então a resposta normalmente
 * vem do cache do servidor em vez de escanear o mercado a cada abertura da view.
 */
export function useVwapBandWidthMeta(enabled) {
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);
  const [scannedAt, setScannedAt] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    async function refresh() {
      setLoading(true);
      try {
        const result = await fetchVwapBandWidthFilter();
        if (!cancelled) {
          setMeta(result.details ?? {});
          setScannedAt(result.scannedAt ?? Date.now());
        }
      } catch (err) {
        if (!cancelled) console.warn('[vwap-fav-width]', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  return { meta, loading, scannedAt };
}
