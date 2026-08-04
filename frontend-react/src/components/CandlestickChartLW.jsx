import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { createChart, CandlestickSeries, LineSeries, ColorType, createSeriesMarkers } from 'lightweight-charts';
import { computeVwapSlopeFlags, splitPointsByFlag } from '../utils/vwapSlopeHighlight';
import { computeStopLossFloor } from '../utils/trailingStopLoss';
import { RectanglePrimitive } from '../utils/lwRectanglePrimitive';
import { BandFillPrimitive } from '../utils/lwBandFillPrimitive';

const C_UP = '#26a69a';
const C_DOWN = '#ef5350';
const VWAP_LINE_COLOR = '#FF4FA3';
const VWAP_BAND_COLOR = 'rgba(255, 79, 163, 0.45)';
const VWAP_BAND_FILL_COLOR = 'rgba(255, 79, 163, 0.08)';
// Destaque de queda da VWAP precisa ficar visualmente distinto da própria VWAP, que agora é rosa.
const VWAP_DECLINE_COLOR = '#ef4444';
const VWAP_DECLINE_CLOUD_COLOR = 'rgba(239, 68, 68, 0.28)';
const BB_COLOR = '#818cf8';

const EMA_LINE_DEFS = [
  { id: 'ma9',  color: '#e879f9' },
  { id: 'ma21', color: '#fb923c' },
  { id: 'ma50', color: '#22d3ee' },
  { id: 'ma200', color: '#f59e0b' },
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
 *  (buildBuyPositionSquares em CandlestickChart.jsx): retângulo do candle de compra até 5
 *  candles à frente, do preço de compra até o preço do alvo/stop, com o % como label. */
function buildPositionRects(buyInfo, stopLossConfig, targetConfig, candlesticks) {
  if (!buyInfo?.price || !candlesticks?.length) return [];
  const buyPrice = buyInfo.price;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return [];
  const ivSec = candlesticks.length > 1
    ? Math.abs(Number(candlesticks[1].openTime) - Number(candlesticks[0].openTime)) / 1000
    : 900;
  let time1 = Math.floor(Number(candlesticks[candlesticks.length - 1].openTime) / 1000);
  if (buyInfo.time != null) {
    let best = candlesticks[0];
    let bestDiff = Infinity;
    for (const c of candlesticks) {
      const d = Math.abs(Number(c.openTime) - buyInfo.time);
      if (d < bestDiff) { bestDiff = d; best = c; }
    }
    time1 = Math.floor(Number(best.openTime) / 1000);
  }
  const time2 = time1 + ivSec * 5;

  const rects = [];
  if (targetConfig?.enabled) {
    const targetPrice = targetConfig.mode === 'price'
      ? targetConfig.price
      : buyPrice * (1 + targetConfig.targetPct / 100);
    if (Number.isFinite(targetPrice)) {
      rects.push({
        time1, time2, price1: buyPrice, price2: targetPrice,
        fillColor: 'rgba(34,197,94,0.14)', labelColor: '#22c55e', label: formatPctFromBase(buyPrice, targetPrice),
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
      });
    }
  }
  return rects;
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

/** Uma linha da VWAP (ou de uma banda) vira várias entradas em `desired` quando o destaque de
 *  queda está ligado — um segmento por trecho contíguo normal/em-queda (cor rosa), pra o
 *  usuário conferir visualmente onde o vwapSlopeFilter do bot vwap-bands bloquearia entrada. */
function buildVwapFieldEntries(points, flags, field, color, width, lineStyle, highlightEnabled, keyPrefix) {
  if (!highlightEnabled) {
    return { [keyPrefix]: { color, width, lineStyle, data: vwapFieldSeries(points, field) } };
  }
  const segments = splitPointsByFlag(
    points, flags, field,
    (p, raw) => ({ time: Math.floor(Number(p.openTime) / 1000), value: Number(raw) }),
  );
  const entries = {};
  segments.forEach((seg, i) => {
    entries[`${keyPrefix}-${i}`] = {
      color: seg.declining ? VWAP_DECLINE_COLOR : color,
      width, lineStyle,
      data: seg.points,
    };
  });
  return entries;
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
 *  são a própria linha deslocada em ±pct%, igual ao cálculo do ECharts (buildOverlaySeries). */
function buildOverlayLineEntries(overlayConfigs) {
  const entries = {};
  for (const cfg of overlayConfigs ?? []) {
    if (!cfg.points?.length) continue;
    const mainData = vwapFieldSeries(cfg.points, 'value');
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

/** Bandas de Bollinger — 3 linhas a partir de bbConfig.points [{openTime, upper, middle, lower}]. */
function buildBollingerEntries(bollingerConfig) {
  if (!bollingerConfig?.enabled || !bollingerConfig.points?.length) return {};
  return {
    bbUpper:  { color: BB_COLOR, width: 1,   lineStyle: 1, data: vwapFieldSeries(bollingerConfig.points, 'upper') },
    bbMiddle: { color: BB_COLOR, width: 1.5, lineStyle: 2, data: vwapFieldSeries(bollingerConfig.points, 'middle') },
    bbLower:  { color: BB_COLOR, width: 1,   lineStyle: 1, data: vwapFieldSeries(bollingerConfig.points, 'lower') },
  };
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

/** Marcadores de trade (Multi-Trade/backtest): sinal (triângulo pequeno) e venda (seta
 *  azul=lucro/amarela=prejuízo com % no texto). A entrada não tem mais seta própria — os
 *  quadrados de alvo/stop (buildPositionRects) e a linha de PnL (buildPnlLineData/
 *  buildPnlMarker) já marcam onde e a que preço a posição foi aberta. */
function buildTradeMarkers(multitradeMarkers) {
  const out = [];
  for (const m of multitradeMarkers ?? []) {
    if (m.time == null) continue;
    const time = Math.floor(Number(m.time) / 1000);
    if (!Number.isFinite(time)) continue;
    if (m.side === 'signal') {
      out.push({ time, position: 'aboveBar', shape: 'arrowDown', color: '#f59e0b', size: 0.5 });
    } else if (m.side === 'sell') {
      const exitPrice = Number(m.price);
      const entryPrice = Number(m.entryPrice);
      if (!Number.isFinite(exitPrice)) continue;
      const hasEntry = Number.isFinite(entryPrice) && entryPrice > 0;
      const isProfit = hasEntry && exitPrice >= entryPrice;
      const text = hasEntry ? `${isProfit ? '+' : ''}${(((exitPrice - entryPrice) / entryPrice) * 100).toFixed(1)}%` : 'venda';
      out.push({ time, position: 'atPriceTop', price: exitPrice, shape: 'arrowDown', color: hasEntry ? (isProfit ? '#3b82f6' : '#eab308') : '#94a3b8', size: 1, text });
    } else if (m.side === 'possible_entry') {
      const price = Number(m.price);
      if (!Number.isFinite(price)) continue;
      out.push({ time, position: 'atPriceMiddle', price, shape: 'circle', color: '#ffffff', size: 0.8, text: m.label ?? 'pronta' });
    }
  }
  return out;
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
  bollingerConfig, srConfig, pphlConfig, rsi, chopConfig,
  stopLossConfig, targetConfig, buyInfo, multitradeMarkers, zoomPeriod, focusLastN,
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
  const subpanelStateRef = useRef({ key: null, series: {} });

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
      // rightOffset: espaço vazio (em candles) depois do último candle — sem isso os candles e
      // as linhas terminavam colados na borda direita do gráfico.
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 3 },
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
        vertTouchDrag: false,
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
    indicatorSeriesRef.current = {};
    priceLinesRef.current = [];
    markersPluginRef.current = createSeriesMarkers(series, []);
    subpanelStateRef.current = { key: null, series: {} };
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      indicatorSeriesRef.current = {};
      priceLinesRef.current = [];
      markersPluginRef.current = null;
      rectPrimitiveRef.current = null;
      bandFillPrimitiveRef.current = null;
      pnlSeriesRef.current = null;
      subpanelStateRef.current = { key: null, series: {} };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors?.bg, colors?.text, colors?.panel]);

  useEffect(() => {
    if (!seriesRef.current || !candlesticks?.length) return;
    const data = candlesticks
      .map((c) => ({
        time: Math.floor(Number(c.openTime) / 1000),
        open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      }))
      .filter((d) => Number.isFinite(d.time) && Number.isFinite(d.open) && Number.isFinite(d.close))
      .sort((a, b) => a.time - b.time);
    // Whitespace (só {time}, sem OHLC) depois do último candle real — sem isso, timeToCoordinate
    // devolve null pra qualquer tempo além do último candle e os quadrados de alvo/stop
    // (5 candles à frente do candle de compra) somem quando a compra é recente. Mecanismo
    // nativo do Lightweight Charts pra estender o eixo de tempo além do último dado real.
    if (data.length > 1) {
      const ivSec = data[data.length - 1].time - data[data.length - 2].time;
      if (ivSec > 0) {
        const lastTime = data[data.length - 1].time;
        for (let i = 1; i <= 8; i++) data.push({ time: lastTime + ivSec * i });
      }
    }
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candlesticks]);

  // Botões "20/50/100 candles" da toolbar — o LW sempre carrega o array de candles inteiro (ao
  // contrário do ECharts, que fatiava via displayLimit), então sem isso os botões não tinham
  // efeito nenhum aqui: precisa restringir o intervalo VISÍVEL, não os dados carregados (mantém
  // o histórico completo pros indicadores, só ajusta o que aparece na tela).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusLastN || !candlesticks?.length) return;
    const idx = Math.max(0, candlesticks.length - focusLastN);
    const from = Math.floor(Number(candlesticks[idx].openTime) / 1000);
    const lastTime = Math.floor(Number(candlesticks[candlesticks.length - 1].openTime) / 1000);
    const ivSec = candlesticks.length > 1
      ? Math.abs(Number(candlesticks[1].openTime) - Number(candlesticks[0].openTime)) / 1000
      : 0;
    const to = lastTime + ivSec * 3; // mesmo respiro de 3 candles do rightOffset (setVisibleRange ignora rightOffset)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return;
    chart.timeScale().setVisibleRange({ from, to });
  }, [focusLastN, candlesticks]);

  // Zoom de período (clique numa ocorrência das abas Estatísticas/Multi-Trade) — roda depois
  // do efeito acima na mesma leva de commits, então sobrescreve o fitContent quando os dois
  // mudam juntos (troca de moeda + zoom).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !zoomPeriod?.startDate || !zoomPeriod?.endDate) return;
    const from = Math.floor(new Date(zoomPeriod.startDate).getTime() / 1000);
    const to = Math.floor(new Date(zoomPeriod.endDate).getTime() / 1000);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    chart.timeScale().setVisibleRange({ from, to });
  }, [zoomPeriod]);

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
    Object.assign(desired, buildOverlayLineEntries(overlayConfigs));
    Object.assign(desired, buildBollingerEntries(bollingerConfig));
    if (vwapConfig?.enabled && vwapConfig.points?.length) {
      const highlightEnabled = !!vwapSlopeHighlight?.enabled;
      const flags = highlightEnabled
        ? computeVwapSlopeFlags(vwapConfig.points, vwapSlopeHighlight.lookback, vwapSlopeHighlight.minSlopePct)
        : null;
      Object.assign(desired, buildVwapFieldEntries(
        vwapConfig.points, flags, 'value', VWAP_LINE_COLOR, 1.5, 0, highlightEnabled, 'vwap',
      ));
      if (vwapConfig.bands) {
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, flags, 'upper1', VWAP_BAND_COLOR, 1, 2, highlightEnabled, 'vwapUp1'));
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, flags, 'lower1', VWAP_BAND_COLOR, 1, 2, highlightEnabled, 'vwapLow1'));
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, flags, 'upper2', VWAP_BAND_COLOR, 1, 3, highlightEnabled, 'vwapUp2'));
        Object.assign(desired, buildVwapFieldEntries(vwapConfig.points, flags, 'lower2', VWAP_BAND_COLOR, 1, 3, highlightEnabled, 'vwapLow2'));
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
        // Chaves de segmento (vwap-0, vwap-1, ...) são reaproveitadas entre renders mesmo
        // quando o trecho que ocupam muda de normal→queda (ou vice-versa) — sem isso a cor
        // ficaria presa na do primeiro render daquele índice.
        current[key].applyOptions({ color: def.color, lineWidth: def.width, lineStyle: def.lineStyle ?? 0 });
      }
      current[key].setData(clampToVisible(def.data));
    }
  }, [activeIndicators, ma9, ma21, ma50, ma200, overlayConfigs, bollingerConfig, vwapConfig, vwapSlopeHighlight, candlesticks]);

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
    rectPrimitiveRef.current.setRects(buildPositionRects(buyInfo, stopLossConfig, targetConfig, candlesticks));
  }, [buyInfo, stopLossConfig, targetConfig, candlesticks]);

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

  // Marcadores: PPHL + sinal/venda de Multi-Trade + % da linha de PnL.
  useEffect(() => {
    if (!markersPluginRef.current) return;
    const markers = [...buildPphlMarkers(pphlConfig), ...buildTradeMarkers(multitradeMarkers)];
    const pnlMarker = buildPnlMarker(buyInfo, candlesticks);
    if (pnlMarker) markers.push(pnlMarker);
    markers.sort((a, b) => a.time - b.time);
    markersPluginRef.current.setMarkers(markers);
  }, [pphlConfig, multitradeMarkers, buyInfo, candlesticks]);

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

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-1 left-2 z-10 text-base font-mono font-bold text-p5/80 pointer-events-none">
        {symbol} · {interval}
      </div>
      <div ref={containerRef} className="absolute top-0 left-0 bottom-0" style={{ right: rightPad }} />
    </div>
  );
});

export default CandlestickChartLW;
