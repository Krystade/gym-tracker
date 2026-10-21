import type { BodyDay } from '../domain/body';
import { mergeMeta, mergeMonth, metaHash, monthHash, monthOf, monthsToSync, splitByMonth, type CloudMonth, type MetaItems, type Seen } from '../domain/cloud';
import { prIds } from '../domain/records';
import type { SetEntry } from '../domain/types';
import type { Replaced, Taken } from '../domain/replaced';
import { addDays } from '../domain/analytics';
import { localDate } from '../domain/ids';
import type { Cloud } from './firebase';
import type { ProfileDb } from '../db/db';

/**
 * What the last sync left your settings as: each item's fingerprint, and the cloud copy's time. `plansFrom`: the first date whose
 * day plan still syncs (see syncMeta); unset until this phone's first sync with a build that ages plans out.
 */
export interface MetaSeen { items: Record<string, string>; at: number; plansFrom?: string }
/** `tombAt`: when each set deleted on this phone went (see db getTombstoneTimes). */
export interface SyncInput { sets: SetEntry[]; body: BodyDay[]; tombstones: Set<string>; tombAt?: Record<string, number>; seen: Seen; meta: MetaItems; metaSeen: MetaSeen }
/** What a month's save took (`taken`), this phone's values it kept aside (`replaced`), and how many sets and body fields it left. */
export interface Applied { taken: Taken; replaced: Replaced[]; skipped: number }
/**
 * The phone's side. Each save lands seconds after the sync read the phone, so it takes only what's still as `base` had it: a set,
 * body field or setting changed here meanwhile is left for the next sync (db applySynced, applySyncedMeta). Each throws if it couldn't save.
 */
export interface SyncApply {
  /** One month: the sets and body fields the sync takes, and this phone's values they replace, kept first (domain/replaced), together. */
  applyMonth: (base: { sets: SetEntry[]; body: BodyDay[] }, taken: Taken, now: number) => Promise<Applied>;
  /** Settings: those the cloud had newer (`pull`), and those deleted on another phone (`remove`: a renamed lift's, say). */
  applyMeta: (base: MetaItems, pull: MetaItems, remove: string[]) => Promise<{ pulled: number; removed: number; skipped: number }>;
}
/**
 * `replaced`: this phone's values kept aside because the sync replaced them; `replacedSets`, how many of them were sets.
 * `skipped`: sets, body fields and settings changed on this phone while the sync was out, left for the next one.
 */
export interface SyncOutcome { seen: Seen; metaSeen: MetaSeen; pulled: number; pushed: number; removed: number; metaPulled: number; replaced: number; replacedSets: number; skipped: number }

/**
 * The phone's side of a sync, on one profile's database (shared with the backup sync, domain/sync). `after` re-reads what a save
 * changed: the log (sets and body days), the settings, the list of copies a sync replaced.
 */
export function phoneApply(db: Pick<ProfileDb, 'applySynced' | 'applySyncedMeta'>, after: { log?: () => unknown; meta?: () => unknown; replaced?: () => unknown } = {}): SyncApply {
  return {
    applyMonth: async (base, taken, now) => {
      const r = await db.applySynced(base, taken, now);
      if (r.replaced.length) after.replaced?.();
      if (r.taken.importSets.length || r.taken.deleteIds.length || r.taken.importBody.length) await after.log?.();
      return r;
    },
    applyMeta: async (base, pull, remove) => {
      const r = await db.applySyncedMeta(base, pull, remove);
      if (r.pulled || r.removed) await after.meta?.();
      return r;
    },
  };
}

/**
 * Syncs the months that changed on either side since the last sync. Each month is one transaction (read, merge, write),
 * so two phones syncing at once can't drop each other's sets; the index says which months changed in the cloud.
 */
export async function syncCloud({ F, db }: Cloud, uid: string, input: SyncInput, apply: SyncApply, now = Date.now()): Promise<SyncOutcome> {
  const indexRef = F.doc(db, `users/${uid}/meta/index`);
  const indexDoc = (await F.getDoc(indexRef)).data();
  const index = (indexDoc?.months ?? {}) as Record<string, number>;
  const local = splitByMonth(input.sets, input.body, input.tombstones, input.tombAt);
  const seen: Seen = { ...input.seen };
  const out = { pulled: 0, pushed: 0, removed: 0, replaced: 0, replacedSets: 0, skipped: 0 };
  for (const m of monthsToSync(local, index, input.seen).sort()) {
    const here = local.get(m) ?? { sets: [], body: [], tombstones: new Set<string>() };
    const ref = F.doc(db, `users/${uid}/months/${m}`);
    const { merged, at } = await F.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const remote = snap.exists() ? (snap.data() as CloudMonth) : null;
      const merged = mergeMonth(here, remote, now);
      if (merged.changed) {
        // The month's PRs go with it, for friends' badges: from this phone's whole log, with the month as merged. Only on a write
        // the sets make anyway, so two phones that see a PR differently never trade the month back and forth over it.
        tx.set(ref, { ...merged.doc, prs: monthPrs(input.sets, m, merged.doc.sets) });
        tx.set(indexRef, { months: { [m]: merged.doc.updatedAt } }, { merge: true });
      }
      return { merged, at: merged.changed ? merged.doc.updatedAt : remote?.updatedAt ?? 0 };
    });
    // The cloud has the merge; now the phone takes what it lacked, with what it replaces kept first. A failed save stops here,
    // so the next sync redoes this month; so does anything changed here meanwhile, which the save leaves as it is.
    const { taken, replaced, skipped } = await apply.applyMonth(here, merged, now).catch((e: unknown) => {
      throw new Error(`Saving the synced log on this phone failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    const tombstones = new Set([...here.tombstones, ...taken.deleteIds]);
    seen[m] = { hash: monthHash({ sets: merged.doc.sets, body: merged.doc.body, tombstones }), at };
    out.pulled += taken.importSets.length;
    out.removed += taken.deleteIds.length;
    out.replaced += replaced.length;
    out.replacedSets += replaced.filter((r) => r.kind === 'set').length;
    out.skipped += skipped;
    if (merged.changed) out.pushed++;
  }
  const meta = await syncMeta({ F, db }, uid, input, apply, (indexDoc?.meta ?? 0) as number, now);
  return { seen, ...out, metaSeen: meta.metaSeen, metaPulled: meta.metaPulled, skipped: out.skipped + meta.skipped };
}

/** The PR set ids among `month`'s sets (`sets`), judged against the whole log as this phone has it (domain/records). */
function monthPrs(log: SetEntry[], month: string, sets: SetEntry[]): string[] {
  const ids = prIds([...log.filter((s) => monthOf(s.date) !== month), ...sets]);
  return sets.filter((s) => ids.has(s.id)).map((s) => s.id);
}

/**
 * Day plans this many days old and more leave the settings document for the archive (see syncMeta). The rotation and adherence
 * read only recent ones (a friend's view of you too), and each phone keeps its own.
 */
export const PLAN_DAYS = 90;
/** The first date whose day plan stays in the settings document on `now`'s day. */
const planCutoff = (now: number) => addDays(localDate(new Date(now)), -PLAN_DAYS);
const later = (a: string, b: string | undefined) => (b && b > a ? b : a);
/** A day plan from before `cut`: 'day:YYYY-MM-DD'. */
const aged = (k: string, cut: string) => k.startsWith('day:') && k.slice(4) < cut;
const split = <T,>(x: Record<string, T>, cut: string) => {
  const recent: Record<string, T> = {}, old: Record<string, T> = {};
  for (const [k, v] of Object.entries(x)) (aged(k, cut) ? old : recent)[k] = v;
  return { recent, old };
};
const parsed = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, JSON.parse(v) as unknown]));
const stringified = (x: MetaItems) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, JSON.stringify(v)]));
/** The settings document. `plansFrom`: the cutoff the last write used (an older build's write leaves it out). */
interface MetaDoc { items: Record<string, string>; updatedAt: number; plansFrom?: string }

/** The archive of old day plans, one document a year (meta/plans-YYYY), as JSON per item like the settings document. */
async function readArchive({ F, db }: Pick<Cloud, 'F' | 'db'>, uid: string): Promise<Record<string, string>> {
  const q = F.query(F.collection(db, `users/${uid}/meta`), F.where(F.documentId(), '>=', 'plans-'), F.where(F.documentId(), '<', 'plans.'));
  return Object.assign({}, ...(await F.getDocs(q)).docs.map((d) => (d.data().items ?? {}) as Record<string, string>));
}

/**
 * Your settings live in one document, stored as JSON per item (Firestore can't hold arrays of arrays, or undefined), and every
 * sync that changes one reads and writes it whole. A day plan is saved each training day, so plans older than PLAN_DAYS leave it
 * for an archive document per year, written in the same transaction; the phone keeps its own. Only plans from the cutoff on are
 * merged: an old plan is never taken as deleted on either side, and a phone with a later date (time zone) sets the cutoff for
 * all, through `plansFrom`. Old plans this phone lacks it takes from the document as they leave it. A phone's first sync with
 * this build also reads the archive, takes what it lacks, and archives its own old plans the account lacks (a first sign-in, or
 * plans an older build dropped here), so old plans end up the same on every phone and in the cloud.
 */
async function syncMeta({ F, db }: Pick<Cloud, 'F' | 'db'>, uid: string, input: SyncInput, apply: SyncApply, remoteAt: number, now: number) {
  const { meta: local, metaSeen } = input;
  const first = metaSeen.plansFrom === undefined;
  const cut0 = later(planCutoff(now), metaSeen.plansFrom);
  const mine = split(local, cut0).recent, seen = split(metaSeen.items, cut0).recent;
  const same = !first && Object.keys(mine).length === Object.keys(seen).length && Object.entries(mine).every(([k, v]) => seen[k] === metaHash(v));
  if (same && remoteAt === metaSeen.at) return { metaSeen, metaPulled: 0, skipped: 0 };
  const archived = first ? await readArchive({ F, db }, uid) : {};
  const ref = F.doc(db, `users/${uid}/meta/profile`), indexRef = F.doc(db, `users/${uid}/meta/index`);
  const { merged, at, cut, old } = await F.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.exists() ? (snap.data() as MetaDoc) : null;
    const cut = later(cut0, raw?.plansFrom);
    const doc = split(raw?.items ?? {}, cut), here = split(local, cut);
    const merged = mergeMeta(here.recent, raw && parsed(doc.recent), split(metaSeen.items, cut).recent);
    const leaving = Object.keys(doc.old).length > 0;
    if (merged.changed || leaving) {
      tx.set(ref, { items: stringified(merged.items), updatedAt: now, plansFrom: cut });
      tx.set(indexRef, { meta: now }, { merge: true });
    }
    // To the archive: what leaves the document, and on a first sync this phone's old plans the archive lacks.
    const keep = { ...(first ? Object.fromEntries(Object.entries(stringified(here.old)).filter(([k]) => !(k in archived))) : {}), ...doc.old };
    const years = new Map<string, Record<string, string>>();
    for (const [k, v] of Object.entries(keep)) years.set(k.slice(4, 8), { ...years.get(k.slice(4, 8)), [k]: v });
    for (const [y, items] of years) tx.set(F.doc(db, `users/${uid}/meta/plans-${y}`), { items, updatedAt: now }, { merge: true });
    const old = Object.fromEntries(Object.entries({ ...split(archived, cut).old, ...doc.old }).filter(([k]) => !(k in local)));
    return { merged, at: merged.changed || leaving ? now : raw?.updatedAt ?? 0, cut, old: parsed(old) };
  });
  // A setting changed here meanwhile is left as it is: the fingerprint below no longer matches it, so the next sync sends it up.
  const pull = { ...old, ...merged.pull };
  const done = Object.keys(pull).length || merged.remove.length ? await apply.applyMeta(local, pull, merged.remove) : { pulled: 0, removed: 0, skipped: 0 };
  return { metaSeen: { items: merged.seen, at, plansFrom: cut }, metaPulled: done.pulled + done.removed, skipped: done.skipped };
}

/**
 * Every cloud document of this account that the owner can delete: the log, the index, friends, invites, requests, private
 * (cycle), gyms and messages sent to you, who you blocked, and your send counters.
 */
export async function deleteCloudData({ F, db }: Cloud, uid: string): Promise<void> {
  const index = ((await F.getDoc(F.doc(db, `users/${uid}/meta/index`))).data()?.months ?? {}) as Record<string, number>;
  const refs = Object.keys(index).map((m) => F.doc(db, `users/${uid}/months/${m}`));
  // Off your friends' lists too (the rules let you delete yourself from them), so nobody keeps a link to a gone account.
  for (const d of (await F.getDocs(F.collection(db, `users/${uid}/friends`))).docs) refs.push(F.doc(db, `users/${d.id}/friends/${uid}`));
  // Before the rules for a newer collection are deployed, listing it is refused; there's nothing in it to delete then. Any
  // other failure (offline, a timeout) stops the delete, so an account is never deleted with anything left behind.
  const refused = (e: unknown) => { if ((e as { code?: string }).code === 'permission-denied') return { docs: [] }; throw e; };
  const newer = new Set(['private', 'gymInbox', 'inbox', 'blocked', 'sendRate', 'summary']);
  const listed = async (sub: string) => {
    const list = F.getDocs(F.collection(db, `users/${uid}/${sub}`));
    return (await (newer.has(sub) ? list.catch(refused) : list)).docs.map((d) => d.ref);
  };
  for (const sub of ['meta', 'friends', 'invites', 'requests', 'private', 'gymInbox', 'inbox', 'blocked', 'summary']) refs.push(...(await listed(sub)));
  // The send counters go in the same write as the profile: the rules let a counter inside its hour go only with the account.
  const last = await listed('sendRate');
  const profile = await F.getDoc(F.doc(db, `users/${uid}`));
  const username = profile.data()?.username as string | undefined;
  // The name goes with the profile, in one write: the rules release a name only as the profile stops going by it.
  if (username) last.push(F.doc(db, `usernames/${username}`));
  last.push(F.doc(db, `users/${uid}`));
  const chunks: (typeof refs)[] = [];
  for (let i = 0; i < refs.length; i += 400) chunks.push(refs.slice(i, i + 400));
  chunks.push(last);
  for (const c of chunks) {
    const b = F.writeBatch(db);
    for (const r of c) b.delete(r);
    await b.commit();
  }
}
