/**
 * Primitive customizado do Lightweight Charts pra desenhar retângulos preenchidos com label —
 * a lib não tem markArea/rectangle nativo (só o ECharts tem). Usado pelos quadrados de
 * alvo (verde) e stop loss (vermelho) da posição aberta, espelhando buildBuyPositionSquares
 * em CandlestickChart.jsx: um retângulo do candle de compra até o candle mais recente (largura
 * dinâmica, sempre deixando os 2 últimos candles livres — ver buildPositionRects em
 * CandlestickChartLW.jsx), do preço de compra até o preço do alvo/stop, com o % de distância
 * como label — encostado no topo do quadrado (alvo) ou no fundo (stop loss), conforme
 * r.labelPos, em vez de centralizado, pra ficar perto do preço-alvo/stop de fato.
 */
class RectanglePaneView {
  constructor(source) {
    this._source = source;
    this._items = [];
  }

  update() {
    const chart = this._source._chart;
    const series = this._source._series;
    if (!chart || !series) { this._items = []; return; }
    const ts = chart.timeScale();
    this._items = this._source._rects
      .map((r) => {
        const x1 = ts.timeToCoordinate(r.time1);
        const x2 = ts.timeToCoordinate(r.time2);
        const y1 = series.priceToCoordinate(r.price1);
        const y2 = series.priceToCoordinate(r.price2);
        if (x1 == null || x2 == null || y1 == null || y2 == null) return null;
        return { x1, x2, y1, y2, fillColor: r.fillColor, label: r.label, labelColor: r.labelColor, labelPos: r.labelPos };
      })
      .filter(Boolean);
  }

  renderer() {
    return new RectangleRenderer(this._items);
  }
}

class RectangleRenderer {
  constructor(items) {
    this._items = items;
  }

  draw(target) {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (const it of this._items) {
        const left = Math.min(it.x1, it.x2);
        const right = Math.max(it.x1, it.x2);
        const top = Math.min(it.y1, it.y2);
        const bottom = Math.max(it.y1, it.y2);
        ctx.fillStyle = it.fillColor;
        ctx.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
        if (it.label && right - left > 24) {
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = it.labelColor;
          ctx.textAlign = 'center';
          const pad = 3;
          let y = (top + bottom) / 2;
          ctx.textBaseline = 'middle';
          if (it.labelPos === 'top') { ctx.textBaseline = 'top'; y = top + pad; }
          else if (it.labelPos === 'bottom') { ctx.textBaseline = 'bottom'; y = bottom - pad; }
          else if (it.labelPos === 'above') { ctx.textBaseline = 'bottom'; y = top - pad; }
          ctx.fillText(it.label, (left + right) / 2, y);
        }
      }
    });
  }
}

export class RectanglePrimitive {
  constructor() {
    this._rects = [];
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._paneView = new RectanglePaneView(this);
  }

  /** rects: [{ time1, price1, time2, price2, fillColor, label, labelColor, labelPos }] (time em
   *  segundos; labelPos: 'top'|'bottom' — encostado na borda, dentro do quadrado — |'above' —
   *  fora, acima da borda superior — |undefined — centralizado) */
  setRects(rects) {
    this._rects = rects ?? [];
    this._requestUpdate?.();
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews() {
    this._paneView.update();
  }

  paneViews() {
    return [this._paneView];
  }
}
