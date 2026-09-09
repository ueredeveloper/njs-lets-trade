import PanelTip from '../PanelTip';
import {
  CARD_CONTROL_H,
  panelCard, cardHeader, cardTitle, cardSectionLabel,
  cardOnBtn, cardCloseBtn, cardAddBtn, toggleGroup, toggleBtn, cardSelect,
} from '../../utils/chartPanelStyles';
import { getEmaPersistCloudConfirmInterval } from '../../utils/uiPreferences';
import { PERM_CLOUD_TONES, PERM_TONE_SWATCH } from '../../utils/emaCrossPersistenceCloud';

/**
 * Manipulador de indicador no padrão CARD (mock "Painel Indicadores Nano"): cabeçalho (título +
 * ON + ×) / corpo (grade de selects + clusters de toggle) / rodapé "+ nome" tracejado. Dirigido
 * por um descriptor de dados puro (../../utils/chartHandlers/descriptors.js): `rows` continua
 * sendo a dica de layout do corpo, mas agora renderiza em flex de altura natural (sem `dims`).
 *
 * - single-instance (descriptor.max === 1): ON + × ficam no cabeçalho, agindo em groups[0].
 * - multi-instance (só S/R, max 4): cada grupo é um sub-bloco com mini-cabeçalho próprio
 *   (chip de cor + ON + ×); o cabeçalho do card mostra só o título + contador n/max.
 *
 * Contrato de `api` (de useGroupedHandlers.js): { groups, add(), remove(id), update(id, patch),
 * toggleFlag(id, key) }.
 */

/** t(key) que cai num fallback quando a chave i18n não existe (t devolve a própria key). */
function tip(t, key, fallback = '') {
  const v = t(key);
  return v === key ? fallback : v;
}

/**
 * Células `kind:'custom'` específicas de um manipulador. O descriptor referencia por string
 * (`render:'permTones'`) porque descriptors.js é dado puro (sem JSX).
 */
const CUSTOM_CELLS = {
  // Swatches de tom da nuvem PERM — bolinhas coloridas liga/desliga.
  permTones(group, api) {
    const tones = group.tones ?? {};
    const sz = 14;
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
                border: on ? `2px solid ${color}` : '2px solid var(--color-pnl-border-2)',
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
  permLayers(group, api) {
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
          flex: 1, minWidth: 0, height: CARD_CONTROL_H, padding: 0, borderRadius: 3,
          border: on ? '1px solid var(--color-pnl-on)' : '1px solid var(--color-pnl-border-2)',
          background: on ? 'var(--color-pnl-toggle)' : 'transparent',
          color: on ? 'var(--color-pnl-on)' : 'var(--color-pnl-muted)',
          fontSize: 10, fontFamily: 'monospace', cursor: 'pointer', boxSizing: 'border-box',
        }}
      >
        {label}
      </button>
    );
    return (
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 3, width: '100%' }}>
        {btn('layer1', iv, layers.layer1 !== false)}
        {c1 && btn('layer2', c1, layers.layer2 !== false)}
        {c2 && btn('layer3', c2, layers.layer3 === true)}
      </div>
    );
  },
};

/** Renderiza uma célula de `field:*` (select ou custom). Não trata `remove`/`flag:enabled` —
 *  esses vão pro cabeçalho e são filtrados antes de chegar aqui. */
function FieldCell({ cell, group, color, descriptor, api, t }) {
  const id = descriptor.id;

  if (cell.ref.startsWith('flag:')) {
    const key = cell.ref.slice(5);
    const fl = descriptor.flags.find((x) => x.key === key);
    const on = !!group[key];
    return (
      <PanelTip text={tip(t, `chart.tip.${id}_${key}`, fl?.label ?? key)}>
        <button type="button" onClick={() => api.toggleFlag(group.id, key)} style={toggleBtn(on, fl?.color ?? color)}>
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
      const fn = typeof f.render === 'string' ? CUSTOM_CELLS[f.render] : f.render;
      return fn ? fn(group, api, color, t) : null;
    }
    const numeric = Array.isArray(f.options) && f.options.every((o) => typeof o === 'number');
    return (
      <PanelTip text={tip(t, `chart.tip.${id}_${key}`, key)}>
        <select
          value={group[key]}
          onChange={(e) => api.update(group.id, { [key]: numeric ? Number(e.target.value) : e.target.value })}
          style={cardSelect(color)}
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

/** Corpo = as `descriptor.rows` sem as células `remove` / `flag:enabled` (que foram pro
 *  cabeçalho). Cada row vira um flex; cada célula ganha `flex: span`. Rows vazias somem. */
function GroupBody({ descriptor, group, color, api, t }) {
  const rows = descriptor.rows
    .map((row) => row.filter((c) => c.ref !== 'remove' && c.ref !== 'flag:enabled'))
    .filter((row) => row.length > 0);
  if (!rows.length) return null;
  return (
    <>
      {rows.map((row, ri) => (
        <div key={ri} style={toggleGroup()}>
          {row.map((cell, ci) => (
            <div key={ci} style={{ flex: cell.span ?? 1, minWidth: 0, display: 'flex', alignItems: 'stretch' }}>
              <FieldCell cell={cell} group={group} color={color} descriptor={descriptor} api={api} t={t} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** ON + × — no cabeçalho (single-instance) ou no mini-cabeçalho de cada grupo (multi). */
function GroupControls({ descriptor, group, api, t }) {
  const id = descriptor.id;
  return (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
      <PanelTip text={tip(t, `chart.tip.${id}_enabled`, group.enabled ? 'Desligar' : 'Ligar')}>
        <button type="button" onClick={() => api.toggleFlag(group.id, 'enabled')} style={cardOnBtn(!!group.enabled)}>
          ON
        </button>
      </PanelTip>
      <PanelTip text={tip(t, `chart.tip.${id}_remove`, 'Remover')}>
        <button type="button" onClick={() => api.remove(group.id)} style={cardCloseBtn()}>×</button>
      </PanelTip>
    </div>
  );
}

export default function GroupBox({ descriptor, api, t }) {
  const { palette, color: baseColor, title, addLabel, max = 4 } = descriptor;
  const groups = api.groups ?? [];
  const multi = max > 1;
  const canAdd = groups.length < max;

  const addBtn = canAdd && (
    <PanelTip text={tip(t, `chart.tip.${descriptor.id}_add`, addLabel)}>
      <button type="button" onClick={() => api.add()} style={cardAddBtn()}>{addLabel}</button>
    </PanelTip>
  );

  // ── Single-instance: ON/× no cabeçalho, corpo = groups[0] ──
  if (!multi) {
    const g = groups[0];
    return (
      <div style={panelCard()}>
        <div style={cardHeader()}>
          <span style={cardTitle()}>{title}</span>
          {g && <GroupControls descriptor={descriptor} group={g} api={api} t={t} />}
        </div>
        {g && <GroupBody descriptor={descriptor} group={g} color={baseColor} api={api} t={t} />}
        {addBtn}
      </div>
    );
  }

  // ── Multi-instance (S/R): sub-bloco por grupo ──
  return (
    <div style={panelCard()}>
      <div style={cardHeader()}>
        <span style={cardTitle()}>{title}</span>
        <span style={cardSectionLabel()}>{groups.length}/{max}</span>
      </div>
      {groups.map((g, gi) => {
        const color = palette?.[gi % palette.length] ?? baseColor;
        return (
          <div
            key={g.id}
            style={{
              border: '1px solid var(--color-pnl-border)',
              borderRadius: 4,
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              <GroupControls descriptor={descriptor} group={g} api={api} t={t} />
            </div>
            <GroupBody descriptor={descriptor} group={g} color={color} api={api} t={t} />
          </div>
        );
      })}
      {addBtn}
    </div>
  );
}
