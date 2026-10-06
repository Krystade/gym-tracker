import type { SetEntry } from './types';
import type { DayPlan, Program, Slot } from './program';
import { normalizeName, setId } from './ids';
import { sameExercise } from './stats';
import { nameKey } from './notes';

/**
 * Every set of `from` moved to `to`. Ids carry the name, so a moved set gets a new id and the old one a tombstone (sync must not
 * bring it back). On a merge, a day's moved sets are numbered after the ones `to` already has from the same source.
 */
export function renameSets(entries: SetEntry[], from: string, to: string): { put: SetEntry[]; remove: string[] } {
  const name = normalizeName(to);
  const put: SetEntry[] = [], remove: string[] = [];
  const next = new Map<string, number>(); // `${source}|${date}` → the next free set number
  for (const e of entries) {
    if (!sameExercise(e.exercise, from) && sameExercise(e.exercise, name)) {
      const k = `${e.source}|${e.date}`;
      next.set(k, Math.max(next.get(k) ?? 1, e.setNo + 1));
    }
  }
  const moving = entries.filter((e) => sameExercise(e.exercise, from)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.setNo - b.setNo));
  for (const e of moving) {
    const k = `${e.source}|${e.date}`;
    const setNo = next.has(k) ? next.get(k)! : e.setNo;
    if (next.has(k)) next.set(k, setNo + 1);
    const moved: SetEntry = { ...e, exercise: name, setNo, id: setId(e.source, e.date, name, setNo) };
    // A change of case only keeps the id; otherwise the old row goes, and the set remembers the name it was logged under.
    if (moved.id !== e.id) { remove.push(e.id); moved.asWritten = e.asWritten ?? e.exercise; }
    put.push(moved);
  }
  return { put, remove };
}

/** A day's slots with `from` renamed; if the day already has `to`, one slot stays, at the first place, with the larger count. */
function renameSlots(slots: Slot[], from: string, to: string): Slot[] {
  const out: Slot[] = [];
  for (const s of slots) {
    const x = sameExercise(s.exercise, from) ? { ...s, exercise: to } : s;
    const have = out.find((o) => sameExercise(o.exercise, x.exercise));
    if (have) have.sets = Math.max(have.sets, x.sets); else out.push({ ...x });
  }
  return out;
}

const touches = (names: string[], from: string) => names.some((n) => sameExercise(n, from));

/** The program with `from` renamed, or null when it doesn't use it. */
export function renameInProgram(p: Program, from: string, to: string): Program | null {
  if (!touches(p.days.flatMap((d) => d.slots.map((s) => s.exercise)), from)) return null;
  const name = normalizeName(to);
  return { ...p, days: p.days.map((d) => ({ ...d, slots: renameSlots(d.slots, from, name) })), newToYou: p.newToYou?.filter((n) => !sameExercise(n, from)) };
}

/** A day plan with `from` renamed in its skips, swaps (either side) and quick slots, or null when it doesn't mention it. */
export function renameInPlan(d: DayPlan, from: string, to: string): DayPlan | null {
  const names = [...d.skips, ...Object.keys(d.swaps), ...Object.values(d.swaps), ...(d.slots ?? []).map((s) => s.exercise)];
  if (!touches(names, from)) return null;
  const name = normalizeName(to);
  const r = (n: string) => (sameExercise(n, from) ? name : n);
  return {
    ...d, skips: [...new Set(d.skips.map(r))], swaps: Object.fromEntries(Object.entries(d.swaps).map(([k, v]) => [r(k), r(v)])),
    ...(d.slots && { slots: renameSlots(d.slots, from, name) }),
  };
}

/** Name mappings pointed at `to`, plus the old name itself, so notes written the old way still land on the new lift. */
export function renameAliases(map: Record<string, string>, from: string, to: string): Record<string, string> {
  const name = normalizeName(to);
  const out = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, sameExercise(v, from) ? name : v]));
  if (nameKey(from) !== nameKey(name)) out[nameKey(from)] = name;
  return out;
}
