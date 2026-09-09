/**
 * Paletas de cor do site. Extraído de SettingsSidebar.jsx pra poder ser importado também por
 * main.jsx (aplicar antes do primeiro paint), CurrencyContext e uiPreferences.
 *
 * Cada entrada tem:
 *   colors  → p1..p5  — chrome do app inteiro (classes Tailwind bg-p* / text-p* / border-p*,
 *                       ~1200 usos) + fundo do body.
 *   panel   → 12 roles do painel de indicadores do gráfico, escritos como --color-pnl-*
 *                       (o painel usa inline style, não classe Tailwind).
 *
 * `applyPalette(entry)` escreve os dois conjuntos em :root, ajusta o fundo do body e dispara o
 * evento 'palette-updated' — os gráficos relêem --color-p* nesse evento (ver CandlestickChart,
 * RsiChart, SrZoneChart, Rsi1hBreakdownChart).
 *
 * REGRA: o painel segue SEMPRE a paleta ativa. Não hardcodar cor de uma paleta enquanto outra
 * está ativa. As cores de IDENTIDADE (qual linha no gráfico — chip S/R, período EMA, grupo BB)
 * ficam nos componentes e não passam por aqui: são "qual série", não chrome.
 */

/** Trio de acento pra paletas escuras (neon) e claras (saturado, contraste em fundo claro). */
const DARK_ACCENTS = { on: '#4ade80', danger: '#f87171', warn: '#facc15' };
const LIGHT_ACCENTS = { on: '#16a34a', danger: '#dc2626', warn: '#ca8a04' };

/** Painel de uma paleta escura, derivado de p1..p5 + trio neon. `muted` = p5 a ~60%. */
function darkPanel({ p1, p2, p3, p4, p5 }) {
  return {
    bg: p1, card: p2, input: p2, border: p3, 'border-2': p4,
    accent: p4, text: p5, muted: `${p5}99`, toggle: p3, ...DARK_ACCENTS,
  };
}

/** Painel de uma paleta clara — mesmo mapa, `muted` = p3 (o cinza médio). */
function lightPanel({ p1, p2, p3, p4, p5 }) {
  return {
    bg: p1, card: p2, input: p2, border: p3, 'border-2': p4,
    accent: p4, text: p5, muted: p3, toggle: p3, ...LIGHT_ACCENTS,
  };
}

const DEFAULT_COLORS = { p1: '#260d33', p2: '#003f69', p3: '#106b87', p4: '#157a8c', p5: '#b3aca4' };
const DRACULA_COLORS = { p1: '#13131f', p2: '#1e1e2e', p3: '#2d2d44', p4: '#bd93f9', p5: '#f8f8f2' };
const TOKYO_COLORS   = { p1: '#0a0c16', p2: '#13152a', p3: '#1e2035', p4: '#7aa2f7', p5: '#c0caf5' };
const LIGHT_COLORS   = { p1: '#f1f5f9', p2: '#dde3ec', p3: '#94a3b8', p4: '#0369a1', p5: '#0f172a' };
const WARM_COLORS    = { p1: '#faf7f2', p2: '#ede8df', p3: '#a8a29e', p4: '#b45309', p5: '#1c1917' };
const CYBER_COLORS   = { p1: '#060a0f', p2: '#0b121b', p3: '#1e2d40', p4: '#00d2ff', p5: '#d1d8e0' };

export const PALETTES = [
  { id: 'default',    name: 'Padrão / Default',        colors: DEFAULT_COLORS, panel: darkPanel(DEFAULT_COLORS) },
  { id: 'dracula',    name: 'Dracula',                 colors: DRACULA_COLORS, panel: darkPanel(DRACULA_COLORS) },
  { id: 'tokyo',      name: 'Tokyo Night',             colors: TOKYO_COLORS,   panel: darkPanel(TOKYO_COLORS) },
  { id: 'light',      name: 'Claro / Light',           colors: LIGHT_COLORS,   panel: lightPanel(LIGHT_COLORS) },
  { id: 'light-warm', name: 'Claro Quente / Warm Light', colors: WARM_COLORS,  panel: lightPanel(WARM_COLORS) },
  {
    id: 'cyberpunk', name: 'Cyberpunk',
    colors: CYBER_COLORS,
    // Espec. do mock "Painel Indicadores Nano" — valores explícitos (não derivados).
    panel: {
      bg: '#060a0f', card: '#0b121b', input: '#101824', border: '#162232', 'border-2': '#1e2d40',
      accent: '#00d2ff', on: '#00e676', danger: '#ff4d4d', warn: '#ffb703',
      text: '#d1d8e0', muted: '#7a8b9e', toggle: '#162436',
    },
  },
];

/** Roles do painel — mesma ordem escrita como --color-pnl-<role>. Referência p/ index.css. */
export const PANEL_ROLES = [
  'bg', 'card', 'input', 'border', 'border-2', 'accent', 'on', 'danger', 'warn', 'text', 'muted', 'toggle',
];

export const DEFAULT_PALETTE_ID = 'default';
export const PALETTE_IDS = PALETTES.map((p) => p.id);

export function getPalette(id) {
  return PALETTES.find((p) => p.id === id)
    ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE_ID);
}

/** Escreve uma entrada de paleta em :root. Aceita a entrada inteira ({colors, panel}). */
export function applyPalette(entry) {
  const p = (entry && entry.colors) ? entry : getPalette(DEFAULT_PALETTE_ID);
  const root = document.documentElement;
  Object.entries(p.colors).forEach(([k, v]) => root.style.setProperty(`--color-${k}`, v));
  const panel = p.panel ?? {};
  PANEL_ROLES.forEach((role) => {
    if (panel[role]) root.style.setProperty(`--color-pnl-${role}`, panel[role]);
  });
  document.body.style.backgroundColor = p.colors.p1;
  window.dispatchEvent(new Event('palette-updated'));
}

export function applyPaletteById(id) {
  applyPalette(getPalette(id));
}
