// Mini-desenho (SVG) de cada padrão de ALTA de candle — Configurações → Price action. Os candles são
// ilustrativos (o/h/l/c numa escala livre, normalizada por padrão); o último é o candle do sinal.
const PATTERNS = {
  hammer: [
    { o: 82, h: 84, l: 72, c: 74 },
    { o: 74, h: 76, l: 64, c: 66 },
    { o: 60, h: 63, l: 42, c: 62 },
  ],
  'morning star': [
    { o: 82, h: 84, l: 60, c: 62 },
    { o: 58, h: 60, l: 54, c: 57 },
    { o: 59, h: 78, l: 58, c: 77 },
  ],
  'three white soldiers': [
    { o: 50, h: 62, l: 49, c: 61 },
    { o: 57, h: 70, l: 56, c: 69 },
    { o: 65, h: 79, l: 64, c: 78 },
  ],
  'bullish engulfing': [
    { o: 76, h: 78, l: 68, c: 70 },
    { o: 70, h: 72, l: 62, c: 64 },
    { o: 62, h: 80, l: 60, c: 78 },
  ],
  'piercing line': [
    { o: 82, h: 84, l: 74, c: 76 },
    { o: 76, h: 78, l: 60, c: 62 },
    { o: 58, h: 74, l: 57, c: 72 },
  ],
  'tweezer bottom': [
    { o: 80, h: 82, l: 70, c: 72 },
    { o: 72, h: 74, l: 54, c: 58 },
    { o: 60, h: 72, l: 54, c: 70 },
  ],
  'bullish marubozu': [
    { o: 60, h: 64, l: 56, c: 58 },
    { o: 58, h: 62, l: 55, c: 60 },
    { o: 58, h: 82, l: 58, c: 82 },
  ],
};

const W = 54;
const H = 40;
const PAD = 3;

export default function CandlePatternIcon({ pattern, className = '' }) {
  const cs = PATTERNS[pattern];
  if (!cs) return null;
  const lo = Math.min(...cs.map((c) => c.l));
  const hi = Math.max(...cs.map((c) => c.h));
  const y = (p) => PAD + (H - 2 * PAD) * (1 - (p - lo) / (hi - lo || 1));
  const step = W / cs.length;
  const bw = Math.min(9, step * 0.55);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={`shrink-0 rounded bg-black/20 ${className}`} aria-hidden="true">
      {cs.map((c, i) => {
        const x = step * i + step / 2;
        const color = c.c >= c.o ? '#22c55e' : '#ef4444';
        const top = y(Math.max(c.o, c.c));
        const bot = y(Math.min(c.o, c.c));
        const last = i === cs.length - 1;
        return (
          <g key={i} opacity={last ? 1 : 0.55}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="1.2" />
            <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1.2, bot - top)} fill={color} rx="0.8" />
          </g>
        );
      })}
    </svg>
  );
}
