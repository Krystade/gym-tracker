import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { pulledCount, rng, type Ledger, type Spend } from '../../domain/buddies/gacha';
import { ACCESSORY, BUDDY, type Banner, type Rarity } from '../../domain/buddies/roster';
import { BOX, BuddySprite } from './BuddySprite';
import { AccIcon, accName, SLOT_NAME } from './Worn';

// A pull's show (owner 2026-11-15: the gambling up front, "juice up the reveal"): a pixel capsule drops in, shakes and charges,
// its light climbing the rarities one by one up to what it holds (grey, green, blue, purple, orange), then bursts in a ring and
// a spray of pixels, and what was in it lands with a bounce. The rarer, the longer: a rare charges for about a second, an epic
// or a legendary longer still and opens with a flash and turning light rays. New or a duplicate, said plainly ("NEW!", or
// "×3 · +8 back"). A tap anywhere skips to what landed; a 10-pull shows each in turn (a tap for the next, or Skip all), then all
// ten. Transform and opacity only (aimed at 60 fps on a 13 mini); under reduced motion it's a short fade to the result.
// Haptics where the browser has them (iOS Safari doesn't). No sound.

export interface Show {
  spends: Spend[];
  /** The ledger before these spends: what was new, and how many times each had landed. */ before: Ledger;
  banner: Banner;
  /** What a multi-pull cost, for its summary. */ bill?: { tickets: number; points: number };
}
/** A button under the result: pull again (or 10 more) on the same banner. */
export interface Again { label: string; sub: string; ok: boolean; run: () => void; /** Paid with a ticket. */ ticket?: boolean }

type Phase = 'drop' | 'charge' | 'burst' | 'land';
const RARITY: Record<Rarity, string> = { 0: 'Common', 1: 'Uncommon', 2: 'Rare', 3: 'Epic', 4: 'Legendary' };
const pts = (x: number) => `${x.toLocaleString('en-US')} ${x === 1 ? 'point' : 'points'}`;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* not here */ } };
const BUZZ: Record<Rarity, number | number[]> = { 0: 12, 1: 18, 2: [24, 40, 34], 3: [30, 50, 30, 50, 90], 4: [40, 40, 40, 40, 40, 60, 140] };

/** When each beat lands, ms from the drop: the charge's length and its colour steps grow with the rarity. A 10-pull's commons
 *  and uncommons go quicker, so ten never drag; its rares and better keep their whole moment. */
export function beats(r: Rarity, quick = false): { drop: number; charge: number; tiers: number[]; burst: number; land: number } {
  const drop = quick && r < 2 ? 220 : 380;
  const charge = r === 0 ? (quick ? 220 : 420) : r === 1 ? (quick ? 300 : 560) : r === 2 ? 950 : r === 3 ? 1450 : 1850;
  // The light steps up one rarity at a time, the last step late in the charge so what it is shows at the last moment.
  const tiers = Array.from({ length: r }, (_, i) => Math.round(drop + charge * (0.2 + (0.72 * (i + 1)) / r)));
  return { drop, charge, tiers, burst: drop + charge, land: drop + charge + 170 };
}

/** The capsule: 16 × 16 pixels, an outline, a top in the light's colour, a white bottom, a dark band and its button. */
type Px = 'o' | 't' | 'h' | 's' | 'b' | 'k' | 'w' | 'd';
const SPANS: readonly [number, number][] = [[5, 10], [3, 12], [2, 13], [1, 14], [1, 14], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [0, 15], [1, 14], [1, 14], [2, 13], [3, 12], [5, 10]];
const inside = (x: number, y: number) => y >= 0 && y < 16 && x >= SPANS[y][0] && x <= SPANS[y][1];
function pixel(x: number, y: number): Px | null {
  if (!inside(x, y)) return null;
  if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return 'o';
  if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return x >= 7 && x <= 8 && y >= 7 && y <= 8 ? 'k' : 'o';
  if (y === 7 || y === 8) return 'b';
  if (y < 7) return (y === 2 && (x === 4 || x === 5)) || (y === 3 && x === 3) || (y === 4 && x === 2) ? 'h' : y === 6 || (x >= 12 && y >= 3) ? 's' : 't';
  return y >= 13 || (x >= 12 && y >= 11) ? 'd' : 'w';
}
/** Each half's pixels as runs (x, y, width, kind), worked out once. */
const HALF = [[0, 8], [8, 16]].map(([y0, y1]) => {
  const runs: [number, number, number, Px][] = [];
  for (let y = y0; y < y1; y++) for (let x = 0; x < 16; x++) {
    const k = pixel(x, y);
    if (!k) continue;
    const last = runs.at(-1);
    if (last && last[1] === y && last[3] === k && last[0] + last[2] === x) last[2]++; else runs.push([x, y, 1, k]);
  }
  return runs;
});
const Capsule = () => (
  <span className="ps-capsule" aria-hidden="true">
    {HALF.map((runs, i) => (
      <svg key={i} className={i ? 'ps-half bottom' : 'ps-half top'} viewBox={`0 ${i * 8} 16 8`} shapeRendering="crispEdges">
        {runs.map(([x, y, w, k]) => <rect key={`${x}.${y}`} className={`px-${k}`} x={x} y={y} width={w} height={1} />)}
      </svg>
    ))}
  </span>
);

/** The burst's pixels: the same spray for the same pull. */
function bitsOf(s: Spend): { dx: number; dy: number; size: number; tone: number; delay: number }[] {
  const next = rng((s.seed ?? s.at) ^ 0x9e3779b9), n = [10, 12, 16, 22, 28][s.rarity], far = s.rarity >= 3 ? 230 : s.rarity === 2 ? 180 : 140;
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + next() * 0.8) / n) * Math.PI * 2, d = far * (0.55 + next() * 0.45);
    return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d * 0.85), size: [6, 8, 10][Math.floor(next() * 3)], tone: Math.floor(next() * 3), delay: Math.round(next() * 70) };
  });
}

/** What landed, by name. */
const nameOf = (s: Spend, names: (id: string) => string) => (!s.got ? `${s.refund} points back` : BUDDY.has(s.got) ? names(s.got) : accName(s.got));
const kindOf = (s: Spend) => { const a = s.got ? ACCESSORY.get(s.got) : undefined; return `${RARITY[s.rarity]} ${a ? SLOT_NAME[a.slot].toLowerCase() : 'buddy'}`; };

function Art({ s, scale, box, still }: { s: Spend; scale: number; box: readonly [number, number]; still?: boolean }) {
  const bud = s.got ? BUDDY.get(s.got) : undefined, acc = s.got ? ACCESSORY.get(s.got) : undefined;
  return bud ? <BuddySprite def={bud} scale={scale} box={box} still={still} /> : acc ? <AccIcon acc={acc} scale={scale} /> : null;
}

/** NEW! or ×N · +8 back. */
function Mark({ dupe, count, refund, small }: { dupe: boolean; count: number; refund: number; small?: boolean }) {
  if (!dupe) return <span className={`ps-new${small ? ' small' : ''}`}>NEW!</span>;
  return <span className={`ps-dupe${small ? ' small' : ''}`}><b>×{count}</b>{!small && <> · <i className="bu-coin" aria-hidden="true" />+{refund} back</>}</span>;
}

export function PullShow({ show, names, onClose, onOpen, again }: {
  show: Show; names: (id: string) => string; onClose: () => void;
  /** Opens what landed (a single pull): a buddy's card, or the lead wearing the accessory. */ onOpen: (s: Spend) => void;
  again?: Again;
}) {
  const { spends, before } = show, n = spends.length, multi = n > 1;
  const [at, setAt] = useState(0);
  const [phase, setPhase] = useState<Phase>('drop');
  const [tier, setTier] = useState(0);
  const [summary, setSummary] = useState(false);
  const timers = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const s = spends[Math.min(at, n - 1)];
  // How each landed: new, or the how-manyth time (the ones before it in this go included).
  const marks = useMemo(() => spends.map((x, i) => ({
    dupe: x.refund > 0,
    count: (x.got ? pulledCount(before, x.got) : 0) + spends.slice(0, i).filter((y) => y.got && y.got === x.got).length + 1,
  })), [spends, before]);
  const bits = useMemo(() => bitsOf(s), [s]);
  const b = useMemo(() => beats(s.rarity, multi), [s.rarity, multi]);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => {
    if (summary) return;
    clear();
    if (reduced()) { setPhase('land'); setTier(s.rarity); buzz(BUZZ[s.rarity]); return; }
    setPhase('drop'); setTier(0);
    const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
    later(b.drop, () => { setPhase('charge'); buzz(8); });
    b.tiers.forEach((ms, i) => later(ms, () => { setTier(i + 1); buzz(10 + i * 6); }));
    later(b.burst, () => { setPhase('burst'); setTier(s.rarity); buzz(BUZZ[s.rarity]); });
    later(b.land, () => setPhase('land'));
    return clear;
  }, [at, summary, s, b]);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  /** A tap: skip to what landed; once landed (a multi-pull), on to the next or to all ten. */
  const tap = useCallback(() => {
    if (summary) return;
    if (phase !== 'land') { clear(); setTier(s.rarity); setPhase('land'); if (phase !== 'burst') buzz(BUZZ[s.rarity]); return; }
    if (!multi) return;
    if (at + 1 < n) setAt(at + 1); else setSummary(true);
  }, [summary, phase, s, multi, at, n]);
  const skipAll = (e: MouseEvent) => { e.stopPropagation(); clear(); setSummary(true); };
  const stop = (f: () => void) => (e: MouseEvent) => { e.stopPropagation(); f(); };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (summary || (!multi && phase === 'land')) onClose(); else if (multi) { clear(); setSummary(true); } else tap(); }
    else if ((e.key === 'Enter' || e.key === ' ') && e.target === root.current) { e.preventDefault(); tap(); }
  };

  const m = marks[Math.min(at, n - 1)];
  const label = multi ? `Your ${n} pulls` : 'Your pull';
  if (summary) {
    const best = Math.max(...spends.map((x) => x.rarity)) as Rarity;
    const refund = spends.reduce((a, x) => a + x.refund, 0), fresh = marks.filter((x) => !x.dupe).length;
    const bestOne = spends.find((x) => x.rarity === best)!;
    return createPortal(
      <div ref={root} className={`ps summary r${best}`} role="dialog" aria-modal="true" aria-label={`${label}: all ${n}`} tabIndex={-1} onKeyDown={key}>
        <div className="ps-sum">
          <h2>{n} pulls</h2>
          <p className={`ps-best r${best}`}>Best: <b className="bu-rarity">{RARITY[best]}</b>, {nameOf(bestOne, names)}</p>
          <ul className="ps-grid" aria-label="What landed">
            {spends.map((x, i) => (
              <li key={x.id} className={`ps-cell r${x.rarity}${x.rarity === best ? ' best' : ''}`} style={{ animationDelay: `${i * 45}ms` }}
                aria-label={`${nameOf(x, names)}, ${kindOf(x).toLowerCase()}, ${marks[i].dupe ? `×${marks[i].count}, ${pts(x.refund)} back` : 'new'}`}>
                <span className="ps-cell-art"><Art s={x} scale={3} box={BOX.tile} still /></span>
                <b>{nameOf(x, names)}</b>
                <Mark {...marks[i]} refund={x.refund} small />
              </li>
            ))}
          </ul>
          <p className="ps-tally">
            <span><b>{fresh}</b> new</span>
            {n - fresh ? <span><b>{n - fresh}</b> {n - fresh === 1 ? 'duplicate' : 'duplicates'}: <i className="bu-coin" aria-hidden="true" /><b>+{refund}</b> back</span> : <span>no duplicates</span>}
          </p>
          {show.bill && <p className="ps-spent small">Spent {[show.bill.tickets && `${show.bill.tickets} ${show.bill.tickets === 1 ? 'ticket' : 'tickets'}`, show.bill.points && pts(show.bill.points)].filter(Boolean).join(' + ')}.</p>}
          <div className="ps-actions">
            {again && <button className={`ps-again${again.ticket ? ' ticket' : ''}`} aria-label={`${again.label}: ${again.sub}`} disabled={!again.ok} onClick={again.run}><b>{again.label}</b><span>{again.sub}</span></button>}
            <button className="primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>, document.body);
  }

  return createPortal(
    <div ref={root} className={`ps r${s.rarity} t${tier} p-${phase}${multi ? ' multi' : ''}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      data-phase={phase} onClick={tap} onKeyDown={key} style={{ '--charge': `${b.charge}ms` } as CSSProperties}>
      <div className="ps-top">
        {multi && <span className="ps-count">{at + 1} of {n}</span>}
        {(multi || phase !== 'land') && <button className="ps-skip" onClick={multi ? skipAll : stop(tap)}>{multi ? 'Skip all' : 'Skip'}</button>}
      </div>
      <div className="ps-stage" key={s.id} aria-hidden="true">
        {s.rarity >= 3 && <i className="ps-rays" />}
        {[0, 1, 2, 3, 4].filter((g) => g <= s.rarity).map((g) => <i key={g} className={`ps-glow g${g}${g === tier ? ' on' : ''}`} />)}
        <i className="ps-ring" />
        {s.rarity >= 3 && <i className="ps-ring two" />}
        {s.rarity >= 2 && (
          <span className="ps-suck">
            {bits.slice(0, 6 + 4 * s.rarity).map((x, i) => <i key={i} style={{ '--dx': `${Math.round(x.dx * 0.8)}px`, '--dy': `${Math.round(x.dy * 0.8)}px`, animationDelay: `${(i * 97) % 620}ms` } as CSSProperties} />)}
          </span>
        )}
        <span className="ps-cap"><span className="ps-shake"><Capsule /></span></span>
        <span className="ps-bits">
          {bits.map((x, i) => <i key={i} className={`tone${x.tone}`} style={{ '--dx': `${x.dx}px`, '--dy': `${x.dy}px`, width: x.size, height: x.size, animationDelay: `${x.delay}ms` } as CSSProperties} />)}
        </span>
        <span className="ps-item"><Art s={s} scale={8} box={[300, 220]} /></span>
        <i className="ps-floor" />
      </div>
      {s.rarity >= 3 && <i className="ps-flash" key={`f${s.id}`} aria-hidden="true" />}
      <div className="ps-panel" role="status">
        {phase === 'land' && (
          <>
            <span className={`ps-kind`}>{kindOf(s)}</span>
            <b className="ps-name">{nameOf(s, names)}</b>
            <Mark {...m} refund={s.refund} />
            {multi ? <span className="ps-hint">{at + 1 < n ? 'Tap for the next' : `Tap to see all ${n}`}</span> : (
              <span className="ps-actions">
                {s.got && <button onClick={stop(() => onOpen(s))}>{BUDDY.has(s.got) ? 'See its card' : 'Wear it'}</button>}
                {again && <button className={`ps-again${again.ticket ? ' ticket' : ''}`} aria-label={`${again.label}: ${again.sub}`} disabled={!again.ok} onClick={stop(again.run)}><b>{again.label}</b><span>{again.sub}</span></button>}
                <button className="primary" onClick={stop(onClose)}>Done</button>
              </span>
            )}
          </>
        )}
      </div>
    </div>, document.body);
}
