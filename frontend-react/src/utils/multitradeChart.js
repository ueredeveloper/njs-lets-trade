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

/** Bandas do filtro MA — MA-Cross: usa % da config (fixos), não histórico por moeda. */
export function buildMaCrossAdaptiveBandsConfig(entry, boundsOverride = null) {
  if (!isMaCrossEntry(entry)) return null;
  const filters = (entry?.maFilters ?? entry?.tradeConfig?.maFilters ?? [])
    .filter(f => f.enabled !== false && f.mode === 'adaptive');
  const filter = filters[0];
  if (!filter) return null;
  const opts = entry?.adaptiveOpts ?? entry?.tradeConfig?.adaptiveOpts ?? {};
  const dipPct = Number(
    boundsOverride?.maxDipPct
    ?? (filter.fixedDipPct != null && filter.fixedDipPct !== '' ? filter.fixedDipPct : null)
    ?? filter.maxDipPct
    ?? 4,
  );
  const abovePct = Number(
    boundsOverride?.maxAbovePct
    ?? (filter.fixedAbovePct != null && filter.fixedAbovePct !== '' ? filter.fixedAbovePct : null)
    ?? filter.maxAbovePct
    ?? 4,
  );
  return {
    period: Number(filter.period ?? 50),
    interval: filter.interval ?? '1h',
    maxDipPct: dipPct,
    maxAbovePct: abovePct,
    // Força banda fixa no chart — nunca recalcula por histórico da moeda
    fixedDipPct: dipPct,
    fixedAbovePct: abovePct > 0 ? abovePct : null,
    adaptiveOpts: opts,
  };
}

/**
 * Slots MA do painel esquerdo alinhados à config do favorito.
 * MA-Cross: null — mantém overlays do usuário (padrão MA1=50@1h); só o
 * timeframe do candlestick segue o sinal.
 */
export function buildOverlaySlotsForEntry(entry, row) {
  if (isMaCrossEntry(entry)) return null;
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
    overlaySlots: buildOverlaySlotsForEntry(entry, row),
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

/**
 * Marcadores a partir de trades da exchange (Gate/Binance).
 * FIFO: cada venda realiza PnL contra compras anteriores.
 * @param {Array} trades
 * @param {{ maxMarkers?: number }} [opts]
 */
export function buildMarkersFromExchangeTrades(trades, opts = {}) {
  const maxMarkers = opts.maxMarkers ?? 24;
  const sorted = [...(trades ?? [])].sort((a, b) => Number(a.time) - Number(b.time));
  const markers = [];
  const inventory = [];

  for (const t of sorted) {
    const time = Number(t.time);
    const price = t.price != null ? Number(t.price) : null;
    const qty = t.qty != null ? Number(t.qty) : 0;
    if (!Number.isFinite(time) || !Number.isFinite(price)) continue;

    if (t.isBuyer) {
      inventory.push({ qty: qty > 0 ? qty : 0, price });
      markers.push({ time, side: 'buy', price, label: '▲ Compra' });
      continue;
    }

    let remain = qty > 0 ? qty : 0;
    let cost = 0;
    let matched = 0;
    while (remain > 1e-12 && inventory.length) {
      const lot = inventory[0];
      const take = Math.min(lot.qty, remain);
      cost += take * lot.price;
      matched += take;
      lot.qty -= take;
      remain -= take;
      if (lot.qty <= 1e-12) inventory.shift();
    }

    let pnlPct = null;
    if (matched > 0 && cost > 0) {
      pnlPct = ((matched * price - cost) / cost) * 100;
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
  }

  return markers.slice(-maxMarkers);
}

/** PnL por trade de venda (FIFO), para o painel de histórico. */
export function attachPnlToExchangeTrades(trades) {
  const sorted = [...(trades ?? [])].sort((a, b) => Number(a.time) - Number(b.time));
  const inventory = [];
  const withPnl = [];

  for (const t of sorted) {
    const price = t.price != null ? Number(t.price) : null;
    const qty = t.qty != null ? Number(t.qty) : 0;
    const row = { ...t, pnlPct: null, pnlUsdt: null };

    if (t.isBuyer) {
      if (Number.isFinite(price) && qty > 0) inventory.push({ qty, price });
      withPnl.push(row);
      continue;
    }

    let remain = qty > 0 ? qty : 0;
    let cost = 0;
    let matched = 0;
    while (remain > 1e-12 && inventory.length) {
      const lot = inventory[0];
      const take = Math.min(lot.qty, remain);
      cost += take * lot.price;
      matched += take;
      lot.qty -= take;
      remain -= take;
      if (lot.qty <= 1e-12) inventory.shift();
    }
    if (matched > 0 && cost > 0 && Number.isFinite(price)) {
      const pnlUsdt = matched * price - cost;
      row.pnlUsdt = pnlUsdt;
      row.pnlPct = (pnlUsdt / cost) * 100;
    }
    withPnl.push(row);
  }

  return withPnl;
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
    // MA-Cross: sem overlay/banda automática aqui — só aparece quando vier
    // explicitamente de um clique de trade no backtest (ver MultitradeBacktestPanel).
    overlaySlots: null,
    adaptiveBands: null,
  });
}

export { CANDLES_BEFORE, INTERVAL_MS, computeCandleLimitFromTime };
