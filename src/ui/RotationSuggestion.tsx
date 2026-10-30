import { useState } from 'react';
import { fmtDay, fmtWeight, plural } from '../domain/format';
import type { DayPlan } from '../domain/program';
import { settingsKey } from '../domain/progression';
import { renameInPlan } from '../domain/rename';
import { rotateProgram, rotationReason, type Carry, type Flat, type Rotation } from '../domain/rotation';
import { sameExercise } from '../domain/stats';
import { getPref, setPref } from '../state/prefs';
import type { ProgramStore } from '../state/useProgram';
import type { SettingsStore } from '../state/useSettings';

// A plateaued lift's next variation (domain/rotation), never applied by itself: one tap switches the program over, Dismiss
// hides it for this plateau. The dismissal is kept per profile on this phone, holding the variation and the plateau's start:
// a new plateau, or another variation (a different gym), shows it again.

const prefName = (lift: string) => `suggest:rotate:${settingsKey(lift)}`;
const sig = (r: Rotation) => `${settingsKey(r.to)}|${r.stall.since}`;
/** Dismissed for this plateau (and this variation) on this phone: Stats leaves the offer out too. */
export const rotationDismissed = (owner: string, r: Rotation): boolean => getPref<string>(owner, prefName(r.from)) === sig(r);

/** `known`: the new lift has history of its own. `onSwitch` absent: the lift isn't in the program, so this is advice only. */
export function RotationSuggestion({ owner, r, carry, known, today, onSwitch }: {
  owner: string; r: Rotation; carry: Carry | null; known: boolean; today: string; onSwitch?: () => void;
}) {
  const [, bump] = useState(0);
  if (rotationDismissed(owner, r)) return null;
  const why = rotationReason(r);
  const start = carry ? <>Start ≈ <b>{fmtWeight(carry.weight)} lb × {carry.reps}</b>: an estimate from your {r.from}, on the light side.</>
    : known ? <>Picks up from your last {r.to}.</> : <>New to you: start light and log every set.</>;
  return (
    <div className="target-suggest rotate-suggest" role="group" aria-label="Suggested variation">
      <p><b>{r.from} flat for {plural(Math.max(1, r.stall.weeks), 'week')}</b> — {onSwitch ? <>switch to <b>{r.to}</b>?</> : <>next time, try <b>{r.to}</b>.</>}</p>
      <p className="muted small">Fatigue-adjusted strength level, no new best since {fmtDay(r.stall.since, today)} · {why}. Strength carries over between them.</p>
      <p className="small">{start}</p>
      <div className="target-suggest-actions">
        {onSwitch && <button type="button" className="primary" onClick={onSwitch}>Switch to {r.to}</button>}
        <button type="button" onClick={() => { setPref(owner, prefName(r.from), sig(r)); bump((n) => n + 1); }}>Dismiss</button>
      </div>
    </div>
  );
}

/**
 * The softer note (domain/rotation `flatFor`): no new best for 3 weeks, said plainly, no plateau called and nothing to switch.
 * Shown where the stall's offer would be, only when there is none. Dismiss hides it until the lift next sets a best.
 */
const flatPref = (lift: string) => `suggest:flat:${settingsKey(lift)}`;
export function FlatNote({ owner, lift, flat, today }: { owner: string; lift: string; flat: Flat; today: string }) {
  const [, bump] = useState(0);
  if (getPref<string>(owner, flatPref(lift)) === flat.since) return null;
  return (
    <div className="target-suggest flat-note" role="group" aria-label="No new best lately">
      <p><b>{lift}: no new best in {plural(Math.max(1, flat.weeks), 'week')}</b></p>
      <p className="muted small">Your best has held since {fmtDay(flat.since, today)}, over {plural(flat.sessions, 'session')}. Not a plateau call, just a heads-up.</p>
      <div className="target-suggest-actions">
        <button type="button" onClick={() => { setPref(owner, flatPref(lift), flat.since); bump((n) => n + 1); }}>Got it</button>
      </div>
    </div>
  );
}

export const inProgram = (programs: ProgramStore, lift: string): boolean =>
  !!programs.program?.days.some((d) => d.slots.some((s) => sameExercise(s.exercise, lift)));

/**
 * Switches the program from the stalled lift to its next variation: every slot of it, for good. The new lift's settings get
 * the carried-over first target (or lose a stale one), and today's saved plan, if it names the old lift, names the new one.
 * Returns the undo, which puts all three back.
 */
export async function applyRotation(r: Rotation, carry: Carry | null, programs: ProgramStore, settings: SettingsStore, today: string, plan: DayPlan | null): Promise<() => Promise<void>> {
  const before = programs.program;
  if (!before) return async () => {};
  const st = settings.get(r.to);
  await programs.save(rotateProgram(before, r.from, r.to, { repMin: st.repMin, repMax: st.repMax }));
  const seeded = !!carry || !!st.seed;
  if (seeded) await settings.save({ ...st, seed: carry ? { weight: carry.weight, reps: carry.reps, from: r.from, date: today, e1rm: Math.round(carry.e1rm), basis: carry.basis } : undefined });
  const stored = plan ? programs.plans.find((p) => p.key === plan.key) ?? null : null;
  const renamed = stored ? renameInPlan(stored, r.from, r.to) : null;
  if (renamed) await programs.savePlan(renamed);
  return async () => {
    await programs.save(before);
    if (seeded) await settings.save(st);
    if (stored && renamed) await programs.savePlan(stored);
  };
}
