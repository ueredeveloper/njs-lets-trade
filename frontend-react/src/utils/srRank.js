/**
 * Ranking de níveis de S/R (Suporte/Resistência) no cliente. Fonte única — CandlestickChartLW.jsx
 * e o motor ECharts (buildSrMarkLines) importam daqui em vez de cada um ter sua cópia.
 *
 * `detectSupportResistance` (srDetectors.js) devolve os níveis já ordenados por preço desc, cada
 * um `{ price, touches, type:'support'|'resistance', ... }`. Aqui damos "posto":
 *   - resistência: menor preço = R1 (mais perto do preço atual, por cima)
 *   - suporte:     maior preço = S1 (mais perto do preço atual, por baixo)
 */

import { detectSupportResistance } from './srDetectors';

/**
 * Anexa `rank` (1..) e `label` ('S1'/'R2'…) aos níveis de UM tipo, ordenados por proximidade.
 * Se o nível JÁ traz um `rank` (ex.: veio de `sliceRankedSrLevels`, que rankeia sobre o conjunto
 * completo antes de fatiar), esse posto é preservado — senão "R3" viraria "R1" ao ser desenhado
 * sozinho.
 */
export function rankSrLevels(levels, type) {
  return (levels ?? [])
    .filter((l) => l.type === type && Number.isFinite(Number(l.price)))
    .sort((a, b) => (type === 'resistance' ? a.price - b.price : b.price - a.price))
    .map((l, i) => {
      const rank = Number.isFinite(Number(l.rank)) ? Number(l.rank) : i + 1;
      return { ...l, rank, label: l.label ?? `${type === 'resistance' ? 'R' : 'S'}${rank}` };
    });
}

/**
 * Um SELETOR de postos do manipulador S/R (campos `support`/`resistance`). Formatos aceitos:
 *   - `'all'` / `null` / `undefined` → todos os postos (S1, S2, … Sn — sem teto)
 *   - `number[]`  → só esses postos exatos, ex.: `[1, 3]` = S1 e S3 (não S2)
 *   - `number`    → LEGADO cumulativo "top N" (`3` = S1–S3)
 * `srRankAllowed(sel, rank)` diz se o posto `rank` (1..) passa no seletor.
 */
export function srRankAllowed(sel, rank) {
  if (sel == null || sel === 'all') return true;
  if (Array.isArray(sel)) return sel.includes(Number(rank));
  const n = Number(sel);
  return Number.isFinite(n) ? Number(rank) <= n : true;
}

/**
 * Normaliza um valor persistido de seletor de postos p/ `'all'` ou `number[]` limpo (inteiros ≥1,
 * únicos, ordenados). `fallback` quando o valor é ausente/inválido. Migra o legado `number` (top N)
 * pra `[1..n]`.
 */
export function normalizeSrRankSel(raw, fallback = 'all') {
  if (raw === 'all') return 'all';
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20))]
      .sort((a, b) => a - b);
  }
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1) return Array.from({ length: Math.min(n, 20) }, (_, i) => i + 1);
  return fallback;
}

/**
 * Manipulador S/R — um seletor de postos por tipo: rankeia sobre o conjunto COMPLETO, mantém só os
 * postos que passam em `selSup` (suportes) / `selRes` (resistências) e devolve os níveis já com
 * `rank`/`label` do conjunto completo preservados (rankSrLevels respeita esse posto), pra "R3"
 * continuar "R3" mesmo desenhado sozinho. Seletores: ver `srRankAllowed`.
 */
export function sliceRankedSrLevels(levels, selSup, selRes) {
  const keep = [];
  for (const [type, sel] of [['support', selSup], ['resistance', selRes]]) {
    for (const l of rankSrLevels(levels, type)) {
      if (srRankAllowed(sel, l.rank)) keep.push(l);
    }
  }
  return keep;
}

/** Multiplicadores do lookback testados, em ordem, quando falta um posto pedido (ver
 *  detectExpandingSrLevels). O último é o teto: no máximo 10× os candles configurados. */
export const SR_EXPAND_STEPS = [1.25, 1.5, 2, 3, 4, 6, 8, 10];
export const SR_EXPAND_MAX_MULT = SR_EXPAND_STEPS[SR_EXPAND_STEPS.length - 1];
/** Mesmo mergePct padrão do detectSupportResistance: nível da janela ampliada colado (≤ isso) no
 *  mais distante que já existe é a mesma zona — não vira posto novo. */
const SR_EXPAND_MERGE_PCT = 0.5;

/** Até que posto um seletor exige: `'all'` → 3 (S1–S3 / R1–R3), `[1, 3]` → 3, legado `n` → n. */
function srNeededRank(sel) {
  if (sel == null || sel === 'all') return 3;
  if (Array.isArray(sel)) return sel.length ? Math.max(...sel.map(Number)) : 0;
  const n = Number(sel);
  return Number.isFinite(n) ? n : 3;
}

/**
 * S/R do GRÁFICO com janela que AMPLIA quando falta posto: roda detectSupportResistance nos
 * `lookback` candles que terminam em `candles[endIdx]`; se não houver suportes/resistências
 * suficientes pros postos pedidos (ex.: preço no topo da janela → zero resistência), recalcula com
 * 1,25×, 1,5×, 2×… até 10× o lookback (ou até acabarem os candles) e só COMPLETA o lado que falta,
 * com níveis além do mais distante já existente — os níveis da janela original não mudam. Nível
 * vindo da janela ampliada leva `expandedCandles` e o rótulo `R1·40c`. Devolve já fatiado pelos
 * seletores (posto/label preservados, igual sliceRankedSrLevels). Só o gráfico usa isso — backtest
 * e bot seguem com a janela fixa.
 */
export function detectExpandingSrLevels(candles, endIdx, lookback, selSup, selRes) {
  const windowOf = (n) => candles.slice(Math.max(0, endIdx - n + 1), endIdx + 1);
  const base = detectSupportResistance(windowOf(lookback), {});
  const byType = { support: rankSrLevels(base, 'support'), resistance: rankSrLevels(base, 'resistance') };
  const need = { support: srNeededRank(selSup), resistance: srNeededRank(selRes) };
  const missing = () => ['support', 'resistance'].filter((t) => byType[t].length < need[t]);

  let prevAvail = Math.min(lookback, endIdx + 1);
  for (const mult of SR_EXPAND_STEPS) {
    if (!missing().length) break;
    const avail = Math.min(Math.round(lookback * mult), endIdx + 1);
    if (avail <= prevAvail) break; // não há mais candles pra trás
    prevAvail = avail;
    const wider = detectSupportResistance(windowOf(avail), { maxLevels: 40 });
    for (const type of missing()) {
      const have = byType[type];
      const far = have.length ? have[have.length - 1].price : null;
      const beyond = rankSrLevels(wider, type).filter((l) => far == null || (
        (type === 'resistance' ? l.price > far : l.price < far)
        && (Math.abs(l.price - far) / far) * 100 > SR_EXPAND_MERGE_PCT));
      for (const l of beyond) {
        if (have.length >= need[type]) break;
        const rank = have.length + 1;
        have.push({ ...l, rank, label: `${type === 'resistance' ? 'R' : 'S'}${rank}·${avail}c`, expandedCandles: avail });
      }
    }
  }

  const keep = [];
  for (const [type, sel] of [['support', selSup], ['resistance', selRes]]) {
    for (const l of byType[type]) if (srRankAllowed(sel, l.rank)) keep.push(l);
  }
  return keep;
}
