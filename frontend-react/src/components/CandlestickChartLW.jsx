import { useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType, LineType, createSeriesMarkers } from 'lightweight-charts';
import { computeVwapSlopeFlags } from '../utils/vwapSlopeHighlight';
import { computeStopLossFloor } from '../utils/trailingStopLoss';
import { RectanglePrimitive } from '../utils/lwRectanglePrimitive';
import { BandFillPrimitive } from '../utils/lwBandFillPrimitive';
import { computeRsiUpCrossings } from '../utils/rsiThresholdCrossings';
import { tickMarkFormatterBrt, crosshairTimeFormatterBrt } from '../utils/lwBrtTimeFormat';
import { INTERVAL_MS } from '../utils/chartView';
import { simulateBbTouchPath, pairBbPathCycles } from '../utils/bollingerTouchPath';
import { computeMedianTrendSignals } from '../utils/bollingerMedianTrend';
import { buildEmaCrossPersistenceClouds, formatEma9SlopeLegend, SLOPE_STATE_META } from '../utils/emaCrossPersistenceCloud';
import { computeBarsSinceMaCross } from '../utils/barsSinceMaCross';
import { computeTdSequentialSetup } from '../utils/tdSequentialSetup';
import { snapPointsToChartCandles } from '../utils/snapToChartCandles';

const C_UP = '#26a69a';
const C_DOWN = '#ef5350';
/** Linhas de S/R (rolante + traço das Estatísticas): uma cor só por tipo — azul p/ suporte, rosa
 *  p/ resistência. O posto vai no rótulo (S1/S2/R1/R2), não na cor. */
const SR_SUPPORT_LINE = '#3b82f6';
const SR_RESISTANCE_LINE = '#ec4899';
// Estilo 'traço': largura mínima do traço, em candles DO GRÁFICO. A largura efetiva é o maior
// entre isto e ~1 candle do intervalo do S/R (ex.: 4h ≈ 16 candles de 15m) — pra o traço ter
// tamanho suficiente pra ser visível e "acompanhar" o arrasto, sem virar 10 candles de 4h.
const SR_TRACO_MIN_CANDLES = 10;

/** Ordena os níveis de um tipo por proximidade do preço (resistência: menor preço = R1; suporte:
 *  maior preço = S1) e anexa `rank` (1..) e `label` ('S1'/'R2'…). */
function rankSrLevels(levels, type) {
  return (levels ?? [])
    .filter((l) => l.type === type && Number.isFinite(Number(l.price)))
    .sort((a, b) => (type === 'resistance' ? a.price - b.price : b.price - a.price))
    .map((l, i) => ({ ...l, rank: i + 1, label: `${type === 'resistance' ? 'R' : 'S'}${i + 1}` }));
}
const VWAP_LINE_COLOR = '#FF4FA3';
const VWAP_BAND_COLOR = 'rgba(255, 79, 163, 0.45)';
const VWAP_BAND_FILL_COLOR = 'rgba(255, 79, 163, 0.08)';
// Verde/vermelho igual ao candle (C_UP/C_DOWN) — dia anterior fechou em alta ou em queda.
const PREV_DAY_CLOUD_UP_FILL_COLOR = 'rgba(38, 166, 154, 0.18)';
const PREV_DAY_CLOUD_DOWN_FILL_COLOR = 'rgba(239, 83, 80, 0.18)';
// Cores randomizadas em ciclo pra cada degrau da nuvem D-1, em vez do verde/vermelho por
// alta/baixa — facilita distinguir visualmente onde um degrau termina e o próximo começa.
const PREV_DAY_CLOUD_RANDOM_COLORS = [
  'rgba(156, 39, 176, 0.35)', // roxo
  'rgba(76, 175, 80, 0.35)',  // verde
  'rgba(33, 150, 243, 0.35)', // azul
  'rgba(255, 193, 7, 0.35)',  // amarelo
  'rgba(233, 30, 99, 0.35)',  // rosa
  'rgba(0, 188, 212, 0.35)',  // ciano
  'rgba(255, 87, 34, 0.35)',  // laranja
  'rgba(121, 85, 72, 0.35)',  // marrom
];
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
  if (!bollingerConfig?.showPath || !candlesticks?.length) {
    return { segments: [], clouds: [], markers: [] };
  }
  // PERM ligado: ciclos já vêm filtrados pela nuvem PERM do manipulador (occurrencesToBbPathNodes
  // em CandlestickChart.jsx) — usa esses em vez de simular do zero. Sem dado ainda carregado
  // (fetch em andamento/sem favorito com PERM equivalente), fica sem path até chegar/permanece
  // vazio (não cai pra simulação simples — misturaria ciclos filtrados com não filtrados).
  const nodes = bollingerConfig.showPermFilter
    ? (bollingerConfig.permPathNodes ?? [])
    : (bollingerConfig.points?.length ? simulateBbTouchPath(bollingerConfig.points) : []);
  if (!nodes.length) return { segments: [], clouds: [], markers: [] };
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

const FLAG_BULL_COLOR = '#26a69a'; // bandeira de alta = verde (mesmo tom do candle de alta)
const FLAG_BEAR_COLOR = '#ef5350'; // bandeira de baixa = vermelho
const FLAG_BULL_FILL = 'rgba(38,166,154,0.10)';
const FLAG_BEAR_FILL = 'rgba(239,83,80,0.10)';

/**
 * Desenho das bandeiras auto-detectadas (ver utils/detectFlags.js): por bandeira, um LineSeries
 * pro mastro, dois pro canal (topo/fundo) e um pro alvo (só quando confirmada). O sombreado do
 * canal sai como banda no BandFillPrimitive (prefixo 'flag-'). Tempos de detectFlags vêm em ms
 * (openTime) — aqui viram segundos (contrato do Lightweight Charts).
 */
function buildFlagsDrawing(flagsConfig) {
  const series = [];
  const bands = [];
  const markers = [];
  const sec = (ms) => Math.floor(Number(ms) / 1000);
  const seg = (aT, aV, bT, bV) => {
    const t1 = sec(aT); const t2 = sec(bT);
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || !Number.isFinite(aV) || !Number.isFinite(bV) || t2 <= t1) return null;
    return [{ time: t1, value: aV }, { time: t2, value: bV }];
  };

  for (const f of flagsConfig?.flags ?? []) {
    const color = f.type === 'bull' ? FLAG_BULL_COLOR : FLAG_BEAR_COLOR;
    const poleStyle = f.confirmed ? 0 : 2; // tracejado enquanto "em formação"

    const pole = seg(f.poleStart.time, f.poleStart.price, f.poleEnd.time, f.poleEnd.price);
    if (pole) series.push({ color, width: 2, style: poleStyle, data: pole });

    const [c0, c1] = f.channel ?? [];
    if (c0 && c1) {
      const up = seg(c0.time, c0.upper, c1.time, c1.upper);
      const lw = seg(c0.time, c0.lower, c1.time, c1.lower);
      if (up) series.push({ color, width: 1, style: 2, data: up });
      if (lw) series.push({ color, width: 1, style: 2, data: lw });
      const bt0 = sec(c0.time); const bt1 = sec(c1.time);
      if (bt1 > bt0 && [c0.upper, c0.lower, c1.upper, c1.lower].every(Number.isFinite)) {
        bands.push({
          points: [
            { time: bt0, upper: c0.upper, lower: c0.lower },
            { time: bt1, upper: c1.upper, lower: c1.lower },
          ],
          fillColor: f.type === 'bull' ? FLAG_BULL_FILL : FLAG_BEAR_FILL,
        });
      }
    }

    if (f.confirmed && f.breakout && f.target) {
      // Alvo na mesma cor da bandeira (verde=alta / vermelho=baixa), pontilhado pra
      // distinguir do mastro/canal.
      const tgt = seg(f.breakout.time, f.target.price, f.target.time, f.target.price);
      if (tgt) series.push({ color, width: 1.5, style: 3, data: tgt });

      const pct = ((f.target.price - f.breakout.price) / f.breakout.price) * 100;
      markers.push({
        time: sec(f.breakout.time),
        position: f.type === 'bull' ? 'belowBar' : 'aboveBar',
        shape: f.type === 'bull' ? 'arrowUp' : 'arrowDown',
        color,
        size: 1,
        text: `${f.label} → alvo ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
      });
    }
  }

  return { series, bands, markers };
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
        fillColor: 'rgba(34,197,94,0.14)', labelColor: '#22c55e',
        label: formatPctFromBase(buyPrice, targetPrice) + (targetConfig.simulated ? ' (simulado)' : ''),
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
        fillColor: 'rgba(239,68,68,0.14)', labelColor: '#ef4444',
        label: formatPctFromBase(buyPrice, stopPrice) + (stopLossConfig.simulated ? ' (simulado)' : ''),
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

/** Williams Fractals — mesmos marcadores do PPHL (um por fractal), mas com cor própria
 *  (rosa) e círculo em vez de seta, pra distinguir dos pivôs do PPHL quando os dois estão
 *  ligados ao mesmo tempo. */
function buildWfractalsMarkers(wfractalsConfig) {
  if (!wfractalsConfig?.points?.length) return [];
  return wfractalsConfig.points
    .map((p) => {
      const time = Math.floor(Number(p.time) / 1000);
      if (!Number.isFinite(time)) return null;
      return p.type === 'high'
        ? { time, position: 'aboveBar', shape: 'circle', color: '#f472b6', size: 0.6 }
        : { time, position: 'belowBar', shape: 'circle', color: '#f472b6', size: 0.6 };
    })
    .filter(Boolean);
}

/** Marcadores numéricos do TD Sequential Setup (ver computeTdSequentialSetup) — número 1-9
 *  abaixo do candle (Buy Setup, possível fundo) ou acima (Sell Setup, possível topo). A
 *  contagem 9 (setup completo) ganha marcador maior e cor sólida; as demais ficam translúcidas
 *  pra não competir visualmente com o preço. */
function buildTdSequentialMarkers(chartCandlesticks, tdSeqCandlesticks) {
  const seq = computeTdSequentialSetup(tdSeqCandlesticks).filter(Boolean);
  const snapped = snapPointsToChartCandles(chartCandlesticks, seq);
  return snapped.map((s) => ({
    time: s.time,
    position: s.state === 'buy' ? 'belowBar' : 'aboveBar',
    shape: 'circle',
    size: s.count === 9 ? 0.7 : 0.25,
    color: s.state === 'buy'
      ? (s.count === 9 ? '#22c55e' : 'rgba(74,222,128,0.55)')
      : (s.count === 9 ? '#ef4444' : 'rgba(251,113,133,0.55)'),
    text: String(s.count),
  }));
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
  bollingerConfigs = [], srConfig, pphlConfig, wfractalsConfig, zigzagConfig, rsiCrossThreshold = 0, flagsConfig, analysisBoxRect, prevDayCloudConfig, rsi, chopConfig, macdConfig,
  emaPersistCloudData, emaPersistCloudConfirmData, emaPersistCloudConfirm2Data, emaPersistCloudLayers, emaPersistCloudTones, barsSinceCrossData, tdSequentialData,
  stopLossConfig, targetConfig, buyInfo, multitradeMarkers, zoomPeriod, focusLastN,
  onNeedOlderCandles, loadingMoreCandles, onVisibleRangeChange, visibleRange,
}, ref) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const indicatorSeriesRef = useRef({});
  const priceLinesRef = useRef([]);
  // S/R rolante: array de LineSeries — um por "posto" de nível (R1, R2… / S1, S2…), ligando o
  // mesmo posto entre as âncoras (estilo 'degrau'/'traço'). Vazio no estilo 'linhas'.
  const srRollSeriesRef = useRef([]);
  const markersPluginRef = useRef(null);
  const rectPrimitiveRef = useRef(null);
  const bandFillPrimitiveRef = useRef(null);
  const pnlSeriesRef = useRef(null);
  // ZigZag: linha ligando os pivôs confirmados + linha tracejada da perna final ainda não
  // confirmada (do último pivô até o candle mais recente).
  const zigzagSeriesRef = useRef(null);
  const zigzagTentativeSeriesRef = useRef(null);
  // Bandeiras (auto): array de LineSeries — mastro + 2 linhas do canal + alvo, por bandeira.
  // O sombreado do canal vai pelo bandFillPrimitiveRef (prefixo 'flag-'), como as demais nuvens.
  const flagsSeriesRef = useRef([]);
  // Array de LineSeries — um por trecho do PATH (alta=verde / baixa=vermelho)
  const bbPathSeriesRef = useRef([]);
  // Array de LineSeries — um por sinal de toque na banda inferior, mostrando os 10 candles
  // anteriores da linha mediana (verde=tendência de alta, vermelho=tendência de baixa)
  const medianTrendSeriesRef = useRef([]);
  const subpanelStateRef = useRef({ key: null, series: {} });
  // MACD sobreposto no preço: histograma + linha MACD + linha de sinal, num price scale próprio
  // ('macd') confinado à faixa inferior da pane principal (ver efeito do MACD abaixo).
  const macdSeriesRef = useRef({ hist: null, macd: null, signal: null });
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
  // Callback de "trecho visível mudou" (pan/zoom) — espelhada em ref pra o listener assinado uma
  // única vez sempre ler a versão mais recente. Ver S/R com janela deslizante no manipulador.
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  useEffect(() => { onVisibleRangeChangeRef.current = onVisibleRangeChange; }, [onVisibleRangeChange]);
  useEffect(() => { onNeedOlderCandlesRef.current = onNeedOlderCandles; }, [onNeedOlderCandles]);
  useEffect(() => { loadingMoreCandlesRef.current = loadingMoreCandles; }, [loadingMoreCandles]);
  useEffect(() => { candlesticksLenRef.current = candlesticks?.length ?? 0; }, [candlesticks]);
  // Sem isso, trocar de moeda/intervalo depois de já ter arrastado-carregado histórico uma vez
  // deixa o guard de "já disparei pra esse tamanho" (triggeredForLenRef, ver handleVisibleLogicalRangeChange
  // abaixo) travado: a busca nova volta a caber exatamente no mesmo tamanho (DEFAULT_CANDLE_LIMIT)
  // que já tinha disparado antes, e o guard bloqueia pra sempre o próximo arrasto pra trás.
  useEffect(() => { triggeredForLenRef.current = -1; }, [symbol, interval]);

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
        // Default da lib é 12 — reduzido pra caber as linhas de grade extras do RSI (10/20/
        // 40/60/90) sem os números se sobreporem. Vale pro chart inteiro (não dá pra fixar só
        // por pane na Lightweight Charts), mas no preço principal também ajuda a caber mais
        // marcações no eixo.
        fontSize: 8,
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
    zigzagSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#818cf8', lineWidth: 2, lineStyle: 0,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      pointMarkersVisible: true, pointMarkersRadius: 3,
    });
    zigzagTentativeSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#818cf8', lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    bbPathSeriesRef.current = [];
    medianTrendSeriesRef.current = [];
    flagsSeriesRef.current = [];
    indicatorSeriesRef.current = {};
    priceLinesRef.current = [];
    srRollSeriesRef.current = [];
    markersPluginRef.current = createSeriesMarkers(series, []);
    subpanelStateRef.current = { key: null, series: {} };
    macdSeriesRef.current = { hist: null, macd: null, signal: null };
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
    // Trecho de TEMPO visível (pan/zoom) — reportado pro pai pra o S/R (e PPHL/WF/ZZ) usarem
    // janela deslizante sobre os candles que estão aparecendo. `range` vem em segundos (UTCTimestamp)
    // ou null quando não há dados.
    const handleVisibleTimeRangeChange = (range) => {
      if (!range || !onVisibleRangeChangeRef.current) return;
      const fromMs = Number(range.from) * 1000;
      const toMs = Number(range.to) * 1000;
      if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
        onVisibleRangeChangeRef.current({ fromMs, toMs });
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
    // pointerdown/touchstart no container = início de um arrasto real; pointerup/touchend/cancel
    // (ouvidos no window, não só no container, pra pegar o "soltar" mesmo se o ponteiro sair da
    // área do gráfico antes de soltar) = fim do gesto. Esse é o único sinal confiável de "o
    // usuário está de fato arrastando" — ver comentário do isUserPanningRef acima.
    // No touch, a lib tem kinetic/momentum scroll (default) — o gráfico continua "deslizando"
    // por inércia depois que o dedo já soltou a tela, então o range change que finalmente cruza
    // a borda (from<=5, ver handleVisibleLogicalRangeChange) só chega DEPOIS do touchend. Por
    // isso handlePanEnd não desliga a flag na hora: espera uma folga (bastante acima da duração
    // típica do momentum) pra ainda contar esses range changes tardios como arrasto real. No
    // mouse (notebook) não há inércia — o range final já chega antes do pointerup, então a folga
    // não muda nada ali, só cobre o caso do touch.
    const el = containerRef.current;
    let panEndTimeoutId = null;
    const handlePanStart = () => {
      if (panEndTimeoutId) { clearTimeout(panEndTimeoutId); panEndTimeoutId = null; }
      isUserPanningRef.current = true;
    };
    const handlePanEnd = () => {
      if (panEndTimeoutId) clearTimeout(panEndTimeoutId);
      panEndTimeoutId = setTimeout(() => {
        isUserPanningRef.current = false;
        panEndTimeoutId = null;
      }, 600);
    };
    el?.addEventListener('pointerdown', handlePanStart);
    el?.addEventListener('touchstart', handlePanStart, { passive: true });
    window.addEventListener('pointerup', handlePanEnd);
    window.addEventListener('pointercancel', handlePanEnd);
    window.addEventListener('touchend', handlePanEnd);
    window.addEventListener('touchcancel', handlePanEnd);
    return () => {
      if (panEndTimeoutId) clearTimeout(panEndTimeoutId);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
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
      srRollSeriesRef.current = [];
      markersPluginRef.current = null;
      rectPrimitiveRef.current = null;
      bandFillPrimitiveRef.current = null;
      pnlSeriesRef.current = null;
      zigzagSeriesRef.current = null;
      zigzagTentativeSeriesRef.current = null;
      bbPathSeriesRef.current = [];
      medianTrendSeriesRef.current = [];
      flagsSeriesRef.current = [];
      subpanelStateRef.current = { key: null, series: {} };
      macdSeriesRef.current = { hist: null, macd: null, signal: null };
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
      // Mesmo religamento pras price scales dos sub-painéis (RSI/CHOP/BARS) — cada pane tem sua
      // própria escala independente da principal, então arrastar o eixo do RSI pra ver mais
      // variação (ver createPriceLine acima) travava autoScale só ali, e sem isso ficava preso
      // fora do range ao trocar de moeda.
      Object.values(subpanelStateRef.current.series).forEach((s) => {
        try { s.priceScale().applyOptions({ autoScale: true }); } catch { /* pane já removida */ }
      });
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

      // Nuvem PERM (inclinação EMA9) — botão "Perman." do painel (ver
      // buildEmaCrossPersistenceClouds). Intervalo PRÓPRIO (independente do gráfico, ver
      // fetchEmaCrossOverlayData em CandlestickChart.jsx) — os candles/EMAs vêm do intervalo
      // escolhido no painel (ex.: PERM em 15m sobre um gráfico em 15m), depois "encaixados" nos
      // candles REALMENTE exibidos via snapPointsToChartCandles. Quando há intervalo de
      // confirmação (ex.: 1h → 15m), o array de segmentos já vem com uma extensão "preview" além
      // do último candle fechado do intervalo principal — flui pelo mesmo filter/map abaixo.
      let emaPersistClouds = [];
      if (activeIndicators.includes('emaPersistCloud')
        && emaPersistCloudData?.candlesticks?.length && emaPersistCloudData?.ma9?.length && emaPersistCloudData?.ma21?.length) {
        const raw = buildEmaCrossPersistenceClouds(
          emaPersistCloudData.candlesticks, emaPersistCloudData.ma9, emaPersistCloudData.ma21,
          emaPersistCloudConfirmData, emaPersistCloudConfirm2Data, emaPersistCloudLayers,
        ).segments;
        const afterTone = raw.filter((seg) => emaPersistCloudTones?.[seg.tone] !== false);
        const afterSnap = afterTone.map((seg) => ({ ...seg, points: snapPointsToChartCandles(candlesticks, seg.points) }));
        const afterClip = afterSnap.map((seg) => ({ ...seg, points: seg.points.filter((p) => p.time >= minTime && p.time <= maxTime) }));
        emaPersistClouds = afterClip.filter((seg) => seg.points.length >= 2);
        // DEBUG TEMPORARIO — remover depois de achar o motivo dos buracos.
        if (window.__PERM_DEBUG__) {
          const fmt = (t) => new Date(t * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          console.log('[PERM debug] raw segments:', raw.length, '-> afterTone:', afterTone.length,
            '-> afterSnap(pontos>0):', afterSnap.filter(s => s.points.length).length,
            '-> afterClip(pontos>0):', afterClip.filter(s => s.points.length).length,
            '-> final:', emaPersistClouds.length);
          console.log('[PERM debug] candlesticks(chart) range:', candlesticks?.length ? fmt(minTime) + ' -> ' + fmt(maxTime) : 'vazio', 'total:', candlesticks?.length);
          console.log('[PERM debug] emaPersistCloudData.candlesticks range:',
            emaPersistCloudData.candlesticks.length,
            fmt(Math.floor(Number(emaPersistCloudData.candlesticks[0].openTime) / 1000)), '->',
            fmt(Math.floor(Number(emaPersistCloudData.candlesticks[emaPersistCloudData.candlesticks.length - 1].openTime) / 1000)));
          console.log('[PERM debug] confirmData?', !!emaPersistCloudConfirmData, emaPersistCloudConfirmData?.candlesticks?.length ?? 0, 'candles');
          console.table(raw.map((s, i) => ({
            i, tone: s.tone, preview: !!s.preview, confirmed: s.confirmed, pontos: s.points.length,
            de: fmt(s.points[0].time), ate: fmt(s.points[s.points.length - 1].time),
          })));
        }
      }
      bandFillPrimitiveRef.current.replacePrefixed('emaPersist-', emaPersistClouds);

      // Nuvem D-1: um "degrau" por candle nativo (intervalo escolhido no seletor "D"), cada um
      // com o envelope abertura/fechamento dos candles ANTERIORES a ele (ver
      // buildPrevDayCloudSegments em CandlestickChart.jsx) — arrastando o gráfico pra trás, cada
      // trecho antigo mostra a nuvem que valia NAQUELE momento, não uma faixa única fixa esticada
      // por todo o histórico. Cor em ciclo randomizado (PREV_DAY_CLOUD_RANDOM_COLORS), não
      // verde/vermelho por alta/baixa — só pra distinguir visualmente onde cada degrau termina.
      let prevDayCloudBand = [];
      if (activeIndicators.includes('prevDayCloud')
        && prevDayCloudConfig?.segments?.length && Number.isFinite(minTime) && Number.isFinite(maxTime)) {
        prevDayCloudBand = prevDayCloudConfig.segments
          .map((seg, idx) => {
            if (!Number.isFinite(seg.upper) || !Number.isFinite(seg.lower)) return null;
            const segStart = Math.floor(seg.startTime / 1000);
            const segEnd = seg.endTime != null ? Math.floor(seg.endTime / 1000) : maxTime;
            const start = Math.max(segStart, minTime);
            const end = Math.min(segEnd, maxTime);
            if (end <= start) return null;
            return {
              points: [{ time: start, upper: seg.upper, lower: seg.lower }, { time: end, upper: seg.upper, lower: seg.lower }],
              fillColor: PREV_DAY_CLOUD_RANDOM_COLORS[idx % PREV_DAY_CLOUD_RANDOM_COLORS.length],
            };
          })
          .filter(Boolean);
      }
      bandFillPrimitiveRef.current.replacePrefixed('prevDayCloud-', prevDayCloudBand);
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
  }, [activeIndicators, ma9, ma21, ma50, ma200, overlayConfigs, bollingerConfigs, vwapConfig, vwapSlopeHighlight, candlesticks, emaPersistCloudData, emaPersistCloudConfirmData, emaPersistCloudConfirm2Data, emaPersistCloudLayers, emaPersistCloudTones, prevDayCloudConfig]);

  // S/R. Dois modos (ver srConfig no CandlestickChart.jsx):
  //  - shape antigo { levels } (override de trade das Estatísticas) → linhas de preço de ponta a
  //    ponta, com rótulo de entrada/alvo (comportamento clássico).
  //  - shape rolante { rolling:[{time,levels}], style } → pra cada âncora um conjunto de níveis.
  //    'degrau' = LineSeries em escada por posto; 'traço' = segmentos curtos soltos por âncora;
  //    'linhas' = só o conjunto da âncora mais recente como linhas de preço.
  // Sempre recriado do zero (poucos níveis/séries, custo desprezível).
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    for (const line of priceLinesRef.current) {
      try { series.removePriceLine(line); } catch { /* já removida junto do chart */ }
    }
    priceLinesRef.current = [];
    for (const s of srRollSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* já removida */ }
    }
    srRollSeriesRef.current = [];

    if (!srConfig) return;

    const eq = (a, b) => a != null && b != null && Math.abs(a - b) / b < 1e-6;
    const entrySup = srConfig.entrySupport ?? null;
    const exitRes = srConfig.exitResistance ?? null;

    // Linhas de preço de ponta a ponta (rótulo no eixo) pra uma lista de níveis — usadas no estilo
    // 'linhas' e no fallback do override sem janela de trade. Pontilhadas, azul (S) / rosa (R),
    // rótulo com o posto (S1/S2/R1…); entrada/alvo em sólido mais grosso.
    //  - mode 'full' : + destaque de entrada/alvo   - mode 'ref' : só referência fina
    const makePriceLines = (levels, mode) => {
      for (const type of ['support', 'resistance']) {
        const color = type === 'support' ? SR_SUPPORT_LINE : SR_RESISTANCE_LINE;
        for (const lvl of rankSrLevels(levels, type)) {
          const isEntry = mode === 'full' && eq(lvl.price, entrySup);
          const isExit = mode === 'full' && eq(lvl.price, exitRes);
          priceLinesRef.current.push(series.createPriceLine({
            price: lvl.price, color,
            lineWidth: mode === 'ref' ? 1 : ((isEntry || isExit) ? 3 : 2),
            lineStyle: (isEntry || isExit) ? 0 : 2,
            axisLabelVisible: true,
            title: `${lvl.label} (${lvl.touches ?? 1}x)${isEntry ? ' entrada' : isExit ? ' alvo' : ''}`,
          }));
        }
      }
    };

    // Faixa de candles carregada (LW rejeita pontos de série fora dela).
    const cs = candlesticks ?? [];
    const minTime = cs.length ? Math.floor(Number(cs[0].openTime) / 1000) : null;
    const maxTime = cs.length ? Math.floor(Number(cs[cs.length - 1].openTime) / 1000) : null;
    const inRange = (tsec) => minTime == null || (tsec >= minTime && tsec <= maxTime);

    // Override de trade das Estatísticas (shape { levels, tradeWindow }): TRAÇO na janela do trade
    // — cada nível vira um segmento entrada→saída, sem linha atravessando o resto do gráfico.
    // Sem janela (ou sem candles) → cai no clássico de ponta a ponta.
    if (!srConfig.rolling) {
      const tw = srConfig.tradeWindow;
      if (!tw || minTime == null) { makePriceLines(srConfig.levels, 'full'); return; }
      const from = Math.max(minTime, Math.floor(tw.fromMs / 1000));
      const to = Math.min(maxTime, Math.floor(tw.toMs / 1000));
      if (to <= from) { makePriceLines(srConfig.levels, 'full'); return; }
      for (const type of ['support', 'resistance']) {
        const color = type === 'support' ? SR_SUPPORT_LINE : SR_RESISTANCE_LINE;
        for (const lvl of rankSrLevels(srConfig.levels, type)) {
          const isEntry = eq(lvl.price, entrySup);
          const isExit = eq(lvl.price, exitRes);
          const s = chart.addSeries(LineSeries, {
            color,
            lineWidth: (isEntry || isExit) ? 3 : 2,
            lineStyle: (isEntry || isExit) ? 0 : 2, // entrada/alvo sólido, resto pontilhado
            lastValueVisible: isEntry || isExit,
            priceLineVisible: false, crosshairMarkerVisible: false,
          });
          s.setData([{ time: from, value: lvl.price }, { time: to, value: lvl.price }]);
          createSeriesMarkers(s, [{
            time: to, position: 'inBar', color, shape: 'circle',
            text: lvl.label + (isEntry ? ' entrada' : isExit ? ' alvo' : ''),
          }]);
          srRollSeriesRef.current.push(s);
        }
      }
      return;
    }

    const anchors = srConfig.rolling;
    if (!anchors.length) return;
    const latest = anchors[anchors.length - 1].levels;

    if (srConfig.style === 'linhas') {
      makePriceLines(latest, 'full');
      return;
    }
    if (minTime == null) { makePriceLines(latest, 'ref'); return; }

    // TRAÇO: os níveis da âncora mais recente (S/R "de agora"), cada um como um traço horizontal
    // curto, SEM escada rolante. O traço termina na borda direita do trecho VISÍVEL (não no último
    // candle carregado) — assim acompanha o arrasto pra trás. Largura = maior entre
    // SR_TRACO_MIN_CANDLES e ~1 candle do intervalo do S/R, em candles do gráfico.
    if (srConfig.style === 'traco') {
      const chartStepSec = cs.length > 1
        ? Math.max(1, Math.floor((Number(cs[cs.length - 1].openTime) - Number(cs[cs.length - 2].openTime)) / 1000))
        : 900;
      const srStepSec = anchors.length > 1
        ? Math.max(chartStepSec, Math.floor((Number(anchors[anchors.length - 1].time) - Number(anchors[anchors.length - 2].time)) / 1000))
        : chartStepSec * 16;
      const widthCandles = Math.max(SR_TRACO_MIN_CANDLES, Math.round(srStepSec / chartStepSec));
      // borda direita do trecho VISÍVEL (prop reativa) → índice do candle do gráfico ali
      const rightSec = Number.isFinite(visibleRange?.toMs) ? Math.floor(visibleRange.toMs / 1000) : maxTime;
      let ei = cs.length - 1;
      for (let i = cs.length - 1; i >= 0; i--) {
        if (Math.floor(Number(cs[i].openTime) / 1000) <= rightSec) { ei = i; break; }
      }
      const endT = Math.floor(Number(cs[ei].openTime) / 1000);
      const startT = Math.floor(Number(cs[Math.max(0, ei - widthCandles)].openTime) / 1000);
      if (endT > startT) {
        for (const type of ['support', 'resistance']) {
          const color = type === 'support' ? SR_SUPPORT_LINE : SR_RESISTANCE_LINE;
          for (const lvl of rankSrLevels(latest, type)) {
            const s = chart.addSeries(LineSeries, {
              color, lineWidth: type === 'support' ? 3 : 2, lineStyle: 2, // pontilhada
              priceLineVisible: false, lastValueVisible: lvl.rank === 1, crosshairMarkerVisible: false,
            });
            s.setData([{ time: startT, value: lvl.price }, { time: endT, value: lvl.price }]);
            createSeriesMarkers(s, [{ time: endT, position: 'inBar', color, shape: 'circle', text: lvl.label }]);
            srRollSeriesRef.current.push(s);
          }
        }
      }
      return;
    }

    // DEGRAU: escada rolante — liga o mesmo posto de nível entre as 10 âncoras.
    const times = anchors.map((a) => Math.floor(Number(a.time) / 1000));
    // Postos por âncora já rankeados (S1 = suporte mais perto do preço, R1 = resistência mais perto).
    const rankedByAnchor = anchors.map((a) => ({
      support: rankSrLevels(a.levels, 'support'),
      resistance: rankSrLevels(a.levels, 'resistance'),
    }));

    for (const type of ['support', 'resistance']) {
      const color = type === 'support' ? SR_SUPPORT_LINE : SR_RESISTANCE_LINE;
      const width = type === 'support' ? 3 : 2;
      // detectSupportResistance devolve no máx. ~3 níveis por tipo; teto defensivo em 6.
      const maxRank = Math.min(6, Math.max(0, ...rankedByAnchor.map((x) => x[type].length)));
      for (let r = 0; r < maxRank; r++) {
        const data = [];
        let lastPt = null;
        for (let i = 0; i < anchors.length; i++) {
          if (!inRange(times[i])) continue;
          const lvl = rankedByAnchor[i][type][r];
          data.push(lvl ? { time: times[i], value: lvl.price } : { time: times[i] });
          if (lvl) lastPt = { time: times[i], value: lvl.price };
        }
        const dedup = [];
        for (const p of data) {
          if (dedup.length && dedup[dedup.length - 1].time >= p.time) {
            if (p.value != null) dedup[dedup.length - 1] = p;
          } else dedup.push(p);
        }
        if (!lastPt || !dedup.some((p) => p.value != null)) continue;
        const s = chart.addSeries(LineSeries, {
          color, lineWidth: width, lineType: LineType.WithSteps, lineStyle: 2, // pontilhada
          priceLineVisible: false, lastValueVisible: r === 0, crosshairMarkerVisible: false,
        });
        s.setData(dedup);
        createSeriesMarkers(s, [{
          time: lastPt.time, position: 'inBar', color, shape: 'circle',
          text: `${type === 'support' ? 'S' : 'R'}${r + 1}`,
        }]);
        srRollSeriesRef.current.push(s);
      }
    }
  // visibleRange só reposiciona o stub do 'traço'; degrau/linhas ignoram (posição vem do srConfig).
  }, [srConfig, candlesticks, visibleRange]);

  // Linhas verticais (fullHeight, largura 2px) nos candles em que o RSI(14) cruzou pra cima do
  // "Limiar RSI" — mesmo gatilho do bot RSI Momentum (ver computeRsiUpCrossings). Roxo.
  const rsiCrossRects = useMemo(() => {
    if (!(Number(rsiCrossThreshold) > 0) || !activeIndicators.includes('rsi')) return [];
    return computeRsiUpCrossings(rsi, candlesticks, rsiCrossThreshold).map((openMs) => {
      const time = Math.floor(openMs / 1000);
      return { time1: time, time2: time, fullHeight: true, fillColor: 'rgba(167,139,250,0.55)', lineWidth: 2 };
    });
  }, [rsi, candlesticks, rsiCrossThreshold, activeIndicators]);

  // Quadrados alvo/stop da posição aberta — retângulo customizado (ver lwRectanglePrimitive.js),
  // igual ao buildBuyPositionSquares do ECharts (markArea verde/vermelho com % de distância).
  useEffect(() => {
    if (!rectPrimitiveRef.current) return;
    rectPrimitiveRef.current.setRects([
      ...buildPositionRects(buyInfo, stopLossConfig, targetConfig, candlesticks),
      ...buildHistoricalPositionRects(multitradeMarkers, candlesticks),
      ...(analysisBoxRect ? [analysisBoxRect] : []),
      ...rsiCrossRects,
    ]);
  }, [buyInfo, stopLossConfig, targetConfig, candlesticks, multitradeMarkers, analysisBoxRect, rsiCrossRects]);

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

  // ZigZag: liga os pivôs confirmados numa linha + perna final tracejada (não confirmada).
  // Direto por timestamp (como buildPphlMarkers), sem mapear pro candle mais próximo.
  useEffect(() => {
    const line = zigzagSeriesRef.current;
    const tentative = zigzagTentativeSeriesRef.current;
    if (!line || !tentative) return;
    const toPoint = (p) => {
      const time = Math.floor(Number(p.time) / 1000);
      const value = Number(p.price);
      return Number.isFinite(time) && Number.isFinite(value) ? { time, value } : null;
    };
    const pts = (zigzagConfig?.points ?? []).map(toPoint).filter(Boolean);
    // LW exige tempos estritamente crescentes e únicos.
    const dedup = [];
    for (const p of pts) {
      if (dedup.length && dedup[dedup.length - 1].time >= p.time) dedup[dedup.length - 1] = p;
      else dedup.push(p);
    }
    line.setData(dedup.length >= 2 ? dedup : []);

    const leg = zigzagConfig?.lastLeg;
    const a = leg?.from ? toPoint({ time: leg.from.time, price: leg.from.price }) : null;
    const b = leg?.to ? toPoint({ time: leg.to.time, price: leg.to.price }) : null;
    tentative.setData(a && b && b.time > a.time ? [a, b] : []);
  }, [zigzagConfig]);

  // Bandeiras (auto): mastro + canal (2 linhas) + alvo, um LineSeries por trecho — mesmo padrão
  // dinâmico do PATH BB (bbPathSeriesRef). O sombreado do canal vai na banda 'flag-' do
  // BandFillPrimitive.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of flagsSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* já removida */ }
    }
    const { series: defs, bands } = buildFlagsDrawing(flagsConfig);
    const next = [];
    for (const def of defs) {
      if (!def.data?.length) continue;
      const s = chart.addSeries(LineSeries, {
        color: def.color, lineWidth: def.width, lineStyle: def.style ?? 0,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(def.data);
      next.push(s);
    }
    flagsSeriesRef.current = next;
    bandFillPrimitiveRef.current?.replacePrefixed('flag-', bands);
  }, [flagsConfig]);

  // Marcadores: PPHL + sinal/venda de Multi-Trade + % da linha de PnL + path BB (de todos os
  // grupos com showPath ligado) + rompimento das bandeiras auto.
  useEffect(() => {
    if (!markersPluginRef.current) return;
    const markers = [...buildPphlMarkers(pphlConfig), ...buildWfractalsMarkers(wfractalsConfig), ...buildTradeMarkers(multitradeMarkers), ...buildFlagsDrawing(flagsConfig).markers];
    const pnlMarker = buildPnlMarker(buyInfo, candlesticks);
    if (pnlMarker) markers.push(pnlMarker);
    const bbPathMarkers = bollingerConfigs
      .filter((cfg) => cfg.showPath)
      .flatMap((cfg) => buildBbPathLineAndMarkers(cfg, candlesticks).markers);
    markers.push(...bbPathMarkers);
    if (activeIndicators.includes('tdSequential') && tdSequentialData?.candlesticks?.length) {
      markers.push(...buildTdSequentialMarkers(candlesticks, tdSequentialData.candlesticks));
    }
    markers.sort((a, b) => a.time - b.time);
    markersPluginRef.current.setMarkers(markers);
  }, [pphlConfig, wfractalsConfig, flagsConfig, multitradeMarkers, buyInfo, candlesticks, bollingerConfigs, activeIndicators, tdSequentialData]);

  // Sub-painéis RSI/CHOP (panes nativos do LW v5) — reconstrói do zero só quando o CONJUNTO
  // ativo muda (ex.: liga CHOP com RSI já ligado), não a cada novo valor.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const showRsi = activeIndicators.includes('rsi');
    const showChop = activeIndicators.includes('chopZone');
    const showBarsCross = activeIndicators.includes('barsSinceCross');
    const ids = [...(showRsi ? ['rsi'] : []), ...(showChop ? ['chopZone'] : []), ...(showBarsCross ? ['barsSinceCross'] : [])];
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
        if (id === 'barsSinceCross') {
          // Histograma (não linha): "Bars Since MA Cross" oscila em torno de zero e cada barra
          // já traz sua própria cor (verde/vermelho) — HistogramSeries aceita `color` por ponto.
          const s = chart.addSeries(HistogramSeries, {
            priceLineVisible: false, lastValueVisible: false,
          }, pane.paneIndex());
          s.createPriceLine({ price: 0, color: '#64748b', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
          newSeries[id] = s;
          newPanes.push(pane);
          return;
        }
        const s = chart.addSeries(LineSeries, {
          color: id === 'rsi' ? '#a78bfa' : '#f59e0b', lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, pane.paneIndex());
        if (id === 'rsi') {
          // Linhas de grade extras (10/20/40/60/90 e 80 quando R80 não está ligado) — sem elas
          // só havia referência visual em 30/50/70, deixando buracos grandes pra ler o valor
          // depois de arrastar/zoomar o eixo (autoScale reajusta o range vertical visível).
          const gridColor = colors?.panel || '#003f69';
          [10, 20, 40, 60, 90].forEach((lvl) => {
            s.createPriceLine({ price: lvl, color: gridColor, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
          });
          s.createPriceLine({ price: 30, color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' });
          s.createPriceLine({ price: 50, color: '#ffffff', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '50' });
          s.createPriceLine({ price: 70, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' });
          if (activeIndicators.includes('rsi50')) s.createPriceLine({ price: 50, color: '#facc15', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '50' });
          if (activeIndicators.includes('rsi80')) {
            s.createPriceLine({ price: 80, color: '#fb923c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '80' });
          } else {
            s.createPriceLine({ price: 80, color: gridColor, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
          }
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
    if (state.series.barsSinceCross) {
      // Intervalo PRÓPRIO (ex.: BARS em 1h sobre gráfico em 15m) — mesmo padrão da nuvem PERM:
      // calcula sobre os candles do intervalo escolhido, depois encaixa nos candles do gráfico.
      let data = [];
      if (barsSinceCrossData?.candlesticks?.length && barsSinceCrossData?.ma9?.length && barsSinceCrossData?.ma21?.length) {
        const raw = computeBarsSinceMaCross(barsSinceCrossData.candlesticks, barsSinceCrossData.ma9, barsSinceCrossData.ma21);
        data = snapPointsToChartCandles(candlesticks, raw).map((p) => ({
          time: p.time, value: p.value, color: p.value >= 0 ? 'rgba(38,166,154,0.9)' : 'rgba(239,83,80,0.9)',
        }));
      }
      state.series.barsSinceCross.setData(data);
    }
  }, [activeIndicators, rsi, chopConfig, candlesticks, barsSinceCrossData]);

  // MACD (12/26/9) SOBREPOSTO no preço — histograma + linha MACD + linha de sinal, num price
  // scale próprio ('macd') na pane principal, confinado à faixa inferior via scaleMargins pra
  // não achatar os candles. Intervalo próprio (macdConfig.interval), alinhado por candle igual
  // ao CHOP/EMAs (alignFieldToCandles), então funciona em qualquer intervalo do gráfico.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const show = activeIndicators.includes('macd') && macdConfig;
    const refs = macdSeriesRef.current;

    if (!show) {
      for (const k of ['hist', 'macd', 'signal']) {
        if (refs[k]) { try { chart.removeSeries(refs[k]); } catch { /* já removida */ } refs[k] = null; }
      }
      return;
    }

    const scaleMargins = { top: 0.72, bottom: 0.02 };
    if (!refs.hist) {
      refs.hist = chart.addSeries(HistogramSeries, {
        priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false, base: 0,
      });
      refs.hist.priceScale().applyOptions({ scaleMargins });
    }
    if (!refs.macd) {
      refs.macd = chart.addSeries(LineSeries, {
        priceScaleId: 'macd', color: '#38bdf8', lineWidth: 1.5,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }
    if (!refs.signal) {
      refs.signal = chart.addSeries(LineSeries, {
        priceScaleId: 'macd', color: '#f97316', lineWidth: 1.5,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }

    const histData = alignFieldToCandles(candlesticks, macdConfig.histogram ?? [], 'value')
      .map((d) => ({ ...d, color: d.value >= 0 ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)' }));
    refs.hist.setData(histData);
    refs.macd.setData(alignFieldToCandles(candlesticks, macdConfig.macd ?? [], 'value'));
    refs.signal.setData(alignFieldToCandles(candlesticks, macdConfig.signal ?? [], 'value'));
    try { refs.hist.priceScale().applyOptions({ scaleMargins, autoScale: true }); } catch { /* noop */ }
  }, [activeIndicators, macdConfig, candlesticks]);

  // Legenda: cor + nome de cada linha sobreposta ao preço (EMA fixa/rápida, VWAP, Bollinger) —
  // com várias Bollinger Bands e EMAs simultâneas na mesma paleta de cores, sem isso não dava
  // pra saber o que era o quê só olhando o gráfico.
  const emaPersistLegend = useMemo(() => {
    if (!activeIndicators.includes('emaPersistCloud')
      || !emaPersistCloudData?.candlesticks?.length || !emaPersistCloudData?.ma9?.length || !emaPersistCloudData?.ma21?.length) {
      return null;
    }
    const { lastSlopePct, lastState, lastConfirmed, lastIsPreview } = buildEmaCrossPersistenceClouds(
      emaPersistCloudData.candlesticks, emaPersistCloudData.ma9, emaPersistCloudData.ma21,
      emaPersistCloudConfirmData, emaPersistCloudConfirm2Data,
    );
    const text = formatEma9SlopeLegend(lastSlopePct, lastState, lastConfirmed, lastIsPreview);
    if (!text) return null;
    const tone = SLOPE_STATE_META[lastState]?.tone;
    if (tone && emaPersistCloudTones?.[tone] === false) return null;
    const fill = SLOPE_STATE_META[lastState]?.fillColor ?? '#4ade80';
    return { text, fill };
  }, [activeIndicators, emaPersistCloudData, emaPersistCloudConfirmData, emaPersistCloudConfirm2Data, emaPersistCloudTones]);

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
    if (emaPersistLegend) {
      entries.push({ key: 'emaPersistCloud', color: emaPersistLegend.fill, label: emaPersistLegend.text });
    }
    if (activeIndicators.includes('macd') && macdConfig) {
      entries.push({ key: 'macd', color: '#38bdf8', label: `MACD 12/26/9 @${macdConfig.interval}` });
    }
    // Cor da legenda das bandeiras: verde se só alta, vermelho se só baixa, cinza se mistura.
    const flagLegendColor = (list) => {
      if (!list?.length) return '#94a3b8';
      const hasBull = list.some((f) => f.type === 'bull');
      const hasBear = list.some((f) => f.type === 'bear');
      if (hasBull && !hasBear) return FLAG_BULL_COLOR;
      if (hasBear && !hasBull) return FLAG_BEAR_COLOR;
      return '#94a3b8';
    };
    if (flagsConfig?.scoped) {
      const list = flagsConfig.flags ?? [];
      const conf = list.filter((f) => f.confirmed).length;
      const forming = list.length - conf;
      entries.push({
        key: 'flags',
        color: flagLegendColor(list),
        label: list.length
          ? `Bandeiras na seleção: ${conf} conf.${forming ? ` + ${forming} possível(is)` : ''}`
          : (flagsConfig.scopedCount != null && flagsConfig.scopedCount < 12
            ? `Seleção pequena (${flagsConfig.scopedCount} candles) — mín. ~12`
            : 'Nenhuma bandeira na seleção'),
      });
    } else if (flagsConfig?.flags?.length) {
      const conf = flagsConfig.flags.filter((f) => f.confirmed).length;
      const forming = flagsConfig.flags.length - conf;
      entries.push({
        key: 'flags',
        color: flagLegendColor(flagsConfig.flags),
        label: `Bandeiras: ${conf} conf.${forming ? ` + ${forming} em formação` : ''}`,
      });
    }
    if (activeIndicators.includes('prevDayCloud') && prevDayCloudConfig?.segments?.length) {
      // Último degrau = nuvem vigente agora (dia mais recente carregado); os degraus mais
      // antigos ficam só no próprio gráfico, sem entrada de legenda separada pra cada um.
      const last = prevDayCloudConfig.segments[prevDayCloudConfig.segments.length - 1];
      const pdSuffix = prevDayCloudConfig.candleCount > 1 ? `×${prevDayCloudConfig.candleCount}` : '';
      const pdSrc = prevDayCloudConfig.useHighLow
        ? ` máx/mín [${last.lower} / ${last.upper}]`
        : ` A ${last.openPrice} / F ${last.closePrice}`;
      entries.push({
        key: 'prevDayCloud',
        color: last.bullish ? C_UP : C_DOWN,
        label: `D-1 ${prevDayCloudConfig.interval}${pdSuffix}${pdSrc}`,
      });
    }
    return entries;
  }, [activeIndicators, overlayConfigs, vwapConfig, bollingerConfigs, emaPersistLegend, prevDayCloudConfig, macdConfig, flagsConfig]);

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
