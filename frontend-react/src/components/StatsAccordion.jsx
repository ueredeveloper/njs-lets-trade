import { useState } from 'react';

/**
 * Acordeão simples usado nos blocos da aba Estatísticas → Momentum RSI (gráfico "Sinais por
 * faixa da nuvem D-1", tabela "Volume 24h × resultado"). Cabeçalho clicável com seta ▶/▼;
 * conteúdo só monta quando aberto. `title` pode ser texto ou nós (ex.: título + tags extras).
 */
export default function StatsAccordion({ title, titleAttr, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md" style={{ background: '#0f1219', border: '1px solid #2a2d3a' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={titleAttr}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-p5/70 text-[10px] font-semibold uppercase tracking-wider hover:text-p5"
      >
        <span className="text-p5/40">{open ? '▼' : '▶'}</span>
        {title}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}
