import type { ProfileDb } from '../db/db';
import { decodeLedger, encodeLedger, hasNew, mergeLedgers } from '../domain/together';
import type { Cloud } from './firebase';

/**
 * Together's ledger (domain/together), on the account: one document only its owner can read (firestore.rules, match /private),
 * never in meta/profile, which friends read: a third friend would learn who trained with whom. A union, so phones merge it
 * without conflict.
 */
export const togetherPath = (uid: string) => `users/${uid}/private/together`;
/** How long the account's copy goes unread when nothing changed here: another phone's bits come in within a day. */
export const TOGETHER_READ_MS = 24 * 3600_000;

/**
 * Merges this phone's ledger with the account's. Reads it only when something changed here since the last merge, on the first
 * sync with this account, or a day after the last read; writes it only when it lacks something this phone has. Returns whether
 * something came in (the screens read the ledger again).
 */
export async function syncTogether({ F, db: fs }: Pick<Cloud, 'F' | 'db'>, uid: string, db: ProfileDb, now = Date.now()): Promise<boolean> {
  const kept = await db.getTogether(uid);
  if (kept.synced && kept.synced.rev === kept.rev && now - kept.synced.at < TOGETHER_READ_MS) return false;
  const ref = F.doc(fs, togetherPath(uid));
  const snap = await F.getDoc(ref);
  const remote = decodeLedger(snap.exists() ? snap.data() : null), local = decodeLedger(kept.ledger);
  const merged = mergeLedgers(remote, local);
  if (hasNew(remote, merged)) await F.setDoc(ref, { ...encodeLedger(merged), updatedAt: now });
  const pulled = hasNew(local, merged);
  await db.finishTogetherSync(uid, kept.rev, pulled ? encodeLedger(merged) : null, now);
  return pulled;
}
