import { useEffect, useState } from 'react';
import { fetchBollingerBandWidthFilter } from '../services/api';

function configsKey(configs) {
  return configs
    .map(c => `${c.interval}|${c.period}|${c.stdDev}|${c.lookback ?? 100}|${c.symbols.slice().sort().join('.')}|${(c.gateSymbols ?? []).slice().sort().join('.')}`)
    .sort()
    .join(',');
}

/**
 * Busca a largura média das Bandas de Bollinger (upper-lower como % da linha inferior) pra
 * os símbolos dos favoritos Bollinger Bands — mesma fonte usada pelo filtro de indicadores
 * "largura da banda", mas escopada aos próprios símbolos (`config.symbols`) em vez de
 * escanear o mercado inteiro: cada favorito tem seu próprio intervalo de entrada (ex.: 1m
 * pra scalping em moeda recém-listada), então um scan de mercado no intervalo errado deixa
 * a largura de fora justamente pras moedas mais novas, além de ser lento demais pra caber
 * numa view de poucos favoritos. Um request por combinação (interval,period,stdDev)
 * presente nos favoritos.
 */
export function useBollingerBandWidthMeta(enabled, configs) {
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);
  const [scannedAt, setScannedAt] = useState(null);

  const effectiveConfigs = configs?.length ? configs : [];
  const key = configsKey(effectiveConfigs);

  useEffect(() => {
    if (!enabled || !effectiveConfigs.length) {
      setMeta({});
      return undefined;
    }

    let cancelled = false;

    async function refresh() {
      setLoading(true);
      try {
        const results = await Promise.all(
          effectiveConfigs.map(c => fetchBollingerBandWidthFilter(c)),
        );
        if (!cancelled) {
          const merged = {};
          for (const r of results) Object.assign(merged, r.details ?? {});
          setMeta(merged);
          setScannedAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) console.warn('[bb-fav-width]', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return { meta, loading, scannedAt };
}
