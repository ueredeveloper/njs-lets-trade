import { useMemo, useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import ReactECharts from 'echarts-for-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchCandlesticksAndCloud, fetchGateTrades, fetchBinanceTrades } from '../services/api';
import { buildMarkersFromExchangeTrades, attachPnlToExchangeTrades } from '../utils/multitradeChart';
import convertOpenTime from '../utils/convertOpenTime';
import Tooltip from './Tooltip';
import { hasAnyChartPanelButton } from '../utils/chartPanelButtons';
import { DEFAULT_OVERLAY_SLOTS } from '../utils/uiPreferences';
import { CHART_VIEW, computeZoomWindow, buildFixedDataZoom, computeCandleLimitFromTime, isTradePanelChartView } from '../utils/chartView';

const LIMIT = 76;
const MAX_CANDLES = 1000;
const CANDLE_FETCH_STEPS = [500, 750, 1000];
const OVERLAY_MA_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d'];
const OVERLAY_MA_COLORS = ['#fb923c', '#c084fc'];
const BAND_PCT_OPTIONS = [2, 3, 4, 5];
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
const DEFAULT_INTERVAL = '15m';

const CHART_LEFT_PAD = 68;
const CHART_LEFT_PAD_NONE = 16;
const PANEL_W = 54;
const PANEL_GAP = 2;
const PANEL_HALF = (PANEL_W - PANEL_GAP) / 2;
const PANEL_QTR  = (PANEL_W - PANEL_GAP * 3) / 4;
const C_UP   = '#26a69a';
const C_DOWN = '#ef5350';

const INDICATOR_GROUPS = [
  { id: 'ma9',      label: 'EMA9',   color: '#e879f9', tipKey: 'chart.tip.sma9' },
  { id: 'ma21',     label: 'EMA21',  color: '#fb923c', tipKey: 'chart.tip.sma21' },
  { id: 'ma50',     label: 'EMA50',  color: '#22d3ee', tipKey: 'chart.tip.sma50' },
  { id: 'ma200',    label: 'EMA200', color: '#f59e0b', tipKey: 'chart.tip.sma200' },
  { id: 'ichimoku', label: 'Ichi',  color: '#60a5fa', tipKey: 'chart.tip.ichimoku' },
  { id: 'rsi',      label: 'RSI',   color: '#a78bfa', tipKey: 'chart.tip.rsi' },
];

const RSI_EXTRA_INDICATORS = [
  { id: 'rsi80', label: 'R80', color: '#fb923c', tipKey: 'chart.tip.rsi80' },
  { id: 'rsi50', label: 'R50', color: '#facc15', tipKey: 'chart.tip.rsi50' },
];

const CHART_INDICATOR_IDS = [
  ...INDICATOR_GROUPS.map(g => g.id),
  ...RSI_EXTRA_INDICATORS.map(g => g.id),
];

function overlayPanelKey(slot) {
  return slot.id === 'slot1' ? 'ma1' : 'ma2';
}

function filterIndicatorsByPanel(activeIndicators, panelButtons) {
  return activeIndicators.filter((id) => {
    if (!CHART_INDICATOR_IDS.includes(id)) return true;
    return panelButtons[id] !== false;
  });
}

function PanelTip({ text, children, position = 'right' }) {
  return (
    <Tooltip text={text} position={position} maxW={280}>
      <span className="inline-flex w-full justify-center">{children}</span>
    </Tooltip>
  );
}

function alignPointsToCandles(candlesticks, points) {
  if (!points?.length || !candlesticks?.length) return [];
  return candlesticks.map(c => {
    const t = Number(c.openTime);
    let lo = 0, hi = points.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].openTime <= t) { best = points[mid].value; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  });
}

async function fetchOverlayMaPoints(symbol, interval, period, source, limit) {
  const srcParam = source === 'gate' ? '&source=gate' : '';
  const candles = await fetch(
    `/services/candles/?symbol=${symbol}&limit=${limit}&interval=${interval}${srcParam}`,
  ).then(r => r.json());
  if (!Array.isArray(candles) || !candles.length) return [];
  const sma = await fetch(`/services/sma?period=${period}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candles),
  }).then(r => r.json());
  if (!Array.isArray(sma)) return [];
  const offset = candles.length - sma.length;
  return sma.map((val, i) => ({
    openTime: Number(candles[offset + i].openTime),
    value: val,
  }));
}

function buildOverlaySeries(overlayConfigs, candlesticks, alignSeries) {
  return (overlayConfigs ?? []).flatMap(cfg => {
    if (!cfg.points?.length) return [];
    const full = alignPointsToCandles(candlesticks, cfg.points);
    const maData = alignSeries(full);
    const bands = cfg.bands ?? {};
    const series = [{
      name: cfg.label,
      type: 'line',
      data: maData,
      smooth: true,
      showSymbol: false,
      lineStyle: { color: cfg.color, width: 1.5, type: 'dashed' },
      endLabel: {
        show: true,
        formatter: cfg.label,
        color: cfg.color,
        fontSize: 9,
        padding: [1, 4],
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 2,
      },
    }];
    if (bands.showAbove) {
      series.push({
        name: `${cfg.label} +${bands.abovePct}%`,
        type: 'line',
        data: maData.map(v => (v == null ? null : v * (1 + bands.abovePct / 100))),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: cfg.color, width: 1, type: 'dotted', opacity: 0.65 },
      });
    }
    if (bands.showBelow) {
      series.push({
        name: `${cfg.label} -${bands.belowPct}%`,
        type: 'line',
        data: maData.map(v => (v == null ? null : v * (1 - bands.belowPct / 100))),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: cfg.color, width: 1, type: 'dotted', opacity: 0.45 },
      });
    }
    return series;
  });
}

const panelBtn = (active, color, darkText = false, size = 'full') => ({
  fontSize: 8,
  padding: '2px 0',
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'monospace',
  background: active ? color : 'transparent',
  color: active ? (darkText ? '#000' : '#fff') : color,
  border: `1px solid ${color}`,
  opacity: active ? 1 : 0.55,
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
  boxSizing: 'border-box',
  textAlign: 'center',
  width: size === 'full' ? PANEL_W : size === 'half' ? PANEL_HALF : PANEL_QTR,
});

function ChartLeftIndicatorPanel({
  activeIndicators,
  toggleIndicator,
  overlaySlots,
  updateOverlaySlot,
  maBands,
  setMaBands,
  overlayMaLoading,
  panelButtons,
}) {
  const { t } = useI18n();
  const show = (key) => panelButtons[key] !== false;
  const indicatorIds = INDICATOR_GROUPS.map(g => g.id).concat(RSI_EXTRA_INDICATORS.map(g => g.id));
  const showIndicatorBlock = indicatorIds.some(show);
  const visibleOverlays = overlaySlots
    .map((slot, idx) => ({ slot, idx, key: idx === 0 ? 'ma1' : 'ma2' }))
    .filter(({ key }) => show(key));
  const showBands = show('bands');

  if (!showIndicatorBlock && !visibleOverlays.length && !showBands) return null;

  const block = {
    background: 'rgba(0,0,0,0.5)',
    borderRadius: 5,
    padding: '3px 4px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    width: PANEL_W + 8,
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: PANEL_W + 12,
      zIndex: 10,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '4px 2px',
      pointerEvents: 'none',
    }}>
      <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, maxHeight: '100%', overflowY: 'auto' }}>
        {/* Indicadores do chart */}
        {showIndicatorBlock && (
        <div style={block}>
          {INDICATOR_GROUPS.filter(({ id }) => show(id)).map(({ id, label, color, tipKey }) => {
            const active = activeIndicators.includes(id);
            return (
              <PanelTip key={id} text={t(tipKey)}>
                <button type="button" onClick={() => toggleIndicator(id)} style={panelBtn(active, color, id === 'ma200')}>
                  {label}
                </button>
              </PanelTip>
            );
          })}
          {RSI_EXTRA_INDICATORS.filter(({ id }) => show(id)).map(({ id, label, color, tipKey }) => {
            const active = activeIndicators.includes(id);
            return (
              <PanelTip key={id} text={t(tipKey)}>
                <button type="button" onClick={() => toggleIndicator(id)} style={panelBtn(active, color, true)}>
                  {label}
                </button>
              </PanelTip>
            );
          })}
        </div>
        )}

        {/* MA overlay 1 e 2 */}
        {visibleOverlays.map(({ slot, idx }) => {
          const maNum = idx + 1;
          return (
          <div key={slot.id} style={block}>
            <PanelTip text={t('chart.tip.ma_overlay', maNum)}>
              <span style={{ fontSize: 8, color: OVERLAY_MA_COLORS[idx], fontFamily: 'monospace', textAlign: 'center', cursor: 'help' }}>
                MA{maNum}
              </span>
            </PanelTip>
            <div style={{ display: 'flex', gap: PANEL_GAP, justifyContent: 'center', width: PANEL_W }}>
              {['50', '200'].map(p => (
                <PanelTip key={p} text={t('chart.tip.ma_period', maNum, p)}>
                  <button type="button" onClick={() => updateOverlaySlot(slot.id, { period: p })} style={{
                    ...panelBtn(slot.period === p, OVERLAY_MA_COLORS[idx], true, 'half'),
                  }}>{p}</button>
                </PanelTip>
              ))}
            </div>
            <PanelTip text={t('chart.tip.ma_interval', maNum)}>
              <select
                value={slot.interval}
                onChange={e => updateOverlaySlot(slot.id, { interval: e.target.value })}
                style={{
                  width: PANEL_W, fontSize: 8, padding: '2px 0', borderRadius: 3, fontFamily: 'monospace',
                  boxSizing: 'border-box', textAlign: 'center',
                  background: '#111', color: OVERLAY_MA_COLORS[idx], border: `1px solid ${OVERLAY_MA_COLORS[idx]}66`,
                }}
              >
                {OVERLAY_MA_INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
            </PanelTip>
            <PanelTip text={t('chart.tip.ma_on', maNum)}>
              <button type="button" onClick={() => updateOverlaySlot(slot.id, { enabled: !slot.enabled })} style={{
                ...panelBtn(slot.enabled, OVERLAY_MA_COLORS[idx], true, 'full'),
              }}>
                {slot.enabled ? 'ON' : 'OFF'}
              </button>
            </PanelTip>
          </div>
          );
        })}

        {/* Bandas % */}
        {showBands && (
        <div style={block}>
          <PanelTip text={t('chart.tip.bands_title')}>
            <span style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace', textAlign: 'center', cursor: 'help' }}>Bandas</span>
          </PanelTip>
          <div style={{ display: 'flex', gap: PANEL_GAP, justifyContent: 'center', width: PANEL_W, flexWrap: 'wrap' }}>
            {BAND_PCT_OPTIONS.map(p => (
              <PanelTip key={p} text={t('chart.tip.bands_pct', p)}>
                <button type="button" onClick={() => setMaBands(b => ({ ...b, pct: p }))} style={{
                  ...panelBtn(maBands.pct === p, '#64748b', maBands.pct === p, 'qtr'),
                  color: maBands.pct === p ? '#fff' : '#94a3b8',
                  border: `1px solid ${maBands.pct === p ? '#94a3b8' : '#475569'}`,
                  background: maBands.pct === p ? '#64748b' : 'transparent',
                }}>{p}</button>
              </PanelTip>
            ))}
          </div>
          <PanelTip text={t('chart.tip.band_above', maBands.pct)}>
            <button type="button" onClick={() => setMaBands(b => ({ ...b, showAbove: !b.showAbove }))} style={{
              ...panelBtn(maBands.showAbove, '#22c55e', true, 'full'),
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              letterSpacing: 0,
            }}>
              <span aria-hidden>↑</span>
              <span>{maBands.pct}%</span>
            </button>
          </PanelTip>
          <PanelTip text={t('chart.tip.band_below', maBands.pct)}>
            <button type="button" onClick={() => setMaBands(b => ({ ...b, showBelow: !b.showBelow }))} style={{
              ...panelBtn(maBands.showBelow, '#f87171', true, 'full'),
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              letterSpacing: 0,
            }}>
              <span aria-hidden>↓</span>
              <span>{maBands.pct}%</span>
            </button>
          </PanelTip>
          {overlayMaLoading && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="animate-spin" style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid #94a3b8', borderTopColor: 'transparent' }} />
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue('--color-p1').trim() || '#1a0a25',
    panel: style.getPropertyValue('--color-p2').trim() || '#003f69',
    text: style.getPropertyValue('--color-p5').trim() || '#b3aca4',
    axis: style.getPropertyValue('--color-p4').trim() || '#157a8c',
  };
}


function fmtChartPrice(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p < 0.01 ? p.toFixed(6) : p < 1 ? p.toFixed(4) : p.toFixed(2);
}

/** Preço de compra aberto para o símbolo do gráfico (multitrade, exchange, FIFO). */
function resolveChartBuyPrice(symbol, {
  multitradeFavorites, fiveMTradeFavorites, activeTrades,
  allTrades, tradePurchases, chartTradeMarkers,
}) {
  const sym = symbol?.toUpperCase();
  if (!sym) return null;

  const mtBought = multitradeFavorites?.find(
    e => e.symbol?.toUpperCase() === sym && e.phase === 'BOUGHT' && e.buyPrice != null,
  );
  if (mtBought) {
    return {
      price: Number(mtBought.buyPrice),
      time: mtBought.buyTime ? new Date(mtBought.buyTime).getTime() : null,
    };
  }

  const fmBought = fiveMTradeFavorites?.find(
    e => e.symbol?.toUpperCase() === sym && e.phase === 'BOUGHT' && (e.buy_price != null || e.buyPrice != null),
  );
  if (fmBought) {
    const price = fmBought.buy_price ?? fmBought.buyPrice;
    const buyTime = fmBought.buy_time ?? fmBought.buyTime;
    return {
      price: Number(price),
      time: buyTime ? new Date(buyTime).getTime() : null,
    };
  }

  const at = activeTrades?.get?.(sym);
  if (at?.buyPrice != null) return { price: Number(at.buyPrice), time: null };

  const entryMarker = [...(chartTradeMarkers ?? [])].reverse().find(
    m => (m.side === 'entry' || m.side === 'buy') && m.price != null,
  );
  if (entryMarker) return { price: Number(entryMarker.price), time: entryMarker.time ?? null };

  if (allTrades?.length) {
    const inv = [];
    const sorted = [...allTrades].sort((a, b) => Number(a.time) - Number(b.time));
    for (const t of sorted) {
      const price = Number(t.price);
      const qty = Number(t.qty);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
      if (t.isBuyer) {
        if (qty > 0) inv.push({ qty, price, time: Number(t.time) });
      } else {
        let remain = qty;
        while (remain > 1e-12 && inv.length) {
          const take = Math.min(inv[0].qty, remain);
          inv[0].qty -= take;
          remain -= take;
          if (inv[0].qty <= 1e-12) inv.shift();
        }
      }
    }
    if (inv.length) {
      const totalQty = inv.reduce((s, l) => s + l.qty, 0);
      const avgPrice = inv.reduce((s, l) => s + l.qty * l.price, 0) / totalQty;
      const firstLot = inv[0];
      return { price: avgPrice, time: firstLot?.time ?? null };
    }
  }

  if (tradePurchases?.length) {
    const last = [...tradePurchases].sort((a, b) => Number(a.time) - Number(b.time)).pop();
    if (last?.price != null) return { price: Number(last.price), time: Number(last.time) };
  }

  return null;
}

/** Série line do preço de compra até o fechamento atual (evita markLine coord no eixo categoria). */
function buildBuyPnlSeries(buyInfo, candlesticks, DL, LEFT_PAD, RIGHT_PAD, lastClose) {
  if (!buyInfo?.price || lastClose == null || !candlesticks?.length) return null;
  const buyPrice = buyInfo.price;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(lastClose)) return null;

  const pct = ((lastClose - buyPrice) / buyPrice) * 100;
  const isUp = pct >= 0;
  const color = isUp ? C_UP : C_DOWN;
  const pctLabel = `${isUp ? '+' : ''}${pct.toFixed(2)}%`;

  const offset = candlesticks.length - DL;
  let buyIdx = 0;
  if (buyInfo.time != null) {
    const absIdx = candlesticks.reduce((best, c, i) =>
      Math.abs(Number(c.openTime) - buyInfo.time) < Math.abs(Number(candlesticks[best].openTime) - buyInfo.time)
        ? i : best,
    0);
    buyIdx = Math.max(0, Math.min(DL - 1, absIdx - offset));
  }

  const x1 = buyIdx + LEFT_PAD;
  const x2 = (DL - 1) + LEFT_PAD;
  const totalLen = LEFT_PAD + DL + RIGHT_PAD;
  if (x1 < 0 || x2 < 0 || x1 >= totalLen || x2 >= totalLen) return null;

  const data = new Array(totalLen).fill(null);
  data[x1] = buyPrice;
  data[x2] = lastClose;

  return {
    name: 'PnL',
    type: 'line',
    data,
    connectNulls: true,
    showSymbol: true,
    symbol: 'circle',
    symbolSize: 4,
    lineStyle: { color, width: 1.5, type: 'dotted' },
    itemStyle: { color },
    endLabel: {
      show: true,
      formatter: pctLabel,
      color: '#fff',
      backgroundColor: color,
      padding: [2, 4],
      borderRadius: 2,
      fontSize: 8,
      fontWeight: 'bold',
    },
    z: 10,
    silent: true,
    animation: false,
  };
}

function buildMultitradeMarkLines(candlesticks, interval, markers, DL, LEFT_PAD) {
  if (!markers?.length || !candlesticks?.length) return [];
  const ms = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': 86_400_000 }[interval] ?? 900_000;
  const offset = candlesticks.length - DL;
  const styles = {
    signal:         { color: '#f59e0b', label: '◆ Sinal' },
    buy:            { color: '#22c55e', label: '▲ Buy' },
    sell:           { color: '#ef4444', label: '▼ Sell' },
    entry:          { color: '#ffffff', label: '▌ Entrada' },
    possible_entry: { color: '#ffffff', label: '◌ Entrada pronta' },
  };
  return markers.flatMap(m => {
    let best = 0;
    let bestDiff = Infinity;
    candlesticks.forEach((c, i) => {
      const d = Math.abs(Number(c.openTime) - m.time);
      if (d < bestDiff) { bestDiff = d; best = i; }
    });
    if (bestDiff > ms * 1.5) return [];
    const localIdx = best - offset;
    if (localIdx < 0 || localIdx >= DL) return [];
    const st = styles[m.side] ?? { color: '#94a3b8', label: m.side };
    const dashed = m.side === 'signal' || m.side === 'possible_entry';
    const label = m.label ?? (m.pnlPct != null
      ? `▼ ${Number(m.pnlPct) >= 0 ? '+' : ''}${Number(m.pnlPct).toFixed(1)}%`
      : st.label);
    return [{
      xAxis: localIdx + LEFT_PAD,
      lineStyle: { color: st.color, width: m.side === 'entry' || m.side === 'possible_entry' ? 2 : 1.5, type: dashed ? 'dashed' : 'solid' },
      label: {
        show: true,
        formatter: label,
        color: m.side === 'sell' && m.pnlPct != null
          ? (Number(m.pnlPct) >= 0 ? '#22c55e' : '#ef4444')
          : st.color,
        fontSize: 9,
        position: m.side === 'sell' ? 'insideEndBottom' : 'insideStartTop',
        padding: [2, 4],
      },
    }];
  });
}

function buildOption({ symbol, interval, candlesticks, ichimokuCloud, movingAverage, ma50, ma9, ma21, rsi }, colors, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = [], overlayConfigs = [], multitradeMarkers = [], chartLeftPad = CHART_LEFT_PAD, buyInfo = null) {
  const showMa9      = activeIndicators.includes('ma9');
  const showMa21     = activeIndicators.includes('ma21');
  const showMa50     = activeIndicators.includes('ma50');
  const showMa200    = activeIndicators.includes('ma200');
  const showIchimoku = activeIndicators.includes('ichimoku');
  const showRsi      = activeIndicators.includes('rsi');
  const showRsi50    = activeIndicators.includes('rsi50');
  const showRsi80    = activeIndicators.includes('rsi80');
  const DL = Math.min(displayLimit, candlesticks.length);
  const LEFT_PAD  = 1;
  const RIGHT_PAD = showIchimoku ? 24 : 3;

  const xData = (() => {
    const slicedDates = candlesticks.slice(-DL).map((c) => convertOpenTime(c.openTime, interval));
    return [...new Array(LEFT_PAD).fill(''), ...slicedDates, ...new Array(RIGHT_PAD).fill('')];
  })();

  // Separadores de dia — só faz sentido em intervalos intraday (< 1d)
  const INTRADAY = !['1d', '3d', '1w'].includes(interval);

  const dayBreakData = (() => {
    if (!INTRADAY) return [];
    const visible = candlesticks.slice(-DL);
    const result  = [];
    let prevDay   = null;
    visible.forEach((c, i) => {
      const day = new Date(Number(c.openTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (prevDay !== null && day !== prevDay) {
        result.push({
          xAxis: i + LEFT_PAD,
          lineStyle: { color: 'rgba(255,255,255,0.07)', width: 1, type: 'solid' },
          label: {
            show: true,
            formatter: day.slice(0, 5),     // "07/06"
            color: 'rgba(255,255,255,0.22)',
            fontSize: 9,
            position: 'insideEndTop',
            padding: [2, 3],
          },
        });
      }
      prevDay = day;
    });
    return result;
  })();

  const periodMarkData = (() => {
    if (!zoomPeriod) return [];
    const startMs  = new Date(zoomPeriod.startDate).getTime();
    const endMs    = new Date(zoomPeriod.endDate).getTime();
    const startIdx = candlesticks.findIndex(c => Number(c.openTime) >= startMs);
    const endIdx   = candlesticks.reduce((best, c, i) =>
      Number(c.openTime) <= endMs ? i : best, -1);
    const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).replace(',', '');
    const line = (idx, label) => ({
      xAxis: idx + LEFT_PAD,
      lineStyle: { color: 'rgba(255,255,255,0.45)', width: 1, type: 'dashed' },
      label: { show: true, formatter: label, color: 'rgba(255,255,255,0.75)',
               fontSize: 12, fontWeight: 'bold', position: 'insideEndTop', padding: [2, 4] },
    });
    const data = [];
    if (startIdx !== -1) data.push(line(startIdx, fmt(zoomPeriod.startDate)));
    if (endIdx   !== -1) data.push(line(endIdx,   fmt(zoomPeriod.endDate)));
    return data;
  })();

  const fmtTradeDate = (ms) => {
    const d = new Date(ms);
    const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  };

  const tradeMarkData = (() => {
    if (!tradeTimes.length || multitradeMarkers?.length) return [];
    const offset = candlesticks.length - DL;
    return tradeTimes.flatMap(tradeMs => {
      const idx = candlesticks.reduce((best, c, i) =>
        Math.abs(Number(c.openTime) - tradeMs) < Math.abs(Number(candlesticks[best].openTime) - tradeMs)
          ? i : best
      , 0);
      const localIdx = idx - offset;
      if (localIdx < 0) return [];
      return [{
        xAxis: localIdx + LEFT_PAD,
        lineStyle: { color: '#ffffff', width: 2, type: 'solid' },
        label: {
          show: true,
          formatter: `▌ ${fmtTradeDate(tradeMs)}`,
          color: '#ffffff',
          fontSize: 9,
          position: 'insideStartTop',
          padding: [3, 5],
        },
      }];
    });
  })();

  // Todas as markLines unificadas: separadores de dia + zoom + compras + sinais MT
  const mtMarkData = buildMultitradeMarkLines(candlesticks, interval, multitradeMarkers, DL, LEFT_PAD);
  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData, ...mtMarkData];

  const lastClose = candlesticks.length ? parseFloat(candlesticks[candlesticks.length - 1].close) : null;
  const buyPnlSeries = buildBuyPnlSeries(buyInfo, candlesticks, DL, LEFT_PAD, RIGHT_PAD, lastClose);
  const finalMarkLine = {
    silent: true, symbol: 'none',
    data: [
      ...allMarkLineData,
      ...(lastClose != null ? [{
        yAxis: lastClose,
        lineStyle: { color: 'rgba(0,0,0,0)' },
        label: {
          show: true, position: 'end',
          formatter: fmtChartPrice(lastClose),
          color: '#111', fontSize: 10, fontWeight: 'bold',
          backgroundColor: '#facc15', padding: [2, 5], borderRadius: 2,
        }
      }] : [])
    ]
  };

  const axisBase = (gridIndex) => ({
    gridIndex,
    type: 'category',
    data: xData,
    axisLine: { lineStyle: { color: colors.panel } },
    axisLabel: { color: colors.text, fontSize: 10, show: gridIndex === (showRsi ? 1 : 0) },
    splitLine: { show: false },
  });

  // Alinha séries com o eixo X:
  // — left-pad com null quando a série tem menos valores que DL (moedas novas com poucos candles)
  // — right-pad com null quando Ichimoku está ativo (24 posições futuras no xData)
  const futurePad = RIGHT_PAD;
  const alignSeries = (arr) => {
    const raw = arr?.slice(-DL) ?? [];
    return [
      ...new Array(LEFT_PAD + Math.max(0, DL - raw.length)).fill(null),
      ...raw,
      ...new Array(futurePad).fill(null),
    ];
  };

  const overlayLineSeries = buildOverlaySeries(overlayConfigs, candlesticks, alignSeries);

  const _fmtV = v => v == null ? '—' : (v < 0.01 ? Number(v).toFixed(6) : v < 1 ? Number(v).toFixed(4) : Number(v).toFixed(2));

  const tooltipFormatter = (params) => {
    const time = params[0]?.axisValue ?? '';
    let html = `<div style="font-family:monospace;font-size:11px;min-width:150px;line-height:1.6">`;
    html += `<div style="margin-bottom:5px;opacity:0.5;font-size:10px">${time}</div>`;
    for (const p of params) {
      if (p.value == null) continue;
      if (p.seriesType === 'candlestick') {
        const [o, c, l, h] = p.value;
        const up = parseFloat(c) >= parseFloat(o);
        const col = up ? '#26a69a' : '#ef5350';
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin-bottom:4px">`;
        html += `<span style="color:#888">O</span><span style="color:${col};font-weight:bold">${_fmtV(o)}</span>`;
        html += `<span style="color:#888">H</span><span style="color:${col}">${_fmtV(h)}</span>`;
        html += `<span style="color:#888">L</span><span style="color:${col}">${_fmtV(l)}</span>`;
        html += `<span style="color:#888">C</span><span style="color:${col};font-weight:bold">${_fmtV(c)}</span>`;
        html += `</div><hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:3px 0"/>`;
      } else {
        if (p.seriesName === 'CL' || p.seriesName === 'BL' || p.seriesName === 'Span A' || p.seriesName === 'Span B' || p.seriesName === 'PnL') continue;
        let col = p.color ?? '#fff';
        if (p.seriesName === 'RSI') {
          const rv = parseFloat(p.value);
          col = rv >= 70 ? '#26a69a' : rv <= 30 ? '#ef5350' : '#a78bfa';
        }
        html += `<div style="display:flex;justify-content:space-between;gap:14px">`;
        html += `<span style="color:${col};opacity:0.85">${p.seriesName}</span>`;
        html += `<span style="color:#fff;font-weight:bold">${_fmtV(p.value)}</span>`;
        html += `</div>`;
      }
    }
    html += `</div>`;
    return html;
  };

  const ma9Data   = alignSeries(ma9);
  const ma21Data  = alignSeries(ma21);
  const ma50Data  = alignSeries(ma50);
  const ma200Data = alignSeries(movingAverage);
  const zoomWindow = zoomPeriod ? computeZoomWindow(candlesticks, zoomPeriod) : null;

  const candleSeries = (idx) => [
    {
      name: 'Candles',
      type: 'candlestick',
      xAxisIndex: idx, yAxisIndex: idx,
      data: [...new Array(LEFT_PAD).fill('-'), ...candlesticks.slice(-DL).map((c) => [c.open, c.close, c.low, c.high])],
      itemStyle: { color: C_UP, color0: C_DOWN, borderColor: C_UP, borderColor0: C_DOWN },
      markLine: finalMarkLine,
    },
    ...(showMa9 && ma9?.length ? [{
      name: 'EMA9',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma9Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#e879f9', width: 1.5 },
    }] : []),
    ...(showMa21 && ma21?.length ? [{
      name: 'EMA21',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma21Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#fb923c', width: 1.5 },
    }] : []),
    ...(showMa50 && ma50?.length ? [{
      name: 'EMA50',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma50Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#22d3ee', width: 1.5 },
    }] : []),
    ...(showMa200 ? [{
      name: 'EMA200',
      type: 'line',
      xAxisIndex: idx, yAxisIndex: idx,
      data: ma200Data,
      smooth: true, showSymbol: false,
      lineStyle: { color: '#f59e0b', width: 1.5 },
    }] : []),
    ...(showIchimoku ? [
      { name: 'CL', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-DL).map((c) => c.conversion)],
        smooth: true, showSymbol: false, lineStyle: { color: '#60a5fa', width: 1 } },
      { name: 'BL', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-DL).map((c) => c.base)],
        smooth: true, showSymbol: false, lineStyle: { color: '#94a3b8', width: 1 } },
      { name: 'Span A', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-(DL + RIGHT_PAD)).map((c) => c.spanA)],
        showSymbol: false, lineStyle: { color: C_UP, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(38,166,154,0.05)' } },
      { name: 'Span B', type: 'line', xAxisIndex: idx, yAxisIndex: idx,
        data: [...new Array(LEFT_PAD).fill(null), ...ichimokuCloud.slice(-(DL + RIGHT_PAD)).map((c) => c.spanB)],
        smooth: true, showSymbol: false, lineStyle: { color: C_DOWN, width: 1, opacity: 0.7 },
        areaStyle: { color: 'rgba(239,83,80,0.05)' } },
    ] : []),
    ...overlayLineSeries.map(s => ({ ...s, xAxisIndex: idx, yAxisIndex: idx })),
    ...(buyPnlSeries ? [{ ...buyPnlSeries, xAxisIndex: idx, yAxisIndex: idx }] : []),
  ];

  if (!showRsi) {
    return {
      backgroundColor: colors.bg,
      title: {
        text: symbol, subtext: interval, left: chartLeftPad, top: 8,
        textStyle: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
        subtextStyle: { color: colors.axis, fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis', backgroundColor: '#003f69ee', borderColor: colors.axis,
        textStyle: { color: colors.text, fontSize: 11 },
        formatter: tooltipFormatter,
        axisPointer: { animation: false, type: 'cross', lineStyle: { color: colors.axis, width: 1, opacity: 0.8 } },
      },
      xAxis: { type: 'category', data: xData,
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { show: false } },
      yAxis: { scale: true, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      grid: { top: 40, bottom: 12, left: chartLeftPad, right: 64 },
      dataZoom: zoomWindow
        ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct)
        : [{ type: 'inside' }],
      series: candleSeries(0),
    };
  }

  const rsiData = alignSeries(rsi);

  return {
    backgroundColor: colors.bg,
    title: {
      text: symbol, subtext: interval, left: chartLeftPad, top: 8,
      textStyle: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
      subtextStyle: { color: colors.axis, fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis', backgroundColor: '#003f69ee', borderColor: colors.axis,
      textStyle: { color: colors.text, fontSize: 11 },
      formatter: tooltipFormatter,
      axisPointer: { animation: false, type: 'cross', lineStyle: { color: colors.axis, width: 1, opacity: 0.8 } },
    },
    grid: [
      { top: 40, bottom: '24%', left: chartLeftPad, right: 64 },
      { top: '79%', bottom: 20, left: chartLeftPad, right: 64 },
    ],
    xAxis: [
      { ...axisBase(0), axisLabel: { show: false } },
      { ...axisBase(1) },
    ],
    yAxis: [
      { gridIndex: 0, scale: true, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.3 } } },
      { gridIndex: 1, min: 0, max: 100, position: 'right',
        axisLine: { lineStyle: { color: colors.panel } },
        axisLabel: { color: colors.text, fontSize: 9 },
        splitLine: { lineStyle: { color: colors.panel, type: 'dashed', opacity: 0.2 } },
        interval: 30 },
    ],
    dataZoom: zoomWindow
      ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct, [0, 1])
      : [{ type: 'inside', xAxisIndex: [0, 1] }],
    series: [
      ...candleSeries(0),
      {
        name: 'RSI',
        type: 'line',
        xAxisIndex: 1, yAxisIndex: 1,
        data: rsiData,
        showSymbol: false,
        lineStyle: { color: '#a78bfa', width: 1.5 },
        markLine: {
          silent: true, symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef5350', type: 'dashed', width: 1 },
              label: { formatter: '30', color: '#ef5350', fontSize: 9, position: 'start' } },
            ...(showRsi50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.6 },
              label: { formatter: '50', color: '#facc15', fontSize: 9, position: 'start' } }] : []),
            { yAxis: 70, lineStyle: { color: '#26a69a', type: 'dashed', width: 1 },
              label: { formatter: '70', color: '#26a69a', fontSize: 9, position: 'start' } },
            ...(showRsi80 ? [{ yAxis: 80, lineStyle: { color: '#fb923c', type: 'dashed', width: 1 },
              label: { formatter: '80', color: '#fb923c', fontSize: 9, position: 'start' } }] : []),
          ],
        },
      },
    ],
  };
}

// ── Gráfico Matrix: área de preço + RSI, tema terminal verde ─────────────────

function buildMatrixOption({ symbol, interval, candlesticks, rsi }, activeIndicators, displayLimit = LIMIT, zoomPeriod = null, tradeTimes = [], chartLeftPad = CHART_LEFT_PAD, buyInfo = null) {
  const showRsi   = activeIndicators.includes('rsi');
  const showRsi50 = activeIndicators.includes('rsi50');
  const showRsi80 = activeIndicators.includes('rsi80');
  const DL      = Math.min(displayLimit, candlesticks.length);
  const LEFT_PAD  = 1;
  const RIGHT_PAD = 3;
  const INTRADAY = !['1d', '3d', '1w'].includes(interval);

  const G        = '#22c55e';                       // verde Matrix
  const G_DIM    = 'rgba(34,197,94,0.08)';
  const G_LABEL  = 'rgba(34,197,94,0.38)';
  const BG       = '#050d0a';

  const xData = (() => {
    const slicedDates = candlesticks.slice(-DL).map(c => convertOpenTime(c.openTime, interval));
    return [...new Array(LEFT_PAD).fill(''), ...slicedDates, ...new Array(RIGHT_PAD).fill('')];
  })();

  // separadores de dia (em tom verde)
  const dayBreakData = (() => {
    if (!INTRADAY) return [];
    const visible = candlesticks.slice(-DL);
    const result  = [];
    let prevDay   = null;
    visible.forEach((c, i) => {
      const day = new Date(Number(c.openTime)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      if (prevDay !== null && day !== prevDay) {
        result.push({
          xAxis: i + LEFT_PAD,
          lineStyle: { color: 'rgba(34,197,94,0.10)', width: 1, type: 'solid' },
          label: { show: true, formatter: day.slice(0, 5), color: 'rgba(34,197,94,0.28)', fontSize: 9, position: 'insideEndTop', padding: [2, 3] },
        });
      }
      prevDay = day;
    });
    return result;
  })();

  // linhas de zoom de período
  const periodMarkData = (() => {
    if (!zoomPeriod) return [];
    const startMs  = new Date(zoomPeriod.startDate).getTime();
    const endMs    = new Date(zoomPeriod.endDate).getTime();
    const startIdx = candlesticks.findIndex(c => Number(c.openTime) >= startMs);
    const endIdx   = candlesticks.reduce((best, c, i) => Number(c.openTime) <= endMs ? i : best, -1);
    const fmt = iso => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    const mk  = (idx, label) => ({ xAxis: idx + LEFT_PAD, lineStyle: { color: 'rgba(255,255,255,0.35)', width: 1, type: 'dashed' }, label: { show: true, formatter: label, color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 'bold', position: 'insideEndTop', padding: [2, 4] } });
    const data = [];
    if (startIdx !== -1) data.push(mk(startIdx, fmt(zoomPeriod.startDate)));
    if (endIdx   !== -1) data.push(mk(endIdx,   fmt(zoomPeriod.endDate)));
    return data;
  })();

  // linhas de compra
  const fmtTradeDate = ms => {
    const d    = new Date(ms);
    const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  };
  const tradeMarkData = (() => {
    if (!tradeTimes.length) return [];
    const offset = candlesticks.length - DL;
    return tradeTimes.flatMap(tradeMs => {
      const idx      = candlesticks.reduce((best, c, i) => Math.abs(Number(c.openTime) - tradeMs) < Math.abs(Number(candlesticks[best].openTime) - tradeMs) ? i : best, 0);
      const localIdx = idx - offset;
      if (localIdx < 0) return [];
      return [{ xAxis: localIdx + LEFT_PAD, lineStyle: { color: '#3b82f6', width: 1.5, type: 'solid' }, label: { show: true, formatter: `compra ${fmtTradeDate(tradeMs)}`, color: '#3b82f6', fontSize: 9, position: 'insideStartTop', padding: [3, 5] } }];
    });
  })();

  const allMarkLineData = [...dayBreakData, ...periodMarkData, ...tradeMarkData];
  const zoomWindow = zoomPeriod ? computeZoomWindow(candlesticks, zoomPeriod) : null;

  const closes    = candlesticks.slice(-DL).map(c => c.close);
  const lastClose = candlesticks.length ? parseFloat(candlesticks[candlesticks.length - 1].close) : null;
  const buyPnlSeries = buildBuyPnlSeries(buyInfo, candlesticks, DL, LEFT_PAD, RIGHT_PAD, lastClose);
  const finalMarkLine = {
    silent: true, symbol: 'none',
    data: [
      ...allMarkLineData,
      ...(lastClose != null ? [{
        yAxis: lastClose,
        lineStyle: { color: 'rgba(0,0,0,0)' },
        label: {
          show: true, position: 'end',
          formatter: fmtChartPrice(lastClose),
          color: BG, fontSize: 10, fontWeight: 'bold',
          backgroundColor: G, padding: [2, 5], borderRadius: 2, fontFamily: 'monospace',
        }
      }] : [])
    ]
  };
  const rsiData = (() => {
    const raw = rsi?.slice(-DL) ?? [];
    return [...new Array(LEFT_PAD + Math.max(0, DL - raw.length)).fill(null), ...raw, ...new Array(RIGHT_PAD).fill(null)];
  })();

  const axisBase = (gridIndex, showLabel) => ({
    gridIndex,
    type: 'category',
    data: xData,
    boundaryGap: false,
    axisLine:  { lineStyle: { color: G_DIM } },
    axisLabel: { show: showLabel, color: G_LABEL, fontSize: 9 },
    splitLine: { show: false },
    axisTick:  { show: false },
  });

  const yAxisBase = (gridIndex, extra = {}) => ({
    gridIndex,
    scale: true,
    position: 'right',
    axisLine:  { lineStyle: { color: G_DIM } },
    axisLabel: { color: G_LABEL, fontSize: 9 },
    splitLine: { lineStyle: { color: G_DIM, type: 'dashed' } },
    ...extra,
  });

  return {
    backgroundColor: BG,
    title: {
      text: symbol, subtext: interval, left: chartLeftPad, top: 8,
      textStyle:    { color: G,         fontSize: 15, fontWeight: 'bold', fontFamily: 'monospace' },
      subtextStyle: { color: G_LABEL,   fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0d1f14ee',
      borderColor: G_DIM,
      textStyle: { color: G, fontSize: 11 },
      axisPointer: { animation: false, type: 'cross', lineStyle: { color: 'rgba(34,197,94,0.3)', width: 1 } },
    },
    grid: showRsi
      ? [{ top: 40, bottom: '26%', left: chartLeftPad, right: 64 }, { top: '78%', bottom: 20, left: chartLeftPad, right: 64 }]
      : [{ top: 40, bottom: 20,    left: chartLeftPad, right: 64 }],
    xAxis: showRsi
      ? [{ ...axisBase(0, false) }, { ...axisBase(1, true) }]
      : { ...axisBase(0, true) },
    yAxis: showRsi
      ? [yAxisBase(0), yAxisBase(1, { scale: false, min: 0, max: 100, interval: 30 })]
      : yAxisBase(0),
    dataZoom: zoomWindow
      ? buildFixedDataZoom(zoomWindow.startPct, zoomWindow.endPct, showRsi ? [0, 1] : [0])
      : [{ type: 'inside', xAxisIndex: showRsi ? [0, 1] : [0] }],
    series: [
      {
        name: 'Preço',
        type: 'line',
        xAxisIndex: 0, yAxisIndex: 0,
        data: [...new Array(LEFT_PAD).fill(null), ...closes],
        showSymbol: false,
        lineStyle: { color: G, width: 1.5 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(34,197,94,0.28)' }, { offset: 1, color: 'rgba(34,197,94,0.02)' }] },
        },
        markLine: finalMarkLine,
      },
      ...(buyPnlSeries ? [{ ...buyPnlSeries, xAxisIndex: 0, yAxisIndex: 0 }] : []),
      ...(showRsi && rsiData.length ? [{
        name: 'RSI',
        type: 'line',
        xAxisIndex: 1, yAxisIndex: 1,
        data: rsiData,
        showSymbol: false,
        lineStyle: { color: '#4ade80', width: 1.2 },
        markLine: {
          silent: true, symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef5350', type: 'dashed', width: 1 }, label: { formatter: '30', color: '#ef5350', fontSize: 9, position: 'start' } },
            ...(showRsi50 ? [{ yAxis: 50, lineStyle: { color: '#facc15', type: 'dashed', width: 1, opacity: 0.6 }, label: { formatter: '50', color: '#facc15', fontSize: 9, position: 'start' } }] : []),
            { yAxis: 70, lineStyle: { color: G,         type: 'dashed', width: 1 }, label: { formatter: '70', color: G,         fontSize: 9, position: 'start' } },
            ...(showRsi80 ? [{ yAxis: 80, lineStyle: { color: '#fb923c', type: 'dashed', width: 1 }, label: { formatter: '80', color: '#fb923c', fontSize: 9, position: 'start' } }] : []),
          ],
        },
      }] : []),
    ],
  };
}

// ── Painel de histórico de trades (aba Matrix) ───────────────────────────────

function fmtDate(ms) {
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return p;
  return n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(2);
}

function TradeHistoryPanel({ symbol, gateFavorites }) {
  const {
    allTrades, setAllTrades, setTradePurchases,
    setChartTradeMarkers, chartViewSource, selectedChart,
  } = useCurrency();
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  
  useEffect(() => {
    if (!symbol) return;
    doRefresh();
    const id = setInterval(doRefresh, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  async function doRefresh() {
    if (!symbol || refreshing) return;
    setRefreshing(true);
    try {
      const useGate = gateFavorites.has(symbol) || selectedChart?.source === 'gate';
      const trades  = await (useGate ? fetchGateTrades(symbol) : fetchBinanceTrades(symbol));
      setAllTrades(trades);
      setTradePurchases(trades.filter(t => t.isBuyer));
      if (chartViewSource === CHART_VIEW.TRADES) {
        setChartTradeMarkers(buildMarkersFromExchangeTrades(trades));
      }
      setLastUpdate(new Date());
    } catch (e) {
      console.warn('[TradeHistoryPanel] refresh:', e.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Apenas trades executados (buys + sells), do mais recente ao mais antigo
  const withPnl = attachPnlToExchangeTrades(allTrades);
  const sorted = [...withPnl].sort((a, b) => Number(b.time) - Number(a.time));

  const base = symbol
    ? (symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol)
    : '';

  const buys  = allTrades.filter(t =>  t.isBuyer);
  const sells = allTrades.filter(t => !t.isBuyer);
  const totalBuy  = buys.reduce((s, t)  => s + parseFloat(t.price) * parseFloat(t.qty), 0);
  const totalSell = sells.reduce((s, t) => s + parseFloat(t.price) * parseFloat(t.qty), 0);
  const totalPnl  = withPnl.reduce((s, t) => s + (t.pnlUsdt ?? 0), 0);

  return (
    <div className="flex flex-col h-full bg-[#050d0a] border-l border-[#0a2a1a] font-mono select-none">

      {/* Header — compacto em mobile, completo em sm+ */}
      <div className="flex items-center justify-between px-1.5 sm:px-3 py-1.5 sm:py-2 border-b border-[#0a2a1a] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="hidden sm:inline text-green-400 tracking-widest text-[10px] font-bold uppercase">
            Executados
          </span>
          {base && (
            <span className="hidden sm:inline text-green-700 text-[10px]">/ {base}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {lastUpdate && (
            <span className="hidden sm:inline text-green-900 text-[9px]">
              {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={doRefresh}
            disabled={refreshing}
            title="Atualizar"
            className="text-green-700 hover:text-green-400 transition-colors disabled:opacity-30 text-base leading-none"
          >
            {refreshing ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {!symbol && (
          <p className="text-green-900 text-center mt-8 text-[10px]">—</p>
        )}
        {symbol && sorted.length === 0 && !refreshing && (
          <p className="text-green-900 text-center mt-8 text-[10px]">vazio</p>
        )}

        {sorted.map((tr, i) => {
          const isBuy    = tr.isBuyer;
          const price    = parseFloat(tr.price);
          const qty      = parseFloat(tr.qty);
          const usdt     = (price * qty).toFixed(2);
          const color    = isBuy ? '#22c55e' : '#ef4444';
          const dimColor = isBuy ? '#14532d' : '#450a0a';
          const timeOnly = fmtDate(Number(tr.time)).slice(-5); // "14:32"
          const pnlPct   = tr.pnlPct;
          const pnlColor = pnlPct == null ? color : (pnlPct >= 0 ? '#22c55e' : '#ef4444');

          return (
            <div key={i} className="px-1.5 sm:px-3 py-1 sm:py-2 border-b" style={{ borderColor: '#0a1f14' }}>

              {/* Linha topo: badge + data */}
              <div className="flex items-center justify-between gap-1">
                <span
                  className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0"
                  style={{ color, background: dimColor }}
                >
                  {isBuy ? '▲' : '▼'}
                  <span className="hidden sm:inline"> {isBuy ? 'COMPRA' : 'VENDA'}</span>
                </span>
                {/* Mobile: só hora | sm+: data completa */}
                <span className="text-[9px] sm:text-[10px] truncate" style={{ color: '#1a5c32' }}>
                  <span className="sm:hidden">{timeOnly}</span>
                  <span className="hidden sm:inline">{fmtDate(Number(tr.time))}</span>
                </span>
              </div>

              {/* Preço (sempre visível) */}
              <div className="mt-0.5 text-[10px] sm:text-[12px] font-semibold" style={{ color }}>
                {fmtPrice(tr.price)}
              </div>

              {/* Qty e USDT — só em sm+ */}
              <div className="hidden sm:flex items-baseline gap-1.5 mt-0.5" style={{ color }}>
                <span className="text-[10px] opacity-50">×</span>
                <span className="text-[10px] opacity-80">{qty.toFixed(4)}</span>
              </div>
              <div className="hidden sm:block text-[10px] mt-0.5" style={{ color: '#1a6b38' }}>
                ≈ ${usdt} USDT
              </div>

              {!isBuy && pnlPct != null && (
                <div className="mt-0.5 text-[10px] font-bold" style={{ color: pnlColor }}>
                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                  {tr.pnlUsdt != null && (
                    <span className="opacity-70 font-normal">
                      {' '}({tr.pnlUsdt >= 0 ? '+' : ''}{tr.pnlUsdt.toFixed(2)})
                    </span>
                  )}
                </div>
              )}

            </div>
          );
        })}
      </div>

      {/* Rodapé */}
      {sorted.length > 0 && (
        <div className="border-t px-1.5 sm:px-3 py-1 sm:py-2 shrink-0 space-y-0.5" style={{ borderColor: '#0a2a1a' }}>
          {/* Mobile: contagens compactas */}
          <div className="flex justify-between text-[9px] sm:hidden">
            <span style={{ color: '#1a5c32' }}>▲{buys.length}</span>
            <span style={{ color: '#5c1a1a' }}>▼{sells.length}</span>
          </div>
          {/* sm+: totais completos */}
          <div className="hidden sm:flex justify-between text-[10px]">
            <span style={{ color: '#1a5c32' }}>Compras ({buys.length})</span>
            <span style={{ color: '#22c55e' }}>${totalBuy.toFixed(2)}</span>
          </div>
          <div className="hidden sm:flex justify-between text-[10px]">
            <span style={{ color: '#5c1a1a' }}>Vendas ({sells.length})</span>
            <span style={{ color: '#ef4444' }}>${totalSell.toFixed(2)}</span>
          </div>
          {sells.length > 0 && (
            <div className="hidden sm:flex justify-between text-[10px] font-semibold">
              <span style={{ color: '#1a5c32' }}>PnL</span>
              <span style={{ color: totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CandlestickChart() {
  const { selectedChart, setSelectedChart, chartZoom, chartTradeMarkers, chartViewSource,
    multitradeChartFocus, tradePurchases, allTrades, gateFavorites, chartInterval: savedInterval, setChartInterval,
    chartPanelButtons, uiPrefs, setOverlaySlotsPreference, multitradeFavorites, fiveMTradeFavorites, activeTrades } = useCurrency();
  const { t } = useI18n();
  const chartRef = useRef(null);
  const chartWrapRef = useRef(null);
  const [currentInterval, setCurrentInterval] = useState(savedInterval || DEFAULT_INTERVAL);
  const [loadingInterval, setLoadingInterval] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const [activeIndicators, setActiveIndicators] = useState(['ma9', 'ma21', 'rsi']);
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'matrix'
  const [overlaySlots, setOverlaySlots] = useState(() => uiPrefs.overlaySlots);
  const [overlayMaCache, setOverlayMaCache] = useState({});
  const [overlayMaLoading, setOverlayMaLoading] = useState(false);
  const [maBands, setMaBands] = useState({
    showAbove: false,
    showBelow: true,
    pct: 4,
  });
  const [candleFetchLimit, setCandleFetchLimit] = useState(500);
  const [displayCandleCount, setDisplayCandleCount] = useState(LIMIT);
  const [loadingMoreCandles, setLoadingMoreCandles] = useState(false);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el || !selectedChart) return undefined;
    const resize = () => chartRef.current?.getEchartsInstance()?.resize();
    resize();
    const t1 = requestAnimationFrame(resize);
    const t2 = setTimeout(resize, 120);
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [selectedChart?.symbol, selectedChart?.interval, activeTab]);


  function toggleIndicator(id) {
    setActiveIndicators((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  useEffect(() => {
    const handleThemeChange = () => setThemeTick(t => t + 1);
    window.addEventListener('palette-updated', handleThemeChange);
    return () => window.removeEventListener('palette-updated', handleThemeChange);
  }, []);

  // Sincroniza intervalo; não reseta limites quando o zoom veio do Multi-Trade (evita flash de velas vazias)
  useEffect(() => {
    if (selectedChart?.interval) {
      setCurrentInterval(selectedChart.interval);
    }
    if (isTradePanelChartView(chartViewSource) && chartZoom) {
      if (multitradeChartFocus?.candleLimit) {
        setCandleFetchLimit(multitradeChartFocus.candleLimit);
        setDisplayCandleCount(multitradeChartFocus.candleLimit);
      }
      return;
    }
    setCandleFetchLimit(500);
    setDisplayCandleCount(LIMIT);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart?.symbol, selectedChart?.interval, chartViewSource, multitradeChartFocus?.candleLimit]);

  // Overlays MA: MA-Cross só muda intervalo do chart; demais MT podem injetar slots da estratégia
  useEffect(() => {
    if (isTradePanelChartView(chartViewSource)) {
      if (multitradeChartFocus?.overlaySlots) {
        setOverlaySlots(multitradeChartFocus.overlaySlots);
      } else {
        setOverlaySlots(uiPrefs.overlaySlots);
      }
      setActiveIndicators(prev => {
        const next = new Set(prev);
        next.add('rsi');
        next.add('ma9');
        next.add('ma21');
        next.add('ma50');
        return [...next];
      });
      return;
    }
    setOverlaySlots(uiPrefs.overlaySlots);
  }, [chartViewSource, multitradeChartFocus?.overlaySlots, uiPrefs.overlaySlots]);

  useEffect(() => {
    if (!selectedChart?.symbol) {
      setOverlayMaCache({});
      return undefined;
    }
    const chartIv = selectedChart.interval ?? currentInterval;
    const toFetch = overlaySlots.filter(s => s.enabled && chartPanelButtons[overlayPanelKey(s)] !== false);
    if (!toFetch.length) {
      setOverlayMaCache({});
      setOverlayMaLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOverlayMaLoading(true);
    (async () => {
      const next = {};
      await Promise.all(toFetch.map(async (slot, idx) => {
        const key = `${slot.period}-${slot.interval}`;
        if (slot.interval === chartIv && slot.period === '50') {
          const candles = selectedChart.candlesticks ?? [];
          const ma = selectedChart.ma50 ?? [];
          if (ma.length && candles.length) {
            const offset = candles.length - ma.length;
            next[key] = ma.map((val, i) => ({
              openTime: Number(candles[offset + i].openTime),
              value: val,
            }));
          }
          return;
        }
        if (slot.interval === chartIv && slot.period === '9') {
          const candles = selectedChart.candlesticks ?? [];
          const ma = selectedChart.ma9 ?? [];
          if (ma.length && candles.length) {
            const offset = candles.length - ma.length;
            next[key] = ma.map((val, i) => ({
              openTime: Number(candles[offset + i].openTime),
              value: val,
            }));
          }
          return;
        }
        if (slot.interval === chartIv && slot.period === '21') {
          const candles = selectedChart.candlesticks ?? [];
          const ma = selectedChart.ma21 ?? [];
          if (ma.length && candles.length) {
            const offset = candles.length - ma.length;
            next[key] = ma.map((val, i) => ({
              openTime: Number(candles[offset + i].openTime),
              value: val,
            }));
          }
          return;
        }
        if (slot.interval === chartIv && slot.period === '200') {
          const candles = selectedChart.candlesticks ?? [];
          const ma = selectedChart.movingAverage ?? [];
          if (ma.length && candles.length) {
            const offset = candles.length - ma.length;
            next[key] = ma.map((val, i) => ({
              openTime: Number(candles[offset + i].openTime),
              value: val,
            }));
          }
          return;
        }
        try {
          const ovLimit = isTradePanelChartView(chartViewSource) && multitradeChartFocus?.fetchFromMs
            ? computeCandleLimitFromTime(multitradeChartFocus.fetchFromMs, slot.interval)
            : candleFetchLimit;
          next[key] = await fetchOverlayMaPoints(
            selectedChart.symbol,
            slot.interval,
            slot.period,
            selectedChart.source,
            ovLimit,
          );
        } catch (e) {
          console.warn('[overlayMA]', key, e.message);
        }
        void idx;
      }));
      if (!cancelled) setOverlayMaCache(next);
      if (!cancelled) setOverlayMaLoading(false);
    })();

    return () => { cancelled = true; };
  }, [overlaySlots, selectedChart?.symbol, selectedChart?.interval, selectedChart?.source, selectedChart?.candlesticks, selectedChart?.ma50, selectedChart?.ma9, selectedChart?.ma21, selectedChart?.movingAverage, currentInterval, candleFetchLimit, chartPanelButtons, chartViewSource, multitradeChartFocus?.fetchFromMs]);

  const colors = useMemo(() => getThemeColors(), [themeTick]);

  function updateOverlaySlot(id, patch) {
    setOverlaySlots(prev => {
      const next = prev.map(s => (s.id === id ? { ...s, ...patch } : s));
      if (!isTradePanelChartView(chartViewSource)) {
        setOverlaySlotsPreference(next);
      }
      return next;
    });
  }

  async function handleIntervalChange(iv) {
    if (iv === currentInterval) return;
    setCurrentInterval(iv);
    setChartInterval(iv);
    if (!selectedChart?.symbol) return;
    setLoadingInterval(true);
    try {
      const isMt = isTradePanelChartView(chartViewSource) && multitradeChartFocus?.fetchFromMs;
      const limit = isMt
        ? computeCandleLimitFromTime(multitradeChartFocus.fetchFromMs, iv)
        : 500;
      if (isMt) {
        setCandleFetchLimit(limit);
        setDisplayCandleCount(limit);
      } else {
        setCandleFetchLimit(500);
        setDisplayCandleCount(LIMIT);
      }
      const data = await fetchCandlesticksAndCloud(
        selectedChart.symbol, iv, selectedChart.source ?? null, limit,
      );
      setSelectedChart({
        ...data,
        interval: iv,
        symbol: selectedChart.symbol,
        source: selectedChart.source ?? null,
        tradeMarkers: selectedChart.tradeMarkers ?? chartTradeMarkers,
      });
    } finally {
      setLoadingInterval(false);
    }
  }

  async function handleLoadMoreCandles() {
    if (!selectedChart?.symbol) return;
    const currentLen = selectedChart.candlesticks?.length ?? 0;
    const nextLimit = CANDLE_FETCH_STEPS.find(step => step > Math.max(candleFetchLimit, currentLen)) ?? MAX_CANDLES;
    if (nextLimit <= candleFetchLimit && currentLen >= MAX_CANDLES) return;

    setLoadingMoreCandles(true);
    try {
      const data = await fetchCandlesticksAndCloud(
        selectedChart.symbol,
        currentInterval,
        selectedChart.source ?? null,
        nextLimit,
      );
      setSelectedChart(data);
      setCandleFetchLimit(nextLimit);
      setDisplayCandleCount(Math.min(nextLimit, data.candlesticks?.length ?? nextLimit));
    } finally {
      setLoadingMoreCandles(false);
    }
  }

  useEffect(() => {
    if (!chartZoom || !chartRef.current || !selectedChart?.candlesticks?.length) return;
    // Zoom embutido na option (buildFixedDataZoom); dispatchAction só como fallback legado (tabela/sem source)
    if (isTradePanelChartView(chartZoom.source) || chartZoom.source === CHART_VIEW.STATISTICS) return;
    const win = computeZoomWindow(selectedChart.candlesticks, chartZoom);
    if (!win) return;
    const instance = chartRef.current.getEchartsInstance();
    instance.dispatchAction({ type: 'dataZoom', start: win.startPct, end: win.endPct });
  }, [chartZoom, selectedChart, chartViewSource]);

  // Linhas azuis legadas (últimas 2 compras). Na view TX usamos só chartTradeMarkers (buy/sell + PnL).
  const tradeTimes = chartViewSource === CHART_VIEW.TRADES
    ? []
    : [...tradePurchases]
      .sort((a, b) => Number(a.time) - Number(b.time))
      .slice(-2)
      .map(t => Number(t.time));

  const markerTimesForWindow = chartViewSource === CHART_VIEW.TRADES && chartTradeMarkers?.length
    ? chartTradeMarkers.map(m => Number(m.time)).filter(Number.isFinite)
    : tradeTimes;

  const displayLimit = (() => {
    const candles = selectedChart?.candlesticks;
    if (chartZoom && (isTradePanelChartView(chartViewSource) || chartViewSource === CHART_VIEW.STATISTICS)) {
      return candles?.length ?? displayCandleCount;
    }
    if ((chartTradeMarkers?.length || selectedChart?.tradeMarkers?.length) && candles?.length && candles.length <= 50) {
      return candles.length;
    }
    if (chartZoom) return candles?.length ?? displayCandleCount;
    if (displayCandleCount > LIMIT) return Math.min(displayCandleCount, candles?.length ?? displayCandleCount);
    if (!candles?.length || !markerTimesForWindow.length) return LIMIT;
    const oldest = Math.min(...markerTimesForWindow);
    const idx = candles.findIndex(c => Number(c.openTime) >= oldest);
    if (idx === -1 || idx >= candles.length - LIMIT) return LIMIT;
    return Math.min(candles.length, candles.length - idx + 5);
  })();

  const chartLeftPad = hasAnyChartPanelButton(chartPanelButtons) ? CHART_LEFT_PAD : CHART_LEFT_PAD_NONE;

  const effectiveIndicators = useMemo(
    () => filterIndicatorsByPanel(activeIndicators, chartPanelButtons),
    [activeIndicators, chartPanelButtons],
  );

  const overlayConfigs = useMemo(() => overlaySlots
    .filter(s => s.enabled && chartPanelButtons[overlayPanelKey(s)] !== false)
    .map((slot) => {
      const key = `${slot.period}-${slot.interval}`;
      const isMa1 = slot.id === 'slot1';
      const colorIdx = isMa1 ? 0 : 1;
      const bandsOn = isMa1 && chartPanelButtons.bands !== false;
      return {
        label: `EMA${slot.period}@${slot.interval}`,
        color: OVERLAY_MA_COLORS[colorIdx],
        points: overlayMaCache[key] ?? [],
        bands: {
          showAbove: bandsOn && maBands.showAbove,
          showBelow: bandsOn && maBands.showBelow,
          abovePct: maBands.pct,
          belowPct: maBands.pct,
        },
      };
    }), [overlaySlots, overlayMaCache, maBands, chartPanelButtons]);

  const chartBuyInfo = useMemo(() => {
    if (!selectedChart?.symbol) return null;
    return resolveChartBuyPrice(selectedChart.symbol, {
      multitradeFavorites,
      fiveMTradeFavorites,
      activeTrades,
      allTrades,
      tradePurchases,
      chartTradeMarkers: chartTradeMarkers?.length
        ? chartTradeMarkers
        : (selectedChart.tradeMarkers ?? []),
    });
  }, [
    selectedChart?.symbol, selectedChart?.tradeMarkers,
    multitradeFavorites, fiveMTradeFavorites, activeTrades, allTrades, tradePurchases, chartTradeMarkers,
  ]);

  const option = useMemo(() => {
    if (!selectedChart) return null;
    if (activeTab === 'matrix') {
      return buildMatrixOption(
        selectedChart, effectiveIndicators, displayLimit, chartZoom, tradeTimes, chartLeftPad, chartBuyInfo,
      );
    }
    return buildOption(
      selectedChart, colors, effectiveIndicators, displayLimit, chartZoom, tradeTimes, overlayConfigs,
      chartTradeMarkers?.length ? chartTradeMarkers : (selectedChart.tradeMarkers ?? []),
      chartLeftPad, chartBuyInfo,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChart, colors, effectiveIndicators, chartZoom, tradePurchases, chartTradeMarkers, activeTab, overlayConfigs, displayLimit, chartLeftPad, chartBuyInfo]);

  if (!selectedChart || !option) {
    return (
      <div className="flex flex-1 items-center justify-center h-full text-p5 opacity-30">
        <div className="flex flex-col items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth="1" stroke="currentColor" className="w-16 h-16">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          <span className="text-sm tracking-wider">{t('chart.select')}</span>
        </div>
      </div>
    );
  }

  // ── Chart ECharts (usado em ambas as abas) ───────────────────────────────────
  const chartNode = (
    <ReactECharts
      key={`${selectedChart.symbol}-${activeTab}`}
      ref={chartRef}
      option={option}
      notMerge={true}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar — compacta no mobile (intervalos em scroll horizontal) */}
      <div className="flex flex-col px-2 md:px-3 pt-1 md:pt-2 pb-0.5 md:pb-1 shrink-0 gap-0.5 md:gap-1 border-b border-p2/40">
        {/* Linha 0 — abas */}
        <div className="flex items-center gap-1 border-b border-p2/20 pb-0.5 md:pb-1 mb-0.5">
          {[
            { id: 'chart',  label: 'Chart' },
            { id: 'matrix', label: 'Matrix' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-2 md:px-3 py-0.5 text-[10px] md:text-xs rounded font-mono transition-colors ${
                activeTab === id
                  ? 'bg-p4 text-white'
                  : 'text-p5/60 hover:text-p5 hover:bg-p3/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Linha 1 — intervalos (uma linha no mobile) */}
        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto touch-pan-x scrollbar-thin md:flex-wrap md:overflow-visible">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => handleIntervalChange(iv)}
              disabled={loadingInterval}
              className={`px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs rounded font-mono transition-colors disabled:opacity-40 shrink-0 ${
                currentInterval === iv
                  ? 'bg-p4 text-white'
                  : 'text-p5 hover:bg-p3/40 hover:text-white'
              }`}
            >
              {iv}
            </button>
          ))}
          {loadingInterval && (
            <div className="w-3 h-3 border border-p4 border-t-transparent rounded-full animate-spin ml-1 shrink-0" />
          )}
          <button
            onClick={handleLoadMoreCandles}
            disabled={loadingMoreCandles || (candleFetchLimit >= MAX_CANDLES && (selectedChart?.candlesticks?.length ?? 0) >= MAX_CANDLES)}
            title={`Carregar mais candles (até ${MAX_CANDLES})`}
            className="ml-1 px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs rounded font-mono transition-colors disabled:opacity-40 text-p5 hover:bg-p3/40 hover:text-white border border-p3/40 shrink-0"
          >
            {loadingMoreCandles ? '…' : `+${selectedChart?.candlesticks?.length ?? candleFetchLimit}/${MAX_CANDLES}`}
          </button>
        </div>


      </div>

      {/* Conteúdo da aba */}
      {activeTab === 'chart' ? (
        <div ref={chartWrapRef} className="flex-1 min-h-0 relative">
          {chartNode}
          <ChartLeftIndicatorPanel
            activeIndicators={activeIndicators}
            toggleIndicator={toggleIndicator}
            overlaySlots={overlaySlots}
            updateOverlaySlot={updateOverlaySlot}
            maBands={maBands}
            setMaBands={setMaBands}
            overlayMaLoading={overlayMaLoading}
            panelButtons={chartPanelButtons}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Gráfico (lado esquerdo) */}
          <div ref={chartWrapRef} className="flex-1 min-w-0 min-h-0 relative">
            {chartNode}
            <ChartLeftIndicatorPanel
              activeIndicators={activeIndicators}
              toggleIndicator={toggleIndicator}
              overlaySlots={overlaySlots}
              updateOverlaySlot={updateOverlaySlot}
              maBands={maBands}
              setMaBands={setMaBands}
              overlayMaLoading={overlayMaLoading}
              panelButtons={chartPanelButtons}
            />
          </div>
          {/* Painel de histórico (lado direito) */}
          <div className="w-24 sm:w-64 shrink-0 min-h-0 overflow-hidden">
            <TradeHistoryPanel
              symbol={selectedChart?.symbol}
              gateFavorites={gateFavorites}
            />
          </div>
        </div>
      )}
    </div>
  );
}
