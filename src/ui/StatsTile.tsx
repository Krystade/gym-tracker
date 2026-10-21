import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Stats v2's tile (plan §2, the stat-tile contract): a label in sentence case, a value with a small unit, one line of context, and
// one 24px mini visual. The whole tile is the button that opens its sheet. Marks: a sparkline in grey with the current point in
// the accent, or columns from a zero baseline with the current one in the accent. No dashed lines, no second axis. A status colour
// (ok, warn, danger) only ever means state, and the words beside it say the same.

/** What a tile shows. `wide`: a row of its own. `news`: a new PR, a new stall, a muscle behind, pain rising. */
export interface TileView {
  id: string; label: string; value: string; unit?: string;
  /** The value is words (a lift's name), set a size down. */ word?: boolean;
  ctx: ReactNode; viz?: (w: number) => ReactNode; vizHeight?: number; wide?: boolean; news?: boolean;
}

export function StatsTile({ t, editing, pinned, hidden, onOpen, onPin, onHide, extra }: {
  t: TileView; editing?: boolean; pinned?: boolean; hidden?: boolean; onOpen?: () => void; onPin?: () => void; onHide?: () => void;
  /** Drawn over the tile, outside its flow (a PR's confetti). */ extra?: ReactNode;
}) {
  const cls = `st-tile${t.wide ? ' wide' : ''}${editing ? ' editing' : ''}${hidden ? ' is-hidden' : ''}`;
  const body = (<>
    <span className="st-t-label">{t.label}{t.news && !editing && <span className="sr-only"> · new</span>}</span>
    {t.news && !editing && <span className="st-t-new" aria-hidden="true" />}
    <span className="st-t-body">
      <span className={`st-t-val${t.word ? ' word' : ''}`}>{t.value}{t.unit && <small>{t.unit}</small>}</span>
      <span className="st-t-ctx">{t.ctx}</span>
      {t.viz && !editing && <Measured h={t.vizHeight ?? 24}>{t.viz}</Measured>}
    </span>
    {extra}
  </>);
  if (editing) return (
    <div className={cls} data-tile={t.id}>
      {body}
      <span className="st-edit-acts">
        <button type="button" className={pinned ? 'on' : undefined} aria-pressed={!!pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${t.label}`} onClick={onPin}><PinIcon on={!!pinned} /></button>
        <button type="button" className={hidden ? 'on' : undefined} aria-pressed={!!hidden} aria-label={`${hidden ? 'Show' : 'Hide'} ${t.label}`} onClick={onHide}><HideIcon /></button>
      </span>
    </div>
  );
  return <button type="button" className={cls} data-tile={t.id} aria-haspopup="dialog" onClick={onOpen}>{body}</button>;
}

const PinIcon = ({ on }: { on: boolean }) => (
  <svg className="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M9.5 3.75h5l-.9 5.1 3.15 3.15v2.25H7.25V12l3.15-3.15z" fill={on ? 'currentColor' : 'none'} /><path d="M12 14.25v6" />
  </svg>
);
const HideIcon = () => (
  <svg className="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3.5 3.5l17 17" /><path d="M10.4 6.15A9.6 9.6 0 0 1 12 6c5 0 8.4 4.1 9.4 6-.45.85-1.35 2.15-2.7 3.35M6.75 7.7C4.7 9 3.3 10.85 2.6 12c1 1.9 4.4 6 9.4 6 1.55 0 2.95-.38 4.2-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

/** A mini visual drawn at the width it gets (a tile's is 143px on the 13 mini, 116 at 320). */
function Measured({ h, children }: { h: number; children: (w: number) => ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.floor(el.clientWidth));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <span ref={ref} className="st-t-viz" style={{ height: h }} aria-hidden="true">{w > 0 && children(w)}</span>;
}

const f1 = (n: number) => n.toFixed(1);

/** A trend: the line in grey, its current point in the accent. Scaled to its own range (a sparkline needs no zero). */
export function Spark({ values, w, h = 24 }: { values: number[]; w: number; h?: number }) {
  if (values.length < 2) return <svg width={w} height={h} />;
  const p = 5, lo = Math.min(...values), hi = Math.max(...values), sp = hi - lo || 1;
  const X = (i: number) => p + (i * (w - 2 * p)) / (values.length - 1), Y = (v: number) => (hi === lo ? h / 2 : h - p - ((v - lo) / sp) * (h - 2 * p));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${f1(X(i))} ${f1(Y(v))}`).join('');
  return (
    <svg width={w} height={h} className="st-spark">
      <path d={d} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={f1(X(values.length - 1))} cy={f1(Y(values.at(-1)!))} r="4" />
    </svg>
  );
}

/**
 * Columns from a zero baseline, the last (the current period) in the accent unless `colour` says otherwise. `goal`: a solid line
 * across at that height.
 */
export function Cols({ values, w, h = 24, goal, colour }: { values: number[]; w: number; h?: number; goal?: number; colour?: (i: number, v: number) => string }) {
  const n = values.length, gap = n > 30 ? 1 : 2, bw = Math.max(1, (w - gap * (n - 1)) / n), hi = Math.max(...values, goal ?? 0) || 1;
  const Y = (v: number) => (v / hi) * h;
  return (
    <svg width={w} height={h} className="st-cols">
      {values.map((v, i) => {
        if (v <= 0) return null;
        const bh = Math.max(2, Y(v));
        return <rect key={i} x={f1(i * (bw + gap))} y={f1(h - bh)} width={f1(bw)} height={f1(bh)} rx={Math.min(2, bw / 2)} fill={colour ? colour(i, v) : i === n - 1 ? 'var(--accent)' : 'var(--col)'} />;
      })}
      {goal != null && goal > 0 && <line x1="0" x2={w} y1={f1(h - Y(goal))} y2={f1(h - Y(goal))} stroke="var(--text)" strokeWidth="1" />}
    </svg>
  );
}

/** Part of the way to something: a track and the accent fill. */
export function Meter({ frac, w, h = 24 }: { frac: number; w: number; h?: number }) {
  return (
    <svg width={w} height={h} className="st-meter">
      <rect x="0" y={h / 2 - 4} width={w} height="8" rx="4" fill="var(--fill)" />
      <rect x="0" y={h / 2 - 4} width={f1(Math.max(8, w * Math.min(1, Math.max(0, frac))))} height="8" rx="4" fill="var(--accent)" />
    </svg>
  );
}

/** Weeks as columns and days as rows (Monday on top): trained days in the accent, rest days a track, days to come left out. */
export function Heat({ weeks, w, h }: { weeks: (0 | 1 | -1)[][]; w: number; h: number }) {
  const cols = weeks.length, g = cols > 30 ? 1 : 2, cw = (w - g * (cols - 1)) / cols, ch = (h - g * 6) / 7;
  return (
    <svg width={w} height={h} className="st-heat">
      {weeks.flatMap((wk, c) => wk.map((v, r) => (v === -1 ? null
        : <rect key={`${c}-${r}`} x={f1(c * (cw + g))} y={f1(r * (ch + g))} width={f1(cw)} height={f1(ch)} rx={Math.min(2, cw / 2)} fill={v ? 'var(--accent)' : 'var(--fill)'} />)))}
    </svg>
  );
}
