/**
 * Rótulo com ícone ⓘ e tooltip nativo (funciona dentro de overflow-y-auto).
 * FieldHint = texto visível abaixo do campo.
 */
export function FieldLabel({ label, hint, className = 'text-[10px] uppercase tracking-wider text-p5/50', style, as: Tag = 'span' }) {
  if (!hint) {
    return <Tag className={className} style={style}>{label}</Tag>;
  }
  return (
    <Tag className={`${className} inline-flex items-center gap-1 cursor-help`} style={style} title={hint}>
      {label}
      <span className="text-p5/25 text-[10px] leading-none select-none" aria-hidden>ⓘ</span>
    </Tag>
  );
}

export function FieldHint({ children, className = '' }) {
  if (!children) return null;
  return (
    <p className={`text-[9px] text-p5/40 leading-relaxed ${className}`}>{children}</p>
  );
}
