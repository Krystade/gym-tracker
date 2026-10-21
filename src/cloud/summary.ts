import { parseSummary, type ReadSummary, type Summary } from '../domain/compare';
import type { Cloud } from './firebase';

/**
 * Compare's one document a person: users/{uid}/summary/compare (domain/compare Summary). Only its owner writes it, at the
 * server's time; only they and their friends read it (firestore.rules, match /summary). A friend's page costs that one read.
 */
export const summaryPath = (uid: string) => `users/${uid}/summary/compare`;

export async function writeSummary({ F, db }: Cloud, me: string, s: Summary): Promise<void> {
  await F.setDoc(F.doc(db, summaryPath(me)), { ...s, at: F.serverTimestamp() });
}

/** A friend's summary, or null: none written yet (an older app, or a phone that hasn't synced since), or one this app can't read. */
export async function readSummary({ F, db }: Cloud, uid: string): Promise<ReadSummary | null> {
  const d = await F.getDoc(F.doc(db, summaryPath(uid)));
  return d.exists() ? parseSummary(d.data()) : null;
}

/** How often your phone may write it: while you log a session it changes with every set, and friends needn't see each one. */
export const PUBLISH_MS = 15 * 60_000;
