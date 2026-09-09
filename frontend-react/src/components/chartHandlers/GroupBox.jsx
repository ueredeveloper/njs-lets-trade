import PanelTip from '../PanelTip';
import {
  PANEL_GAP, PANEL_TILE_PAD, SECTION_TITLE_ROWS,
  scaleFontSize, panelBtn, panelSelect, scaleSectionTitle,
} from '../../utils/chartPanelStyles';
import { groupBoxRowSpan } from '../../utils/chartHandlers/groupBoxLayout';
import { getEmaPersistCloudConfirmInterval } from '../../utils/uiPreferences';
import { PERM_CLOUD_TONES, PERM_TONE_SWATCH } from '../../utils/emaCrossPersistenceCloud';

/**
 * Células `kind:'custom'` específicas de um manipulador. O descriptor referencia por string
 * (`render:'permTones'`) porque descriptors.js é dado puro (sem JSX).
 */
const CUSTOM_CELLS = {
  // Swatches de tom da nuvem PERM — bolinhas coloridas liga/desliga.
  permTones(group, api, dims) {
    const tones = group.tones ?? {};
    const sz = Math.max(10, Math.min(18, dims.h - 4));
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', height: '100%', justifyContent: 'center' }}>
        {PERM_CLOUD_TONES.map((id) => {
          const on = tones[id] !== false;
          const color = PERM_TONE_SWATCH[id];
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              title={id}
              onClick={(e) => { e.stopPropagation(); api.update(group.id, { tones: { ...tones, [id]: !on } }); }}
              style={{
                width: sz, height: sz, padding: 0, borderRadius: '50%',
                border: on ? `2px solid ${color}` : '2px solid #334155',
                background: on ? color : 'transparent', opacity: on ? 1 : 0.35,
                cursor: 'pointer', boxSizing: 'border-box',
              }}
            />
          );
        })}
      </div>
    );
  },
  // Camadas da nuvem PERM (principal + confirmação + confirmação-da-confirmação) — rótulo = o
  // intervalo REAL que cada uma liga, derivado do intervalo principal.
  permLayers(group, api, dims) {
    const layers = group.layers ?? {};
    const iv = group.interval;
    const c1 = getEmaPersistCloudConfirmInterval(iv);
    const c2 = c1 ? getEmaPersistCloudConfirmInterval(c1) : null;
    const toggle = (key, cur) => api.update(group.id, { layers: { ...layers, [key]: !cur } });
    const btn = (key, label, on) => (
      <button
        key={key} type="button" aria-pressed={on}
        onClick={(e) => { e.stopPropagation(); toggle(key, on); }}
        style={{
          flex: 1, minWidth: 0, height: '100%', padding: 0, borderRadius: 4,
          border: on ? '1px solid #4ade80' : '1px solid #334155',
          background: on ? 'rgba(74,222,128,0.18)' : 'transparent',
          color: on ? '#4ade80' : '#64748b',
          fontSize: scaleFontSize({ w: 34, h: dims.h }, 0.28, 8, 11),
          fontFamily: 'monospace', cursor: 'pointer', boxSizing: 'border-box',
        }}
      >
        {label}
      </button>
    );
    return (
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 3, width: '100%', height: '100%' }}>
        {btn('layer1', iv, layers.layer1 !== false)}
        {c1 && btn('layer2', c1, layers.layer2 !== false)}
        {c2 && btn('layer3', c2, layers.layer3 === true)}
      </div>
    );
  },
};

/**
 * Caixa genérica de um manipulador de indicador no padrão Bollinger/EMA: label de título +
 * N grupos (cada um com ON, selects/params, botão ×) + botão "+ nome". Dirigida por um descriptor
 * (ver ../../utils/chartHandlers/descriptors.js). Modelado célula a célula em renderBollingerTile /
 * renderQuickEmaGroupsTile de CandlestickChart.jsx.
 */

/** t(key) que cai num fallback quando a chave i18n não existe (t devolve a própria key). */
function tip(t, key, fallback = '') {
  const v = t(key);
  return v === key ? fallback : v;
}

function GroupCell({ cell, group, color, dims, descriptor, api, t }) {
  const id = descriptor.id;

  if (cell.ref === 'remove') {
    return (
      <PanelTip text={tip(t, `chart.tip.${id}_remove`, 'Remover')}>
        <button
          type="button"
          onClick={() => api.remove(group.id)}
          style={{ ...panelBtn(false, '#f87171', false, dims), fontSize: 11 }}
        >
          ×
        </button>
      </PanelTip>
    );
  }

  if (cell.ref.startsWith('flag:')) {
    const key = cell.ref.slice(5);
    const fl = descriptor.flags.find((x) => x.key === key);
    const on = !!group[key];
    return (
      <PanelTip text={tip(t, `chart.tip.${id}_${key}`, fl?.label ?? key)}>
        <button
          type="button"
          onClick={() => api.toggleFlag(group.id, key)}
          style={panelBtn(on, fl?.color ?? color, false, dims)}
        >
          {fl?.label ?? key}
        </button>
      </PanelTip>
    );
  }

  if (cell.ref.startsWith('field:')) {
    const key = cell.ref.slice(6);
    const f = descriptor.fields.find((x) => x.key === key);
    if (!f) return null;
    if (f.kind === 'custom') {
      if (typeof f.render === 'string') {
        const fn = CUSTOM_CELLS[f.render];
        return fn ? fn(group, api, dims, color, t) : null;
      }
      return f.render ? f.render(group, api, dims, color, t) : null;
    }
    const numeric = Array.isArray(f.options) && f.options.every((o) => typeof o === 'number');
    return (
      <PanelTip text={tip(t, `chart.tip.${id}_${key}`, key)}>
        <select
          value={group[key]}
          onChange={(e) => api.update(group.id, { [key]: numeric ? Number(e.target.value) : e.target.value })}
          style={{ ...panelSelect(color, dims), fontSize: scaleFontSize(dims, 0.3, 9, 13) }}
        >
          {(f.options ?? []).map((o) => (
            <option key={String(o)} value={o}>{f.fmt ? f.fmt(o) : o}</option>
          ))}
        </select>
      </PanelTip>
    );
  }

  return null;
}

export default function GroupBox({ descriptor, api, dims, t }) {
  const { cols, rows, palette, color: baseColor, title, addLabel, max = 4 } = descriptor;
  const groups = api.groups ?? [];
  const innerW = dims.w - PANEL_TILE_PAD * 2;
  const innerH = dims.h - PANEL_TILE_PAD * 2;
  const totalRows = groupBoxRowSpan(descriptor, groups);
  const rowH = (innerH - (totalRows - 1) * PANEL_GAP) / totalRows;
  const colW = (innerW - (cols - 1) * PANEL_GAP) / cols;
  const cellDims = (span) => ({ w: colW * span + PANEL_GAP * (span - 1), h: rowH });
  const fullDims = { w: innerW, h: rowH };
  const perGroup = rows.length;

  const cells = groups.flatMap((g, gi) => {
    const color = palette?.[gi % palette.length] ?? baseColor;
    const out = [];
    rows.forEach((row, ri) => {
      const gridRow = SECTION_TITLE_ROWS + gi * perGroup + ri + 1;
      let col = 1;
      for (const cell of row) {
        const span = cell.span ?? 1;
        out.push(
          <div
            key={`${g.id}-${ri}-${col}`}
            style={{ gridColumn: `${col} / span ${span}`, gridRow: `${gridRow}`, display: 'flex', alignItems: 'stretch' }}
          >
            <GroupCell cell={cell} group={g} color={color} dims={cellDims(span)} descriptor={descriptor} api={api} t={t} />
          </div>,
        );
        col += span;
      }
    });
    return out;
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${totalRows}, 1fr)`,
      gap: PANEL_GAP,
      width: innerW,
      height: innerH,
      boxSizing: 'border-box',
    }}
    >
      <div style={{ gridColumn: `1 / span ${cols}`, gridRow: '1', ...scaleSectionTitle(fullDims) }}>
        {title}
      </div>
      {cells}
      {groups.length < max && (
        <div style={{ gridColumn: `1 / span ${cols}`, gridRow: `${totalRows}`, display: 'flex', alignItems: 'stretch' }}>
          <PanelTip text={tip(t, `chart.tip.${descriptor.id}_add`, addLabel)}>
            <button type="button" onClick={() => api.add()} style={panelBtn(false, '#94a3b8', false, fullDims)}>
              {addLabel}
            </button>
          </PanelTip>
        </div>
      )}
    </div>
  );
}
