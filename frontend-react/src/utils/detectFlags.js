/**
 * Detecção automática de BANDEIRAS (flags) de alta e de baixa — botão "Band." no painel de
 * indicadores do gráfico. Roda sobre os candles JÁ carregados no gráfico (não faz fetch
 * próprio), então acompanha o intervalo/zoom atuais.
 *
 * Bibliografia (ver estudo enviado ao usuário): Schabacker (1932), Edwards & Magee
 * (Technical Analysis of Stock Trends, cap. de Consolidation Formations — "flag flies at
 * half-mast"), O'Neil (high, tight flag) e Bulkowski (Encyclopedia of Chart Patterns —
 * medições e taxas de acerto). Regras objetivas aqui:
 *
 *  1. MASTRO (pole): impulso forte e quase reto — ganho >= minPoleGainPct em <= maxPoleBars
 *     candles, com maioria de candles a favor e começando/terminando nos extremos do trecho.
 *  2. BANDEIRA (flag): 4–20 candles de consolidação, retração <= maxRetracePct do mastro
 *     (ideal <= 0.38), canal levemente CONTRA a tendência (alta: drift <= +3%; baixa: >= -3%),
 *     e volume médio da bandeira menor que o do mastro (contração).
 *  3. GATILHO: fechamento rompe a linha do canal na direção da tendência -> `confirmed: true`.
 *     Sem rompimento ainda (dentro do limite de candles) -> `confirmed: false` ("em formação").
 *  4. ALVO: projeção da altura do mastro a partir do ponto de rompimento (measured move).
 *  5. HTF (high, tight flag de O'Neil/Bulkowski): mastro >= tightPoleGainPct com retração
 *     <= tightRetracePct -> `tight: true` (a única variante com edge forte na literatura).
 *
 * @returns {Array<Flag>} onde Flag = {
 *   type: 'bull'|'bear', tight: boolean, confirmed: boolean, label: string,
 *   poleStart: {time, price}, poleEnd: {time, price},         // time em ms (openTime)
 *   channel: [{time, upper, lower}, {time, upper, lower}],     // 2 pontos (reta de regressão)
 *   breakout: {time, price}|null, target: {time, price}|null,
 *   retracePct: number, poleGainPct: number,
 * }
 */

const DEFAULTS = {
  lookback: 320,          // varre no máximo os últimos N candles
  minPoleGainPct: 6,      // impulso mínimo do mastro (%)
  maxPoleBars: 12,        // ...em até N candles
  minPoleGainPerBarPct: 1.1, // mastro tem que ser ÍNGREME (ganho médio por candle)
  minPoleBodyRatio: 0.5,  // fração mínima de candles a favor da tendência no mastro
  minFlagBars: 4,
  maxFlagBars: 20,
  maxRetracePct: 0.5,     // retração da bandeira <= 50% do mastro
  maxChannelDriftPct: 3,  // inclinação do canal a favor da tendência tolerada (%)
  volRatioMax: 1.0,       // volume médio bandeira / volume médio mastro
  breakoutTolPct: 0,      // folga no rompimento além da linha do canal
  forwardResolveBars: 3,  // bandeira sem rompimento só aparece se terminou nos últimos N candles
  tightPoleGainPct: 40,   // >= isso + retração baixa => high, tight flag
  tightRetracePct: 0.25,
  maxFlags: 8,            // mantém só os mais recentes
};

/** Regressão linear simples sobre índices 0..n-1 -> { slope, intercept }. */
function linreg(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

function detectDirection(cs, dir, opts) {
  const n = cs.length;
  const flags = [];
  const minLow = (a, b) => { let m = Infinity; for (let i = a; i <= b; i++) m = Math.min(m, cs[i].l); return m; };
  const maxHigh = (a, b) => { let m = -Infinity; for (let i = a; i <= b; i++) m = Math.max(m, cs[i].h); return m; };

  let e = 1;
  while (e < n - opts.minFlagBars) {
    let matched = false;

    for (let s = Math.max(0, e - opts.maxPoleBars); s < e; s++) {
      // Extremos do mastro conforme a direção.
      const startP = dir > 0 ? cs[s].l : cs[s].h;
      const endP = dir > 0 ? cs[e].h : cs[e].l;
      const poleH = Math.abs(endP - startP);
      const gainPct = (poleH / startP) * 100;
      if (gainPct < opts.minPoleGainPct) continue;
      if (gainPct / (e - s) < opts.minPoleGainPerBarPct) continue; // tem que ser íngreme

      // O mastro tem que começar e terminar nos extremos do próprio trecho — senão é só
      // um pedaço de um movimento maior, não um impulso limpo. `fwd` confirma que `e` é
      // mesmo o topo/fundo do impulso (os 2 candles seguintes não o superam) — sem isso a
      // detecção "para" no meio do mastro e trata o resto da subida como bandeira.
      const fwd = Math.min(e + 2, n - 1);
      if (dir > 0) {
        if (cs[s].l > minLow(s, e) + 1e-12) continue;
        if (cs[e].h < maxHigh(s, e) - 1e-12) continue;
        if (cs[e].h < maxHigh(e + 1, fwd) - 1e-12) continue;
      } else {
        if (cs[s].h < maxHigh(s, e) - 1e-12) continue;
        if (cs[e].l > minLow(s, e) + 1e-12) continue;
        if (cs[e].l > minLow(e + 1, fwd) + 1e-12) continue;
      }

      // Maioria de candles a favor da tendência.
      let favor = 0;
      for (let i = s + 1; i <= e; i++) {
        if (dir > 0 ? cs[i].c >= cs[i].o : cs[i].c <= cs[i].o) favor++;
      }
      if (favor / (e - s) < opts.minPoleBodyRatio) continue;

      const poleVol = avgVol(cs, s + 1, e);

      // --- Procura a bandeira depois do mastro ---
      const flagStart = e + 1;
      let broke = null;   // { idx, price }
      let invalid = false;
      let jEnd = -1;

      for (let j = flagStart; j < n && (j - flagStart) < opts.maxFlagBars; j++) {
        // Retração além do limite => o "mastro" não segura, não é bandeira.
        const retr = dir > 0
          ? (endP - minLow(flagStart, j)) / poleH
          : (maxHigh(flagStart, j) - endP) / poleH;
        if (retr > opts.maxRetracePct) { invalid = true; jEnd = j; break; }

        jEnd = j;
        if ((j - flagStart) < opts.minFlagBars - 1) continue;

        // Canal por regressão sobre highs/lows da bandeira até aqui.
        const highs = []; const lows = [];
        for (let i = flagStart; i <= j; i++) { highs.push(cs[i].h); lows.push(cs[i].l); }
        const rh = linreg(highs); const rl = linreg(lows);
        const upperAt = (idx) => rh.intercept + rh.slope * (idx - flagStart);
        const lowerAt = (idx) => rl.intercept + rl.slope * (idx - flagStart);

        // Inclinação do canal: bandeira deve driftar CONTRA a tendência (ou de lado).
        const span = j - flagStart;
        const driftPct = dir > 0
          ? ((upperAt(j) - upperAt(flagStart)) / upperAt(flagStart)) * 100
          : ((lowerAt(flagStart) - lowerAt(j)) / lowerAt(flagStart)) * 100;
        if (span > 0 && driftPct > opts.maxChannelDriftPct) { invalid = true; break; }

        // Rompimento: fechamento cruza a linha do canal na direção da tendência E supera
        // (alta) / perfura (baixa) o extremo da própria bandeira até o candle anterior.
        const prevExtreme = dir > 0 ? maxHigh(flagStart, j - 1) : minLow(flagStart, j - 1);
        const line = dir > 0 ? upperAt(j) : lowerAt(j);
        const tol = 1 + (dir > 0 ? opts.breakoutTolPct : -opts.breakoutTolPct) / 100;
        if (dir > 0
          ? (cs[j].c > line * tol && cs[j].c > prevExtreme)
          : (cs[j].c < line * tol && cs[j].c < prevExtreme)) {
          broke = { idx: j, price: cs[j].c };
          jEnd = j - 1;
          break;
        }
      }

      if (invalid && !broke) continue;
      if (jEnd < flagStart + opts.minFlagBars - 1) continue;
      // Bandeira sem rompimento só interessa se ainda está "viva" (perto do candle mais
      // recente) — uma consolidação antiga que nunca rompeu já falhou, não é sinal.
      if (!broke && (n - 1 - jEnd) > opts.forwardResolveBars) continue;

      // Volume: contração na bandeira (pula se não houver dado de volume).
      const flagVol = avgVol(cs, flagStart, jEnd);
      if (poleVol > 0 && flagVol > 0 && flagVol / poleVol > opts.volRatioMax) continue;

      // Reconstrói o canal final (flagStart..jEnd) pros pontos de desenho.
      const fHighs = []; const fLows = [];
      for (let i = flagStart; i <= jEnd; i++) { fHighs.push(cs[i].h); fLows.push(cs[i].l); }
      const rh = linreg(fHighs); const rl = linreg(fLows);
      const chAt = (idx) => ({
        upper: rh.intercept + rh.slope * (idx - flagStart),
        lower: rl.intercept + rl.slope * (idx - flagStart),
      });

      const retracePct = dir > 0
        ? (endP - minLow(flagStart, jEnd)) / poleH
        : (maxHigh(flagStart, jEnd) - endP) / poleH;
      const tight = gainPct >= opts.tightPoleGainPct && retracePct <= opts.tightRetracePct;

      let target = null;
      if (broke) {
        const tgtPrice = dir > 0 ? broke.price + poleH : broke.price - poleH;
        const ivMs = cs.length > 1 ? cs[1].t - cs[0].t : 0;
        const projBars = Math.min(e - s, n - 1 - broke.idx);
        const tgtTime = projBars > 0
          ? cs[broke.idx + projBars].t
          : cs[broke.idx].t + ivMs * (e - s);
        target = { time: tgtTime, price: tgtPrice };
      }

      const typ = dir > 0 ? 'bull' : 'bear';
      flags.push({
        type: typ,
        tight,
        confirmed: !!broke,
        label: dir > 0
          ? (tight ? 'Bandeira de alta (HTF)' : 'Bandeira de alta')
          : 'Bandeira de baixa',
        poleStart: { time: cs[s].t, price: startP },
        poleEnd: { time: cs[e].t, price: endP },
        channel: [
          { time: cs[flagStart].t, ...chAt(flagStart) },
          { time: cs[jEnd].t, ...chAt(jEnd) },
        ],
        breakout: broke ? { time: cs[broke.idx].t, price: broke.price } : null,
        target,
        retracePct,
        poleGainPct: gainPct,
      });

      // Não sobrepõe: retoma a varredura depois do fim desta bandeira.
      e = (broke ? broke.idx : jEnd) + 1;
      matched = true;
      break;
    }

    if (!matched) e++;
  }

  return flags;
}

function avgVol(cs, a, b) {
  let sum = 0; let cnt = 0;
  for (let i = a; i <= b; i++) {
    const v = cs[i].v;
    if (Number.isFinite(v)) { sum += v; cnt++; }
  }
  return cnt ? sum / cnt : 0;
}

/**
 * @param {Array<{openTime, open, high, low, close, volume}>} candlesticks
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function detectFlags(candlesticks, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const minLen = opts.minFlagBars + opts.minFlagBars + 4;
  if (!Array.isArray(candlesticks) || candlesticks.length < minLen) {
    return [];
  }

  const sliced = candlesticks.slice(-opts.lookback);
  const cs = sliced
    .map((c) => ({
      t: Number(c.openTime),
      o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close),
      v: Number(c.volume),
    }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.o) && Number.isFinite(c.h)
      && Number.isFinite(c.l) && Number.isFinite(c.c));
  if (cs.length < minLen) return [];

  const all = [...detectDirection(cs, +1, opts), ...detectDirection(cs, -1, opts)]
    .sort((a, b) => a.poleStart.time - b.poleStart.time);

  return all.slice(-opts.maxFlags);
}

export const FLAG_DETECT_DEFAULTS = DEFAULTS;
