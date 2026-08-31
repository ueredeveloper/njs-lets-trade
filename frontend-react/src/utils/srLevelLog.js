/**
 * DEBUG — printa no console os níveis de S/R (Suporte/Resistência) de um conjunto de níveis,
 * numerados por proximidade do preço (S1 = suporte mais alto, R1 = resistência mais baixa), no
 * mesmo critério do gráfico (rankSrLevels em CandlestickChartLW.jsx / buildSrMarkLines).
 *
 * Usado em dois pontos:
 *  - ao criar a caixa de análise no gráfico (níveis no momento da borda direita da caixa)
 *  - ao clicar num trade da aba Estatísticas → Momentum RSI (níveis EXATOS que o backtest usou)
 *
 * Horários em BRT (America/Sao_Paulo), formato DD/MM HH:MM — ver CLAUDE.md.
 */

const fmtBRT = (ms) => (Number.isFinite(Number(ms))
  ? new Date(Number(ms)).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  : '—');

const near = (a, b) => a != null && b != null && Math.abs(a - b) / b < 1e-6;

export function logSrLevels(context, symbol, levels, meta = {}) {
  const rows = [];
  for (const type of ['resistance', 'support']) {
    (levels ?? [])
      .filter((l) => l.type === type && Number.isFinite(Number(l.price)))
      .sort((a, b) => (type === 'resistance' ? a.price - b.price : b.price - a.price))
      .forEach((l, i) => {
        let ref = '';
        if (near(l.price, meta.entrySupport)) ref = 'entrada';
        else if (near(l.price, meta.exitResistance)) ref = 'alvo';
        rows.push({
          nível: `${type === 'resistance' ? 'R' : 'S'}${i + 1}`,
          preço: Number(l.price),
          toques: l.touches ?? 1,
          ref,
        });
      });
  }
  console.groupCollapsed(`%c[S/R] ${context} — ${symbol ?? '?'}`, 'color:#ec4899;font-weight:bold');
  if (meta.interval) console.log('intervalo S/R:', meta.interval);
  if (meta.lookback) console.log('lookback:', meta.lookback, 'candles');
  if (meta.anchorMs != null) console.log('âncora (BRT):', fmtBRT(meta.anchorMs), '— último candle do intervalo ≤ esse ponto');
  if (meta.signalMs != null) {
    console.log('sinal (BRT):', fmtBRT(meta.signalMs));
    console.log('  (o backtest ancora no último candle do intervalo que JÁ FECHOU antes do sinal — sem look-ahead)');
  }
  if (Array.isArray(meta.windowMs)) console.log('janela (BRT):', fmtBRT(meta.windowMs[0]), '→', fmtBRT(meta.windowMs[1]));
  if (rows.length) console.table(rows);
  else console.log('(nenhum nível de S/R nesse momento)');
  console.groupEnd();
}
