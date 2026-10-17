import type { BodyDay } from '../domain/body';
import { mergeMeta, mergeMonth, metaHash, monthHash, monthsToSync, splitByMonth, type CloudMonth, type MetaItems, type Seen } from '../domain/cloud';
import type { SetEntry } from '../domain/types';
import type { Replaced, Taken } from '../domain/replaced';
import type { Cloud } from './firebase';
import type { ProfileDb } from '../db/db';

/** What the last sync left your settings as: each item's fingerprint, and the cloud copy's time. */
export interface MetaSeen { items: Record<string, string>; at: number }
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
        tx.set(ref, merged.doc);
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

/** Your settings live in one document, stored as JSON per item (Firestore can't hold arrays of arrays, or undefined). */
async function syncMeta({ F, db }: Pick<Cloud, 'F' | 'db'>, uid: string, input: SyncInput, apply: SyncApply, remoteAt: number, now: number) {
  const { meta: local, metaSeen } = input;
  const same = Object.keys(local).length === Object.keys(metaSeen.items).length && Object.entries(local).every(([k, v]) => metaSeen.items[k] === metaHash(v));
  if (same && remoteAt === metaSeen.at) return { metaSeen, metaPulled: 0, skipped: 0 };
  const ref = F.doc(db, `users/${uid}/meta/profile`), indexRef = F.doc(db, `users/${uid}/meta/index`);
  const { merged, at } = await F.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.exists() ? (snap.data() as { items: Record<string, string>; updatedAt: number }) : null;
    const remote = raw && Object.fromEntries(Object.entries(raw.items).map(([k, v]) => [k, JSON.parse(v) as unknown]));
    const merged = mergeMeta(local, remote, metaSeen.items);
    if (merged.changed) {
      tx.set(ref, { items: Object.fromEntries(Object.entries(merged.items).map(([k, v]) => [k, JSON.stringify(v)])), updatedAt: now });
      tx.set(indexRef, { meta: now }, { merge: true });
    }
    return { merged, at: merged.changed ? now : raw?.updatedAt ?? 0 };
  });
  // A setting changed here meanwhile is left as it is: the fingerprint below no longer matches it, so the next sync sends it up.
  const done = Object.keys(merged.pull).length || merged.remove.length ? await apply.applyMeta(local, merged.pull, merged.remove) : { pulled: 0, removed: 0, skipped: 0 };
  return { metaSeen: { items: merged.seen, at }, metaPulled: done.pulled + done.removed, skipped: done.skipped };
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
  const newer = new Set(['private', 'gymInbox', 'inbox', 'blocked', 'sendRate']);
  const listed = async (sub: string) => {
    const list = F.getDocs(F.collection(db, `users/${uid}/${sub}`));
    return (await (newer.has(sub) ? list.catch(refused) : list)).docs.map((d) => d.ref);
  };
  for (const sub of ['meta', 'friends', 'invites', 'requests', 'private', 'gymInbox', 'inbox', 'blocked']) refs.push(...(await listed(sub)));
  // The send counters go in the same write as the profile: the rules let a counter inside its hour go only with the account.
  const last = await listed('sendRate');
  const profile = await F.getDoc(F.doc(db, `users/${uid}`));
  const username = profile.data()?.username as string | undefined;
  if (username) refs.push(F.doc(db, `usernames/${username}`));
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
