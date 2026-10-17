import { BODY_FIELDS, type BodyDay, type BodyField } from './body';
import { metaHash } from './cloud';
import { fmtSet, fmtWeight } from './format';
import type { Flag, SetEntry } from './types';

/** How long this phone keeps a copy that a sync replaced. */
export const KEEP_MS = 30 * 24 * 3600 * 1000;
export type BodyValues = Partial<Pick<BodyDay, BodyField>>;
/**
 * Something of this phone's that a sync replaced with a different value, kept so it can be put back. `at`: when (epoch ms).
 * A set: `theirs` is the copy that replaced it, or null when another phone's delete took it. A body day: only the fields replaced.
 */
export type Replaced =
  | { key: string; kind: 'set'; at: number; date: string; exercise: string; mine: SetEntry; theirs: SetEntry | null }
  | { key: string; kind: 'body'; at: number; date: string; mine: BodyValues; theirs: BodyValues };

/**
 * What a set says, the way it shows: not its place in the day, its edit times, or what the app suggested for it. The time to
 * the minute, as it shows and is edited: the same set logged on two phones seconds apart is the same.
 */
const content = (s: SetEntry) => ({
  exercise: s.exercise, weight: s.weight, reps: s.reps, rir: s.rir, flags: [...s.flags].sort(), note: s.note || undefined,
  painRegion: s.painRegion, painSeverity: s.painSeverity, gym: s.gym, cardio: s.cardio, loggedAt: s.loggedAt ? Math.floor(Date.parse(s.loggedAt) / 60_000) : undefined,
  tags: s.tags?.length ? [...s.tags].sort() : undefined,
});
export const sameSet = (a: SetEntry, b: SetEntry): boolean => metaHash(content(a)) === metaHash(content(b));

/** What a sync is about to do to this phone. */
export interface Taken { importSets: SetEntry[]; deleteIds: string[]; importBody: BodyDay[] }

/**
 * Of what a sync is about to take onto this phone, each value of this phone's it replaces with a different one: a set the
 * other copy replaces (a newer edit, or the cloud winning a tie), a set another phone's delete takes, a body field replaced.
 * A set or field this phone didn't have, or one replaced by the same value, is nothing. Keyed by the set (or day) and this
 * phone's copy, so a sync redone after a failed save keeps one record.
 */
export function replacements(local: { sets: SetEntry[]; body: BodyDay[] }, taken: Taken, now: number): Replaced[] {
  const sets = new Map(local.sets.map((s) => [s.id, s])), days = new Map(local.body.map((d) => [d.date, d]));
  const out: Replaced[] = [];
  const replaced = (mine: SetEntry, theirs: SetEntry | null) =>
    out.push({ key: `set|${mine.id}|${metaHash(content(mine))}`, kind: 'set', at: now, date: mine.date, exercise: mine.exercise, mine, theirs });
  for (const s of taken.importSets) { const m = sets.get(s.id); if (m && !sameSet(m, s)) replaced(m, s); }
  for (const id of taken.deleteIds) { const m = sets.get(id); if (m) replaced(m, null); }
  for (const d of taken.importBody) {
    const h = days.get(d.date), mine: BodyValues = {}, theirs: BodyValues = {};
    for (const k of BODY_FIELDS) if (d[k] != null && h?.[k] != null && d[k] !== h[k]) { Object.assign(mine, { [k]: h[k] }); Object.assign(theirs, { [k]: d[k] }); }
    if (Object.keys(mine).length) out.push({ key: `body|${d.date}|${metaHash(mine)}`, kind: 'body', at: now, date: d.date, mine, theirs });
  }
  return out;
}

/**
 * Of what a sync is about to take onto this phone, what still applies. The sync worked it out from the phone as it was when it
 * read it (`base`), and it lands seconds later: a set changed here since (edited, deleted, put back by Undo, or logged under the
 * same id) and a body field entered since are left as they are now (`now`: those sets and days, absent where there's none), for
 * the next sync to merge. `skipped`: how many sets and body fields were left.
 */
export function stillTaken(base: { sets: SetEntry[]; body: BodyDay[] }, now: { sets: Map<string, SetEntry | undefined>; body: Map<string, BodyDay | undefined> }, taken: Taken): { taken: Taken; skipped: number } {
  const sets = new Map(base.sets.map((s) => [s.id, s])), days = new Map(base.body.map((d) => [d.date, d]));
  const asWas = (id: string) => { const b = sets.get(id), c = now.sets.get(id); return b && c ? metaHash(b) === metaHash(c) : !b && !c; };
  const importSets = taken.importSets.filter((s) => asWas(s.id)), deleteIds = taken.deleteIds.filter(asWas);
  let skipped = taken.importSets.length - importSets.length + taken.deleteIds.length - deleteIds.length;
  const importBody: BodyDay[] = [];
  for (const d of taken.importBody) {
    const b = days.get(d.date), c = now.body.get(d.date), fill: BodyDay = { date: d.date };
    for (const k of BODY_FIELDS) {
      if (d[k] == null) continue;
      if (b?.[k] !== c?.[k] || b?.at?.[k] !== c?.at?.[k]) { skipped++; continue; }
      Object.assign(fill, { [k]: d[k] });
      if (d.at?.[k] != null) fill.at = { ...fill.at, [k]: d.at[k] };
    }
    if (Object.keys(fill).length > 1) importBody.push(fill);
  }
  return { taken: { importSets, deleteIds, importBody }, skipped };
}

export const expired = (r: Replaced, now: number): boolean => r.at < now - KEEP_MS;

/** Flags that only add a note to a set; the others (partial, hold, bodyweight, cardio) change what its numbers mean. */
const NOTE_FLAGS: Flag[] = ['unsure', 'pain', 'test', 'warmup', 'double_pulley'];

/**
 * The synced copy with what only this phone's copy had added in: a note, tags, RIR, a gym, flags like pain or warm-up (with the
 * pain's place). Where both have a value, the synced copy's stays. Null when that would add nothing, or give back this phone's
 * copy exactly (Keep does that).
 */
export function combine(mine: SetEntry, theirs: SetEntry): SetEntry | null {
  const u: SetEntry = { ...theirs, flags: [...theirs.flags, ...mine.flags.filter((f) => NOTE_FLAGS.includes(f) && !theirs.flags.includes(f))] };
  if (!theirs.note && mine.note) u.note = mine.note;
  if (theirs.rir == null && mine.rir != null) u.rir = mine.rir;
  if (!theirs.gym && mine.gym) u.gym = mine.gym;
  const tags = [...new Set([...(theirs.tags ?? []), ...(mine.tags ?? [])])];
  if (tags.length) u.tags = tags;
  if (u.flags.includes('pain') && !theirs.painRegion && mine.painRegion) { u.painRegion = mine.painRegion; u.painSeverity = mine.painSeverity; }
  return sameSet(u, theirs) || sameSet(u, mine) ? null : u;
}

const FLAG_TEXT: Partial<Record<Flag, string>> = { warmup: 'warm-up', double_pulley: '2× pulley' };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** One copy of a set: its numbers, then whatever about it differs from the other copy. */
function setText(s: SetEntry, other: SetEntry | null): string {
  const o = other ? content(other) : null, c = content(s);
  const differs = (k: keyof ReturnType<typeof content>) => !!o && metaHash([c[k]]) !== metaHash([o[k]]); // wrapped: a hash of undefined has no text
  const parts = [fmtSet(s)];
  if (differs('exercise')) parts.push(s.exercise);
  if (differs('rir') && s.rir != null) parts.push(`RIR ${s.rir}`);
  for (const f of s.flags) if (o && !o.flags.includes(f) && f !== 'bodyweight' && f !== 'cardio') parts.push(f === 'pain' && s.painRegion ? `pain · ${s.painRegion}` : FLAG_TEXT[f] ?? f);
  if (s.flags.includes('pain') && o?.flags.includes('pain') && (differs('painRegion') || differs('painSeverity')) && s.painRegion) parts.push(`pain · ${s.painRegion}`);
  for (const t of c.tags ?? []) if (o && !o.tags?.includes(t)) parts.push(`#${t}`);
  if (differs('gym') && s.gym) parts.push(`at ${s.gym}`);
  if (differs('loggedAt') && s.loggedAt) parts.push(time(s.loggedAt));
  if (differs('note') && s.note) parts.push(`“${s.note}”`);
  return parts.join(' · ');
}

const BODY_TEXT: Record<BodyField, (n: number) => string> = {
  weight: (n) => `${fmtWeight(n)} lb`, calories: (n) => `${n} kcal`, protein: (n) => `${n} g protein`, energy: (n) => `energy ${n}`,
};

/** What a record is about, and each copy as text: "This phone had …", "Synced copy …". */
export function sides(r: Replaced): { what: string; mine: string; theirs: string } {
  if (r.kind === 'set') return { what: r.exercise, mine: setText(r.mine, r.theirs), theirs: r.theirs ? setText(r.theirs, r.mine) : 'Deleted' };
  const ks = BODY_FIELDS.filter((k) => r.mine[k] != null);
  const text = (v: BodyValues) => ks.map((k) => BODY_TEXT[k](v[k]!)).join(' · ');
  const what = ks.join(', ');
  return { what: what.charAt(0).toUpperCase() + what.slice(1), mine: text(r.mine), theirs: text(r.theirs) };
}
