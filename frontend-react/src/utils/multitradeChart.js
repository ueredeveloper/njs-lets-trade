import { INTERVAL_MS, computeCandleLimitFromTime } from './chartView';

const CANDLES_BEFORE = 10;

export function isMaCrossEntry(entry) {
  return entry?.strategyId === 'ma-cross' || entry?.kind === 'ma_cross' || entry?.tradeConfig?.kind === 'ma_cross';
}

export function isVwapBandsEntry(entry) {
  return entry?.strategyId === 'vwap-bands' || entry?.kind === 'vwap_bands' || entry?.tradeConfig?.kind === 'vwap_bands';
}

export function isBollingerBandsEntry(entry) {
  return entry?.strategyId === 'bollinger-bands' || entry?.kind === 'bollinger_bands' || entry?.tradeConfig?.kind === 'bollinger_bands';
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
  if (isVwapBandsEntry(entry)) {
    const e = entry.entry ?? entry.tradeConfig?.entry ?? {};
    return e.interval ?? '1h';
  }
  if (isBollingerBandsEntry(entry)) {
    const e = entry.entry ?? entry.tradeConfig?.entry ?? {};
    return e.interval ?? '4h';
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

/** Banda (piso) do filtro de tendência EMA do bollinger-bands — mesmo formato de
 *  buildMaCrossAdaptiveBandsConfig (period/interval/maxDipPct + fixed*), reaproveitando o
 *  mesmo mecanismo de overlay adaptativo do chart (EMA + linha de piso a maxDipPct% abaixo).
 *  Sem teto (maxAbovePct: 0) — o filtro só bloqueia por baixo. null quando o filtro está
 *  desligado no favorito, ou a entrada não é bollinger-bands. */
export function buildBollingerEmaFilterBandsConfig(entry) {
  if (!isBollingerBandsEntry(entry)) return null;
  const e = entry?.entry ?? entry?.tradeConfig?.entry ?? {};
  const ema = e.emaFilter;
  if (!ema?.enabled) return null;
  const dipPct = Number(ema.maxDipPct ?? 2);
  return {
    period: Number(ema.period ?? 50),
    interval: ema.interval ?? e.interval ?? '1h',
    maxDipPct: dipPct,
    maxAbovePct: 0,
    fixedDipPct: dipPct,
    fixedAbovePct: null,
    adaptiveOpts: {},
  };
}

/** Grupo Quick EMA (painel manual do gráfico, independente de favorito — ver CandlestickChart.jsx)
 *  pré-preenchido com a EMA do filtro de tendência do bollinger-bands selecionado: mesmo
 *  período/intervalo/variação de buildBollingerEmaFilterBandsConfig, no formato que o painel
 *  espera (periods: string[], bandPeriod: string). null quando o filtro está desligado. */
export function buildBollingerQuickEmaOverride(entry) {
  const cfg = buildBollingerEmaFilterBandsConfig(entry);
  if (!cfg) return null;
  const period = String(cfg.period);
  return { period, interval: cfg.interval, belowPct: cfg.maxDipPct };
}

/**
 * Slots MA do painel esquerdo alinhados à config do favorito.
 * MA-Cross: null — mantém overlays do usuário (padrão MA1=50@1h); só o
 * timeframe do candlestick segue o sinal.
 */
export function buildOverlaySlotsForEntry(entry, row) {
  if (isMaCrossEntry(entry)) return null;
  if (isVwapBandsEntry(entry)) return null;
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

  // Candle do cruzamento/toque que motivou a entrada (pode ser bem antes de buyTime
  // quando o bot esperou um pullback) — ver entry_signal_time em tradeExecution.js.
  // Também aparece em PENDING (aguardando pullback), antes da compra acontecer — ma-cross
  // e vwap-bands preenchem isso hoje; outros bots ficam sem o triângulo.
  if (entry?.entrySignalTime && (entry?.phase === 'BOUGHT' || entry?.phase === 'PENDING')) {
    markers.push({
      time: new Date(entry.entrySignalTime).getTime(),
      side: 'signal',
      price: entry.entrySignalPrice ?? null,
    });
  }

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
      if (t.entry_signal_time) {
        markers.push({
          time: new Date(t.entry_signal_time).getTime(),
          side: 'signal',
          price: t.entry_signal_price != null ? Number(t.entry_signal_price) : null,
        });
      }
      markers.push({
        time: entryMs,
        side: 'buy',
        price: t.entry_price != null ? Number(t.entry_price) : null,
        label: '▲ Compra',
        // real: distingue compra de fato executada pelo bot (some da seta/marcador — só o
        // quadrado compra→venda com % acima, ver buildHistoricalPositionRects em
        // CandlestickChartLW.jsx) dos ciclos de estudo/backtest clicados na aba Estatísticas
        // (esses continuam com seta cheia, sem essa flag).
        real: true,
      });
    }
    if (exitMs) {
      const pnl = t.pnl_pct != null ? Number(t.pnl_pct) : null;
      markers.push({
        time: exitMs,
        side: 'sell',
        price: t.exit_price != null ? Number(t.exit_price) : null,
        pnlPct: pnl,
        // entryTime/entryPrice: usados pra desenhar o quadrado compra→venda no
        // histórico (buildHistoricalPositionSquares em CandlestickChart.jsx) — a
        // largura do quadrado é a distância real (em candles) entre os dois.
        entryTime: entryMs,
        entryPrice: t.entry_price != null ? Number(t.entry_price) : null,
        label: pnl != null
          ? `▼ ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`
          : '▼ Venda',
        real: true,
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
      inventory.push({ qty: qty > 0 ? qty : 0, price, time });
      // real: compra de fato executada na exchange (fill real, aba TX) — some da seta/marcador,
      // só o quadrado compra→venda com % acima (buildHistoricalPositionRects) representa o ciclo.
      markers.push({ time, side: 'buy', price, label: '▲ Compra', real: true });
      continue;
    }

    let remain = qty > 0 ? qty : 0;
    let cost = 0;
    let matched = 0;
    // dominantLot: o lote que mais contribuiu em quantidade pra essa venda — usado só
    // como entryTime/visual do quadrado (não pro PnL, que segue FIFO certinho contra
    // TODOS os lotes consumidos). Poeira sobrando de uma compra bem mais antiga (fill
    // parcial, arredondamento) não pode "puxar" o quadrado lá pra trás — foi o bug visto
    // na NEAR: uma venda pequena não fechava 100% do lote antigo, e a poeira restante
    // fazia a venda seguinte (que na prática veio quase toda de uma compra recente)
    // aparecer como se tivesse começado na compra antiga, atravessando um ciclo inteiro.
    let dominantLotTime = null;
    let dominantLotQty = 0;
    while (remain > 1e-12 && inventory.length) {
      const lot = inventory[0];
      const take = Math.min(lot.qty, remain);
      if (take > dominantLotQty) { dominantLotQty = take; dominantLotTime = lot.time; }
      cost += take * lot.price;
      matched += take;
      lot.qty -= take;
      remain -= take;
      if (lot.qty <= 1e-12) inventory.shift();
    }

    let pnlPct = null;
    let avgEntryPrice = null;
    if (matched > 0 && cost > 0) {
      avgEntryPrice = cost / matched;
      pnlPct = ((matched * price - cost) / cost) * 100;
    }
    markers.push({
      time,
      side: 'sell',
      price,
      pnlPct,
      // entryTime: horário do lote dominante (não o mais antigo em FIFO estrito) —
      // usados pra desenhar o quadrado compra→venda no histórico (largura = candles
      // entre os dois), ver buildHistoricalPositionSquares em CandlestickChart.jsx.
      entryTime: dominantLotTime,
      entryPrice: avgEntryPrice,
      label: pnlPct != null
        ? `▼ ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`
        : '▼ Venda',
      real: true,
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

  const trades = await fetchMultitradeTrades({ symbol: sym, strategyId: entry.strategyId, limit: 30 }).catch(() => []);
  // Descarta trades fechados fora do intervalo configurado atualmente no favorito (ex.:
  // favorito reconfigurado de 5m pra 1h, mesmo strategy_id) — misturar os dois no mesmo
  // gráfico não faz sentido. Trades sem `interval` gravado (antes da coluna existir, ou de
  // antes do bot reiniciar após a migration) também são descartados — sem essa marcação não
  // dá pra confirmar que são do intervalo atual.
  const sameIntervalTrades = trades.filter(t => t.interval === interval);
  const markers = buildMarkersFromLiveTrades(sameIntervalTrades, entry);

  // Carga inicial pequena e fixa (não mais "cobrir o sinal/compra mais antigo dos 30 trades",
  // que em intervalos rápidos tipo 1m podia passar de 900 candles e deixar o primeiro render
  // do gráfico lento — ver conversa com o usuário sobre ACE/TUT/BICO). Sinais/marcadores mais
  // antigos que essa janela só "grudam" no candle quando o usuário arrasta o gráfico pra trás
  // (onNeedOlderCandles em CandlestickChartLW.jsx já cobre isso sob demanda, mesmo mecanismo
  // usado pela view de trades em CurrencyTable.jsx) — não precisa mais adivinhar upfront.
  const candleLimit = 80;

  const chartData = await fetchCandlesticksAndCloud(sym, interval, src, candleLimit);

  // Reafirma o override de VWAP/Bollinger do próprio favorito (mesmos defaults usados em
  // applyChartVwapBandsOverlay/applyChartBollingerBandsOverlay) — precisa ser setado aqui de
  // novo porque esta chamada roda DEPOIS daquelas (aguardou o fetch acima) e applyMultitradeSymbolChart
  // substitui o multitradeChartFocus inteiro; sem isso, o override setado por elas era apagado
  // e a banda sumia do gráfico logo após aparecer.
  const e = entry.entry ?? entry.tradeConfig?.entry ?? {};
  const vwapOverride = isVwapBandsEntry(entry)
    ? { enabled: true, interval: e.vwapInterval ?? '4h', session: e.session ?? 'weekly', bands: true }
    : null;
  const bollingerOverride = isBollingerBandsEntry(entry)
    ? { enabled: true, interval: e.interval ?? '4h', period: e.period ?? 20, stdDev: e.stdDev ?? 2 }
    : null;
  // Mesmo motivo do vwapOverride/bollingerOverride acima: reafirma a banda do filtro EMA do
  // bollinger-bands (ver applyChartBollingerBandsOverlay) que essa chamada senão apagaria.
  const adaptiveBands = buildBollingerEmaFilterBandsConfig(entry);
  const quickEmaOverride = buildBollingerQuickEmaOverride(entry);

  applyMultitradeSymbolChart({
    chartData,
    symbol: sym,
    interval,
    exchangeSource: src,
    markers,
    // MA-Cross: sem overlay/banda automática aqui — só aparece quando vier
    // explicitamente de um clique de trade no backtest (ver MultitradeBacktestPanel).
    overlaySlots: null,
    adaptiveBands,
    quickEmaOverride,
    vwapOverride,
    bollingerOverride,
  });
}

export { CANDLES_BEFORE, INTERVAL_MS, computeCandleLimitFromTime };
