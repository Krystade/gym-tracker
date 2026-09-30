import { useState } from 'react';

const W = 340, H = 150, L = 34, R = 6, T = 10, B = 22, GAP = 2, RADIUS = 4;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** A bar anchored to the baseline with only its top corners rounded. */
function barPath(x: number, w: number, base: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`;
}

export function BarChart({ label, points, format, tick = String, goal }: {
  label: string; points: { x: string; y: number }[]; format: (n: number) => string; tick?: (n: number) => string; goal?: number;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(goal ?? 0, ...points.map((p) => p.y), 1);
  const slot = (W - L - R) / points.length;
  const base = H - B;
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        <line x1={L} x2={W - R} y1={base} y2={base} className="axis" />
        <text x={L - 6} y={T + 4} className="lbl" textAnchor="end">{tick(max)}</text>
        <text x={L - 6} y={base} className="lbl" textAnchor="end">0</text>
        {goal != null && <line x1={L} x2={W - R} y1={Y(goal)} y2={Y(goal)} className="goal" />}
        {points.map((p, i) => {
          const h = base - Y(p.y);
          return (
            <g key={p.x} onClick={() => setSel(i)}>
              {/* Hit target: the whole column, not just the bar. */}
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
              {h > 0 && <path className={sel === i ? 'bar sel' : 'bar'} d={barPath(L + i * slot + GAP / 2, slot - GAP, base, h)} />}
            </g>
          );
        })}
        <text x={L} y={H - 6} className="lbl">{md(points[0].x)}</text>
        <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(points.at(-1)!.x)}</text>
      </svg>
      <p className="readout" aria-live="polite">{sel == null ? 'Tap a bar for its value.' : `Week of ${md(points[sel].x)}: ${format(points[sel].y)}`}</p>
    </>
  );
}
