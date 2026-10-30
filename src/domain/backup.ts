import { BODY_FIELDS, type BodyDay } from './body';
import { isFlag, type SetEntry } from './types';
import { editStamp, lifeStamp, metaHash, type MetaItems } from './cloud';
import { isBuddyKey, mergeBuddyMeta } from './buddies/kept';
import { importOverlap } from './duplicates';
import { photoId, POSES, type PhotoMeta } from './photos';
import type { Taken } from './replaced';

// The backup file (owner 2026-10-29, in place of the private GitHub backup): one profile's sets, deletes, body days, Gym
// Buddies' items and progress photos, the JPEGs themselves in base64, in one JSON file saved through the share sheet. Restore
// merges a file back in: nothing is replaced but by a newer edit, so restoring the same file twice changes nothing.

export const BACKUP_KIND = 'gym-tracker-backup';
/** A progress photo with both its images (db photoBlobs), base64. */
export interface BackupPhoto { meta: PhotoMeta; type: string; full: string; thumb: string }
/**
 * `person`: whose log it is, so a restore into another profile asks first. `deleted`: the sets deleted from the log and when
 * (epoch ms), so a restore onto a phone still holding one of them takes it out, unless that set changed after.
 */
export interface Backup {
  kind: typeof BACKUP_KIND; v: 1; at: string; person: string;
  sets: SetEntry[]; deleted: Record<string, number>; body: BodyDay[]; buddies: MetaItems; photos: BackupPhoto[];
}

/** `gym-backup-2026-10-29.json`; another profile's carries its name: `gym-backup-sam-2026-10-29.json`. */
export const backupName = (day: string, slug: string | null): string => `gym-backup-${slug ? `${slug}-` : ''}${day}.json`;

export function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const fromB64 = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * The file, from the log as the database has it (db getSyncSnapshot). A tombstone under a set that's in the log is an old
 * delete of a reused id and stays out; one without a time (from before delete times, or one a sync brought) goes at `at`.
 */
export function toBackup(x: { person: string; at: Date; sets: SetEntry[]; tombstones: Set<string>; tombAt: Record<string, number>; body: BodyDay[]; buddies: MetaItems; photos: BackupPhoto[] }): Backup {
  const live = new Set(x.sets.map((s) => s.id));
  const deleted = Object.fromEntries([...x.tombstones].filter((id) => !live.has(id)).map((id) => [id, x.tombAt[id] ?? x.at.getTime()]));
  return { kind: BACKUP_KIND, v: 1, at: x.at.toISOString(), person: x.person, sets: x.sets, deleted, body: x.body, buddies: x.buddies, photos: x.photos };
}

const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A set as the file has it, or null when it doesn't read as one: the fields the app relies on, typed. */
function readSet(x: unknown): SetEntry | null {
  if (!obj(x)) return null;
  const ok = str(x.id) && x.id !== '' && str(x.date) && DAY.test(x.date) && str(x.exercise) && x.exercise.trim() !== '' && Number.isInteger(x.setNo)
    && num(x.weight) && (x.reps === null || num(x.reps)) && str(x.source) && num(x.seq) && Array.isArray(x.flags) && x.flags.every((f) => str(f) && isFlag(f))
    && (x.editedAt === undefined || num(x.editedAt)) && (x.restoredAt === undefined || num(x.restoredAt))
    && (x.loggedAt === undefined || str(x.loggedAt)) && (x.enteredAt === undefined || str(x.enteredAt));
  return ok ? (x as unknown as SetEntry) : null;
}
/** A body day with only the fields it should have, or null. */
function readBody(x: unknown): BodyDay | null {
  if (!obj(x) || !str(x.date) || !DAY.test(x.date)) return null;
  const d: BodyDay = { date: x.date };
  for (const k of BODY_FIELDS) {
    const v = x[k];
    if (v === undefined) continue;
    if (!num(v) || (k === 'energy' && !(Number.isInteger(v) && v >= 1 && v <= 5))) return null;
    Object.assign(d, { [k]: v });
    const at = obj(x.at) ? x.at[k] : undefined;
    if (num(at)) d.at = { ...d.at, [k]: at };
  }
  return d;
}
function readPhoto(x: unknown): BackupPhoto | null {
  if (!obj(x) || !obj(x.meta) || !str(x.type) || !str(x.full) || !str(x.thumb)) return null;
  const m = x.meta;
  const ok = str(m.date) && DAY.test(m.date) && (POSES as readonly unknown[]).includes(m.pose) && m.id === photoId(m.date, m.pose as PhotoMeta['pose'])
    && num(m.width) && num(m.height) && str(m.addedAt);
  return ok ? { meta: { id: m.id as string, date: m.date as string, pose: m.pose as PhotoMeta['pose'], width: m.width as number, height: m.height as number, addedAt: m.addedAt as string }, type: x.type, full: x.full, thumb: x.thumb } : null;
}

/** The file read, each part as untrusted: what doesn't read is left out and counted in `skipped`. */
export function parseBackup(text: string): { backup: Backup; skipped: number } | { error: string } {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { error: 'That isn’t a backup file.' }; }
  if (!obj(j) || j.kind !== BACKUP_KIND) return { error: 'That isn’t a backup file.' };
  if (j.v !== 1) return { error: 'That backup is from a newer version of the app. Update the app, then restore it.' };
  let skipped = 0;
  const all = <T,>(xs: unknown, read: (x: unknown) => T | null): T[] => {
    const out: T[] = [];
    for (const x of Array.isArray(xs) ? xs : []) { const v = read(x); if (v === null) skipped++; else out.push(v); }
    return out;
  };
  const sets = all(j.sets, readSet), body = all(j.body, readBody), photos = all(j.photos, readPhoto);
  const deleted = Object.fromEntries(Object.entries(obj(j.deleted) ? j.deleted : {}).filter(([, at]) => num(at))) as Record<string, number>;
  // Each buddies item is read again as untrusted when merged (mergeBuddyMeta).
  const buddies = Object.fromEntries(Object.entries(obj(j.buddies) ? j.buddies : {}).filter(([k]) => isBuddyKey(k)));
  return { backup: { kind: BACKUP_KIND, v: 1, at: str(j.at) ? j.at : '', person: str(j.person) ? j.person : '', sets, deleted, body, buddies, photos }, skipped };
}

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
/** The newest thing known to have happened to a set, for a delete to beat: logged, edited or put back (cloud lifeStamp). */
const setStamp = (s: SetEntry) => Math.max(lifeStamp(s), ms(s.loggedAt), ms(s.enteredAt));

/**
 * What a restore takes onto this phone, for db applySynced (`taken`, the phone's replaced values kept first) and applySyncedMeta
 * (`buddies`). Sets: the file's that the phone lacks, and its copy of one the phone has when edited there since this phone's last
 * change; the phone wins a tie. A file's set on a day and lift the log already has from another import is held back (`held`,
 * domain/duplicates), as Import CSV holds it back. Deletes: the file's and this phone's, the later time for each; a delete beats
 * a set only if it's newer than all that happened to it. Body days: per field, a value the phone lacks, or one entered there more
 * recently. Buddies: the union, merged per item (domain/buddies/kept).
 */
export function mergeBackup(local: { sets: SetEntry[]; body: BodyDay[]; tombstones: Set<string>; tombAt: Record<string, number>; buddies: MetaItems }, b: Backup, now: number):
  { taken: Taken; held: number; buddies: MetaItems } {
  const have = new Map(local.sets.map((e) => [e.id, e]));
  const deleted: Record<string, number> = { ...b.deleted };
  for (const id of local.tombstones) {
    if (have.has(id)) continue;
    deleted[id] = Math.max(deleted[id] ?? 0, local.tombAt[id] ?? deleted[id] ?? now);
  }
  const gone = (id: string, stamp: number) => id in deleted && stamp <= deleted[id];

  const fresh = b.sets.filter((e) => !have.has(e.id) && !gone(e.id, setStamp(e)));
  const held = new Set(importOverlap(local.sets, fresh).held.map((e) => e.id));
  const incoming = new Map(fresh.filter((e) => !held.has(e.id)).map((e) => [e.id, e]));
  for (const e of b.sets) {
    const mine = have.get(e.id);
    // Edited elsewhere since this phone's last change: the file's, in this phone's place in the day.
    if (mine && editStamp(e) > editStamp(mine)) incoming.set(e.id, { ...e, seq: mine.seq });
  }
  const deleteIds = local.sets.filter((s) => { const t = incoming.get(s.id); return gone(s.id, Math.max(setStamp(s), t ? setStamp(t) : 0)); }).map((s) => s.id);
  for (const id of deleteIds) incoming.delete(id);

  const bodyBy = new Map(local.body.map((d) => [d.date, d]));
  const importBody: BodyDay[] = [];
  for (const d of b.body) {
    const mine = bodyBy.get(d.date);
    const fill: BodyDay = { date: d.date };
    for (const k of BODY_FIELDS) {
      if (d[k] == null || (mine?.[k] != null && (d.at?.[k] ?? 0) <= (mine.at?.[k] ?? 0))) continue;
      Object.assign(fill, { [k]: d[k] });
      if (d.at?.[k] != null) fill.at = { ...fill.at, [k]: d.at[k] };
    }
    if (Object.keys(fill).length > 1) importBody.push(fill);
  }

  const merged = mergeBuddyMeta(local.buddies, b.buddies);
  const buddies = Object.fromEntries(Object.entries(merged).filter(([k, v]) => local.buddies[k] === undefined || metaHash(v) !== metaHash(local.buddies[k])));
  return { taken: { importSets: [...incoming.values()], deleteIds, importBody }, held: held.size, buddies };
}

/** The last backup file saved of a profile: when, how many photos it held, and when its nudge was last put off (Not now). */
export interface BackupMark { at?: string; photos?: number; snoozed?: string }
/** Photos added or retaken since the last backup: so far on this phone alone. */
export const unbackedPhotos = (metas: readonly PhotoMeta[], mark: BackupMark | null): number => metas.filter((m) => m.addedAt > (mark?.at ?? '')).length;
export const NUDGE_AT = 3;
/** The backup nudge: 3 or more photos added since the last backup (or ever, with none) and since it was last put off. */
export function backupDue(metas: readonly PhotoMeta[], mark: BackupMark | null): boolean {
  const since = [mark?.at ?? '', mark?.snoozed ?? ''].sort().at(-1)!;
  return metas.filter((m) => m.addedAt > since).length >= NUDGE_AT;
}
