/**
 * Nuvem de "permanência" EMA9×EMA21 — botão "Perman." no painel de indicadores do gráfico
 * (INDICATOR_GROUPS em CandlestickChart.jsx). Duas regras diferentes por lado — sempre em verde,
 * já que as duas marcam um momento "bullish" (início de alta / fim provável de queda), nunca um
 * momento vermelho:
 *
 * Em vez de medir quantos CANDLES a moeda fica de um lado ou de outro, mede o quanto a
 * DISTÂNCIA (%) entre EMA9 e EMA21 diverge em cada perna antes de reverter — o pico de
 * afastamento (gap%) tipicamente alcançado antes do cruzamento voltar. A média histórica desses
 * picos vira o valor "normal" de reversão de cada lado:
 *
 *  - Pernas de ALTA (ema9 > ema21): pinta do início do cruzamento (gap ≈ 0) até o gap% atingir o
 *    maior valor médio histórico (o pico médio de afastamento das pernas de alta).
 *
 *  - Pernas de BAIXA (ema9 < ema21): o INVERSO — só começa quando o gap% (em módulo) atinge o
 *    maior valor médio histórico das pernas de baixa, e vai diminuindo até o possível cruzamento
 *    de volta (ema9 cruzando acima da ema21 de novo). Não pinta o início da queda, só a reta final
 *    de volta ao cruzamento.
 *
 * As médias são calculadas só sobre os últimos MAX_HISTORY_CANDLES candles (não o histórico
 * inteiro carregado no gráfico) — pra pegar o modelo RECENTE de movimento da moeda; regime
 * antigo (ex.: bull run de meses atrás) não deve puxar a média de um par que agora está em
 * lateralização. Ex.: se em média o gap chega a 3.5% nas pernas de alta antes de reverter, a
 * nuvem de alta cobre do início (gap ≈ 0) até o candle em que o gap atinge 3.5%. Se em média
 * chega a -2.4% nas pernas de baixa, a nuvem de baixa começa no candle em que o gap atinge -2.4%
 * e vai até o candle imediatamente antes do cruzamento de volta pra cima. Pernas que nunca
 * alcançam o pico médio não pintam nada (lado alta pinta só até onde a divergência chegou de
 * fato; lado baixa não pinta nenhum candle).
 */

import { buildEmaCrossMergedSeries } from './emaCrossSeries';

const CLOUD_COLOR = 'rgba(38, 166, 154, 0.22)'; // mesmo verde do candle de alta (C_UP) — os dois lados usam a mesma cor

// Teto de candles usados pra calcular a média/pico do gap% — mantém o modelo de reversão
// baseado no comportamento RECENTE do par, não no histórico inteiro que o gráfico carregou
// (que pode remontar a regimes de mercado bem diferentes do atual).
const MAX_HISTORY_CANDLES = 700;

const EMPTY_RESULT = { segments: [], avgAbove: 0, avgBelow: 0, halfAbove: 0, halfBelow: 0 };

/**
 * @param {Array} candlesticks candles do gráfico (mesmo array passado pra CandlestickChartLW)
 * @param {Array} ma9  série EMA9 alinhada ao fim de `candlesticks` (mesmo formato do prop `ma9`)
 * @param {Array} ma21 série EMA21, idem
 * @returns {{ segments: Array<{points: Array<{time:number, upper:number, lower:number}>, fillColor: string}>,
 *             avgAbove: number, avgBelow: number, halfAbove: number, halfBelow: number }}
 *          avgAbove/avgBelow: pico médio histórico do gap% (distância EMA9↔EMA21 normalizada
 *          pela EMA21) de cada lado — limiar usado pra recortar as duas nuvens (alta: do início
 *          do cruzamento até avgAbove; baixa: de avgBelow até o cruzamento de volta).
 *          halfAbove/halfBelow (metade desses picos) são devolvidos só por completude — não são
 *          mais usados no recorte de nenhuma das duas nuvens.
 */
export function buildEmaCrossPersistenceClouds(candlesticks, ma9, ma21) {
  const fullMerged = buildEmaCrossMergedSeries(candlesticks, ma9, ma21);
  if (fullMerged.length < 2) return EMPTY_RESULT;
  // Só os últimos MAX_HISTORY_CANDLES candles entram no cálculo (média/pico e nuvem) — ver
  // comentário do módulo.
  const merged = fullMerged.length > MAX_HISTORY_CANDLES
    ? fullMerged.slice(-MAX_HISTORY_CANDLES)
    : fullMerged;

  // Gap% por candle — distância EMA9↔EMA21 normalizada pelo preço (EMA21), pra comparar moedas
  // de escalas diferentes. Positivo com EMA9 acima (alta), negativo com EMA9 abaixo (baixa).
  const gapPct = merged.map((m) => ((m.fast - m.slow) / m.slow) * 100);

  // Runs (sequências consecutivas) de "acima"/"abaixo", guardando início/fim (fim exclusivo)
  // em `merged` pra recortar a nuvem depois.
  const runs = [];
  let state = null;
  let start = 0;
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].fast === merged[i].slow) continue; // empate exato: não pertence a nenhum lado
    const s = merged[i].fast > merged[i].slow ? 'above' : 'below';
    if (s !== state) {
      if (state) runs.push({ state, start, end: i });
      state = s;
      start = i;
    }
  }
  if (state) runs.push({ state, start, end: merged.length });

  // Pico de divergência (%) alcançado em cada perna antes de reverter — o "quanto chegou a
  // afastar" antes do cruzamento voltar. Sempre um valor positivo (módulo), dos dois lados.
  const peakOf = (run) => {
    let peak = 0;
    const sign = run.state === 'above' ? 1 : -1;
    for (let i = run.start; i < run.end; i++) {
      const g = sign * gapPct[i];
      if (g > peak) peak = g;
    }
    return peak;
  };

  const avg = (list) => (list.length ? list.reduce((a, r) => a + peakOf(r), 0) / list.length : 0);
  const avgAbove = avg(runs.filter((r) => r.state === 'above'));
  const avgBelow = avg(runs.filter((r) => r.state === 'below'));
  const halfAbove = avgAbove / 2;
  const halfBelow = avgBelow / 2;

  const buildPoints = (from, to) => {
    const points = [];
    for (let i = from; i < to; i++) {
      const m = merged[i];
      points.push({ time: m.time, upper: Math.max(m.fast, m.slow), lower: Math.min(m.fast, m.slow) });
    }
    return points;
  };

  // Primeiro índice do run (em módulo, com o sinal do lado) em que o gap% atinge `threshold`.
  // null se o run inteiro nunca alcança o limiar.
  const firstIndexReaching = (run, threshold) => {
    const sign = run.state === 'above' ? 1 : -1;
    for (let i = run.start; i < run.end; i++) {
      if (sign * gapPct[i] >= threshold) return i;
    }
    return null;
  };

  const segments = [];
  for (const run of runs) {
    let points;
    if (run.state === 'above') {
      if (avgAbove <= 0) continue;
      // Perna de alta inteira: do início do cruzamento (menor valor, gap ≈ 0) até o gap%
      // atingir o maior valor médio histórico (pico médio das pernas de alta) — ou até onde
      // o run chegou, se ainda não atingiu.
      const reachedAt = firstIndexReaching(run, avgAbove);
      const to = reachedAt != null ? reachedAt + 1 : run.end;
      points = buildPoints(run.start, to);
    } else {
      if (avgBelow <= 0) continue;
      // Inverso da nuvem de alta: só começa quando o gap% (em módulo) atinge o maior valor
      // médio histórico das pernas de baixa, e vai até o fim do run (o candle logo antes do
      // cruzamento de volta pra cima). Runs que nunca atingem o pico médio não pintam nada.
      const fromIdx = firstIndexReaching(run, avgBelow);
      if (fromIdx == null) continue;
      points = buildPoints(fromIdx, run.end);
    }
    if (points.length >= 2) segments.push({ points, fillColor: CLOUD_COLOR });
  }

  return { segments, avgAbove, avgBelow, halfAbove, halfBelow };
}
