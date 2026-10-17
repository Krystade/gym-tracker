import type { ProfileDb } from '../db/db';
import { mergeCycle, type CyclePhase } from '../domain/cycle';
import type { Cloud } from './firebase';

/** The account's copy: one document only its owner can read (firestore.rules, match /private). Friends never read it. */
export interface CloudCycle { days: Record<string, CyclePhase>; tracking: boolean; updatedAt: number }
export const cyclePath = (uid: string) => `users/${uid}/private/cycle`;

/**
 * Syncs the cycle days, per date with the phone winning. Reads the account's copy only when there's something to do: the
 * setting is on, something changed here, or this phone hasn't synced it with this account yet. Returns how many days came in.
 */
export async function syncCycle({ F, db: fs }: Pick<Cloud, 'F' | 'db'>, uid: string, db: ProfileDb, now = Date.now()): Promise<number> {
  const { days, cfg } = await db.getCycle();
  if (!cfg.tracking && cfg.synced?.uid === uid && cfg.synced.rev === cfg.rev) return 0;
  const ref = F.doc(fs, cyclePath(uid));
  if (cfg.wiped) await F.deleteDoc(ref);
  const snap = cfg.wiped ? null : await F.getDoc(ref);
  const remote = snap?.exists() ? (snap.data() as CloudCycle) : null;
  const m = mergeCycle(days, remote?.days ?? {});
  const tracking = cfg.tracking ?? remote?.tracking ?? false;
  if (m.changed || (cfg.tracking != null && tracking !== (remote?.tracking ?? false))) await F.setDoc(ref, { days: m.days, tracking, updatedAt: now } satisfies CloudCycle);
  await db.finishCycleSync(uid, cfg.rev, m.pull, remote?.tracking);
  return m.pull.length;
}
