import { useMemo, useState } from 'react';
import type { BodyDay } from '../domain/body';
import { MUSCLES, type Muscle } from '../domain/muscles';
import type { Profile } from '../domain/profile';
import { programBlock, programVolume, rebuildLike, volumeDiffers, type BuildContext, type Program, type ProgramDay } from '../domain/program';
import { planAims, volumeAdvice, type PlanAim } from '../domain/learn/volume';
import { sizing } from '../domain/learn/session';
import { kneePlan } from '../domain/learn/rest';
import { warmupCount } from '../domain/suggest';
import type { SetEntry } from '../domain/types';
import { tappedLight } from '../state/lightWeek';
import { getPref, setPref } from '../state/prefs';

// Owner decision 2 (2026-10-20): a program plans each muscle at item 07's aim (learn/volume planAims), and at each 3-week block
// boundary an existing program offers an update toward his ranges. Offered on Today, never applied by itself; Not now waits for
// the next block.

const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

/** Each muscle's plan (learn/volume planAims) on `today`, as the builder takes it. */
export function aimsOn(entries: SetEntry[], body: readonly BodyDay[], profile: Profile, today: string, owner: string): { by: Record<Muscle, PlanAim>; ranges: Record<Muscle, [number, number]>; held: Muscle[]; weeks: number } {
  const a = volumeAdvice(entries, body, profile, today, tappedLight(owner));
  const by = planAims(a, profile);
  return { weeks: a?.weeks.length ?? 0, by, held: MUSCLES.filter((m) => by[m].from === 'held'), ranges: Object.fromEntries(MUSCLES.map((m) => [m, by[m].plan])) as Record<Muscle, [number, number]> };
}

/** A program day's minutes as a minutes program is sized: at his pace, else the timer's rests (learn/session sizing). */
export function dayEstimate(entries: SetEntry[], today: string, keptRest?: (ex: string) => number | undefined): (day: ProgramDay) => number {
  const cache = new Map<string, number>();
  const warm = (ex: string) => { const k = ex.toLowerCase(); if (!cache.has(k)) cache.set(k, warmupCount(entries, ex, today)); return cache.get(k)!; };
  const size = sizing(entries, today, { warmups: warm, kept: keptRest, knee: kneePlan(entries, today) ?? undefined });
  return (day) => Math.round(size.seconds(day.slots) / 60);
}

const KEY = 'program:update-later';
const blockKey = (p: Program, block: number) => `${p.createdAt}|${block}`;

/** The update offered at a block boundary: the rebuilt program and what moves, or null when nothing is due. */
export function useProgramUpdate(o: { owner: string; program: Program | null; entries: SetEntry[]; body: readonly BodyDay[]; profile: Profile; today: string; ctx: BuildContext; keptRest?: (ex: string) => number | undefined; taps: number }) {
  const { owner, program: p, entries, body, profile, today, ctx, taps } = o;
  return useMemo(() => {
    if (!p) return null;
    const block = programBlock(p, today);
    if (block < 1 || getPref<string>(owner, KEY) === blockKey(p, block)) return null;
    const aims = aimsOn(entries, body, profile, today, owner);
    // No week counted (a break): nothing new to step from, and 07 never cuts.
    if (!aims.weeks) return null;
    // An update only climbs (07 never cuts): no muscle below what the program plans now, up to its range's top.
    const cur = programVolume(p);
    const ranges = Object.fromEntries(MUSCLES.map((m) => { const [lo, hi] = aims.ranges[m], top = aims.by[m].band[1], keep = Math.min(cur[m], top);
      return [m, [Math.max(lo, keep), Math.max(hi, keep)]]; })) as Record<Muscle, [number, number]>;
    const next = rebuildLike({ days: p.days.length, perSession: p.perSession, minutes: p.minutes }, profile, entries, new Date(`${today}T12:00:00`), ctx, ranges, dayEstimate(entries, today, o.keptRest), aims.held);
    if (!volumeDiffers(p, next)) return null;
    const was = programVolume(p), now = programVolume(next);
    const moves = MUSCLES.filter((m) => Math.abs(now[m] - was[m]) >= 1).sort((a, b) => profile.tiers[a] - profile.tiers[b])
      .map((m) => ({ muscle: m, was: was[m], now: now[m], gap: Math.max(0, aims.by[m].band[0] - now[m]) }));
    // Only an update with a step up is worth offering.
    if (!moves.some((x) => x.now > x.was)) return null;
    return { block, next, moves };
    // `taps` re-reads the dismissal; the rest are what the update is built from.
  }, [p, entries, body, profile, today, ctx, owner, taps]);
}

export function ProgramUpdateCard({ owner, program, update, onUpdate, onLater }: {
  owner: string; program: Program; update: { block: number; next: Program; moves: { muscle: Muscle; was: number; now: number; gap: number }[] };
  onUpdate: (next: Program) => void; onLater: () => void;
}) {
  const [more, setMore] = useState(false);
  // Steps up are the update; a muscle with fewer sets only makes room in a session of the same size.
  const ups = update.moves.filter((x) => x.now > x.was), room = update.moves.filter((x) => x.now < x.was);
  const shown = more ? ups : ups.slice(0, 4);
  return (
    <div className="target-suggest program-update" role="group" aria-label="Program update">
      <p><b>Program update</b> · 3 weeks are up. Each muscle steps up to 20 % on your last 3 weeks, toward its range.</p>
      <ul className="target-suggest-changes" aria-label="Weekly sets that change">
        {shown.map((x) => (
          <li key={x.muscle} aria-label={`${x.muscle}: ${fmt(x.was)} to ${fmt(x.now)} sets a week${x.gap > 0 ? `, ${fmt(x.gap)} short of its range` : ''}`}>
            <span>{x.muscle}</span><span>{fmt(x.was)}/wk</span><span>→ <b>{fmt(x.now)}</b></span>
            {x.gap > 0 && <small>{fmt(x.gap)} short of its range after this</small>}
          </li>
        ))}
      </ul>
      {ups.length > 4 && !more && <button type="button" className="mini" onClick={() => setMore(true)}>{ups.length - 4} more</button>}
      {room.length > 0 && <p className="muted small">To make room, same sets a session: {room.map((x) => `${x.muscle} ${fmt(x.was)} → ${fmt(x.now)}`).join(', ')}.</p>}
      {program.edited && <p className="muted small">It rebuilds every day, so your hand edits are replaced.</p>}
      <div className="target-suggest-actions">
        <button type="button" className="primary" onClick={() => onUpdate(update.next)}>Update program</button>
        <button type="button" onClick={() => { setPref(owner, KEY, blockKey(program, update.block)); onLater(); }}>Not now</button>
      </div>
    </div>
  );
}
