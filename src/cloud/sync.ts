import type { BodyDay } from '../domain/body';
import { mergeMeta, mergeMonth, metaHash, monthHash, monthsToSync, splitByMonth, type CloudMonth, type MetaItems, type Seen } from '../domain/cloud';
import type { SetEntry } from '../domain/types';
import type { Cloud } from './firebase';

/** What the last sync left your settings as: each item's fingerprint, and the cloud copy's time. */
export interface MetaSeen { items: Record<string, string>; at: number }
export interface SyncInput { sets: SetEntry[]; body: BodyDay[]; tombstones: Set<string>; seen: Seen; meta: MetaItems; metaSeen: MetaSeen }
export interface SyncApply {
  importSets: (s: SetEntry[]) => Promise<unknown>; importBody: (d: BodyDay[]) => Promise<boolean>; removeSets: (ids: string[]) => Promise<boolean>;
  importMeta: (m: MetaItems) => Promise<void>;
}
export interface SyncOutcome { seen: Seen; metaSeen: MetaSeen; pulled: number; pushed: number; removed: number; metaPulled: number }

/**
 * Syncs the months that changed on either side since the last sync. Each month is one transaction (read, merge, write),
 * so two phones syncing at once can't drop each other's sets; the index says which months changed in the cloud.
 */
export async function syncCloud({ F, db }: Cloud, uid: string, input: SyncInput, apply: SyncApply, now = Date.now()): Promise<SyncOutcome> {
  const indexRef = F.doc(db, `users/${uid}/meta/index`);
  const indexDoc = (await F.getDoc(indexRef)).data();
  const index = (indexDoc?.months ?? {}) as Record<string, number>;
  const local = splitByMonth(input.sets, input.body, input.tombstones);
  const seen: Seen = { ...input.seen };
  const out = { pulled: 0, pushed: 0, removed: 0 };
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
    // The cloud has the merge; now the phone takes what it lacked. A failed save stops here, so the next sync redoes this month.
    if (merged.importSets.length && (await apply.importSets(merged.importSets)) == null) throw new Error('Saving the synced sets on this phone failed.');
    if (merged.importBody.length && !(await apply.importBody(merged.importBody))) throw new Error('Saving the synced body days on this phone failed.');
    if (merged.deleteIds.length && !(await apply.removeSets(merged.deleteIds))) throw new Error('Removing sets deleted on another phone failed.');
    const tombstones = new Set([...here.tombstones, ...merged.deleteIds]);
    seen[m] = { hash: monthHash({ sets: merged.doc.sets, body: merged.doc.body, tombstones }), at };
    out.pulled += merged.importSets.length;
    out.removed += merged.deleteIds.length;
    if (merged.changed) out.pushed++;
  }
  const meta = await syncMeta({ F, db }, uid, input, apply, (indexDoc?.meta ?? 0) as number, now);
  return { seen, ...out, ...meta };
}

/** Your settings live in one document, stored as JSON per item (Firestore can't hold arrays of arrays, or undefined). */
async function syncMeta({ F, db }: Pick<Cloud, 'F' | 'db'>, uid: string, input: SyncInput, apply: SyncApply, remoteAt: number, now: number) {
  const { meta: local, metaSeen } = input;
  const same = Object.keys(local).length === Object.keys(metaSeen.items).length && Object.entries(local).every(([k, v]) => metaSeen.items[k] === metaHash(v));
  if (same && remoteAt === metaSeen.at) return { metaSeen, metaPulled: 0 };
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
  if (Object.keys(merged.pull).length) await apply.importMeta(merged.pull);
  return { metaSeen: { items: merged.seen, at }, metaPulled: Object.keys(merged.pull).length };
}

/** Every cloud document of this account that the owner can delete: the log, the index, friends, invites and requests. */
export async function deleteCloudData({ F, db }: Cloud, uid: string): Promise<void> {
  const index = ((await F.getDoc(F.doc(db, `users/${uid}/meta/index`))).data()?.months ?? {}) as Record<string, number>;
  const refs = Object.keys(index).map((m) => F.doc(db, `users/${uid}/months/${m}`));
  // Off your friends' lists too (the rules let you delete yourself from them), so nobody keeps a link to a gone account.
  for (const d of (await F.getDocs(F.collection(db, `users/${uid}/friends`))).docs) refs.push(F.doc(db, `users/${d.id}/friends/${uid}`));
  for (const sub of ['meta', 'friends', 'invites', 'requests']) {
    for (const d of (await F.getDocs(F.collection(db, `users/${uid}/${sub}`))).docs) refs.push(d.ref);
  }
  const profile = await F.getDoc(F.doc(db, `users/${uid}`));
  const username = profile.data()?.username as string | undefined;
  if (username) refs.push(F.doc(db, `usernames/${username}`));
  refs.push(F.doc(db, `users/${uid}`));
  for (let i = 0; i < refs.length; i += 400) {
    const b = F.writeBatch(db);
    for (const r of refs.slice(i, i + 400)) b.delete(r);
    await b.commit();
  }
}
