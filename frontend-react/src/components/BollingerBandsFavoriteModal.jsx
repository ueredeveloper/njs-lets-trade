import { useCallback, useState } from 'react';
import {
  BOLLINGER_BANDS_DEFAULTS, normalizeBollingerBandsForm, bollingerBandsFormFromEntry, bollingerBandsFormToPayload,
} from '../constants/bollingerBandsConfigSchema';
import { MT_HELP } from '../constants/multitradeHelp';
import BollingerBandsStrategyForm from './BollingerBandsStrategyForm';

const BB_COLOR = '#f472b6';
const GATE_COLOR = '#0068ff';
const BINANCE_COLOR = '#f0b90b';

/**
 * Modal dedicado só ao bollinger-bands — mesmo padrão do VwapBandsFavoriteModal: symbol+
 * capital+BollingerBandsStrategyForm, criar ou editar um único favorito bollinger-bands por vez.
 */
export default function BollingerBandsFavoriteModal({
  symbol: initialSymbol, defaultExchange, currentEntry, onConfirm, onRemove, onCancel,
}) {
  const isEditing = !!currentEntry;
  const [symbol, setSymbol] = useState(initialSymbol ?? '');
  const [capital, setCapital] = useState(currentEntry?.capital ?? 40);
  const [enabled, setEnabled] = useState(currentEntry?.enabled !== false);
  const [form, setForm] = useState(() => (
    currentEntry ? bollingerBandsFormFromEntry(currentEntry) : normalizeBollingerBandsForm(BOLLINGER_BANDS_DEFAULTS)
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [exchange, setExchange] = useState(defaultExchange ?? currentEntry?.exchange ?? 'binance');

  const patch = useCallback((path, value) => {
    setForm(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }, []);

  async function handleSave() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) { setError('Informe o símbolo (ex.: BTCUSDT)'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = bollingerBandsFormToPayload(form, {
        symbol: sym,
        exchange,
        capital: Number(capital) || 40,
        strategyId: 'bollinger-bands',
        strategy_id: 'bollinger-bands',
        enabled,
        label: 'Bollinger Bands',
      });
      await onConfirm({ id: currentEntry?.id ?? null, payload });
    } catch (err) {
      setError(err.message ?? 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!currentEntry?.id) return;
    setSaving(true);
    try {
      await onRemove(currentEntry.id);
    } catch (err) {
      setError(err.message ?? 'Falha ao remover');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-4"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-lg p-4 space-y-4"
        style={{ background: '#12141c', border: '1px solid #2a2d3a' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold" style={{ color: BB_COLOR }}>
            {isEditing ? `Editar Bollinger Bands — ${symbol}` : 'Novo favorito Bollinger Bands'}
          </h3>
          <button type="button" onClick={onCancel} className="text-p5/40 hover:text-p5 text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-wrap gap-2 items-center text-xs text-p5">
          {isEditing ? (
            <span className="font-mono font-semibold">{symbol}</span>
          ) : (
            <input
              autoFocus
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Símbolo (ex.: BTCUSDT)"
              className="rounded px-2 py-1 text-xs font-mono outline-none"
              style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}
            />
          )}
          <span className="text-p5/50 ml-2">Capital</span>
          <input
            type="number" min={1} value={capital}
            onChange={(e) => setCapital(e.target.value)}
            className="w-20 rounded px-2 py-1 text-xs font-mono outline-none"
            style={{ background: '#1e2130', border: '1px solid #2a2d3a', color: '#e2e8f0' }}
          />
          <span className="text-p5/40">USDT</span>
          <label className="flex items-center gap-1 ml-2 text-p5/70">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-pink-400" />
            Habilitado
          </label>
          <label className="flex items-center gap-1 ml-2 text-p5/70" title="Pausa só novas entradas — posição já comprada continua sendo gerenciada/vendida normalmente">
            <input
              type="checkbox"
              checked={form.entry.enabled !== false}
              onChange={(e) => patch('entry.enabled', e.target.checked)}
              className="accent-pink-400"
            />
            Comprar
          </label>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-p5/50 mb-1.5" title={MT_HELP.shared.exchange}>Corretora</div>
          <div className="flex gap-2">
            {[{ id: 'gate', label: 'Gate.io', color: GATE_COLOR }, { id: 'binance', label: 'Binance', color: BINANCE_COLOR }].map(ex => (
              <button key={ex.id} type="button" onClick={() => setExchange(ex.id)}
                className="flex-1 py-1.5 text-xs rounded font-semibold"
                style={{
                  background: exchange === ex.id ? ex.color : 'transparent',
                  color: exchange === ex.id ? (ex.id === 'binance' ? '#000' : '#fff') : ex.color,
                  border: `1px solid ${ex.color}`, opacity: exchange === ex.id ? 1 : 0.55,
                }}>{ex.label}</button>
            ))}
          </div>
        </div>

        <BollingerBandsStrategyForm form={form} patch={patch} symbol={symbol.trim().toUpperCase()} exchange={exchange} />

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-3 py-1.5 text-xs rounded font-semibold text-p5/70 hover:text-p5">
            Cancelar
          </button>
          {isEditing && (
            <button type="button" onClick={handleRemove} disabled={saving}
              className="px-3 py-1.5 text-xs rounded font-semibold text-red-400 hover:bg-red-500/10">
              Remover
            </button>
          )}
          <button type="button" onClick={handleSave} disabled={saving || !symbol.trim()}
            className="px-3 py-1.5 text-xs rounded font-semibold text-white"
            style={{ background: BB_COLOR }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
