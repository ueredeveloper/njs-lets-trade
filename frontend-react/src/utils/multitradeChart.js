import { INTERVAL_MS, computeCandleLimitFromTime } from './chartView';

const CANDLES_BEFORE = 10;

export function isMaCrossEntry(entry) {
  return entry?.strategyId === 'ma-cross' || entry?.kind === 'ma_cross' || entry?.tradeConfig?.kind === 'ma_cross';
}

export function isRule2Row(row) {
  return row?.ruleId === 'rule2' || row?.entryKind === 'ma';
}

/** Intervalo principal do chart para o sinal selecionado */
export function resolveTradeChartInterval(entry, row) {
  if (isMaCrossEntry(entry)) {
    const e = entry.entry ?? entry.tradeConfig?.entry ?? {};
    const iv1 = e.ma1?.interval ?? '15m';
    const iv2 = e.ma2?.interval ?? iv1;
    const ms1 = INTERVAL_MS[iv1] ?? 900_000;
    const ms2 = INTERVAL_MS[iv2] ?? 900_000;
    return ms1 <= ms2 ? iv1 : iv2;
  }
  if (isRule2Row(row)) {
    const em = entry?.rule2?.entryMa ?? entry?.entryMa ?? {};
    return em.interval ?? '1h';
  }
  const er = entry?.rule1?.entryRsi ?? entry?.entryRsi ?? {};
  return er.interval ?? '15m';
}

/** Slots MA do painel esquerdo alinhados à config do favorito */
export function buildOverlaySlotsForEntry(entry, row) {
  if (isMaCrossEntry(entry)) {
    const e = entry.entry ?? entry.tradeConfig?.entry ?? {};
    const ma1 = e.ma1 ?? { period: 9, interval: '15m' };
    const ma2 = e.ma2 ?? { period: 21, interval: ma1.interval ?? '15m' };
    const slots = [
      { id: 'slot1', period: String(ma1.period ?? 9), interval: ma1.interval ?? '15m', enabled: true },
      { id: 'slot2', period: String(ma2.period ?? 21), interval: ma2.interval ?? '15m', enabled: true },
    ];
    const filters = (entry.maFilters ?? entry.tradeConfig?.maFilters ?? []).filter(f => f.enabled && f.mode !== 'off');
    if (filters[0]) {
      slots.push({
        id: 'slot3',
        period: String(filters[0].period ?? 50),
        interval: filters[0].interval ?? '1h',
        enabled: true,
      });
    }
    return slots.slice(0, 2);
  }
  if (isRule2Row(row)) {
    const em = entry?.rule2?.entryMa ?? entry?.entryMa ?? {};
    const period = String(em.period ?? 50);
    const interval = em.interval ?? '1h';
    return [
      { id: 'slot1', period, interval, enabled: true },
      { id: 'slot2', period: '50', interval: '4h', enabled: interval !== '4h' },
    ];
  }
  const mas = entry?.rule1?.maConditions ?? entry?.maConditions ?? [];
  const ma1h = mas.find(m => m.interval === '1h') ?? { period: 50, interval: '1h' };
  const ma4h = mas.find(m => m.interval === '4h') ?? { period: 50, interval: '4h' };
  return [
    { id: 'slot1', period: String(ma1h.period ?? 50), interval: ma1h.interval ?? '1h', enabled: true },
    { id: 'slot2', period: String(ma4h.period ?? 50), interval: ma4h.interval ?? '4h', enabled: true },
  ];
}

export function formatMaCrossEntrySummary(entry) {
  const e = entry?.entry ?? entry?.tradeConfig?.entry ?? {};
  const dir = e.direction === 'cross_down' ? '↓' : '↑';
  const p1 = e.ma1?.period ?? 9;
  const iv1 = e.ma1?.interval ?? '15m';
  const p2 = e.ma2?.period ?? 21;
  const iv2 = e.ma2?.interval ?? iv1;
  return `EMA${p1}(${iv1}) cruza ${dir} EMA${p2}(${iv2})`;
}

export function tradeFetchPlan(entry, row, signalMs) {
  const interval = resolveTradeChartInterval(entry, row);
  const msPerCandle = INTERVAL_MS[interval] ?? 900_000;
  const fetchFromMs = signalMs - CANDLES_BEFORE * msPerCandle;
  const candleLimit = computeCandleLimitFromTime(fetchFromMs, interval);
  return {
    interval,
    msPerCandle,
    fetchFromMs,
    candleLimit,
    overlaySlots: isMaCrossEntry(entry) ? null : buildOverlaySlotsForEntry(entry, row),
  };
}

/** Marcadores de trades reais (Supabase rsi_multi_bot_trades + posição aberta) */
export function buildMarkersFromLiveTrades(trades, entry) {
  const markers = [];
  const openMs = entry?.buyTime ? new Date(entry.buyTime).getTime() : null;

  if (entry?.phase === 'BOUGHT' && openMs) {
    markers.push({
      time: openMs,
      side: 'entry',
      price: entry.buyPrice,
      label: '▌ Compra',
    });
  }

  for (const t of trades ?? []) {
    const entryMs = t.entry_time ? new Date(t.entry_time).getTime() : null;
    const exitMs  = t.exit_time ? new Date(t.exit_time).getTime() : null;
    if (!entryMs) continue;

    const isOpenDup = openMs && Math.abs(entryMs - openMs) < 60_000;
    if (!isOpenDup) {
      markers.push({
        time: entryMs,
        side: 'buy',
        price: t.entry_price != null ? Number(t.entry_price) : null,
        label: '▲ Compra',
      });
    }
    if (exitMs) {
      const pnl = t.pnl_pct != null ? Number(t.pnl_pct) : null;
      markers.push({
        time: exitMs,
        side: 'sell',
        price: t.exit_price != null ? Number(t.exit_price) : null,
        pnlPct: pnl,
        label: pnl != null
          ? `▼ ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`
          : '▼ Venda',
      });
    }
  }

  return markers;
}

/** Marcadores a partir de trades da exchange (Gate/Binance) */
export function buildMarkersFromExchangeTrades(trades) {
  const sorted = [...(trades ?? [])].sort((a, b) => Number(a.time) - Number(b.time));
  const markers = [];
  let lastBuyPrice = null;

  for (const t of sorted) {
    const time = Number(t.time);
    const price = t.price != null ? Number(t.price) : null;
    if (t.isBuyer) {
      lastBuyPrice = price;
      markers.push({ time, side: 'entry', price, label: '▌ Compra' });
    } else {
      let pnlPct = null;
      if (lastBuyPrice && price) {
        pnlPct = ((price - lastBuyPrice) / lastBuyPrice) * 100;
      }
      markers.push({
        time,
        side: 'sell',
        price,
        pnlPct,
        label: pnlPct != null
          ? `▼ ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`
          : '▼ Venda',
      });
      lastBuyPrice = null;
    }
  }

  return markers.slice(-12);
}

/**
 * Carrega chart com intervalo da estratégia MT e marcadores de trades reais.
 * Sem zoom em trade específico (uso: clique na favorita ou na tabela).
 */
export async function loadMultitradeSymbolChart(entry, {
  fetchCandlesticksAndCloud,
  fetchMultitradeTrades,
  applyMultitradeSymbolChart,
}) {
  if (!entry?.symbol) return;
  const interval = resolveTradeChartInterval(entry, null);
  const src = entry.exchange === 'gate' ? 'gate' : null;
  const sym = entry.symbol.toUpperCase();

  const [chartData, trades] = await Promise.all([
    fetchCandlesticksAndCloud(sym, interval, src),
    fetchMultitradeTrades({ symbol: sym, strategyId: entry.strategyId, limit: 30 }).catch(() => []),
  ]);

  const markers = buildMarkersFromLiveTrades(trades, entry);
  applyMultitradeSymbolChart({
    chartData,
    symbol: sym,
    interval,
    exchangeSource: src,
    markers,
    overlaySlots: isMaCrossEntry(entry) ? null : buildOverlaySlotsForEntry(entry, null),
  });
}

export { CANDLES_BEFORE, INTERVAL_MS, computeCandleLimitFromTime };
