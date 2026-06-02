import { useState, useEffect } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchRsiOversoldRecovery, fetchCandlesticksAndCloud } from '../services/api';

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];

const TABS = [{ id: 'rsi', label: 'RSI' }];

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function SummaryCard({ label, value, highlight }) {
  return (
    <div className="flex flex-col items-center justify-center bg-p2/50 border border-p3/20 rounded px-0.5 py-px sm:px-2 sm:py-1.5 min-w-[38px] sm:min-w-[80px]">
      <span className={`text-[8px] sm:text-xs font-bold ${highlight ?? 'text-p5'}`}>{value}</span>
      <span className="text-[6px] sm:text-[9px] text-p5/50 text-center leading-tight">{label}</span>
    </div>
  );
}

function RsiStats() {
  const { selectedChart, setSelectedChart } = useCurrency();
  const [symbol, setSymbol]         = useState(selectedChart?.symbol || 'BTCUSDT');
  const [interval, setInterval]     = useState('30m');
  const [oversold, setOversold]     = useState(30);
  const [overbought, setOverbought] = useState(70);
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState(null);

  const inp = 'bg-p2 border border-p3/40 text-p5 text-[11px] sm:text-xs rounded px-2 py-1 focus:outline-none focus:border-p4 w-full';

  async function handleSearch(overrideSymbol, updateChart = false) {
    const sym = (overrideSymbol ?? symbol).trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchRsiOversoldRecovery(sym, interval, oversold, overbought);
      setResult(data);
      if (updateChart) {
        const chartData = await fetchCandlesticksAndCloud(sym, interval);
        setSelectedChart(chartData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedChart?.symbol) {
      setSymbol(selectedChart.symbol);
      handleSearch(selectedChart.symbol, false);
    }
  }, [selectedChart?.symbol]);

  useEffect(() => {
    if (selectedChart?.interval) {
      setInterval(selectedChart.interval);
    }
  }, [selectedChart?.interval]);

  useEffect(() => { handleSearch(); }, []);

  return (
    <div className="flex flex-col md:flex-row gap-3 w-full">

      {/* Formulário */}
      <div className="flex flex-col gap-1.5 w-full md:w-72 md:shrink-0">

        {/* Símbolo */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <label className="text-[9px] text-p5/50 uppercase tracking-wider">Símbolo</label>
            {selectedChart?.symbol === symbol && (
              <span className="text-[8px] text-p4/70 italic">tabela</span>
            )}
          </div>
          <input
            className={inp}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="BTCUSDT"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(undefined, true)}
          />
        </div>

        {/* Intervalo + Sobrv + Sobrcp + Botão */}
        <div className="flex items-end gap-1.5">
          <div className="flex flex-col gap-0.5 flex-1">
            <label className="text-[9px] text-p5/50 uppercase tracking-wider">Intervalo</label>
            <select className={inp} value={interval} onChange={(e) => setInterval(e.target.value)}>
              {INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <label className="text-[9px] text-p5/50 uppercase tracking-wider">Sobrv.</label>
            <input className={inp} type="number" min={1} max={99}
              value={oversold} onChange={(e) => setOversold(Number(e.target.value))} />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <label className="text-[9px] text-p5/50 uppercase tracking-wider">Sobrcp.</label>
            <input className={inp} type="number" min={1} max={99}
              value={overbought} onChange={(e) => setOverbought(Number(e.target.value))} />
          </div>
          <button
            onClick={() => handleSearch(undefined, true)}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 flex-1 py-1 rounded text-[11px] text-white bg-p3 hover:bg-p4 transition-colors disabled:opacity-50"
          >
            {loading
              ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                  strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
            }
            Buscar
          </button>
        </div>
      </div>

      {/* Resultados */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">

        {error && (
          <p className="text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            {/* Cartões de resumo */}
            <div className="flex gap-1.5 flex-wrap justify-center shrink-0">
              <SummaryCard label="Candles" value={result.totalCandles} />
              <SummaryCard label="Períodos RSI" value={result.totalRsiPeriods} />
              <SummaryCard label="Ocorrências" value={result.totalOccurrences} highlight="text-p4" />
              <SummaryCard
                label="Valor. média"
                value={`${result.avgAppreciationPercent > 0 ? '+' : ''}${result.avgAppreciationPercent}%`}
                highlight={result.avgAppreciationPercent >= 0 ? 'text-green-400' : 'text-red-400'}
              />
              <SummaryCard label="RSI entrada" value={`< ${result.oversoldThreshold}`} />
              <SummaryCard label="RSI saída"   value={`> ${result.overboughtThreshold}`} />
            </div>

            {/* Tabela */}
            {result.occurrences.length === 0 && !result.openOccurrence ? (
              <p className="text-[11px] text-p5/50">Nenhum ciclo encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-p1">
                    <tr className="text-[9px] sm:text-[10px] text-p5/40 uppercase tracking-wider border-b border-p3/20">
                      <th className="text-left pb-1 pr-2">#</th>
                      <th className="text-left pb-1 pr-2">Início</th>
                      <th className="text-right pb-1 pr-2">P. entrada</th>
                      <th className="text-right pb-1 pr-2">RSI</th>
                      <th className="text-right pb-1 pr-2">RSI 4h</th>
                      <th className="text-right pb-1 pr-2">RSI 8h</th>
                      <th className="text-left pb-1 pr-2">Fim</th>
                      <th className="text-right pb-1 pr-2">P. saída</th>
                      <th className="text-right pb-1 pr-2">RSI</th>
                      <th className="text-right pb-1">Valor.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.occurrences.map((o, i) => {
                      const pos = o.appreciationPercent >= 0;
                      return (
                        <tr key={i} className="border-b border-p3/10 hover:bg-p2/40 transition-colors">
                          <td className="py-0.5 pr-2 text-[10px] text-p5/40">{i + 1}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.startDate)}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-yellow-400">{o.entryRsi}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-orange-400">{o.entryRsi4h ?? '—'}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-amber-600">{o.entryRsi8h ?? '—'}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap">{formatDate(o.endDate)}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right font-mono">${o.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                          <td className="py-0.5 pr-2 text-[10px] sm:text-xs text-right text-yellow-400">{o.exitRsi}</td>
                          <td className={`py-0.5 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-400' : 'text-red-400'}`}>
                            {pos ? '+' : ''}{o.appreciationPercent}%
                          </td>
                        </tr>
                      );
                    })}

                    {/* Ciclo aberto — RSI cruzou oversold mas ainda não atingiu overbought */}
                    {result.openOccurrence && (() => {
                      const o   = result.openOccurrence;
                      const pos = o.appreciationPercent >= 0;
                      return (
                        <tr className="border-t-2 border-amber-500/40 bg-amber-500/5">
                          <td className="py-1 pr-2 text-[10px] text-amber-400/70">↓</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs font-mono whitespace-nowrap text-amber-300">{formatDate(o.startDate)}</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs text-right font-mono text-amber-300">${o.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-yellow-400 font-bold">{o.entryRsi}</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-orange-400">{o.entryRsi4h ?? '—'}</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-amber-600">{o.entryRsi8h ?? '—'}</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs whitespace-nowrap text-amber-400/60 italic">em aberto</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                          <td className="py-1 pr-2 text-[10px] sm:text-xs text-right text-p5/30">—</td>
                          <td className={`py-1 text-[10px] sm:text-xs text-right font-bold ${pos ? 'text-green-400' : 'text-red-400'}`}>
                            {pos ? '+' : ''}{o.appreciationPercent}%
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="text-[11px] text-p5/30 italic">Configure os parâmetros e clique em Buscar.</p>
        )}
      </div>
    </div>
  );
}

export default function StatisticsPanel() {
  const [activeTab, setActiveTab] = useState('rsi');

  return (
    <div className="flex flex-col h-full">

      {/* Abas */}
      <div className="flex gap-1 border-b border-p3/20 px-4 pt-3 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs rounded-t transition-colors ${
              activeTab === tab.id ? 'bg-p3 text-white' : 'text-p5/60 hover:text-p5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 pb-3 pt-2">
        {activeTab === 'rsi' && <RsiStats />}
      </div>
    </div>
  );
}
