/**
 * Primitive customizado do Lightweight Charts pra preencher a área entre duas linhas (banda
 * superior/inferior) — a lib não tem "area between two lines" nativo, só Area/Baseline
 * (preenchimento contra um valor fixo, não contra outra série). Usado pra área da banda ±1σ
 * do VWAP e pra "nuvem" vermelha de queda da VWAP (vwapSlopeHighlight) — várias bandas
 * independentes (chaveadas por string) podem coexistir no mesmo primitive, cada uma com sua
 * própria cor; uma faixa de tempo sem cobertura em nenhuma banda simplesmente não é pintada.
 */
class BandFillPaneView {
  constructor(source) {
    this._source = source;
    this._items = [];
  }

  update() {
    const chart = this._source._chart;
    const series = this._source._series;
    if (!chart || !series) { this._items = []; return; }
    const ts = chart.timeScale();
    const items = [];
    for (const { points, fillColor } of this._source._bands.values()) {
      const upperCoords = [];
      const lowerCoords = [];
      for (const p of points) {
        const x = ts.timeToCoordinate(p.time);
        const yu = series.priceToCoordinate(p.upper);
        const yl = series.priceToCoordinate(p.lower);
        if (x == null || yu == null || yl == null) continue;
        upperCoords.push({ x, y: yu });
        lowerCoords.push({ x, y: yl });
      }
      if (upperCoords.length >= 2) items.push({ upperCoords, lowerCoords, fillColor });
    }
    this._items = items;
  }

  zOrder() {
    return 'bottom';
  }

  renderer() {
    return new BandFillRenderer(this._items);
  }
}

class BandFillRenderer {
  constructor(items) {
    this._items = items;
  }

  draw(target) {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (const it of this._items) {
        ctx.beginPath();
        ctx.moveTo(it.upperCoords[0].x, it.upperCoords[0].y);
        for (let i = 1; i < it.upperCoords.length; i++) ctx.lineTo(it.upperCoords[i].x, it.upperCoords[i].y);
        for (let i = it.lowerCoords.length - 1; i >= 0; i--) ctx.lineTo(it.lowerCoords[i].x, it.lowerCoords[i].y);
        ctx.closePath();
        ctx.fillStyle = it.fillColor;
        ctx.fill();
      }
    });
  }
}

export class BandFillPrimitive {
  constructor() {
    this._bands = new Map();
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._paneView = new BandFillPaneView(this);
  }

  /** points: [{ time, upper, lower }] (time em segundos) — `key` identifica a banda (ex.:
   *  'vwapSigma') pra poder coexistir com outras (ex.: 'vwapDecline-0') sem se sobrescrever. */
  setBand(key, points, fillColor) {
    this._bands.set(key, { points: points ?? [], fillColor: fillColor ?? 'rgba(0,0,0,0)' });
    this._requestUpdate?.();
  }

  removeBand(key) {
    if (this._bands.delete(key)) this._requestUpdate?.();
  }

  /** Substitui todas as bandas cuja chave começa com `prefix` pela lista dada — usado pra
   *  segmentos dinâmicos (ex.: nuvem de queda, um segmento por trecho contíguo em queda),
   *  cuja quantidade muda a cada render. */
  replacePrefixed(prefix, list) {
    for (const k of [...this._bands.keys()]) {
      if (k.startsWith(prefix)) this._bands.delete(k);
    }
    (list ?? []).forEach((b, i) => {
      this._bands.set(`${prefix}${i}`, { points: b.points ?? [], fillColor: b.fillColor ?? 'rgba(0,0,0,0)' });
    });
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
