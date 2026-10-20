import type { CSSProperties } from 'react';
import type { Kind } from '../domain/crew';

export const kindColour = (k: Kind | null | undefined) => (k ? `var(--kind-${k})` : 'var(--kind-other)');

/**
 * A ring of segments from 12 o'clock, clockwise: one per set (a kind each), out of `total` (more than that, and the ring is full,
 * shared out between them). `draw`: the segments draw in, one after another (social.css; nothing under reduced motion).
 * Decorative: whatever shows it says the same in words.
 */
export function Ring({ segs, total, size, width, gap = 3.2, track = 'var(--fill)', draw, className, colours, merge }: {
  segs: (Kind | null)[]; total: number; size: number; width: number; gap?: number; track?: string | null; draw?: boolean; className?: string;
  /** A colour per segment, in place of its kind's. */ colours?: string[];
  /** Neighbouring segments of one kind as one arc (today's sets: a run of legs reads as legs, not as a dashed line). */ merge?: boolean;
}) {
  const r = (size - width) / 2, c = size / 2, C = 2 * Math.PI * r;
  const per = C / Math.max(total, segs.length, 1);
  const g = Math.min((gap / 360) * C, per * 0.35);
  // Arcs: [first segment, how many, colour].
  const arcs: [number, number, string][] = [];
  segs.forEach((k, i) => {
    const col = colours?.[i] ?? kindColour(k), last = arcs[arcs.length - 1];
    if (merge && last && last[2] === col) last[1]++; else arcs.push([i, 1, col]);
  });
  return (
    <svg className={`ring${draw ? ' draw' : ''}${className ? ` ${className}` : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <g transform={`rotate(-90 ${c} ${c})`}>
        {track && <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={width} />}
        {arcs.map(([i, n, col]) => {
          const span = n * per;
          // Round caps reach half the stroke past each end: room for them, while an arc is long enough to keep its shape.
          const round = span - g > width * 1.6;
          const len = Math.max(0.5, span - g - (round ? width : 0));
          return (
            <circle key={i} className="seg" cx={c} cy={c} r={r} fill="none" stroke={col} strokeWidth={width} strokeLinecap={round ? 'round' : 'butt'}
              strokeDasharray={`${len.toFixed(2)} ${C.toFixed(2)}`} strokeDashoffset={(-(i * per + g / 2 + (round ? width / 2 : 0))).toFixed(2)}
              style={{ '--d': i * 18 } as CSSProperties} />
          );
        })}
      </g>
    </svg>
  );
}
