import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { fetchTradeFavorites } from '../services/api';

/**
 * Carrega resumo de compras/vendas (Gate + Binance) quando a view de trades está ativa.
 */
export function useTradeFavoritesSummary(extraSymbols, enabled) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scannedAt, setScannedAt] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const forceFreshRef = useRef(false);
  const symbolsKey = useMemo(
    () => [...(extraSymbols ?? [])].map(s => String(s).toUpperCase()).sort().join(','),
    [extraSymbols],
  );
  /** Força ignorar o cache de 60s do backend — usado logo após enviar uma venda. */
  const forceRefresh = useCallback(() => {
    forceFreshRef.current = true;
    setRefreshNonce(n => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    async function refresh() {
      const fresh = forceFreshRef.current;
      forceFreshRef.current = false;
      setLoading(true);
      try {
        const list = await fetchTradeFavorites(
          symbolsKey ? symbolsKey.split(',').filter(Boolean) : [],
          { fresh },
        );
        if (!cancelled) {
          setItems(list ?? []);
          setScannedAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) console.warn('[trade-fav-summary]', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();
    const id = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, symbolsKey, refreshNonce]);

  const status = useMemo(() => {
    const map = {};
    for (const row of items) {
      map[row.symbol] = row;
    }
    return map;
  }, [items]);

  const symbols = useMemo(() => items.map(r => r.symbol), [items]);

  return { items, symbols, status, loading, scannedAt, refresh: forceRefresh };
}
