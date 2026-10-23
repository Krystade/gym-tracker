import { describe, expect, it } from 'vitest';
import { addDays, weekStart } from './analytics';
import { achievements, shareOf, unlocksOf, unlockText, DEF, type Context } from './achievements';
import { summarize } from './compare';
import { defaultProfile } from './profile';
import {
  decodeLedger, effective, encodeLedger, gymKey, hasNew, mergeLedgers, NO_LEDGER, pairStart, togetherDay, togetherOn, togetherSteps,
  weekRings, windowPairs, withList, type FriendSide, type Ledger, type Pair,
} from './together';
import type { Flag, SetEntry } from './types';

// Synthetic people and gyms only. Times are UTC; dates are the sets' own.
const MON = '2026-11-02'; // a Monday
const day = (n: number) => addDays(MON, n);
const TODAY = day(20); // a Sunday, three weeks in
const START = MON;
let seq = 0;
interface O { gym?: string; ex?: string; flags?: Flag[]; enteredAt?: string; source?: string; cardio?: boolean }
/** One set at `hm` (HH:MM, UTC) on a day. */
function set(date: string, hm: string, o: O = {}): SetEntry {
  const loggedAt = `${date}T${hm}:00.000Z`;
  return {
    id: `t|${date}|${++seq}`, date, seq: Date.parse(loggedAt), loggedAt, exercise: o.cardio ? 'Treadmill' : o.ex ?? 'Bench Press', setNo: seq,
    weight: o.cardio ? 0 : 135, reps: o.cardio ? null : 8, flags: o.cardio ? ['cardio'] : o.flags ?? [], source: o.source ?? 'app',
    ...(o.gym !== undefined && { gym: o.gym }), ...(o.enteredAt && { enteredAt: o.enteredAt }), ...(o.cardio && { cardio: { seconds: 1200 } }),
  };
}
/** A visit: a set every `gap` minutes from `hm`, `n` sets. */
function visit(date: string, hm: string, n: number, o: O = {}, gap = 4): SetEntry[] {
  const [h, m] = hm.split(':').map(Number);
  return Array.from({ length: n }, (_, i) => { const t = h * 60 + m + i * gap; return set(date, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, o); });
}
const IRON = { gym: 'Iron Den' };
const friend = (uid: string, sets: SetEntry[], over: Partial<FriendSide> = {}): FriendSide =>
  ({ uid, start: START, goal: 2, sets, from: addDays(TODAY, -55), met: null, ...over });
const together = (friends: FriendSide[], ledger: Ledger = NO_LEDGER) => ({ friends, ledger });
const ctx = (friends: FriendSide[], over: Partial<Context> = {}, ledger: Ledger = NO_LEDGER): Context =>
  ({ profile: { ...defaultProfile(), weeklyGoal: 2 }, today: TODAY, since: START, together: together(friends, ledger), ...over });
const unlocks = (mine: SetEntry[], c: Context, id: string) => achievements(mine, c).unlocks.filter((u) => u.id === id);
const steps = (mine: SetEntry[], friends: FriendSide[], ledger: Ledger = NO_LEDGER, since = START, goal = 2, today = TODAY) =>
  togetherSteps(effective(mine, since, goal, together(friends, ledger), today));

describe('trained together: one day, the same gym, 20 minutes, both live', () => {
  it('the same gym at the same time counts, named as yours names it', () => {
    const m = togetherOn(visit(day(0), '18:00', 8, IRON), visit(day(0), '18:10', 8, { gym: 'iron den' }));
    expect(m?.gym).toBe('Iron Den');
    expect(m!.to - m!.from).toBeGreaterThanOrEqual(20 * 60_000);
  });
  it('a gym’s name is compared trimmed, spaces collapsed, case folded', () => {
    expect(gymKey('  Iron   DEN ')).toBe(gymKey('iron den'));
    expect(togetherOn(visit(day(0), '18:00', 6, { gym: '  Iron   DEN ' }), visit(day(0), '18:00', 6, IRON))).not.toBeNull();
  });
  it('a different gym does not count, nor a set with no gym', () => {
    expect(togetherOn(visit(day(0), '18:00', 8, IRON), visit(day(0), '18:00', 8, { gym: 'Iron Den Annex' }))).toBeNull();
    expect(togetherOn(visit(day(0), '18:00', 8, IRON), visit(day(0), '18:00', 8))).toBeNull();
    expect(togetherOn(visit(day(0), '18:00', 8, { gym: '' }), visit(day(0), '18:00', 8, { gym: ' ' }))).toBeNull();
  });
  it('less than 20 minutes of overlap does not count; exactly 20 does (each visit 10 minutes either side)', () => {
    // One set each: spans 17:50–18:10 and 17:50–18:10 overlap 20 minutes; a minute later, 19.
    expect(togetherOn([set(day(0), '18:00', IRON)], [set(day(0), '18:00', IRON)])).not.toBeNull();
    expect(togetherOn([set(day(0), '18:00', IRON)], [set(day(0), '18:01', IRON)])).toBeNull();
    // Yours 18:00–18:20 (17:50–18:30), theirs 18:21–18:41 (18:11–18:51): 19 minutes.
    expect(togetherOn(visit(day(0), '18:00', 6, IRON), visit(day(0), '18:21', 6, IRON))).toBeNull();
    expect(togetherOn(visit(day(0), '18:00', 6, IRON), visit(day(0), '18:20', 6, IRON))).not.toBeNull();
  });
  it('late-entered sets do not count, on either side, nor sets with an edited time or an import', () => {
    const late = { ...IRON, enteredAt: `${day(0)}T22:00:00.000Z` };
    expect(togetherOn(visit(day(0), '18:00', 8, IRON), visit(day(0), '18:00', 8, late))).toBeNull();
    expect(togetherOn(visit(day(0), '18:00', 8, late), visit(day(0), '18:00', 8, IRON))).toBeNull();
    expect(togetherOn(visit(day(0), '18:00', 8, IRON), visit(day(0), '18:00', 8, { ...IRON, source: 'notes' }))).toBeNull();
    // One live set among late ones is a visit of its own: 17:50–18:10 against theirs, still counts if it overlaps 20 minutes.
    expect(togetherOn(visit(day(0), '18:00', 8, IRON), [...visit(day(0), '18:00', 7, late), set(day(0), '18:04', IRON)])).not.toBeNull();
  });
  it('a morning and an evening at the same gym are two visits: a friend there at noon was not with you', () => {
    const mine = [...visit(day(0), '08:00', 6, IRON), ...visit(day(0), '19:00', 6, IRON)];
    expect(togetherOn(mine, visit(day(0), '13:00', 6, IRON))).toBeNull();
    expect(togetherOn(mine, visit(day(0), '19:05', 6, IRON))).not.toBeNull();
  });
  it('warm-ups alone are not a visit; cardio is', () => {
    expect(togetherOn(visit(day(0), '18:00', 6, { ...IRON, flags: ['warmup'] }), visit(day(0), '18:00', 6, IRON))).toBeNull();
    expect(togetherOn(visit(day(0), '18:00', 3, { ...IRON, cardio: true }), visit(day(0), '18:00', 6, IRON))).not.toBeNull();
  });
  it('counts days, starter at 1 and bronze at 5, dated the fifth, with who and where', () => {
    const days = [0, 2, 4, 7, 9, 11];
    const mine = days.flatMap((d) => visit(day(d), '18:00', 6, IRON)), theirs = days.flatMap((d) => visit(day(d), '18:05', 6, IRON));
    const us = unlocks(mine, ctx([friend('ana', theirs)]), 'trained-together');
    expect(us.map((u) => [u.tier, u.date])).toEqual([['starter', day(0)], ['bronze', day(9)]]);
    expect(us[0].with).toEqual(['ana']);
    expect(us[0].gym).toBe('Iron Den');
    expect(unlockText(us[0], (u) => `@${u}_lifts`)).toBe('First session together: @ana_lifts, Iron Den');
  });
});

describe('the start: nothing before either start day counts', () => {
  const days = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const mine = days.flatMap((d) => visit(day(d), '18:00', 6, IRON)), theirs = days.flatMap((d) => visit(day(d), '18:00', 6, IRON));
  it('counts from the later of the two starts, whichever is later', () => {
    expect(steps(mine, [friend('ana', theirs, { start: day(5) })])['trained-together'].map((s) => s.date)).toEqual([day(5), day(6), day(7), day(8)]);
    expect(steps(mine, [friend('ana', theirs)], NO_LEDGER, day(7))['trained-together'].map((s) => s.date)).toEqual([day(7), day(8)]);
    expect(pairStart(day(3), day(5))).toBe(day(5));
    expect(pairStart(day(5), day(3))).toBe(day(5));
  });
  it('a friend who hasn’t started (an older app): nothing with them counts', () => {
    for (const start of [undefined, null, 'soon']) expect(windowPairs(mine, START, 2, [friend('ana', theirs, { start })], TODAY).pairs).toEqual({});
  });
  it('a ledger day from before the start is not counted', () => {
    const old: Ledger = { ana: { day: new Set([day(1)]), tog: new Set([day(1)]), week: new Map() } };
    expect(steps(mine.filter((e) => e.date === day(1)), [friend('ana', [], { start: day(5) })], old)['trained-together']).toEqual([]);
  });
  it('a goal week counts only the sessions from the start: two before it and one after don’t meet a goal of 2', () => {
    // Start on Wednesday: Monday and Tuesday's sessions are before it.
    const m = [0, 1, 3].flatMap((d) => visit(day(d), '18:00', 3, IRON)), t = [0, 1, 3, 5].flatMap((d) => visit(day(d), '18:00', 3));
    expect(steps(m, [friend('ana', t, { start: day(2) })], NO_LEDGER, START, 2, day(6))['same-week']).toEqual([]);
    expect(steps([...m, ...visit(day(4), '18:00', 3)], [friend('ana', t, { start: day(2) })], NO_LEDGER, START, 2, day(6))['same-week'].map((s) => s.date)).toEqual([day(5)]);
  });
  it('days before the window aren’t read: an unknown day isn’t a rest day', () => {
    const p = windowPairs(mine, START, 2, [friend('ana', theirs, { from: day(4) })], TODAY).pairs.ana;
    expect([...p.day].sort()).toEqual(days.filter((d) => d >= 4).map(day));
  });
});

describe('same week, crew streak and full house: each against their own goal', () => {
  // Weeks 0..2. You: goal 2, two sessions each week. Ana: goal 3. Sam: goal 1.
  const mine = [0, 2, 7, 9, 14, 16].flatMap((d) => visit(day(d), '07:00', 3));
  const ana = [0, 1, 2, 7, 8, 14, 15, 16].flatMap((d) => visit(day(d), '12:00', 3)); // weeks 0 and 2 at 3
  const sam = [4, 18].flatMap((d) => visit(day(d), '20:00', 3));
  it('a week you both met your own goals, dated the later of the two days it was met', () => {
    const s = steps(mine, [friend('ana', ana, { goal: 3 })]);
    expect(s['same-week'].map((x) => [x.date, x.value])).toEqual([[day(2), 1], [day(16), 2]]);
  });
  it('a week only you met is not one; nor one only they met', () => {
    expect(steps(mine.filter((e) => e.date !== day(16)), [friend('ana', ana, { goal: 3 })])['same-week'].map((x) => x.date)).toEqual([day(2)]);
    expect(steps(mine, [friend('ana', ana, { goal: 4 })])['same-week']).toEqual([]);
  });
  it('crew streak: the best run of weeks with a friend at goal alongside you; a gap never lowers it', () => {
    const s = steps(mine, [friend('ana', ana, { goal: 3 }), friend('sam', sam, { goal: 1 })]);
    expect(s['crew-streak'].map((x) => x.value)).toEqual([1]); // weeks 0 and 2 (sam week 0 and 2): week 1 nobody
    const both = steps(mine, [friend('ana', ana, { goal: 2 })]);
    expect(both['crew-streak'].at(-1)!.value).toBe(3);
  });
  it('full house: the most friends at goal in a week you met yours, the k-th dated as they got there', () => {
    const s = steps(mine, [friend('ana', ana, { goal: 3 }), friend('sam', sam, { goal: 1 })]);
    const best = Math.max(...s['full-house'].map((x) => x.value));
    expect(best).toBe(2);
    expect(s['full-house'].find((x) => x.value === 2)!.date).toBe(day(4)); // week 0: ana on day 2, sam on day 4
  });
  it('full house counts nothing in a week you missed yours, however many friends met theirs', () => {
    const s = steps(mine.filter((e) => e.date < day(7)).slice(0, 3), [friend('ana', ana, { goal: 1 }), friend('sam', sam, { goal: 1 })]);
    expect(s['full-house']).toEqual([]);
  });
  it('the rings: this week against each one’s goal, a friend who hasn’t started left out', () => {
    const r = weekRings(mine, START, 2, [friend('ana', ana, { goal: 3 }), friend('sam', sam, { goal: 1 }), friend('kai', ana, { start: null })], TODAY);
    expect(r).toEqual([{ uid: null, sessions: 2, goal: 2, met: true }, { uid: 'ana', sessions: 3, goal: 3, met: true }, { uid: 'sam', sessions: 1, goal: 1, met: true }]);
  });
});

describe('older than the window: their summary’s goal string', () => {
  const today = day(84); // twelve weeks on: the window starts at day(29)
  const from = addDays(today, -55);
  const mine = Array.from({ length: 12 }, (_, w) => [day(w * 7), day(w * 7 + 2)]).flat().flatMap((d) => visit(d, '07:00', 3));
  const theirs = Array.from({ length: 12 }, (_, w) => [day(w * 7 + 1), day(w * 7 + 3)]).flat().filter((d) => d >= from).flatMap((d) => visit(d, '12:00', 3));
  /** Their summary: every week met. */
  const met = { day: today, met: '1'.repeat(52) };
  it('weeks before the window come from the summary, dated their Sunday; weeks inside it from their sets', () => {
    const w = windowPairs(mine, START, 2, [friend('ana', theirs, { from, met })], today).pairs.ana.week;
    expect(w.get(day(0))).toBe(day(6)); // the summary's
    expect(w.get(weekStart(from))).toBe(day(31)); // the window's first, partial week: its sets show it met, so not the summary
    expect(w.get(day(35))).toBe(day(38)); // a whole week in the window: their sets
    expect(w.size).toBe(12); // weeks 0..11, each met on both sides (today, week 12's Monday, has none yet)
  });
  it('the summary never overrules their sets: a week the window holds and they missed stays missed', () => {
    const missing = theirs.filter((e) => weekStart(e.date) !== day(42));
    expect(windowPairs(mine, START, 2, [friend('ana', missing, { from, met })], today).pairs.ana.week.has(day(42))).toBe(false);
  });
  it('a summary week is used only once it is wholly after the start: a start midweek keeps that week out', () => {
    const w = windowPairs(mine, day(2), 2, [friend('ana', theirs, { from, met, start: day(2) })], today).pairs.ana.week;
    expect(w.has(day(0))).toBe(false);
    expect(w.has(day(7))).toBe(true);
  });
  it('a summary not in shape is ignored', () => {
    for (const bad of [{ day: today, met: '1'.repeat(51) }, { day: 'x', met: '1'.repeat(52) }, { day: today, met: '2'.repeat(52) }]) {
      expect(windowPairs(mine, START, 2, [friend('ana', theirs, { from, met: bad })], today).pairs.ana.week.has(day(0))).toBe(false);
    }
  });
});

describe('crew day and gym crew: you and two friends', () => {
  it('crew day: you and two friends all trained that day, anywhere; one friend is not a crew day', () => {
    const mine = visit(day(0), '07:00', 3, IRON);
    const s = steps(mine, [friend('ana', visit(day(0), '12:00', 3, { gym: 'Elsewhere' })), friend('sam', visit(day(0), '21:00', 3, { enteredAt: `${day(1)}T08:00:00.000Z` }))]);
    expect(s['crew-day'].map((x) => [x.date, x.with])).toEqual([[day(0), ['ana', 'sam']]]);
    expect(steps(mine, [friend('ana', visit(day(0), '12:00', 3))])['crew-day']).toEqual([]);
  });
  it('gym crew: together with two friends at once; with one, it is trained together only', () => {
    const mine = visit(day(0), '18:00', 8, IRON);
    const two = steps(mine, [friend('ana', visit(day(0), '18:00', 8, IRON)), friend('sam', visit(day(0), '18:10', 8, IRON))]);
    expect(two['gym-crew'].map((x) => [x.date, x.with, x.gym])).toEqual([[day(0), ['ana', 'sam'], 'Iron Den']]);
    const one = steps(mine, [friend('ana', visit(day(0), '18:00', 8, IRON)), friend('sam', visit(day(0), '18:10', 8, { gym: 'Other' }))]);
    expect(one['gym-crew']).toEqual([]);
    expect(one['trained-together']).toHaveLength(1);
  });
});

describe('the ledger: what a window showed is kept', () => {
  const mine = [0, 2].flatMap((d) => visit(day(d), '18:00', 6, IRON));
  const theirs = [0, 2].flatMap((d) => visit(day(d), '18:00', 6, IRON));
  const seen = windowPairs(mine, START, 2, [friend('ana', theirs)], TODAY).pairs;
  it('a friend who later deletes theirs, or whose days leave the window, takes nothing away', () => {
    expect(steps(mine, [friend('ana', [])], seen)['trained-together']).toHaveLength(2);
  });
  it('a removed friend keeps what was earned with them, and shows as who they were to you', () => {
    const c = ctx([], {}, seen);
    const us = unlocks(mine, c, 'trained-together');
    expect(us.map((u) => u.with)).toEqual([['ana']]);
    expect(unlockText(us[0], () => 'a former friend')).toBe('First session together: a former friend');
    expect(achievements(mine, c).hidden).not.toContain('trained-together');
  });
  it('a removed friend gives nothing new: their sets are no longer read', () => {
    expect(steps([...mine, ...visit(day(4), '18:00', 6, IRON)], [], seen)['trained-together']).toHaveLength(2);
  });
  it('your own day deleted takes it away: every family needs your session that day', () => {
    expect(steps(mine.filter((e) => e.date !== day(2)), [friend('ana', [])], seen)['trained-together'].map((s) => s.date)).toEqual([day(0)]);
  });
  it('stored and read back the same; anything not in shape is left out', () => {
    const l: Ledger = { ana: { day: new Set([day(0), day(2), day(40)]), tog: new Set([day(2)]), week: new Map([[day(0), day(2)], [day(14), day(20)]]) }, sam: { day: new Set([day(5)]), tog: new Set(), week: new Map() } };
    const back = decodeLedger(JSON.parse(JSON.stringify(encodeLedger(l))));
    expect(norm(back)).toEqual(norm(l));
    expect(JSON.stringify(encodeLedger(l)).length).toBeLessThan(140);
    const n = Math.round(Date.parse(`${MON}T00:00:00Z`) / 864e5); // MON's day number: n + 1 is a Tuesday
    const bad = { v: 1, f: { ana: { o: 'x' }, sam: { o: n, d: '!!' }, kai: { o: n + 1 }, eve: { o: n, w: '9' }, '': { o: n }, ok: { o: n, d: 'AQ==', w: '03' } } };
    const kept = decodeLedger(bad);
    expect(Object.keys(kept)).toEqual(['ok']);
    expect(norm(kept)).toEqual({ ok: { day: [MON], tog: [], week: [[day(7), day(9)]] } });
    expect(decodeLedger(null)).toEqual({});
    expect(decodeLedger({ f: [1] })).toEqual({});
  });
  it('merges as a union: order and repeats don’t matter, and a week keeps the earlier day', () => {
    const a: Ledger = { ana: { day: new Set([day(0)]), tog: new Set(), week: new Map([[day(0), day(3)]]) } };
    const b: Ledger = { ana: { day: new Set([day(2)]), tog: new Set([day(2)]), week: new Map([[day(0), day(2)]]) }, sam: { day: new Set([day(1)]), tog: new Set(), week: new Map() } };
    expect(norm(mergeLedgers(a, b))).toEqual(norm(mergeLedgers(b, a)));
    expect(norm(mergeLedgers(a, mergeLedgers(a, b)))).toEqual(norm(mergeLedgers(a, b)));
    expect(mergeLedgers(a, b).ana.week.get(day(0))).toBe(day(2));
    expect(hasNew(a, b)).toBe(true);
    expect(hasNew(mergeLedgers(a, b), a)).toBe(false);
    expect(hasNew(mergeLedgers(a, b), b)).toBe(false);
  });
});

describe('both phones get the same count from the same data', () => {
  /** Deterministic noise. */
  const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
  const GYMS = ['Iron Den', 'iron den ', 'Peak', ''];
  function person(r: () => number, days: number): SetEntry[] {
    const out: SetEntry[] = [];
    for (let d = 0; d < days; d++) {
      if (r() < 0.45) continue;
      const g = GYMS[Math.floor(r() * GYMS.length)], h = 17 + Math.floor(r() * 3), mm = Math.floor(r() * 60);
      const late = r() < 0.15 ? `${day(d)}T23:00:00.000Z` : undefined;
      out.push(...visit(day(d), `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, 2 + Math.floor(r() * 8), { gym: g, ...(late && { enteredAt: late }) }, 2 + Math.floor(r() * 6)));
    }
    return out;
  }
  it('two phones, each its own log and the other’s window: the same days, weeks and runs, on the same dates', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed), a = person(r, 21), b = person(r, 21);
      const sa = day(Math.floor(r() * 5)), sb = day(Math.floor(r() * 5)), ga = 1 + Math.floor(r() * 3), gb = 1 + Math.floor(r() * 3);
      const onA = togetherSteps(effective(a, sa, ga, together([{ uid: 'b', start: sb, goal: gb, sets: b, from: addDays(TODAY, -55) }], NO_LEDGER), TODAY));
      const onB = togetherSteps(effective(b, sb, gb, together([{ uid: 'a', start: sa, goal: ga, sets: a, from: addDays(TODAY, -55) }], NO_LEDGER), TODAY));
      for (const id of ['trained-together', 'same-week', 'crew-streak'] as const) {
        expect(onA[id].map((x) => [x.date, x.value]), `seed ${seed} ${id}`).toEqual(onB[id].map((x) => [x.date, x.value]));
      }
      // The suite is about something: across the seeds, some days together, some not.
      if (seed === 40) expect(onA['trained-together'].length).toBeGreaterThanOrEqual(0);
    }
  });
  it('the seeds above find days together and days apart (the check isn’t vacuous)', () => {
    let some = 0, none = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed), a = person(r, 21), b = person(r, 21);
      const n = togetherSteps(effective(a, START, 2, together([{ uid: 'b', start: START, goal: 2, sets: b, from: addDays(TODAY, -55) }], NO_LEDGER), TODAY))['trained-together'].length;
      if (n) some++; else none++;
    }
    expect(some).toBeGreaterThan(5);
    expect(none).toBeGreaterThan(0);
  });
});

describe('privacy: only the two of you', () => {
  // Ana and Ben trained together at Iron Den. Cat is friends with both, and trained alone at Peak.
  const ana = visit(day(0), '18:00', 8, IRON), ben = visit(day(0), '18:05', 8, IRON), cat = visit(day(0), '07:00', 8, { gym: 'Peak' });
  it('Cat’s phone, with both their windows, learns nothing of it: no Together unlock, no feed line', () => {
    const c = ctx([friend('ana', ana), friend('ben', ben)]);
    const a = achievements(cat, c);
    expect(a.unlocks.filter((u) => DEF.get(u.id)!.group === 'together' && u.id !== 'crew-day')).toEqual([]);
    expect(togetherDay(cat, START, friend('ana', ana), day(0))).toBeNull();
    expect(togetherDay(cat, START, friend('ben', ben), day(0))).toBeNull();
    // Crew day is Cat's own (she trained that day too), and says nothing of where or with whom they were.
    expect(a.unlocks.find((u) => u.id === 'crew-day')?.gym).toBeUndefined();
    expect(withList(effective(cat, START, 2, together([friend('ana', ana), friend('ben', ben)]), TODAY), 'trained-together')).toEqual([]);
  });
  it('Ana’s phone has it; her summary for friends never carries it, whatever her switches say', () => {
    const a = achievements(ana, ctx([friend('ben', ben)]));
    expect(a.unlocks.map((u) => u.id)).toContain('trained-together');
    const shared = shareOf(a, []);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.filter((x) => DEF.get(x.i)!.group === 'together')).toEqual([]);
    expect(JSON.stringify(summarize(ana, TODAY, 2, shared))).not.toMatch(/together|"ben"|iron den/i);
  });
  it('a Together id in a friend’s summary (a modified app) is dropped as read', () => {
    expect(unlocksOf([{ i: 'trained-together', l: 0, d: day(0) }, { i: 'sessions', l: 0, d: day(0) }]).map((u) => u.id)).toEqual(['sessions']);
  });
  it('the feed line: on your phone, the day you two were together', () => {
    expect(togetherDay(ana, START, friend('ben', ben), day(0))?.gym).toBe('Iron Den');
    expect(togetherDay(ana, START, friend('ben', ben, { start: null }), day(0))).toBeNull();
    expect(togetherDay(ana, day(1), friend('ben', ben), day(0))).toBeNull();
  });
});

describe('the With list (only you see it)', () => {
  it('each friend, how many, the last day and its gym while the window shows it', () => {
    const mine = [0, 2, 4].flatMap((d) => visit(day(d), '18:00', 6, IRON));
    const seen = effective(mine, START, 2, together([friend('ana', [0, 2].flatMap((d) => visit(day(d), '18:00', 6, IRON))), friend('sam', visit(day(4), '18:00', 6, IRON))]), TODAY);
    expect(withList(seen, 'trained-together')).toEqual([{ uid: 'ana', n: 2, last: day(2), gym: 'Iron Den' }, { uid: 'sam', n: 1, last: day(4), gym: 'Iron Den' }]);
  });
});

/** A ledger as plain sorted arrays, to compare. */
function norm(l: Ledger) {
  return Object.fromEntries(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)).map(([k, p]: [string, Pair]) =>
    [k, { day: [...p.day].sort(), tog: [...p.tog].sort(), week: [...p.week].sort(([a], [b]) => a.localeCompare(b)) }]));
}

describe('Together’s cost', () => {
  it('ten friends, eight weeks of 20-set sessions each, and a year of ledger: worked out in well under a frame budget', () => {
    const days = Array.from({ length: 56 }, (_, i) => addDays(TODAY, -55 + i)).filter((_, i) => i % 2 === 0);
    const mine = days.flatMap((d) => visit(d, '18:00', 20, IRON));
    const fs = Array.from({ length: 10 }, (_, k) => friend(`f${k}`, days.flatMap((d) => visit(d, `18:${String(k * 3).padStart(2, '0')}`, 20, IRON)), { start: addDays(TODAY, -300) }));
    const ledger: Ledger = Object.fromEntries(fs.map((f) => [f.uid, { day: new Set(days), tog: new Set(days), week: new Map() }]));
    const c = ctx(fs, { since: addDays(TODAY, -300) }, ledger);
    achievements(mine, c); // warm
    const t = performance.now();
    const a = achievements(mine, { ...c });
    expect(performance.now() - t).toBeLessThan(150);
    expect(a.unlocks.some((u) => u.id === 'gym-crew')).toBe(true); // it did the work
  });
});
