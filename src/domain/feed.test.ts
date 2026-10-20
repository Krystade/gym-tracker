import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { defaultProfile } from './profile';
import {
  behindMuscles, board, e1rmChange, liftTrend, friendPrs, goalWeek, LIVE_MS, liftKind, liveSince, milestone, prCard, ringSets, sessionCard, setKind, sharedChanges,
  recentPrs, streakNudge, topLifts, usualSession, weekSets, weekStreak,
} from './feed';

// Synthetic sets only. Today is Thu 15 Oct 2026, 6:40 PM.
const TODAY = '2026-10-15';
const NOW = Date.parse('2026-10-15T18:40:00');
let n = 0;
const s = (exercise: string, k = 1, over: Partial<SetEntry> = {}, date = TODAY): SetEntry[] =>
  Array.from({ length: k }, () => { n++; return { id: `t|${date}|${exercise}|${n}`, date, seq: n, exercise, setNo: 1, weight: 100, reps: 8, flags: [], source: 't', ...over }; });
const at = (hhmm: string, date = TODAY) => new Date(`${date}T${hhmm}:00`).toISOString();
const cardio = (mins: number, date = TODAY, over: Partial<SetEntry> = {}): SetEntry[] =>
  s('Treadmill', 1, { weight: 0, reps: null, flags: ['cardio'], cardio: { seconds: mins * 60 }, ...over }, date);

describe('liveSince: a friend is live while their newest working set is under 20 minutes old', () => {
  it('is the time of the newest working set when it is within 20 minutes', () => {
    const sets = [...s('Bench Press', 1, { loggedAt: at('18:05') }), ...s('Bench Press', 1, { loggedAt: at('18:31') })];
    expect(liveSince(sets, NOW)).toBe(Date.parse(at('18:31')));
  });
  it('ends 20 minutes after the last set', () => {
    expect(LIVE_MS).toBe(20 * 60_000);
    expect(liveSince(s('Bench Press', 1, { loggedAt: at('18:19') }), NOW)).toBeNull(); // 21 minutes
    expect(liveSince(s('Bench Press', 1, { loggedAt: at('18:21') }), NOW)).not.toBeNull(); // 19 minutes
    const sets = s('Bench Press', 1, { loggedAt: new Date(NOW - LIVE_MS - 1000).toISOString() });
    expect(liveSince(sets, NOW)).toBeNull();
    expect(liveSince(s('Bench Press', 1, { loggedAt: new Date(NOW - LIVE_MS + 1000).toISOString() }), NOW)).not.toBeNull();
  });
  it('a warm-up alone is not training yet; a cardio bout is', () => {
    expect(liveSince(s('Bench Press', 2, { flags: ['warmup'], loggedAt: at('18:35') }), NOW)).toBeNull();
    expect(liveSince(cardio(20, TODAY, { loggedAt: at('18:30') }), NOW)).toBe(Date.parse(at('18:30')));
  });
  it('a set with no time (imported, pasted) never makes anyone live, nor does one far in the future', () => {
    expect(liveSince(s('Bench Press', 3), NOW)).toBeNull();
    expect(liveSince(s('Bench Press', 1, { loggedAt: new Date(NOW + 3 * 60_000).toISOString() }), NOW)).not.toBeNull(); // a clock a little fast
    expect(liveSince(s('Bench Press', 1, { loggedAt: new Date(NOW + 60 * 60_000).toISOString() }), NOW)).toBeNull();
  });
});

describe('setKind and liftKind', () => {
  it('names what a set trained by its muscles, cardio as cardio, warm-ups and unknown lifts as nothing', () => {
    expect(liftKind('Bench Press')).toBe('push');
    expect(liftKind('Barbell Squat')).toBe('legs');
    expect(liftKind('Lat Pulldown')).toBe('pull');
    expect(liftKind('Mystery Move')).toBeNull();
    expect(setKind(s('Bench Press')[0])).toBe('push');
    expect(setKind(cardio(10)[0])).toBe('cardio');
    expect(setKind(s('Bench Press', 1, { flags: ['warmup'] })[0])).toBeNull();
  });
});

describe('ringSets: a ring segment per set, in the order done', () => {
  it('gives each working set its kind, cardio a segment per 3 minutes, and leaves warm-ups out', () => {
    const sets = [
      ...s('Bench Press', 1, { loggedAt: at('18:10') }), ...cardio(10, TODAY, { loggedAt: at('18:30') }),
      ...s('Barbell Squat', 1, { loggedAt: at('18:00') }), ...s('Bench Press', 1, { flags: ['warmup'], loggedAt: at('17:55') }), ...s('Mystery Move', 1, { loggedAt: at('18:20') }),
    ];
    expect(ringSets(sets)).toEqual(['legs', 'push', null, 'cardio', 'cardio', 'cardio']);
  });
});

describe('usualSession: how many working sets fill a person’s ring', () => {
  it('is the median of their sessions before today', () => {
    const sets = [...s('Bench Press', 10, {}, '2026-10-05'), ...s('Bench Press', 12, {}, '2026-10-07'), ...s('Bench Press', 14, {}, '2026-10-09'), ...s('Bench Press', 30)];
    expect(usualSession(sets, TODAY)).toBe(12);
  });
  it('is 15 with fewer than three sessions to go on, and stays between 6 and 30', () => {
    expect(usualSession(s('Bench Press', 4, {}, '2026-10-05'), TODAY)).toBe(15);
    const few = ['2026-10-05', '2026-10-06', '2026-10-07'].flatMap((d) => s('Bench Press', 2, {}, d));
    expect(usualSession(few, TODAY)).toBe(6);
    const many = ['2026-10-05', '2026-10-06', '2026-10-07'].flatMap((d) => s('Bench Press', 40, {}, d));
    expect(usualSession(many, TODAY)).toBe(30);
  });
});

describe('goalWeek: this week against their own goal', () => {
  it('counts lifting days from Monday, never cardio-only days, and says whether today met it', () => {
    const sets = [...s('Bench Press', 3, {}, '2026-10-12'), ...cardio(30, '2026-10-13'), ...s('Barbell Squat', 4, {}, '2026-10-11'), ...s('Lat Pulldown', 3)];
    expect(goalWeek(sets, TODAY, 2)).toEqual({ sessions: 2, cardioDays: 1, goal: 2, met: true, metToday: true });
    expect(goalWeek(sets, TODAY, 3)).toMatchObject({ sessions: 2, met: false, metToday: false });
    expect(goalWeek(sets, TODAY, 1)).toMatchObject({ met: true, metToday: false }); // Monday met it
  });
});

describe('weekStreak', () => {
  it('runs through the weeks that met the goal, this week once it’s met, and says when it reaches the start of what was read', () => {
    const weekly = (mondays: string[]) => mondays.flatMap((m) => [...s('Bench Press', 2, {}, m), ...s('Barbell Squat', 2, {}, addDay(m, 2))]);
    const sets = weekly(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(weekStreak(sets, TODAY, 2, 8)).toEqual({ current: 3, best: 3, whole: false });
    const all = weekly(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
    expect(weekStreak(all, TODAY, 2, 8)).toEqual({ current: 7, best: 7, whole: true });
  });
});

describe('sessionCard: a day told as a card', () => {
  const prs = new Set<string>();
  const day1 = [
    ...s('Bench Press', 1, { weight: 95, flags: ['warmup'], loggedAt: at('18:00') }),
    ...s('Bench Press', 1, { weight: 185, reps: 8, loggedAt: at('18:02') }),
    ...s('Bench Press', 1, { weight: 185, reps: 7, loggedAt: at('18:06') }),
    ...s('Incline DB Press', 1, { weight: 70, reps: 10, loggedAt: at('18:15') }),
    ...s('Cable Fly', 1, { weight: 25, reps: 12, loggedAt: at('18:36') }),
  ];
  prs.add(day1[3].id);
  it('lists each lift once in the order started, with its top set, kind, PR and the lift being done now', () => {
    const c = sessionCard(day1, TODAY, prs, NOW)!;
    expect(c.lifts.map((l) => [l.exercise, l.sets, l.weight, l.reps, l.kind, l.pr, l.now])).toEqual([
      ['Bench Press', 2, 185, 8, 'push', false, false],
      ['Incline DB Press', 1, 70, 10, 'push', true, false],
      ['Cable Fly', 1, 25, 12, 'push', false, true],
    ]);
    expect(c).toMatchObject({ sets: 4, prs: 1, kinds: { push: 4 }, start: Date.parse(at('18:02')), end: Date.parse(at('18:36')), live: true });
  });
  it('is quiet once the last set is 20 minutes old: nothing is "now"', () => {
    const c = sessionCard(day1, TODAY, prs, Date.parse(at('19:30')))!;
    expect(c.live).toBe(false);
    expect(c.lifts.some((l) => l.now)).toBe(false);
  });
  it('adds up cardio minutes and miles, and is null for a day of warm-ups or none', () => {
    const c = sessionCard([...cardio(20, TODAY, { cardio: { seconds: 1200, miles: 1.5 } }), ...cardio(10, TODAY, { cardio: { seconds: 600, miles: 0.6 } })], TODAY, prs, NOW)!;
    expect(c.lifts).toMatchObject([{ exercise: 'Treadmill', sets: 2, seconds: 1800, miles: 2.1, kind: 'cardio' }]);
    expect(c.minutes).toBe(30);
    expect(c.sets).toBe(0);
    expect(sessionCard(s('Bench Press', 2, { flags: ['warmup'] }), TODAY, prs, NOW)).toBeNull();
    expect(sessionCard(day1, '2026-10-14', prs, NOW)).toBeNull();
  });
});

describe('friendPrs: true PRs where their phone wrote them, best-in-the-window where it didn’t', () => {
  it('takes a month’s written ids, and works the rest out from the sets read', () => {
    // September: no ids written (an older app). October: the phone wrote its PRs.
    const sept = [...s('Bench Press', 1, { weight: 150 }, '2026-09-20'), ...s('Bench Press', 1, { weight: 160 }, '2026-09-25')];
    const oct = [...s('Bench Press', 1, { weight: 155 }, '2026-10-02'), ...s('Bench Press', 1, { weight: 170 }, '2026-10-09')];
    const got = friendPrs({ sets: [...sept, ...oct], prs: { '2026-10': [oct[0].id] } });
    expect([...got].sort()).toEqual([sept[1].id, oct[0].id].sort());
  });
});

describe('e1rmChange: each person against their own start', () => {
  const series = (lift: string, w: number[], from = '2026-08-20', every = 7, reps = 5) =>
    w.flatMap((x, i) => s(lift, 1, { weight: x, reps }, addDay(from, i * every)));
  it('compares the best of their first two weeks in the window with the best of their last two', () => {
    const sets = series('Bench Press', [100, 102, 104, 106, 108, 110, 112, 114]); // Aug 20 to Oct 8
    const c = e1rmChange(sets, 'Bench Press', '2026-08-20', TODAY)!;
    // Epley at 5 reps is weight × 7/6: the same ratio as the weights.
    expect(c.pct).toBeCloseTo((114 - 102) / 102 * 100, 5);
    expect(c.sessions).toBe(8);
  });
  it('a lighter lifter improving faster shows the bigger change', () => {
    const strong = series('Back Squat', [300, 302, 304, 306, 308, 310, 312, 315]);
    const newer = series('Back Squat', [95, 100, 105, 110, 115, 120, 125, 130]);
    expect(e1rmChange(newer, 'Back Squat', '2026-08-20', TODAY)!.pct).toBeGreaterThan(e1rmChange(strong, 'Back Squat', '2026-08-20', TODAY)!.pct);
  });
  it('needs two sessions at least two weeks apart, and weighted sets', () => {
    expect(e1rmChange(series('Bench Press', [100, 110], '2026-10-01', 7), 'Bench Press', '2026-08-20', TODAY)).toBeNull();
    expect(e1rmChange(series('Bench Press', [100]), 'Bench Press', '2026-08-20', TODAY)).toBeNull();
    expect(e1rmChange(series('Pull-up', [0, 0, 0, 0]), 'Pull-up', '2026-08-20', TODAY)).toBeNull();
  });
  it('reads only the window', () => {
    const sets = series('Bench Press', [50, 60, 100, 102, 104, 106], '2026-07-23', 14);
    expect(e1rmChange(sets, 'Bench Press', '2026-08-20', TODAY)!.sessions).toBe(4);
  });
});

describe('sharedChanges: the lifts you both do, as each one’s own change', () => {
  const series = (lift: string, w: number[]) => w.flatMap((x, i) => s(lift, 1, { weight: x, reps: 5 }, addDay('2026-08-24', i * 7)));
  it('lists only lifts both do, matched whatever the case, the most trained first, and no loads', () => {
    const mine = [...series('Bench Press', [200, 202, 204, 206, 208]), ...series('Barbell Squat', [300, 305, 310, 315, 320, 325, 330]), ...series('Leg Press', [400, 410, 420])];
    const theirs = [...series('bench press', [100, 104, 108, 112, 116]), ...series('Barbell Squat', [150, 155, 160])];
    const got = sharedChanges(mine, theirs, '2026-08-20', TODAY);
    expect(got.map((g) => g.lift)).toEqual(['Barbell Squat', 'Bench Press']);
    expect(got[1].them).toBeGreaterThan(got[1].me);
    expect(Object.keys(got[0]).sort()).toEqual(['lift', 'me', 'them']);
  });
});

describe('milestone: the next round number on a lift’s e1RM', () => {
  it('steps by 5 under 50, 10 under 150, else 25, and says how far along the step it is', () => {
    expect(milestone(286)).toEqual({ prev: 275, next: 300, progress: 11 / 25 });
    expect(milestone(246)).toEqual({ prev: 225, next: 250, progress: 21 / 25 });
    expect(milestone(42)).toEqual({ prev: 40, next: 45, progress: 2 / 5 });
    expect(milestone(335)).toEqual({ prev: 325, next: 350, progress: 10 / 25 });
    expect(milestone(300)).toEqual({ prev: 300, next: 325, progress: 0 });
    expect(milestone(120)).toEqual({ prev: 120, next: 130, progress: 0 });
  });
});

describe('topLifts: the lifts Stats follows', () => {
  it('is weighted lifts done in the last 4 weeks, the most sessions over 12 weeks first', () => {
    const e = [
      ...['2026-09-01', '2026-09-08', '2026-09-15', '2026-10-13'].flatMap((d) => s('Bench Press', 2, {}, d)),
      ...['2026-10-01', '2026-10-08'].flatMap((d) => s('Barbell Squat', 2, {}, d)),
      ...['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-08-01'].flatMap((d) => s('Deadlift', 2, {}, d)), // stopped
      ...['2026-10-01', '2026-10-08', '2026-10-13'].flatMap((d) => s('Pull-up', 2, { weight: 0 }, d)), // bodyweight: no e1RM
      ...cardio(30, '2026-10-13'),
    ];
    expect(topLifts(e, TODAY, 4)).toEqual(['Bench Press', 'Barbell Squat']);
  });
});

describe('behindMuscles: what’s behind where the week should be, each with a lift of yours for it', () => {
  it('lists muscles under their pace, the furthest behind first, with your own lift that works each most', () => {
    const p = defaultProfile();
    // Thursday: 3/7 of the week behind us. Default tiers put everything at priority 3 or so; read the targets from the profile.
    const e = [
      ...s('Bench Press', 3, {}, '2026-10-12'), // Chest 3: under its 5–8, but ahead of Thursday's pace (5 × 3/7)
      ...s('DB Lateral Raise', 3, {}, '2026-09-30'), // done before, not this week
      ...s('Seated Leg Curl', 3, {}, '2026-09-29'),
    ];
    const got = behindMuscles(e, p, TODAY, 3);
    expect(got.length).toBeLessThanOrEqual(3);
    for (const b of got) expect(b.sets).toBeLessThan(b.range[0] * (3 / 7));
    const side = behindMuscles(e, p, TODAY, 20).find((b) => b.muscle === 'Side Delts');
    expect(side?.fix).toBe('DB Lateral Raise');
    expect(behindMuscles(e, p, TODAY, 20).find((b) => b.muscle === 'Chest')).toBeUndefined();
    // Monday asks for nothing yet.
    expect(behindMuscles(e, p, '2026-10-12', 20)).toEqual([]);
  });
});

describe('streakNudge', () => {
  it('says how many more sessions by Sunday keep the streak going', () => {
    expect(streakNudge({ sessions: 3, goal: 4, streak: 5, today: TODAY, trainedToday: true })).toEqual({ lead: '1 more session', rest: ' by Sunday makes it 6 weeks.' });
    expect(streakNudge({ sessions: 0, goal: 2, streak: 0, today: TODAY, trainedToday: false })).toEqual({ lead: '2 more sessions', rest: ' by Sunday meets your goal.' });
  });
  it('says the goal is met, and never scolds when the week can’t make it', () => {
    expect(streakNudge({ sessions: 4, goal: 4, streak: 6, today: TODAY, trainedToday: true })).toEqual({ lead: 'Goal met.', rest: ' 6 weeks in a row.' });
    expect(streakNudge({ sessions: 2, goal: 2, streak: 1, today: TODAY, trainedToday: true })).toEqual({ lead: 'Goal met.', rest: ' Your streak starts here.' });
    // Sunday, 2 to go, one day left.
    expect(streakNudge({ sessions: 1, goal: 3, streak: 4, today: '2026-10-18', trainedToday: false })).toEqual({ lead: '1 of 3', rest: ' this week. A new week starts Monday.' });
  });
});

describe('weekSets: sets so far against last week by the same day', () => {
  it('counts working sets Monday to today, and last week’s Monday to the same weekday', () => {
    const e = [...s('Bench Press', 5, {}, '2026-10-12'), ...s('Bench Press', 4, {}, '2026-10-06'), ...s('Bench Press', 9, {}, '2026-10-10'), ...s('Bench Press', 2, { flags: ['warmup'] })];
    expect(weekSets(e, TODAY)).toEqual({ sets: 5, before: 4 });
  });
});

describe('prCard: the newest PR this week', () => {
  it('names the lift, the set and how far it moved your best e1RM', () => {
    const e = [...s('Back Squat', 1, { weight: 225, reps: 5 }, '2026-10-01'), ...s('Back Squat', 1, { weight: 245, reps: 5, loggedAt: at('07:20') })];
    const c = prCard(e, TODAY)!;
    expect(c.set.id).toBe(e[1].id);
    expect(c.detail).toBe(`e1RM ${Math.round(245 * (1 + 5 / 30))} lb, up ${Math.round((245 - 225) * (1 + 5 / 30))} lb on your best`);
    expect(prCard(e, '2026-10-25')).toBeNull(); // over a week ago
  });
});

function addDay(d: string, k: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + k);
  return x.toISOString().slice(0, 10);
}

describe('board: a friend’s last 8 weeks as tiles, a row a week from Monday', () => {
  it('gives each day its kinds, working-set count, PR and live marks; days after today are empty and flagged', () => {
    const squat = s('Barbell Squat', 3, { loggedAt: at('18:30') });
    const old = s('Bench Press', 2, {}, '2026-08-24'); // Monday, 8 weeks back: the first row's first tile
    const before = s('Bench Press', 1, {}, '2026-08-23'); // the day before the board
    const warm = s('Barbell Squat', 1, { flags: ['warmup'] });
    const rows = board([...squat, ...old, ...before, ...warm], TODAY, new Set([squat[2].id]), NOW);
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    expect(rows[0][0]).toMatchObject({ date: '2026-08-24', kinds: ['push'], sets: 2, pr: false, live: false, future: false });
    const today = rows[7][3];
    expect(today).toMatchObject({ date: TODAY, kinds: ['legs'], sets: 3, pr: true, live: true, today: true, future: false });
    expect(rows[7][4]).toMatchObject({ date: '2026-10-16', sets: 0, kinds: [], future: true });
    expect(rows[7][2]).toMatchObject({ sets: 0, kinds: [], future: false, today: false });
  });
  it('is live only on today’s tile and only within 20 minutes', () => {
    const late = s('Barbell Squat', 1, { loggedAt: at('18:00') });
    expect(board(late, TODAY, new Set(), NOW)[7][3].live).toBe(false);
  });
});

describe('recentPrs: one PR per lift, newest first', () => {
  it('keeps each lift’s newest PR set and orders by date', () => {
    const a = s('Bench Press', 1, { weight: 100 }, '2026-10-01');
    const b = s('Bench Press', 1, { weight: 110 }, '2026-10-08');
    const c = s('Barbell Squat', 1, { weight: 150 }, '2026-10-05');
    const d = s('Lat Pulldown', 1, {}, '2026-10-12');
    const got = recentPrs([...a, ...b, ...c, ...d], new Set([a[0].id, b[0].id, c[0].id]), 2);
    expect(got.map((e) => e.id)).toEqual([b[0].id, c[0].id]);
  });
});

describe('liftTrend: a lift over 12 weeks, for Getting stronger', () => {
  it('gives each session’s best e1RM oldest first, the change from your own start, and the latest top set', () => {
    const e = [
      ...s('Bench Press', 1, { weight: 100, reps: 5 }, '2026-07-10'), // before the 12 weeks: left out
      ...s('Bench Press', 1, { weight: 150, reps: 5 }, '2026-08-20'),
      ...s('Bench Press', 2, { weight: 160, reps: 5 }, '2026-09-20'),
      ...s('Bench Press', 1, { weight: 170, reps: 5 }, '2026-10-14'),
      ...s('Bench Press', 1, { weight: 150, reps: 5 }, '2026-10-14'),
    ];
    const t = liftTrend(e, 'Bench Press', TODAY)!;
    expect(t.points.map((p) => p.date)).toEqual(['2026-08-20', '2026-09-20', '2026-10-14']);
    expect(t.points[2].v).toBeCloseTo(170 * (1 + 5 / 30));
    expect(t.top).toMatchObject({ weight: 170, reps: 5, date: '2026-10-14' });
    expect(Math.round(t.delta!)).toBe(Math.round(20 * (1 + 5 / 30)));
    expect(t.stall).toBeNull();
  });
  it('is null for a lift with no weighted sets in the 12 weeks', () => {
    expect(liftTrend(s('Plank', 1, { weight: 0, reps: 60 }), 'Plank', TODAY)).toBeNull();
  });
});
