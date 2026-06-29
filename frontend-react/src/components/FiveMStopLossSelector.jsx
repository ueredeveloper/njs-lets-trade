import Tooltip from './Tooltip';
import {
  getStopLossOptions,
  initialStopLossTypes,
  toggleStopType,
  stopOptionAvailable,
  stopOptionDetail,
} from '../constants/fiveMStopLoss';

export const STOP_COLOR = '#f87171';
export { initialStopLossTypes, toggleStopType, stopOptionAvailable };

export default function FiveMStopLossSelector({ stop, loading, rsiBuy, value, onChange, stale }) {
  const selected = Array.isArray(value) ? value : [];
  const showLoadingBanner = loading && !stop?.fixed2?.ok && !stop?.hist?.ok;

  if (showLoadingBanner) {
    return <p className="text-[9px] text-p5/40 font-mono mt-1">Calculando stops…</p>;
  }

  const hasCalc = !!stop && !stop.loading && !stop.error;
  const options = getStopLossOptions(Number(rsiBuy));
  const recommended = stop?.recommended;
  const calcRsi = Number(stop?.rsiBuy ?? stop?.hist?.rsiBuy);
  const rsiMismatch = hasCalc && Number.isFinite(calcRsi) && calcRsi !== Number(rsiBuy);

  return (
    <div className="space-y-2">
      <p className="text-[9px] text-p5/50 leading-relaxed">
        Escolha uma ou mais regras — o bot vende se <strong className="text-p5/70">qualquer</strong> stop for atingido.
        O histórico usa o <strong className="text-p5/70">RSI de compra atual</strong> (agora &lt;{rsiBuy}).
        {!hasCalc && ' Clique em Sugerir.'}
        {(stale || rsiMismatch || loading) && (
          <span className="block text-amber-500/85 mt-0.5">
            {loading ? 'Calculando…' : 'Desatualizado — clique Sugerir.'}
          </span>
        )}
        {recommended && hasCalc && !rsiMismatch && (
          <span className="block text-amber-500/90 mt-0.5">
            Sugestão: {options.find(o => o.type === recommended)?.label ?? recommended}
          </span>
        )}
      </p>
      {options.map(opt => {
        const active    = selected.includes(opt.type);
        const available = stopOptionAvailable(opt.type, stop, rsiBuy);
        const detail    = stopOptionDetail(opt.type, stop, rsiBuy);
        const isRec     = recommended === opt.type && available;

        return (
          <label
            key={opt.type}
            className={`flex items-start gap-2 rounded px-2 py-2 transition-colors ${
              available ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-45'
            }`}
            style={{
              background: active ? `${STOP_COLOR}14` : '#1e2130',
              border: `1px solid ${active ? STOP_COLOR : isRec ? '#f59e0b55' : '#2a2d3a'}`,
            }}
          >
            <input
              type="checkbox"
              checked={active}
              disabled={!available}
              onChange={() => onChange(toggleStopType(selected, opt.type))}
              className="mt-0.5 shrink-0"
              style={{ accentColor: STOP_COLOR }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Tooltip text={opt.tooltip} maxW={300}>
                  <span
                    className="text-[9px] font-semibold underline decoration-dotted decoration-p5/30 underline-offset-2"
                    style={{ color: active ? STOP_COLOR : '#94a3b8' }}
                  >
                    {opt.label}
                  </span>
                </Tooltip>
                {isRec && (
                  <span className="text-[8px] px-1 rounded font-medium"
                    style={{ background: '#f59e0b22', color: '#f59e0b' }}>
                    sugerido
                  </span>
                )}
              </div>
              <p className="text-[9px] text-p5/55 leading-relaxed mt-0.5">{opt.summary}</p>
              {detail && (
                <p className="text-[9px] font-mono leading-relaxed mt-0.5"
                  style={{ color: available ? '#94a3b8' : '#4b5563' }}>
                  {detail}
                </p>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
