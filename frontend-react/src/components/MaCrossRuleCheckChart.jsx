import { useMemo, useState, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { fetchMultitradeBacktest } from '../services/api';

/**
 * Conferência visual das regras de entrada do ma-cross: para cada cruzamento
 * EMA9↑EMA21 (15m) num período escolhido, mostra um ponto colorido pela regra
 * que decidiu o resultado (permitida / tendência / aproximação / outros filtros),
 * junto com a linha de preço e os trades reais executados nessa simulação.
 */

const BUCKET_COLOR = {
  allowed:  '#008300',
  trend:    '#3987e5',
  approach: '#d55181',
  other:    '#c98500',
};

const BUCKET_SYMBOL = {
  allowed:  'circle',
  trend:    'triangle',
  approach: 'diamond',
  other:    'rect',
};

const BUCKET_LABEL = {
  allowed:  'Entrada permitida',
  trend:    'Bloqueada — tendência EMA9×21',
  approach: 'Bloqueada — aproximação EMA9/21',
  other:    'Bloqueada — outros filtros',
};

const TRADE_GOOD = '#0ca30c';
const TRADE_CRITICAL = '#d03b3b';

function bucketOutcome(outcome) {
  if (outcome === 'BOUGHT' || outcome === 'POSITION_OPEN') return 'allowed';
  if (outcome?.startsWith('HTF_TREND')) return 'trend';
  if (outcome?.startsWith('EMA_APPROACH')) return 'approach';
  return 'other';
}

function fmtDateTime(ms) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtPrice(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p < 0.01 ? p.toFixed(6) : p < 1 ? p.toFixed(4) : p.toFixed(2);
}

function fmtPct(p) {
  return p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

/** input datetime-local (hora local do navegador) → ISO. */
function localInputToISO(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function defaultSinceInput(daysBack = 7) {
  const d = new Date(Date.now() - daysBack * 86_400_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function buildTooltip(row) {
  const lines = [
    `<b>${fmtDateTime(row.timeISO ?? row.time)}</b>`,
    `close: ${fmtPrice(row.price)}`,
  ];
  if (row.ma1 != null && row.ma2 != null) {
    lines.push(`EMA9(15m): ${fmtPrice(row.ma1)} · EMA21(15m): ${fmtPrice(row.ma2)}`);
  }
  if (row.trendMa1 != null && row.trendMa2 != null) {
    const gap = ((row.trendMa1 / row.trendMa2) - 1) * 100;
    lines.push(`tendência: gap ${fmtPct(gap)}`);
  }
  if (row.approachGapPct != null) {
    lines.push(`aproximação: gap ${fmtPct(row.approachGapPct)}${row.approachTroughGapPct != null ? ` (fundo ${fmtPct(row.approachTroughGapPct)})` : ''}`);
  }
  lines.push(`<b>${row.outcomeLabel ?? row.outcome}</b>`);
  if (row.outcome === 'BOUGHT' && row.exitDetail) {
    lines.push(row.exitDetail);
  }
  if (row.pnlPct != null) {
    lines.push(`PnL: ${fmtPct(row.pnlPct)}`);
  }
  return lines.join('<br/>');
}

export default function MaCrossRuleCheckChart({ symbol, exchange, capital = 40, strategyId, tradeConfig }) {
  const [sinceInput, setSinceInput] = useState(defaultSinceInput(7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    if (!symbol) return;
    const since = localInputToISO(sinceInput);
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMultitradeBacktest({
        symbol, exchange, capital, strategyId, tradeConfig, since,
      });
      setData(result);
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, exchange, capital, strategyId, tradeConfig, sinceInput]);

  const option = useMemo(() => {
    if (!data) return null;

    const priceData = (data.priceSeries ?? []).map(p => [p.time, p.close]);

    const buckets = { allowed: [], trend: [], approach: [], other: [] };
    for (const row of data.entryLog ?? []) {
      buckets[bucketOutcome(row.outcome)].push({
        value: [row.timeISO ? new Date(row.timeISO).getTime() : row.time, row.price],
        row,
      });
    }

    const buys = (data.trades ?? []).filter(t => t.type === 'BUY');
    const sells = (data.trades ?? []).filter(t => t.type === 'SELL');

    const ruleSeries = Object.keys(buckets).map(key => ({
      name: BUCKET_LABEL[key],
      type: 'scatter',
      data: buckets[key],
      symbol: BUCKET_SYMBOL[key],
      symbolSize: 10,
      itemStyle: { color: BUCKET_COLOR[key], opacity: 0.9 },
      emphasis: { scale: 1.4 },
      z: 3,
    }));

    const tradeSeries = [
      {
        name: 'Compra executada',
        type: 'scatter',
        data: buys.map(t => ({ value: [t.time, t.price], row: t })),
        symbol: 'arrow',
        symbolSize: 13,
        itemStyle: { color: 'transparent', borderColor: TRADE_GOOD, borderWidth: 2 },
        z: 4,
      },
      {
        name: 'Venda executada',
        type: 'scatter',
        data: sells.map(t => ({
          value: [t.time, t.price],
          row: t,
        })),
        symbol: 'arrow',
        symbolRotate: 180,
        symbolSize: 13,
        itemStyle: { color: 'transparent', borderWidth: 2 },
        z: 4,
      },
    ];
    // itemStyle por ponto de venda (ganho = good, perda = critical)
    tradeSeries[1].data = tradeSeries[1].data.map(d => ({
      ...d,
      itemStyle: { color: 'transparent', borderColor: (d.row.pnlUsdt ?? 0) >= 0 ? TRADE_GOOD : TRADE_CRITICAL, borderWidth: 2 },
    }));

    return {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'monospace', color: '#c3c2b7' },
      grid: { left: 56, right: 16, top: 36, bottom: 60 },
      legend: {
        top: 0,
        textStyle: { color: '#c3c2b7', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 10,
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1a1a19',
        borderColor: '#383835',
        textStyle: { color: '#ffffff', fontSize: 11 },
        formatter: (p) => {
          const row = p.data?.row;
          if (!row) return '';
          if (row.type === 'BUY' || row.type === 'SELL') {
            return [
              `<b>${row.type === 'BUY' ? 'Compra' : 'Venda'}</b> ${fmtDateTime(row.time)}`,
              `preço: ${fmtPrice(row.price)}`,
              row.pnlPct != null ? `PnL: ${fmtPct(row.pnlPct)}` : null,
            ].filter(Boolean).join('<br/>');
          }
          return buildTooltip(row);
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#383835' } },
        axisLabel: {
          color: '#898781',
          fontSize: 10,
          hideOverlap: true,
          formatter: (v) => fmtDateTime(v),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { lineStyle: { color: '#383835' } },
        axisLabel: { color: '#898781', fontSize: 10, formatter: (v) => fmtPrice(v) },
        splitLine: { lineStyle: { color: '#2c2c2a' } },
      },
      series: [
        {
          name: 'Preço',
          type: 'line',
          data: priceData,
          showSymbol: false,
          lineStyle: { color: '#c3c2b7', width: 1 },
          z: 1,
        },
        ...ruleSeries,
        ...tradeSeries,
      ],
    };
  }, [data]);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: 'monospace', fontSize: 11 }}>
        <span style={{ color: '#898781' }}>Desde:</span>
        <input
          type="datetime-local"
          value={sinceInput}
          onChange={e => setSinceInput(e.target.value)}
          style={{
            background: '#111', color: '#c3c2b7', border: '1px solid #383835',
            borderRadius: 3, padding: '2px 4px', fontFamily: 'monospace', fontSize: 11,
          }}
        />
        <button
          type="button"
          onClick={run}
          disabled={loading || !symbol}
          style={{
            background: loading ? '#333' : '#1c5cab', color: '#fff', border: 'none',
            borderRadius: 3, padding: '3px 10px', cursor: loading ? 'default' : 'pointer',
            fontFamily: 'monospace', fontSize: 11,
          }}
        >
          {loading ? 'verificando…' : 'Verificar regras'}
        </button>
        {data?.summary && (
          <span style={{ color: '#898781' }}>
            {data.summary.entrySignals} cruzamento(s) · {data.summary.trades} trade(s) · PnL {fmtPct(data.summary.totalPnlPct)}
          </span>
        )}
      </div>

      {error && <div style={{ color: '#e66767', fontSize: 11, marginTop: 6, fontFamily: 'monospace' }}>{error}</div>}

      {option && (
        <div style={{ marginTop: 8, background: '#1a1a19', borderRadius: 4, border: '1px solid #2c2c2a' }}>
          <ReactECharts option={option} style={{ height: 340, width: '100%' }} notMerge lazyUpdate />
        </div>
      )}

      {!data && !loading && !error && (
        <div style={{ color: '#898781', fontSize: 11, marginTop: 6, fontFamily: 'monospace' }}>
          Escolha a data/hora inicial e clique em "Verificar regras" pra ver os pontos de cruzamento coloridos pela regra que bloqueou (ou permitiu) cada um.
        </div>
      )}
    </div>
  );
}
