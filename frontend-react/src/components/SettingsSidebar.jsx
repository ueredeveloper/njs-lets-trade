import { useState } from 'react';

const PALETTES = [
  {
    id: 'default',
    name: 'Padrão',
    colors: { p1: '#260d33', p2: '#003f69', p3: '#106b87', p4: '#157a8c', p5: '#b3aca4' },
  },
  {
    id: 'palette1',
    name: 'Dark Green',
    colors: { p1: '#05110d', p2: '#0b1f17', p3: '#132e22', p4: '#00c076', p5: '#c8e6c9' },
  },
  {
    id: 'palette2',
    name: 'Deep Blue',
    colors: { p1: '#020a14', p2: '#071828', p3: '#0d2540', p4: '#38bdf8', p5: '#e2eeff' },
  },
  {
    id: 'palette3',
    name: 'Amber',
    colors: { p1: '#0e0a02', p2: '#1c1506', p3: '#2b200d', p4: '#fbbf24', p5: '#fef9ec' },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    colors: { p1: '#13131f', p2: '#1e1e2e', p3: '#2d2d44', p4: '#bd93f9', p5: '#f8f8f2' },
  },
  {
    id: 'nord',
    name: 'Nord',
    colors: { p1: '#141921', p2: '#1e242f', p3: '#2a3244', p4: '#88c0d0', p5: '#eceff4' },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    colors: { p1: '#14140f', p2: '#1e1e17', p3: '#2d2d24', p4: '#a6e22e', p5: '#f8f8f2' },
  },
  {
    id: 'tokyo',
    name: 'Tokyo Night',
    colors: { p1: '#0a0c16', p2: '#13152a', p3: '#1e2035', p4: '#7aa2f7', p5: '#c0caf5' },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    colors: { p1: '#0d0d17', p2: '#161622', p3: '#1e1e2e', p4: '#cba6f7', p5: '#cdd6f4' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    colors: { p1: '#100a15', p2: '#1e1020', p3: '#2e1a31', p4: '#fb923c', p5: '#fde8d0' },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    colors: { p1: '#110607', p2: '#1f0c0e', p3: '#2e1416', p4: '#f87171', p5: '#fde8e8' },
  },
  {
    id: 'slate',
    name: 'Slate',
    colors: { p1: '#0a0c0f', p2: '#131720', p3: '#1e2533', p4: '#94a3b8', p5: '#e2e8f0' },
  },
];

function applyPalette(colors) {
  const root = document.documentElement;
  root.style.setProperty('--color-p1', colors.p1);
  root.style.setProperty('--color-p2', colors.p2);
  root.style.setProperty('--color-p3', colors.p3);
  root.style.setProperty('--color-p4', colors.p4);
  root.style.setProperty('--color-p5', colors.p5);
  document.body.style.backgroundColor = colors.p1;
  window.dispatchEvent(new Event('palette-updated'));
}

export default function SettingsSidebar({ open, onClose }) {
  const [activeId, setActiveId] = useState('default');

  function selectPalette(palette) {
    setActiveId(palette.id);
    applyPalette(palette.colors);
  }

  return (
    <>
      {/* Overlay clicável para fechar */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Painel lateral */}
      <div
        className={`fixed top-0 right-0 h-full w-72 z-50 flex flex-col bg-p1 border-l border-p2 transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-p2 shrink-0">
          <span className="text-p5 text-xs font-semibold uppercase tracking-widest">
            Configurações
          </span>
          <button
            onClick={onClose}
            className="text-p5 hover:text-white p-1 rounded hover:bg-p2 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth="2" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="text-p5 text-xs uppercase tracking-widest opacity-50 mb-3">
            Paleta de cores
          </p>

          <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-120px)] pr-0.5">
            {PALETTES.map((palette) => {
              const isActive = activeId === palette.id;
              return (
                <button
                  key={palette.id}
                  onClick={() => selectPalette(palette)}
                  className={`flex flex-col gap-2 p-3 rounded border text-left transition-all ${
                    isActive
                      ? 'border-p4 bg-p2/60'
                      : 'border-p2/40 hover:border-p3 hover:bg-p2/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-p5 text-xs font-medium">{palette.name}</span>
                    {isActive && (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                        strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5 text-p4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                  {/* Swatches das 5 cores */}
                  <div className="flex gap-1.5">
                    {Object.values(palette.colors).map((color, i) => (
                      <div
                        key={i}
                        className="flex-1 h-5 rounded-sm border border-white/10"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
