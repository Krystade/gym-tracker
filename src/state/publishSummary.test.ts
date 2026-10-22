import { describe, expect, it } from 'vitest';
import { fakeFirestore } from '../cloud/fakeFirestore';
import { PUBLISH_MS } from '../cloud/summary';
import { defaultProfile, type Profile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { hashOf, publishSummary, type PublishSource } from './publishSummary';

// Synthetic sets only.
const set = (date: string, weight: number, n: number): SetEntry => ({ id: `t|${date}|bench|${n}`, date, seq: n, exercise: 'Bench Press', setNo: 1, weight, reps: 5, flags: [], source: 't' });
const T = Date.parse('2026-10-21T18:00:00');

function phone(sets: SetEntry[], goal = 3, tombstones: string[] = [], since: string | undefined = undefined, extra: Partial<Profile> = {}) {
  const log = { sets, tombstones: new Set(tombstones) };
  const src: PublishSource = {
    getSyncSnapshot: async () => log, getProfile: async () => ({ ...defaultProfile(), weeklyGoal: goal, ...extra }),
    getAchStart: async () => since, getProgram: async () => undefined, getDayPlans: async () => [],
  };
  return { src, log };
}
let account = 0;

describe('publishSummary: your summary, from this phone, when it changed and at most every 15 minutes', () => {
  it('writes the first time, then not again within 15 minutes even if it changed', async () => {
    const uid = `u${++account}`, w = fakeFirestore(), p = phone([set('2026-10-01', 135, 1)]);
    expect(await publishSummary(w.cloud, uid, p.src, T)).toBe(true);
    const doc = w.docs[`users/${uid}/summary/compare`];
    expect(doc).toMatchObject({ v: 1, day: '2026-10-21', goal: 3 });
    expect(doc.at).toBeDefined(); // the server's time
    p.log.sets.push(set('2026-10-21', 140, 2));
    expect(await publishSummary(w.cloud, uid, p.src, T + PUBLISH_MS - 1)).toBe(false);
    expect(await publishSummary(w.cloud, uid, p.src, T + PUBLISH_MS)).toBe(true);
  });
  it('nothing changed: no write, and no working it out again for another 15 minutes', async () => {
    const uid = `u${++account}`, w = fakeFirestore(), p = phone([set('2026-10-01', 135, 1)]);
    await publishSummary(w.cloud, uid, p.src, T);
    let reads = 0;
    const counted: PublishSource = { ...p.src, getSyncSnapshot: async () => { reads++; return p.log; } };
    delete w.docs[`users/${uid}/summary/compare`];
    expect(await publishSummary(w.cloud, uid, counted, T + PUBLISH_MS)).toBe(false);
    expect(reads).toBe(1);
    expect(w.docs[`users/${uid}/summary/compare`]).toBeUndefined();
    expect(await publishSummary(w.cloud, uid, counted, T + PUBLISH_MS + 60_000)).toBe(false);
    expect(reads).toBe(1); // looked at 15 minutes after the write: the next look waits 15 from then
  });
  it('a new day is a change (its ranges move on); so is a new goal; a deleted set isn’t counted', async () => {
    const uid = `u${++account}`, w = fakeFirestore(), p = phone([set('2026-10-01', 135, 1), set('2026-10-08', 300, 9)], 3, ['t|2026-10-08|bench|9']);
    await publishSummary(w.cloud, uid, p.src, T);
    // The deleted 300 would be a first 225 Bench Press and a climb: the summary is the one a phone without it publishes.
    const clean = `u${++account}`;
    await publishSummary(w.cloud, clean, phone([set('2026-10-01', 135, 1)]).src, T);
    const { at: _a, ...mine } = w.docs[`users/${uid}/summary/compare`] as Record<string, unknown>;
    const { at: _b, ...without } = w.docs[`users/${clean}/summary/compare`] as Record<string, unknown>;
    expect(mine).toEqual(without);
    expect(mine.firsts).toEqual([]);
    expect(await publishSummary(w.cloud, uid, p.src, T + 864e5)).toBe(true);
    expect(w.docs[`users/${uid}/summary/compare`]).toMatchObject({ day: '2026-10-22' });
    expect(await publishSummary(w.cloud, uid, phone(p.log.sets, 5, ['t|2026-10-08|bench|9']).src, T + 2 * 864e5 - 1)).toBe(true);
  });
  it('a write the cloud refuses waits 15 minutes to try again, and is tried again', async () => {
    const uid = `u${++account}`, w = fakeFirestore(), p = phone([set('2026-10-01', 135, 1)]);
    const F = w.cloud.F as unknown as { setDoc: (...a: unknown[]) => Promise<void> };
    const ok = F.setDoc;
    F.setDoc = async () => { throw Object.assign(new Error('refused'), { code: 'permission-denied' }); };
    await expect(publishSummary(w.cloud, uid, p.src, T)).rejects.toMatchObject({ code: 'permission-denied' });
    F.setDoc = ok;
    expect(await publishSummary(w.cloud, uid, p.src, T + 60_000)).toBe(false);
    expect(await publishSummary(w.cloud, uid, p.src, T + PUBLISH_MS)).toBe(true);
  });
  it('the hash tells summaries apart', () => {
    expect(hashOf('a')).not.toBe(hashOf('b'));
    expect(hashOf('{"v":1}')).toBe(hashOf('{"v":1}'));
  });
  it('achievements go with it from the start day on, the highest of each, and a group kept from friends stays out', async () => {
    const uid = `u${++account}`, w = fakeFirestore();
    // Before any start day: none, and the summary is as an app from before them sends it.
    await publishSummary(w.cloud, uid, phone([set('2026-10-01', 135, 1)]).src, T);
    expect(w.docs[`users/${uid}/summary/compare`]).not.toHaveProperty('ach');
    // Counting from Oct 20: a first session, plates at 135 then 225 (the highest only), the Oct 1 set before it counts nothing.
    const log = [set('2026-10-01', 135, 1), set('2026-10-20', 135, 2), set('2026-10-21', 225, 3)];
    const two = `u${++account}`;
    await publishSummary(w.cloud, two, phone(log, 3, [], '2026-10-20').src, T);
    expect(w.docs[`users/${two}/summary/compare`].ach).toEqual([
      { i: 'plates', l: 1, d: '2026-10-21', n: 'Bench Press' },
      { i: 'prs', l: 0, d: '2026-10-21' },
      { i: 'comeback', l: 0, d: '2026-10-20' }, // 19 days after Oct 1
      { i: 'sessions', l: 0, d: '2026-10-20' },
    ]);
    // Milestones and Getting stronger kept from friends: plates and PRs go, the rest stay.
    const three = `u${++account}`;
    await publishSummary(w.cloud, three, phone(log, 3, [], '2026-10-20', { achHidden: ['milestones', 'stronger'] }).src, T);
    expect(w.docs[`users/${three}/summary/compare`].ach).toEqual([{ i: 'comeback', l: 0, d: '2026-10-20' }, { i: 'sessions', l: 0, d: '2026-10-20' }]);
  });
});
