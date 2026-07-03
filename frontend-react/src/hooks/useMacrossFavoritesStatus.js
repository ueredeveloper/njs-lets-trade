import { useEffect, useState, useMemo } from 'react';
import { fetchMaCrossStatus } from '../services/api';
import { buildMacrossStatusItems, isMaCrossEntry } from '../utils/macrossFavoritesSort';
import { getEntriesForSymbol } from '../constants/strategyPresets';

/**
 * Busca gap/cruzamento MA para favoritos MA-Cross (poll a cada 30s quando ativo).
 */
export function useMacrossFavoritesStatus(symbols, multitradeFavorites, enabled) {
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(false);
  const [scannedAt, setScannedAt] = useState(null);
  const symbolsKey = symbols.slice().sort().join(',');

  const entriesBySymbol = useMemo(() => {
    const map = new Map();
    for (const sym of symbols) {
      map.set(sym, getEntriesForSymbol(multitradeFavorites, sym).filter(isMaCrossEntry));
    }
    return map;
  }, [symbolsKey, multitradeFavorites]);

  useEffect(() => {
    if (!enabled || !symbols.length) {
      setStatus({});
      setScannedAt(null);
      return undefined;
    }

    let cancelled = false;

    async function refresh() {
      setLoading(true);
      try {
        const items = buildMacrossStatusItems(symbols, entriesBySymbol);
        const result = await fetchMaCrossStatus(items);
        if (!cancelled) {
          setStatus(result.details ?? {});
          setScannedAt(result.scannedAt ?? Date.now());
        }
      } catch (err) {
        if (!cancelled) console.warn('[macross-fav-status]', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbolsKey, enabled, entriesBySymbol]);

  return { status, loading, scannedAt, entriesBySymbol };
}
