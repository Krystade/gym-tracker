import type { Cloud } from '../cloud/firebase';
import { PUBLISH_MS, writeSummary } from '../cloud/summary';
import { achievementsOf, shareOf } from '../domain/achievements';
import { summarize, summaryKey } from '../domain/compare';
import { defaultProfile, type Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import { localDate } from '../domain/ids';
import type { SetEntry } from '../domain/types';
import { getPref, setPref } from './prefs';

// Compare: your summary for friends (domain/compare), written from this phone after a sync, when it changed and at most every
// 15 minutes (cloud/summary PUBLISH_MS), so a session logged set by set writes it a few times, not once a set. The Spark
// plan's 20,000 writes a day are never near: one a quarter-hour while training, about one a day otherwise.

/** What was last written from this phone (a hash of it, and when), and when it was last worked out to find nothing new. */
interface Mark { hash: string; at: number; checked: number }
const scope = (uid: string) => `acct:${uid}`;
const NAME = 'compare:published';

/** A short hash of what the summary says, so the phone keeps 13 characters rather than the whole document. */
export function hashOf(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface PublishSource {
  getSyncSnapshot(): Promise<{ sets: SetEntry[]; tombstones: Set<string> }>;
  getProfile(): Promise<Profile | undefined>;
  /** The day achievements count from (none yet: the summary goes without them). */ getAchStart(): Promise<string | null | undefined>;
  getProgram(): Promise<Program | null | undefined>;
  getDayPlans(): Promise<DayPlan[]>;
}

/** Your achievements as friends get them (domain/achievements shareOf): none before the start day is kept. Never fails the summary. */
function sharedAch(sets: SetEntry[], today: string, profile: Profile | undefined, since: string | null | undefined, program: Program | null | undefined, plans: DayPlan[]) {
  if (!since) return undefined;
  try {
    const p = { ...defaultProfile(), ...profile };
    return shareOf(achievementsOf(sets, { profile: p, today, since, program: program ?? null, plans }), p.achHidden);
  } catch { return undefined; }
}

/**
 * After a sync: your summary written if it changed and the last write (or look) is 15 minutes old. Worked out from the log as
 * the phone's database holds it now (what the sync just brought in included), off the busy moment after a set. A write the
 * cloud refuses (the rules for it not deployed yet) waits the same 15 minutes to try again. True when it wrote.
 */
export async function publishSummary(c: Cloud, uid: string, db: PublishSource, now = Date.now()): Promise<boolean> {
  const last = getPref<Mark>(scope(uid), NAME);
  if (last && now - Math.max(last.at, last.checked) < PUBLISH_MS) return false;
  const [log, profile, since, program, plans] = await Promise.all([db.getSyncSnapshot(), db.getProfile(), db.getAchStart(), db.getProgram(), db.getDayPlans()]);
  const sets = log.sets.filter((e) => !log.tombstones.has(e.id)), today = localDate(new Date(now));
  const s = summarize(sets, today, profile?.weeklyGoal ?? 2, sharedAch(sets, today, profile, since, program, plans));
  const hash = hashOf(summaryKey(s));
  if (last?.hash === hash) { setPref(scope(uid), NAME, { ...last, checked: now }); return false; }
  setPref(scope(uid), NAME, { hash: last?.hash ?? '', at: last?.at ?? 0, checked: now });
  await writeSummary(c, uid, s);
  setPref(scope(uid), NAME, { hash, at: now, checked: now });
  return true;
}
