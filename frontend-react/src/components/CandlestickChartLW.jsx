import { useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { createChart, CandlestickSeries, LineSeries, ColorType, createSeriesMarkers } from 'lightweight-charts';
import { computeVwapSlopeFlags } from '../utils/vwapSlopeHighlight';
import { computeStopLossFloor } from '../utils/trailingStopLoss';
import { RectanglePrimitive } from '../utils/lwRectanglePrimitive';
import { BandFillPrimitive } from '../utils/lwBandFillPrimitive';
import { tickMarkFormatterBrt, crosshairTimeFormatterBrt } from '../utils/lwBrtTimeFormat';
import { INTERVAL_MS } from '../utils/chartView';
import { simulateBbTouchPath, pairBbPathCycles } from '../utils/bollingerTouchPath';
import { computeMedianTrendSignals } from '../utils/bollingerMedianTrend';

const C_UP = '#26a69a';
const C_DOWN = '#ef5350';
const VWAP_LINE_COLOR = '#FF4FA3';
const VWAP_BAND_COLOR = 'rgba(255, 79, 163, 0.45)';
const VWAP_BAND_FILL_COLOR = 'rgba(255, 79, 163, 0.08)';
const VWAP_DECLINE_CLOUD_COLOR = 'rgba(239, 68, 68, 0.28)';
const BB_COLOR = '#94a3b8';
const BB_PATH_UP = '#9C27B0';
const BB_PATH_DOWN = '#FFC107';
const BB_PATH_CLOUD_UP = 'rgba(156,39,176,0.22)';
const BB_PATH_CLOUD_DOWN = 'rgba(255,193,7,0.22)';

/**
 * PATH BB no LW: só segmentos entrada→saída + nuvem (diagonal↔banda inferior) + marcadores.
 * Não liga saída→próxima entrada.
 */
function buildBbPathLineAndMarkers(bollingerConfig, candlesticks) {
  if (!bollingerConfig?.showPath || !bollingerConfig.points?.length || !candlesticks?.length) {
    return { segments: [], clouds: [], markers: [] };
  }
  const nodes = simulateBbTouchPath(bollingerConfig.points);
  const cycles = pairBbPathCycles(nodes);
  if (!cycles.length) return { segments: [], clouds: [], markers: [] };

  const ivMs = candlesticks.length > 1
    ? Math.abs(Number(candlesticks[1].openTime) - Number(candlesticks[0].openTime))
    : Infinity;
  const maxDiffMs = Number.isFinite(ivMs) ? ivMs * 1.5 : Infinity;

  // Busca binária (candlesticks vêm ordenados por openTime crescente) em vez de varredura
  // linear — com até MAX_CANDLES (10500) carregados e dezenas de ciclos de path, a varredura
  // linear por ciclo somava um custo síncrono perceptível a cada atualização (ver CLAUDE.md /
  // conversa sobre travamento ao "carregar mais" candles).
  const mapNode = (n) => {
    let lo = 0, hi = candlesticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(candlesticks[mid].openTime) < n.openTime) lo = mid + 1;
      else hi = mid;
    }
    let best = lo;
    if (lo > 0) {
      const dLo = Math.abs(Number(candlesticks[lo].openTime) - n.openTime);
      const dPrev = Math.abs(Number(candlesticks[lo - 1].openTime) - n.openTime);
      if (dPrev < dLo) best = lo - 1;
    }
    const bestDiff = Math.abs(Number(candlesticks[best].openTime) - n.openTime);
    if (bestDiff > maxDiffMs) return null;
    const time = Math.floor(Number(candlesticks[best].openTime) / 1000);
    if (!Number.isFinite(time) || !Number.isFinite(n.price)) return null;
    return { time, price: n.price, absIdx: best, node: n };
  };

  const lowerByAbs = new Array(candlesticks.length).fill(null);
  {
    const pts = [...(bollingerConfig.points ?? [])].sort((a, b) => Number(a.openTime) - Number(b.openTime));
    for (let i = 0; i < candlesticks.length; i++) {
      const t = Number(candlesticks[i].openTime);
      let lo = 0; let hi = pts.length - 1; let best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (Number(pts[mid].openTime) <= t) { best = Number(pts[mid].lower); lo = mid + 1; }
        else hi = mid - 1;
      }
      lowerByAbs[i] = Number.isFinite(best) ? best : null;
    }
  }

  const segments = [];
  const clouds = [];
  const markers = [];

  for (const cycle of cycles) {
    const a = mapNode(cycle.buy);
    const b = mapNode(cycle.exit);
    if (!a || !b || a.time === b.time) continue;

    const isUp = b.price >= a.price;
    const color = isUp ? BB_PATH_UP : BB_PATH_DOWN;
    const fill = isUp ? BB_PATH_CLOUD_UP : BB_PATH_CLOUD_DOWN;

    segments.push({
      color,
      data: [
        { time: a.time, value: a.price },
        { time: b.time, value: b.price },
      ],
    });

    const i0 = Math.min(a.absIdx, b.absIdx);
    const i1 = Math.max(a.absIdx, b.absIdx);
    const span = i1 - i0;
    const cloudPts = [];
    for (let i = i0; i <= i1; i++) {
      const tt = span > 0 ? (i - i0) / span : 0;
      const pathStart = a.absIdx <= b.absIdx ? a.price : b.price;
      const pathEnd = a.absIdx <= b.absIdx ? b.price : a.price;
      const pathY = pathStart + tt * (pathEnd - pathStart);
      const lowerY = lowerByAbs[i];
      if (!Number.isFinite(pathY) || !Number.isFinite(lowerY)) continue;
      cloudPts.push({
        time: Math.floor(Number(candlesticks[i].openTime) / 1000),
        upper: Math.max(pathY, lowerY),
        lower: Math.min(pathY, lowerY),
      });
    }
    if (cloudPts.length >= 2) {
      clouds.push({ points: cloudPts, fillColor: fill });
    }

    const pnl = cycle.exit.pnlPct;
    if (Number.isFinite(pnl)) {
      markers.push({
        time: b.time, position: 'atPriceTop', price: b.price,
        shape: 'circle', color, size: 0.6,
        text: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`,
      });
    }
  }

  return { segments, clouds, markers };
}

const EMA_LINE_DEFS = [
  { id: 'ma9',  color: '#e879f9', label: 'EMA9' },
  { id: 'ma21', color: '#fb923c', label: 'EMA21' },
  { id: 'ma50', color: '#22d3ee', label: 'EMA50' },
  { id: 'ma200', color: '#f59e0b', label: 'EMA200' },
];

/** Array de indicador (ma9/ma21/ma50/movingAverage/rsi) é alinhado ao FIM do array de candles —
 *  mesma convenção usada em CandlestickChart.jsx (alignSeries/candles[offset+i]). */
function alignIndicatorToCandles(candlesticks, arr) {
  if (!arr?.length || !candlesticks?.length) return [];
  const offset = candlesticks.length - arr.length;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const c = candlesticks[offset + i];
    const v = Number(arr[i]);
    if (!c || !Number.isFinite(v)) continue;
    out.push({ time: Math.floor(Number(c.openTime) / 1000), value: v });
  }
  return out;
}

function formatPctFromBase(basePrice, price) {
  const pct = ((price - basePrice) / basePrice) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** Quadrados alvo (verde) e stop loss (vermelho) da posição aberta — mesma regra do ECharts
 *  (buildBuyPositionSquares em CandlestickChart.jsx): retângulo do candle de compra até o
 *  candle mais recente, do preço de compra até o preço do alvo/stop, com o % como label.
 *  Largura DINÂMICA: acompanha os candles que vão fechando (cresce a cada novo candle),
 *  deixando os 2 candles mais recentes livres na frente — mas só quando há mais de 5 candles
 *  à frente da compra; com 5 ou menos, preenche até o candle mais recente (sem faixa livre). */
function buildPositionRects(buyInfo, stopLossConfig, targetConfig, candlesticks) {
  if (!buyInfo?.price || !candlesticks?.length) return [];
  const buyPrice = buyInfo.price;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return [];
  let buyIdx = candlesticks.length - 1;
  if (buyInfo.time != null) {
    let bestDiff = Infinity;
    for (let i = 0; i < candlesticks.length; i++) {
      const d = Math.abs(Number(candlesticks[i].openTime) - buyInfo.time);
      if (d < bestDiff) { bestDiff = d; buyIdx = i; }
    }
  }
  const lastIdx = candlesticks.length - 1;
  const candlesAhead = lastIdx - buyIdx;
  const rightIdx = candlesAhead > 5 ? lastIdx - 2 : lastIdx;
  const time1 = Math.floor(Number(candlesticks[buyIdx].openTime) / 1000);
  const time2 = Math.floor(Number(candlesticks[rightIdx].openTime) / 1000);

  const rects = [];
  if (targetConfig?.enabled) {
    const targetPrice = targetConfig.mode === 'price'
      ? targetConfig.price
      : buyPrice * (1 + targetConfig.targetPct / 100);
    if (Number.isFinite(targetPrice)) {
      rects.push({
        time1, time2, price1: buyPrice, price2: targetPrice,
        fillColor: 'rgba(34,197,94,0.14)', labelColor: '#22c55e', label: formatPctFromBase(buyPrice, targetPrice),
        labelPos: 'top',
      });
    }
  }
  if (stopLossConfig?.enabled) {
    const stopPrice = stopLossConfig.mode === 'price'
      ? stopLossConfig.price
      : computeStopLossFloor(buyPrice, buyPrice, stopLossConfig);
    if (Number.isFinite(stopPrice)) {
      rects.push({
        time1, time2, price1: buyPrice, price2: stopPrice,
        fillColor: 'rgba(239,68,68,0.14)', labelColor: '#ef4444', label: formatPctFromBase(buyPrice, stopPrice),
        labelPos: 'bottom',
      });
    }
  }
  return rects;
}

/** Ancora um timestamp (ms) no candle mais próximo, retornando o ÍNDICE (não o horário) — usado
 *  pra garantir largura mínima de 1 candle no quadrado histórico (ver buildHistoricalPositionRects):
 *  quando o gráfico é aberto num intervalo mais grosso que o da simulação (ex.: gráfico em 1h
 *  pra um ciclo VWAP que durou 40min), compra e venda podem cair no MESMO candle — comparar só
 *  o horário faz o quadrado desaparecer (time2 <= time1); com o índice dá pra empurrar pro
 *  próximo candle e manter o quadrado visível. */
function snapToNearestCandleIndex(candlesticks, timeMs) {
  if (!candlesticks?.length || !Number.isFinite(timeMs)) return null;
  let bestIdx = 0, bestDiff = Infinity;
  for (let i = 0; i < candlesticks.length; i++) {
    const d = Math.abs(Number(candlesticks[i].openTime) - timeMs);
    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
  }
  return bestIdx;
}

/** Quadrado histórico compra→venda de um ciclo já fechado (ex.: clique numa linha de estudo
 *  na aba Estatísticas) — precisa de entryTime/entryPrice no marcador de venda, mesmo contrato
 *  usado por buildMarkersFromExchangeTrades/buildMarkersFromLiveTrades (multitradeChart.js).
 *  Mesma paleta verde/vermelho do alvo/stop da posição aberta (buildPositionRects): o ciclo já
 *  fechou, então só um dos dois desfechos aconteceu de fato — verde (alvo) se deu lucro,
 *  vermelho (stop) se deu prejuízo — sem motivo pra manter uma paleta separada (azul/amarelo)
 *  só porque a venda já é real. */
function buildHistoricalPositionRects(multitradeMarkers, candlesticks) {
  const out = [];
  for (const m of multitradeMarkers ?? []) {
    if (m.side !== 'sell' || m.entryPrice == null || m.entryTime == null || m.time == null) continue;
    const entryPrice = Number(m.entryPrice);
    const exitPrice = Number(m.price);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(exitPrice)) continue;
    const idx1 = snapToNearestCandleIndex(candlesticks, Number(m.entryTime));
    let idx2 = snapToNearestCandleIndex(candlesticks, Number(m.time));
    if (idx1 == null || idx2 == null) continue;
    if (idx2 <= idx1) idx2 = idx1 + 1;
    if (idx2 >= candlesticks.length) continue;
    const time1 = Math.floor(Number(candlesticks[idx1].openTime) / 1000);
    const time2 = Math.floor(Number(candlesticks[idx2].openTime) / 1000);
    const isProfit = exitPrice >= entryPrice;
    out.push({
      time1, time2, price1: entryPrice, price2: exitPrice,
      fillColor: isProfit ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)',
      labelColor: isProfit ? '#22c55e' : '#ef4444',
      label: formatPctFromBase(entryPrice, exitPrice),
      labelPos: 'above',
    });
  }
  return out;
}

/** Linha pontilhada do preço de compra até o fechamento atual — verde se subiu, vermelho se
 *  caiu (mesma ideia do buildBuyPnlSeries do ECharts). buildPnlMarker desenha o % no ponto
 *  final (o marcador aceita texto; a série de linha sozinha não tem label embutido no LW). */
function buildPnlLineData(buyInfo, candlesticks) {
  if (!buyInfo?.price || !candlesticks?.length) return null;
  const buyPrice = buyInfo.price;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;
  const lastCandle = candlesticks[candlesticks.length - 1];
  const lastClose = Number(lastCandle.close);
  const lastTime = Math.floor(Number(lastCandle.openTime) / 1000);
  if (!Number.isFinite(lastClose) || !Number.isFinite(lastTime)) return null;
  let buyTime = lastTime;
  if (buyInfo.time != null) {
    let best = candlesticks[0];
    let bestDiff = Infinity;
    for (const c of candlesticks) {
      const d = Math.abs(Number(c.openTime) - buyInfo.time);
      if (d < bestDiff) { bestDiff = d; best = c; }
    }
    buyTime = Math.floor(Number(best.openTime) / 1000);
  }
  if (buyTime >= lastTime) return null;
  return {
    color: lastClose >= buyPrice ? C_UP : C_DOWN,
    data: [{ time: buyTime, value: buyPrice }, { time: lastTime, value: lastClose }],
  };
}

function buildPnlMarker(buyInfo, candlesticks) {
  if (!buyInfo?.price || !candlesticks?.length) return null;
  const buyPrice = buyInfo.price;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;
  const lastCandle = candlesticks[candlesticks.length - 1];
  const lastClose = Number(lastCandle.close);
  const lastTime = Math.floor(Number(lastCandle.openTime) / 1000);
  if (!Number.isFinite(lastClose) || !Number.isFinite(lastTime)) return null;
  const pct = ((lastClose - buyPrice) / buyPrice) * 100;
  const isUp = pct >= 0;
  return {
    time: lastTime, position: isUp ? 'atPriceTop' : 'atPriceBottom', price: lastClose,
    shape: 'circle', color: isUp ? C_UP : C_DOWN, size: 0.1,
    text: `${isUp ? '+' : ''}${pct.toFixed(2)}%`,
  };
}

function vwapFieldSeries(points, field) {
  if (!points?.length) return [];
  return points
    .map((p) => ({ time: Math.floor(Number(p.openTime) / 1000), value: Number(p[field]) }))
    .filter((d) => Number.isFinite(d.time) && Number.isFinite(d.value))
    .sort((a, b) => a.time - b.time);
}

/** Mesma busca binária de alignPointsToCandles (CandlestickChart.jsx/ECharts): um ponto por
 *  candle do gráfico, pegando o valor mais recente de `points` com openTime <= o do candle.
 *  Sem isso, um overlay num intervalo MENOR que o do gráfico (ex.: EMA200@15m sobre candle de
 *  1h) entra no eixo com timestamps próprios — o Lightweight Charts espaça as colunas de forma
 *  uniforme pela união dos tempos de TODAS as séries, então cada ponto extra de 15m sem candle
 *  correspondente empurra os candles reais mais longe uns dos outros. */
function alignFieldToCandles(candlesticks, points, field) {
  if (!points?.length || !candlesticks?.length) return [];
  const sorted = [...points].sort((a, b) => Number(a.openTime) - Number(b.openTime));
  const out = [];
  for (const c of candlesticks) {
    const t = Number(c.openTime);
    // `best` começa undefined (não null) — Number(null) é 0 (passa no isFinite abaixo e
    // desenharia um ponto falso em 0 pra todo candle anterior ao início dos dados da EMA);
    // Number(undefined) é NaN, corretamente filtrado, deixando a linha nascer só onde há dado.
    let lo = 0, hi = sorted.length - 1, best;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Number(sorted[mid].openTime) <= t) { best = sorted[mid][field]; lo = mid + 1; }
      else hi = mid - 1;
    }
    const value = Number(best);
    if (!Number.isFinite(value)) continue;
    out.push({ time: Math.floor(t / 1000), value });
  }
  return out;
}

/** Uma linha da VWAP (ou de uma banda). O destaque de queda (vwapSlopeFilter do bot
 *  vwap-bands) é indicado só pela nuvem vermelha (buildDeclineCloudSegments) — a linha em si
 *  mantém sempre a mesma cor. */
function buildVwapFieldEntries(points, field, color, width, lineStyle, keyPrefix) {
  return { [keyPrefix]: { color, width, lineStyle, data: vwapFieldSeries(points, field) } };
}

/** "Nuvem" vermelha de queda da VWAP — preenche a área entre up1/lw1 (mesma faixa da banda
 *  ±1σ normal, ver bandPoints abaixo) só nos trechos contíguos em que a VWAP está em queda
 *  (mesmo cálculo do vwapSlopeFilter do bot vwap-bands). Um item por trecho contíguo — vira
 *  uma banda própria em BandFillPrimitive (replacePrefixed), já que cada trecho é um polígono
 *  independente (não dá pra desenhar como uma banda só, senão preenchia por cima dos vãos
 *  onde a VWAP não está caindo). */
function buildDeclineCloudSegments(points, flags) {
  const segments = [];
  let cur = null;
  let prevPoint = null;
  for (let i = 0; i < points.length; i++) {
    const time = Math.floor(Number(points[i].openTime) / 1000);
    const upper = Number(points[i].upper1);
    const lower = Number(points[i].lower1);
    if (!Number.isFinite(time) || !Number.isFinite(upper) || !Number.isFinite(lower)) continue;
    const declining = !!flags[i];
    const point = { time, upper, lower };
    if (declining) {
      // Encosta no candle anterior (não-em-queda) pra a nuvem começar exatamente onde a linha
      // muda de cor, sem deixar vão na transição.
      if (!cur) cur = prevPoint ? [prevPoint, point] : [point];
      else cur.push(point);
    } else if (cur) {
      cur.push(point); // e fecha encostando no primeiro candle de volta à normalidade
      segments.push(cur);
      cur = null;
    }
    prevPoint = point;
  }
  if (cur) segments.push(cur);
  return segments
    .filter((pts) => pts.length >= 2)
    .map((pts) => ({ points: pts, fillColor: VWAP_DECLINE_CLOUD_COLOR }));
}

/** EMAs extras (overlay slots de Configurações + Quick EMA groups do painel do gráfico) —
 *  cfg.points já vem como [{openTime, value}], mesmo formato usado pelo VWAP. Bandas % (cfg.bands)
 *  são a própria linha deslocada em ±pct%, igual ao cálculo do ECharts (buildOverlaySeries).
 *  Alinhado por candle (alignFieldToCandles) pra suportar overlay num intervalo diferente do
 *  intervalo do gráfico, tanto maior (ex.: EMA50@4h sobre chart 15m) quanto menor (ex.:
 *  EMA200@15m sobre chart 1h) sem distorcer o espaçamento dos candles. */
function buildOverlayLineEntries(overlayConfigs, candlesticks) {
  const entries = {};
  for (const cfg of overlayConfigs ?? []) {
    if (!cfg.points?.length) continue;
    const mainData = alignFieldToCandles(candlesticks, cfg.points, 'value');
    if (cfg.showMiddle !== false) {
      entries[`overlay-${cfg.label}`] = { color: cfg.color, width: 1.5, lineStyle: 2, data: mainData };
    }
    const bands = cfg.bands ?? {};
    if (bands.showAbove) {
      entries[`overlay-${cfg.label}-up`] = {
        color: cfg.color, width: 1, lineStyle: 3,
        data: mainData.map((d) => ({ time: d.time, value: d.value * (1 + bands.abovePct / 100) })),
      };
    }
    if (bands.showBelow) {
      entries[`overlay-${cfg.label}-lw`] = {
        color: cfg.color, width: 1, lineStyle: 3,
        data: mainData.map((d) => ({ time: d.time, value: d.value * (1 - bands.belowPct / 100) })),
      };
    }
  }
  return entries;
}

/** Bandas de Bollinger — até 3 linhas por grupo (superior/média/inferior, cada uma opcional)
 *  a partir de cfg.points [{openTime, upper, middle, lower}]. Uma config por grupo BB do painel
 *  (ver chartBollingerConfigs em CandlestickChart.jsx) — chaves prefixadas por cfg.id pra
 *  coexistirem sem se sobrescrever. */
function buildBollingerEntries(bollingerConfigs) {
  const entries = {};
  for (const cfg of bollingerConfigs ?? []) {
    if (!cfg?.enabled || !cfg.points?.length) continue;
    const color = cfg.color ?? BB_COLOR;
    if (cfg.showUpper) entries[`bb-${cfg.id}-upper`] = { color, width: 1, lineStyle: 1, data: vwapFieldSeries(cfg.points, 'upper') };
    if (cfg.showMiddle) entries[`bb-${cfg.id}-middle`] = { color, width: 1.5, lineStyle: 2, data: vwapFieldSeries(cfg.points, 'middle') };
    if (cfg.showLower) entries[`bb-${cfg.id}-lower`] = { color, width: 1, lineStyle: 1, data: vwapFieldSeries(cfg.points, 'lower') };
  }
  return entries;
}

/** PPHL (pivôs de alta/baixa) — direto por timestamp, sem precisar achar o candle mais
 *  próximo (diferente do ECharts, que trabalha por índice de candle exibido). */
function buildPphlMarkers(pphlConfig) {
  if (!pphlConfig?.points?.length) return [];
  return pphlConfig.points
    .map((p) => {
      const time = Math.floor(Number(p.time) / 1000);
      if (!Number.isFinite(time)) return null;
      return p.type === 'high'
        ? { time, position: 'aboveBar', shape: 'arrowDown', color: C_DOWN, size: 0.8 }
        : { time, position: 'belowBar', shape: 'arrowUp', color: C_UP, size: 0.8 };
    })
    .filter(Boolean);
}

/** Marcadores de trade (Multi-Trade/backtest/Estatísticas): compra (seta verde), sinal
 *  (triângulo pequeno) e venda (seta verde=lucro/vermelha=prejuízo com % no texto, mesma
 *  paleta do quadrado — ver buildHistoricalPositionRects). A posição
 *  ATUALMENTE aberta (buyInfo) ainda ganha os quadrados de alvo/stop (buildPositionRects) e a
 *  linha de PnL (buildPnlLineData/buildPnlMarker) por cima — a seta de compra aqui cobre o caso
 *  de ciclos já fechados do histórico (ex.: clique numa linha de estudo em Estatísticas), que
 *  não passam por buyInfo (ver resolveChartBuyPrice em CandlestickChart.jsx).
 *  Compra/venda REAIS (m.real, ver buildMarkersFromLiveTrades) não passam por aqui — o quadrado
 *  compra→venda (buildHistoricalPositionRects) com o % acima já cobre esse caso sozinho. */
function buildTradeMarkers(multitradeMarkers) {
  const out = [];
  for (const m of multitradeMarkers ?? []) {
    if (m.time == null) continue;
    const time = Math.floor(Number(m.time) / 1000);
    if (!Number.isFinite(time)) continue;
    if (m.side === 'signal') {
      out.push({ time, position: 'aboveBar', shape: 'arrowDown', color: '#f59e0b', size: 0.5, text: m.label });
    } else if (m.side === 'buy' && !m.real) {
      const price = Number(m.price);
      if (!Number.isFinite(price)) continue;
      out.push({ time, position: 'atPriceBottom', price, shape: 'arrowUp', color: C_UP, size: 1, text: m.label ?? 'Compra' });
    } else if (m.side === 'sell' && !m.real) {
      const exitPrice = Number(m.price);
      const entryPrice = Number(m.entryPrice);
      if (!Number.isFinite(exitPrice)) continue;
      const hasEntry = Number.isFinite(entryPrice) && entryPrice > 0;
      const pnlPct = Number.isFinite(m.pnlPct) ? m.pnlPct : (hasEntry ? ((exitPrice - entryPrice) / entryPrice) * 100 : null);
      const isProfit = pnlPct != null ? pnlPct >= 0 : null;
      const text = pnlPct != null ? `${isProfit ? '+' : ''}${pnlPct.toFixed(1)}%` : 'venda';
      out.push({ time, position: 'atPriceTop', price: exitPrice, shape: 'arrowDown', color: isProfit == null ? '#94a3b8' : (isProfit ? '#22c55e' : '#ef4444'), size: 1, text });
    } else if (m.side === 'possible_entry') {
      const price = Number(m.price);
      if (!Number.isFinite(price)) continue;
      out.push({ time, position: 'atPriceMiddle', price, shape: 'circle', color: '#ffffff', size: 0.8, text: m.label ?? 'pronta' });
    }
  }
  return out;
}

/**
 * Filtra/normaliza candlesticks pro formato do LW, descartando entradas sem OHLC válido (ex.:
 * candle em formação ainda sem fechamento) — MESMA regra usada em seriesRef.current.setData().
 * Usado também pro cálculo de idx/from/to do preset de candles (focusLastN) — sem essa mesma
 * filtragem ali, um from/to calculado sobre o array BRUTO podia apontar pra um timestamp que
 * não tem candle nenhum desenhado (por ter sido descartado aqui), deixando a janela visível
 * com a borda direita ou esquerda em branco enquanto os candles reais ficam espremidos fora
 * do centro do intervalo.
 */
function toValidLwCandles(candlesticks) {
  if (!candlesticks?.length) return [];
  return candlesticks
    .map((c) => ({
      time: Math.floor(Number(c.openTime) / 1000),
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
    }))
    .filter((d) => Number.isFinite(d.time) && Number.isFinite(d.open) && Number.isFinite(d.close))
    .sort((a, b) => a.time - b.time);
}

/**
 * Motor de gráfico padrão (TradingView Lightweight Charts). Candles + EMA9/21/50/200 + EMAs
 * extras com bandas % + VWAP(bandas) + Bollinger + S/R + PPHL + RSI/CHOP (sub-painéis nativos)
 * + Stop Loss/Alvo + marcadores de trade. Só ficam de fora (ver CandlestickChart.jsx): nuvem
 * Ichimoku (precisa preencher a área entre spanA/spanB, sem primitive pronta aqui) e a régua
 * de medição (depende de conversão pixel↔preço que ainda não foi portada).
 */
const CandlestickChartLW = forwardRef(function CandlestickChartLW({
  symbol, interval, candlesticks, colors, rightPad = 0,
  activeIndicators = [], ma9, ma21, ma50, ma200, overlayConfigs, vwapConfig, vwapSlopeHighlight,
  bollingerConfigs = [], srConfig, pphlConfig, rsi, chopConfig,
  stopLossConfig, targetConfig, buyInfo, multitradeMarkers, zoomPeriod, focusLastN,
  onNeedOlderCandles, loadingMoreCandles,
}, ref) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const indicatorSeriesRef = useRef({});
  const priceLinesRef = useRef([]);
  const markersPluginRef = useRef(null);
  const rectPrimitiveRef = useRef(null);
  const bandFillPrimitiveRef = useRef(null);
  const pnlSeriesRef = useRef(null);
  // Array de LineSeries — um por trecho do PATH (alta=verde / baixa=vermelho)
  const bbPathSeriesRef = useRef([]);
  // Array de LineSeries — um por sinal de toque na banda inferior, mostrando os 10 candles
  // anteriores da linha mediana (verde=tendência de alta, vermelho=tendência de baixa)
  const medianTrendSeriesRef = useRef([]);
  const subpanelStateRef = useRef({ key: null, series: {} });
  // onNeedOlderCandles/loadingMoreCandles espelhados em ref pra o listener de pan (assinado uma
  // única vez, ver efeito de criação do chart) sempre ler o valor mais recente sem precisar
  // re-assinar a cada render. pendingRestoreRangeRef guarda o range visível ANTES de disparar o
  // carregamento, pra restaurar depois que candlesticks crescer (ver efeito de setData abaixo)
  // — sem isso, o fitContent()+barSpacing padrão jogava a visão de volta pros candles mais
  // recentes assim que os dados mais antigos chegavam, cancelando o arrasto do usuário.
  const onNeedOlderCandlesRef = useRef(onNeedOlderCandles);
  const loadingMoreCandlesRef = useRef(loadingMoreCandles);
  const pendingRestoreRangeRef = useRef(null);
  const candlesticksLenRef = useRef(0);
  // Marca o tamanho de candlesticks em que o último pedido de histórico foi disparado — evita
  // disparar de novo repetidamente durante o mesmo arrasto (o evento de pan dispara várias
  // vezes antes de loadingMoreCandles voltar como prop true, já que isso depende de um
  // round-trip de estado assíncrono no componente pai).
  const triggeredForLenRef = useRef(-1);
  // Só considera "usuário arrastou até a borda" quando existe um gesto de fato em andamento
  // (ponteiro/touch pressionado sobre o gráfico) — setado por pointerdown/touchstart no
  // container e desligado no pointerup/touchend (ver efeito de criação do chart). Sem isso, o
  // range change disparado pela PRÓPRIA lib ao chamarmos fitContent()/setVisibleRange() (troca
  // de moeda, preset 20/80/160, restauração de arrasto) era indistinguível de um arrasto real:
  // quando os candles carregados cabem inteiros na largura do gráfico (ex.: favorito Bollinger
  // Bands busca exatamente 80 e o preset também pede 80), o range calculado começa perto de 0
  // (igual a "arrastou até o início"), disparando um "carregar mais histórico" automático e
  // indesejado — os candles reais eram trocados por outra leva (500+) cuja janela restaurada não
  // batia mais com o que estava na tela. Uma janela de tempo (requestAnimationFrame) pra suprimir
  // esse evento programático não é confiável (corre contra o próprio ciclo de render da lib);
  // rastrear o gesto real do usuário é determinístico.
  const isUserPanningRef = useRef(false);
  useEffect(() => { onNeedOlderCandlesRef.current = onNeedOlderCandles; }, [onNeedOlderCandles]);
  useEffect(() => { loadingMoreCandlesRef.current = loadingMoreCandles; }, [loadingMoreCandles]);
  useEffect(() => { candlesticksLenRef.current = candlesticks?.length ?? 0; }, [candlesticks]);

  // Expõe conversão pixel↔preço/tempo pro pai (régua de medição em CandlestickChart.jsx) —
  // equivalente ao convertToPixel/convertFromPixel que o ReactECharts expõe via
  // getEchartsInstance(). Métodos lêem das refs no momento da chamada, sem depender de closure
  // sobre estado reativo, então a lista de deps vazia é segura.
  useImperativeHandle(ref, () => ({
    coordinateToPrice: (y) => seriesRef.current?.coordinateToPrice(y) ?? null,
    coordinateToTime: (x) => chartRef.current?.timeScale().coordinateToTime(x) ?? null,
  }), []);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: colors?.bg || '#1a0a25' },
        textColor: colors?.text || '#b3aca4',
      },
      grid: {
        vertLines: { color: colors?.panel || '#003f69', style: 1 },
        horzLines: { color: colors?.panel || '#003f69', style: 1 },
      },
      // localization.timeFormatter: label de tempo do crosshair (canto inferior).
      // A lib formata time (UTCTimestamp) em UTC por padrão — convertemos pra BRT (UTC-3).
      localization: { timeFormatter: crosshairTimeFormatterBrt },
      // rightOffset: espaço vazio (em candles) depois do último candle — sem isso os candles e
      // as linhas terminavam colados na borda direita do gráfico.
      // barSpacing: largura de cada candle em px — default da lib (6) fica fininho demais.
      // tickMarkFormatter: mesmo motivo do localization.timeFormatter acima, mas pros labels
      // do eixo de tempo.
      timeScale: {
        timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 10,
        tickMarkFormatter: tickMarkFormatterBrt,
      },
      autoSize: true,
      // Zoom nativo do Lightweight Charts: scroll do mouse e pinch no touch mudam quantos
      // candles ficam visíveis (mais candles ao afastar, menos ao aproximar) — mesma função
      // pros dois casos, já que a lib trata os dois gestos como "escala" internamente.
      // Explícito aqui (em vez de contar com o default) pra não depender de mudança futura
      // da lib.
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      handleScroll: {
        mouseWheel: false, // scroll vertical simples só dá zoom (handleScale), não arrasta
        pressedMouseMove: true,
        horzTouchDrag: true,
        // true: no celular, o app não tem página pra rolar por trás do gráfico (layout é
        // h-dvh/overflow-hidden fixo — ver App.jsx), então deixar o LW tratar o arrasto
        // vertical como "page scroll" (default da lib) resultava num gesto morto: dedo
        // arrasta e nada acontece, nem no gráfico nem na página.
        vertTouchDrag: true,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: C_UP, downColor: C_DOWN,
      borderUpColor: C_UP, borderDownColor: C_DOWN,
      wickUpColor: C_UP, wickDownColor: C_DOWN,
      // 4 casas decimais na escala de preço à direita — moedas de tick pequeno (a maioria
      // aqui) ficavam achatadas em 2 casas (o formatador padrão do LW arredonda pelo preço).
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const rectPrimitive = new RectanglePrimitive();
    series.attachPrimitive(rectPrimitive);
    rectPrimitiveRef.current = rectPrimitive;
    const bandFillPrimitive = new BandFillPrimitive();
    series.attachPrimitive(bandFillPrimitive);
    bandFillPrimitiveRef.current = bandFillPrimitive;
    pnlSeriesRef.current = chart.addSeries(LineSeries, {
      color: C_UP, lineWidth: 1.5, lineStyle: 1,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    bbPathSeriesRef.current = [];
    medianTrendSeriesRef.current = [];
    indicatorSeriesRef.current = {};
    priceLinesRef.current = [];
    markersPluginRef.current = createSeriesMarkers(series, []);
    subpanelStateRef.current = { key: null, series: {} };
    // Arrastar o gráfico pra trás até quase o candle mais antigo carregado (range.from perto de
    // 0 no espaço lógico) dispara a busca de mais histórico — ver onNeedOlderCandles em
    // CandlestickChart.jsx (reaproveita o mesmo handleLoadMoreCandles do botão "+500/1000").
    // Guarda o range visível ANTES de disparar pra restaurar depois que candlesticks crescer
    // (ver efeito de setData abaixo), senão o fitContent() padrão volta a visão pros candles
    // mais recentes assim que os dados mais antigos chegam.
    const handleVisibleLogicalRangeChange = (range) => {
      if (!isUserPanningRef.current) return;
      if (!range || range.from > 5) return;
      if (loadingMoreCandlesRef.current || !onNeedOlderCandlesRef.current) return;
      if (triggeredForLenRef.current === candlesticksLenRef.current) return;
      triggeredForLenRef.current = candlesticksLenRef.current;
      pendingRestoreRangeRef.current = chart.timeScale().getVisibleRange();
      onNeedOlderCandlesRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
    // pointerdown/touchstart no container = início de um arrasto real; pointerup/touchend/cancel
    // (ouvidos no window, não só no container, pra pegar o "soltar" mesmo se o ponteiro sair da
    // área do gráfico antes de soltar) = fim do gesto. Esse é o único sinal confiável de "o
    // usuário está de fato arrastando" — ver comentário do isUserPanningRef acima.
    const el = containerRef.current;
    const handlePanStart = () => { isUserPanningRef.current = true; };
    const handlePanEnd = () => { isUserPanningRef.current = false; };
    el?.addEventListener('pointerdown', handlePanStart);
    el?.addEventListener('touchstart', handlePanStart, { passive: true });
    window.addEventListener('pointerup', handlePanEnd);
    window.addEventListener('pointercancel', handlePanEnd);
    window.addEventListener('touchend', handlePanEnd);
    window.addEventListener('touchcancel', handlePanEnd);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
      el?.removeEventListener('pointerdown', handlePanStart);
      el?.removeEventListener('touchstart', handlePanStart);
      window.removeEventListener('pointerup', handlePanEnd);
      window.removeEventListener('pointercancel', handlePanEnd);
      window.removeEventListener('touchend', handlePanEnd);
      window.removeEventListener('touchcancel', handlePanEnd);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      indicatorSeriesRef.current = {};
      priceLinesRef.current = [];
      markersPluginRef.current = null;
      rectPrimitiveRef.current = null;
      bandFillPrimitiveRef.current = null;
      pnlSeriesRef.current = null;
      bbPathSeriesRef.current = [];
      medianTrendSeriesRef.current = [];
      subpanelStateRef.current = { key: null, series: {} };
    };
  }, [colors?.bg, colors?.text, colors?.panel]);

  // setData() + posicionamento do range visível NUM SÓ efeito — antes eram dois useEffect
  // separados (um pro setData+fitContent, outro pro focusLastN/setVisibleRange), ambos
  // dependendo de `candlesticks` e por isso rodando na mesma leva de commits; qual dos dois
  // "vencia" a corrida pelo range final dependia de timing interno da lib (fitContent() agenda
  // parte do recálculo de layout de forma assíncrona), fazendo o range calculado corretamente
  // pelo focusLastN às vezes ser sobrescrito de volta pelo fitContent()+barSpacing fixo do outro
  // efeito — candles reais ficavam espremidos numa ponta da tela com o resto em branco. Unificar
  // num efeito só elimina a corrida: cada leva de candlesticks só define o range UMA vez.
  useEffect(() => {
    if (!seriesRef.current || !candlesticks?.length) return;
    const valid = toValidLwCandles(candlesticks);
    const data = [...valid];
    // Whitespace (só {time}, sem OHLC) depois do último candle real — sem isso, timeToCoordinate
    // devolve null pra qualquer tempo além do último candle. Mecanismo nativo do Lightweight
    // Charts pra estender o eixo de tempo além do último dado real (dá margem pra qualquer
    // primitive/marcador futuro que precise de tempo além do candle mais recente).
    if (data.length > 1) {
      const ivSec = data[data.length - 1].time - data[data.length - 2].time;
      if (ivSec > 0) {
        const lastTime = data[data.length - 1].time;
        for (let i = 1; i <= 8; i++) data.push({ time: lastTime + ivSec * i });
      }
    }
    seriesRef.current.setData(data);
    // Adia a definição do range visível pro próximo frame — chamar setVisibleRange()/fitContent()
    // na MESMA execução síncrona do setData() usava dimensões/layout internos da lib ainda não
    // recalculados pros dados novos (candles reais ficavam espremidos numa ponta da tela mesmo
    // com from/to calculados certinho, cobrindo o array inteiro — o range chegava a ser
    // reajustado sozinho pra outro valor logo em seguida, confirmado pelos eventos de range
    // change disparados nos frames seguintes). Um requestAnimationFrame dá tempo da lib
    // processar o setData antes da gente mexer no timeScale.
    const rafId = requestAnimationFrame(() => {
      const chart = chartRef.current;
      if (pendingRestoreRangeRef.current) {
        // candlesticks cresceu por causa do arrasto pra trás (onNeedOlderCandles) — restaura
        // exatamente onde o usuário estava em vez de saltar pros candles mais recentes.
        chart?.timeScale().setVisibleRange(pendingRestoreRangeRef.current);
        pendingRestoreRangeRef.current = null;
      } else if (zoomPeriod?.startDate && zoomPeriod?.endDate) {
        // Zoom de período ativo (clique numa ocorrência de Estatísticas/Multi-Trade) — deixa pro
        // efeito de zoomPeriod abaixo (que roda depois, na mesma leva) definir o range. Se
        // zoomPeriod for um resquício de uma navegação anterior (Estatísticas) que não foi limpo
        // ao selecionar essa moeda, e não tiver mudado de valor, o outro efeito (que só depende de
        // [zoomPeriod, interval]) NÃO reroda — a moeda nova fica sem range nenhum sendo definido.
      } else if (focusLastN && valid.length) {
        // idx/from/to calculados sobre os candles VÁLIDOS — não sobre o array bruto. Um candle
        // mais recente ainda em formação (sem close fechado) costuma vir com OHLC nulo e é
        // descartado do que é desenhado; calcular o range em cima do array bruto apontava "to"
        // pro timestamp desse candle inexistente na tela, deixando a borda direita em branco e os
        // candles reais espremidos mais à esquerda.
        const idx = Math.max(0, valid.length - focusLastN);
        const from = valid[idx].time;
        const lastTime = valid[valid.length - 1].time;
        const ivSec = valid.length > 1 ? Math.abs(valid[1].time - valid[0].time) : 0;
        const to = lastTime + ivSec * 3; // mesmo respiro de 3 candles do rightOffset (setVisibleRange ignora rightOffset)
        if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
          chart?.timeScale().setVisibleRange({ from, to });
        }
      } else {
        // fitContent() calcula um barSpacing pra caber TODOS os candles carregados na largura do
        // gráfico, o que sobrescreve o barSpacing fixo do createChart e deixa os candles fininhos
        // de novo assim que a lista de candles fica grande. Reaplicar o barSpacing depois ancora a
        // visão nos candles mais recentes (mostra só quantos couberem naquela largura, em vez de
        // espremer o histórico inteiro).
        chart?.timeScale().fitContent();
        chart?.timeScale().applyOptions({ barSpacing: 10 });
      }
      // O chart (e a price scale) não é recriado ao trocar de moeda — só no efeito de cores acima.
      // Se o usuário arrastou o eixo de preço em algum momento, o Lightweight Charts desliga
      // autoScale e só religa com duplo clique no eixo (axisDoubleClickReset). Sem isso, trocar de
      // moeda/favorito herdava a escala manual da moeda anterior e os candles/linhas apareciam
      // fora do range vertical até o usuário dar o duplo clique manualmente.
      chart?.priceScale('right').applyOptions({ autoScale: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [candlesticks, focusLastN, zoomPeriod]);

  // Zoom de período (clique numa ocorrência das abas Estatísticas/Multi-Trade) — roda depois
  // do efeito acima na mesma leva de commits, então sobrescreve o fitContent quando os dois
  // mudam juntos (troca de moeda + zoom).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !zoomPeriod?.startDate || !zoomPeriod?.endDate) return;
    // Respiro de 10 candles antes/depois do período estudado (sinal→venda) — sem isso a
    // entrada/saída ficavam coladas na borda do gráfico.
    const padSec = (INTERVAL_MS[interval] ?? 0) * 10 / 1000;
    const from = Math.floor(new Date(zoomPeriod.startDate).getTime() / 1000) - padSec;
    const to = Math.floor(new Date(zoomPeriod.endDate).getTime() / 1000) + padSec;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    chart.timeScale().setVisibleRange({ from, to }); // ver comentário no efeito de focusLastN acima — sem reaplicar barSpacing fixo depois
  }, [zoomPeriod, interval]);

  // Linhas: EMAs + EMAs extras + VWAP(bandas) + Bollinger.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const desired = {};
    for (const { id, color } of EMA_LINE_DEFS) {
      if (!activeIndicators.includes(id)) continue;
      const arr = { ma9, ma21, ma50, ma200 }[id];
      desired[id] = { color, width: 1.5, data: alignIndicatorToCandles(candlesticks, arr) };
    }
    Object.assign(desired, buildOverlayLineEntries(overlayConfigs, candlesticks));
    Object.assign(desired, buildBollingerEntries(bollingerConfigs));
    if (vwapConfig?.enabled && vwapConfig.points?.length) {
      Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, 'value', VWAP_LINE_COLOR, 1.5, 0, 'vwap'));
      if (vwapConfig.bands) {
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, 'upper1', VWAP_BAND_COLOR, 1, 2, 'vwapUp1'));
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, 'lower1', VWAP_BAND_COLOR, 1, 2, 'vwapLow1'));
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, 'upper2', VWAP_BAND_COLOR, 1, 3, 'vwapUp2'));
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, 'lower2', VWAP_BAND_COLOR, 1, 3, 'vwapLow2'));
      }
    }

    // VWAP/EMAs extras/Bollinger vêm de fetches próprios (intervalo e período maiores que os
    // candles exibidos — ex.: VWAP diário buscando várias sessões) e não são cortados nem
    // alinhados como ma9/ma21/ma50/ma200 (esses já vêm com o mesmo tamanho dos candles). Sem
    // esse corte, a linha ia mais pra trás (ou pra frente) do que os 50 candles visíveis.
    const minTime = candlesticks?.length ? Math.floor(Number(candlesticks[0].openTime) / 1000) : -Infinity;
    const maxTime = candlesticks?.length ? Math.floor(Number(candlesticks[candlesticks.length - 1].openTime) / 1000) : Infinity;
    const clampToVisible = (data) => {
      const clipped = data.filter((d) => d.time >= minTime && d.time <= maxTime);
      // Segura o último valor conhecido até o candle mais recente — o intervalo do indicador
      // (ex.: VWAP@4h) é mais grosso que o do gráfico (15m), então o último ponto real é do
      // último candle de 4h FECHADO, ficando alguns candles atrás do preço atual. O ECharts
      // resolve isso alinhando por candle (alignPointsToCandles); aqui só estica a reta.
      const last = clipped[clipped.length - 1];
      if (last && Number.isFinite(maxTime) && last.time < maxTime) {
        clipped.push({ time: maxTime, value: last.value });
      }
      return clipped;
    };

    // Área entre as bandas ±1σ do VWAP (ver lwBandFillPrimitive.js) — mesmo corte/estica do
    // clampToVisible acima, mas em pares {upper,lower} já que o preenchimento precisa dos dois
    // valores por ponto (não dá pra reaproveitar clampToVisible, que só trabalha com 1 valor).
    if (bandFillPrimitiveRef.current) {
      let bandPoints = [];
      if (vwapConfig?.enabled && vwapConfig.bands && vwapConfig.points?.length) {
        bandPoints = vwapConfig.points
          .map((p) => ({ time: Math.floor(Number(p.openTime) / 1000), upper: Number(p.upper1), lower: Number(p.lower1) }))
          .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.upper) && Number.isFinite(p.lower))
          .sort((a, b) => a.time - b.time)
          .filter((p) => p.time >= minTime && p.time <= maxTime);
        const last = bandPoints[bandPoints.length - 1];
        if (last && Number.isFinite(maxTime) && last.time < maxTime) {
          bandPoints.push({ time: maxTime, upper: last.upper, lower: last.lower });
        }
      }
      bandFillPrimitiveRef.current.setBand('vwapSigma', bandPoints, VWAP_BAND_FILL_COLOR);

      // Nuvem vermelha (up1↔lw1) nos trechos em que a VWAP está caindo — botão "Queda VWAP"
      // no painel do gráfico (renderVwapTile em CandlestickChart.jsx).
      let cloudSegments = [];
      if (vwapConfig?.enabled && vwapSlopeHighlight?.enabled && vwapConfig.points?.length) {
        const sorted = [...vwapConfig.points].sort((a, b) => Number(a.openTime) - Number(b.openTime));
        const flags = computeVwapSlopeFlags(sorted, vwapSlopeHighlight.lookback, vwapSlopeHighlight.minSlopePct);
        cloudSegments = buildDeclineCloudSegments(sorted, flags)
          .map((seg) => ({
            ...seg,
            points: seg.points.filter((p) => p.time >= minTime && p.time <= maxTime),
          }))
          .filter((seg) => seg.points.length >= 2);
      }
      bandFillPrimitiveRef.current.replacePrefixed('vwapDecline-', cloudSegments);

      // Nuvem PATH BB: entre a diagonal entrada→saída e a banda inferior — uma por grupo com
      // showPath ligado, concatenadas antes de aplicar (replacePrefixed troca tudo de uma vez).
      const bbPathClouds = bollingerConfigs
        .filter((cfg) => cfg.showPath)
        .flatMap((cfg) => buildBbPathLineAndMarkers(cfg, candlesticks).clouds);
      bandFillPrimitiveRef.current.replacePrefixed('bbPath-', bbPathClouds);
    }

    const current = indicatorSeriesRef.current;
    for (const key of Object.keys(current)) {
      if (!desired[key]) {
        chart.removeSeries(current[key]);
        delete current[key];
      }
    }
    for (const [key, def] of Object.entries(desired)) {
      if (!current[key]) {
        current[key] = chart.addSeries(LineSeries, {
          color: def.color, lineWidth: def.width, lineStyle: def.lineStyle ?? 0,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
      } else {
        current[key].applyOptions({ color: def.color, lineWidth: def.width, lineStyle: def.lineStyle ?? 0 });
      }
      current[key].setData(clampToVisible(def.data));
    }
  }, [activeIndicators, ma9, ma21, ma50, ma200, overlayConfigs, bollingerConfigs, vwapConfig, vwapSlopeHighlight, candlesticks]);

  // Linhas de preço: S/R. Sempre recriadas do zero (poucos níveis por vez, custo desprezível)
  // em vez de diff — mais simples que casar id estável por nível.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) {
      try { series.removePriceLine(line); } catch { /* já removida junto do chart */ }
    }
    const lines = [];
    for (const lvl of srConfig?.levels ?? []) {
      const price = Number(lvl.price);
      if (!Number.isFinite(price)) continue;
      const isRes = lvl.type === 'resistance';
      lines.push(series.createPriceLine({
        price, color: isRes ? C_DOWN : C_UP, lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: `${isRes ? 'R' : 'S'} (${lvl.touches ?? 1}x)`,
      }));
    }
    priceLinesRef.current = lines;
  }, [srConfig]);

  // Quadrados alvo/stop da posição aberta — retângulo customizado (ver lwRectanglePrimitive.js),
  // igual ao buildBuyPositionSquares do ECharts (markArea verde/vermelho com % de distância).
  useEffect(() => {
    if (!rectPrimitiveRef.current) return;
    rectPrimitiveRef.current.setRects([
      ...buildPositionRects(buyInfo, stopLossConfig, targetConfig, candlesticks),
      ...buildHistoricalPositionRects(multitradeMarkers, candlesticks),
    ]);
  }, [buyInfo, stopLossConfig, targetConfig, candlesticks, multitradeMarkers]);

  // Linha de PnL: entrada → preço atual, verde/vermelho conforme sobe ou cai.
  useEffect(() => {
    if (!pnlSeriesRef.current) return;
    const entry = buildPnlLineData(buyInfo, candlesticks);
    if (entry) {
      pnlSeriesRef.current.applyOptions({ color: entry.color });
      pnlSeriesRef.current.setData(entry.data);
    } else {
      pnlSeriesRef.current.setData([]);
    }
  }, [buyInfo, candlesticks]);

  // Trajetória BB lower→upper (simulada): um LineSeries por trecho, verde/vermelho — de todos
  // os grupos com showPath ligado, concatenados.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const segments = bollingerConfigs
      .filter((cfg) => cfg.showPath)
      .flatMap((cfg) => buildBbPathLineAndMarkers(cfg, candlesticks).segments);
    for (const s of bbPathSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* já removida */ }
    }
    const next = [];
    for (const seg of segments) {
      if (!seg.data?.length) continue;
      const s = chart.addSeries(LineSeries, {
        color: seg.color, lineWidth: 1.5, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(seg.data);
      next.push(s);
    }
    bbPathSeriesRef.current = next;
  }, [bollingerConfigs, candlesticks]);

  // Filtro de tendência da mediana (média): a cada toque na banda inferior, uma linha
  // verde/vermelha sobre os 10 candles anteriores mostra se a linha mediana estava subindo
  // (verde, o bot compraria) ou caindo (vermelho, o bot bloqueia/cancela a compra) — mesmo
  // cálculo de backend/bot/bollinger-bands/strategyEngine.js#checkMedianTrendFilter. Um grupo
  // por vez pode ter essa opção ligada; todos entram concatenados.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of medianTrendSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* já removida */ }
    }
    const next = [];
    if (candlesticks?.length) {
      const minTime = Math.floor(Number(candlesticks[0].openTime) / 1000);
      const maxTime = Math.floor(Number(candlesticks[candlesticks.length - 1].openTime) / 1000);
      for (const cfg of bollingerConfigs) {
        if (!cfg.showMedianTrend || !cfg.points?.length) continue;
        const lookback = cfg.medianTrendLookback ?? 10;
        const threshold = cfg.medianTrendThreshold ?? 0.2;
        const signals = computeMedianTrendSignals(cfg.points, lookback, threshold);
        for (const sig of signals) {
          const data = sig.data.filter(d => d.time >= minTime && d.time <= maxTime);
          if (data.length < 2) continue;
          const s = chart.addSeries(LineSeries, {
            color: sig.trend === 'up' ? C_UP : C_DOWN, lineWidth: 3, lineStyle: 0,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          });
          s.setData(data);
          next.push(s);
        }
      }
    }
    medianTrendSeriesRef.current = next;
  }, [bollingerConfigs, candlesticks]);

  // Marcadores: PPHL + sinal/venda de Multi-Trade + % da linha de PnL + path BB (de todos os
  // grupos com showPath ligado).
  useEffect(() => {
    if (!markersPluginRef.current) return;
    const markers = [...buildPphlMarkers(pphlConfig), ...buildTradeMarkers(multitradeMarkers)];
    const pnlMarker = buildPnlMarker(buyInfo, candlesticks);
    if (pnlMarker) markers.push(pnlMarker);
    const bbPathMarkers = bollingerConfigs
      .filter((cfg) => cfg.showPath)
      .flatMap((cfg) => buildBbPathLineAndMarkers(cfg, candlesticks).markers);
    markers.push(...bbPathMarkers);
    markers.sort((a, b) => a.time - b.time);
    markersPluginRef.current.setMarkers(markers);
  }, [pphlConfig, multitradeMarkers, buyInfo, candlesticks, bollingerConfigs]);

  // Sub-painéis RSI/CHOP (panes nativos do LW v5) — reconstrói do zero só quando o CONJUNTO
  // ativo muda (ex.: liga CHOP com RSI já ligado), não a cada novo valor.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const showRsi = activeIndicators.includes('rsi');
    const showChop = activeIndicators.includes('chopZone');
    const ids = [...(showRsi ? ['rsi'] : []), ...(showChop ? ['chopZone'] : [])];
    const key = ids.join(',');
    const state = subpanelStateRef.current;

    if (state.key !== key) {
      for (const s of Object.values(state.series)) {
        try { chart.removeSeries(s); } catch { /* já removida junto do chart */ }
      }
      const panes = chart.panes();
      for (let i = panes.length - 1; i >= 1; i--) {
        try { chart.removePane(i); } catch { /* pane já vazia */ }
      }
      const newSeries = {};
      const newPanes = [];
      ids.forEach((id) => {
        // addPane() devolve o handle já criado — usar o índice devolvido por ele (em vez de
        // adivinhar i+1 e torcer pra chart.panes() já refletir a pane nova) é o que garante
        // que cada série vá pra sua própria pane; adivinhar o índice fazia RSI e CHOP caírem
        // na mesma pane, compartilhando escala.
        const pane = chart.addPane();
        const s = chart.addSeries(LineSeries, {
          color: id === 'rsi' ? '#a78bfa' : '#f59e0b', lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, pane.paneIndex());
        if (id === 'rsi') {
          s.createPriceLine({ price: 30, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });
          s.createPriceLine({ price: 70, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
          if (activeIndicators.includes('rsi50')) s.createPriceLine({ price: 50, color: '#facc15', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '50' });
          if (activeIndicators.includes('rsi80')) s.createPriceLine({ price: 80, color: '#fb923c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '80' });
        } else {
          s.createPriceLine({ price: 38.2, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '38' });
          s.createPriceLine({ price: 61.8, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '62' });
        }
        newSeries[id] = s;
        newPanes.push(pane);
      });
      // Proporção via stretchFactor (não setHeight em px) — o LW recalcula pixels a partir
      // disso a cada resize; usar setHeight direto tinha o valor derrubado pela redistribuição
      // de layout quando outra pane era criada logo em seguida. Pane principal ganha o dobro
      // do espaço de cada sub-painel.
      chart.panes()[0]?.setStretchFactor(2);
      newPanes.forEach((pane) => pane.setStretchFactor(1));
      state.key = key;
      state.series = newSeries;
    }

    if (state.series.rsi) state.series.rsi.setData(alignIndicatorToCandles(candlesticks, rsi));
    if (state.series.chopZone) state.series.chopZone.setData(vwapFieldSeries(chopConfig?.points ?? [], 'value'));
  }, [activeIndicators, rsi, chopConfig, candlesticks]);

  // Legenda: cor + nome de cada linha sobreposta ao preço (EMA fixa/rápida, VWAP, Bollinger) —
  // com várias Bollinger Bands e EMAs simultâneas na mesma paleta de cores, sem isso não dava
  // pra saber o que era o quê só olhando o gráfico.
  const legendEntries = useMemo(() => {
    const entries = [];
    for (const { id, color, label } of EMA_LINE_DEFS) {
      if (activeIndicators.includes(id)) entries.push({ key: id, color, label });
    }
    for (const cfg of overlayConfigs ?? []) {
      if (!cfg.points?.length) continue;
      entries.push({ key: `overlay-${cfg.label}`, color: cfg.color, label: cfg.label });
    }
    if (vwapConfig?.enabled && vwapConfig.points?.length) {
      const session = vwapConfig.session === 'weekly' ? 'semanal' : 'diária';
      entries.push({ key: 'vwap', color: VWAP_LINE_COLOR, label: `VWAP ${vwapConfig.interval} (${session})` });
    }
    for (const cfg of bollingerConfigs ?? []) {
      if (!cfg.enabled || !(cfg.showUpper || cfg.showMiddle || cfg.showLower)) continue;
      entries.push({ key: `bb-${cfg.id}`, color: cfg.color, label: cfg.label ?? `BB${cfg.period}@${cfg.interval}` });
    }
    return entries;
  }, [activeIndicators, overlayConfigs, vwapConfig, bollingerConfigs]);

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-1 left-2 z-10 text-base font-mono font-bold text-p5/80 pointer-events-none">
        {symbol} · {interval}
      </div>
      {legendEntries.length > 0 && (
        <div className="absolute top-7 left-2 z-10 flex flex-wrap gap-x-2 gap-y-0.5 max-w-[75%] pointer-events-none">
          {legendEntries.map((e) => (
            <span key={e.key} className="flex items-center gap-1 text-[10px] font-mono text-p5/70 whitespace-nowrap">
              <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: e.color }} />
              {e.label}
            </span>
          ))}
        </div>
      )}
      <div ref={containerRef} className="absolute top-0 left-0 bottom-0" style={{ right: rightPad }} />
    </div>
  );
});

export default CandlestickChartLW;
