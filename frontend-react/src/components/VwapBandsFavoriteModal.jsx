import { useCallback, useState } from 'react';
import {
  VWAP_BANDS_DEFAULTS, normalizeVwapBandsForm, vwapBandsFormFromEntry, vwapBandsFormToPayload,
} from '../constants/vwapBandsConfigSchema';
import VwapBandsStrategyForm from './VwapBandsStrategyForm';

const VWAP_COLOR = '#a78bfa';

/**
 * Modal dedicado só ao vwap-bands — sem abas de outras estratégias. O MultitradeModal
 * (ma-cross/swing/amap) é "dual strategy" de propósito (um símbolo pode rodar duas
 * estratégias em paralelo), mas isso deixa o formulário do vwap-bands escondido atrás de
 * uma aba e junto de campos que não fazem sentido pra ele. Aqui é só symbol+capital+
 * VwapBandsStrategyForm — criar ou editar um único favorito vwap-bands por vez.
 */
export default function VwapBandsFavoriteModal({
  symbol: initialSymbol, defaultExchange, currentEntry, onConfirm, onRemove, onCancel,
}) {
  const isEditing = !!currentEntry;
  const [symbol, setSymbol] = useState(initialSymbol ?? '');
  const [capital, setCapital] = useState(currentEntry?.capital ?? 40);
  const [enabled, setEnabled] = useState(currentEntry?.enabled !== false);
  const [form, setForm] = useState(() => (
    currentEntry ? vwapBandsFormFromEntry(currentEntry) : normalizeVwapBandsForm(VWAP_BANDS_DEFAULTS)
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const exchange = defaultExchange ?? currentEntry?.exchange ?? 'binance';

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
      const payload = vwapBandsFormToPayload(form, {
        symbol: sym,
        exchange,
        capital: Number(capital) || 40,
        strategyId: 'vwap-bands',
        strategy_id: 'vwap-bands',
        enabled,
        label: 'VWAP Bands',
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
          <h3 className="text-sm font-bold" style={{ color: VWAP_COLOR }}>
            {isEditing ? `Editar VWAP Bands — ${symbol}` : 'Novo favorito VWAP Bands'}
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
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-purple-400" />
            Habilitado
          </label>
        </div>

        <VwapBandsStrategyForm form={form} patch={patch} symbol={symbol.trim().toUpperCase()} />

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
            style={{ background: VWAP_COLOR }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
