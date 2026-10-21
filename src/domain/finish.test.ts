import { describe, expect, it } from 'vitest';
import { finishSummary, lastSetAt, nextUp, sessionClose, showSummary } from './finish';
import { defaultProfile, targetFor } from './profile';
import type { SetEntry } from './types';

const DATE = '2026-10-20'; // a Tuesday
const at = (hm: string, date = DATE) => new Date(`${date}T${hm}:00`).getTime();
let n = 0;
const set = (exercise: string, hm: string | null, weight: number, reps: number, o: Partial<SetEntry> = {}): SetEntry => ({
  id: `s${n++}`, date: DATE, seq: n, exercise, setNo: 1, weight, reps, flags: [], source: 'sample', ...(hm && { loggedAt: new Date(at(hm, o.date ?? DATE)).toISOString() }), ...o,
});

describe('finish: when the session closes', () => {
  const day = [set('Bench Press', '18:00', 185, 8), set('Bench Press', '18:04', 185, 8), set('Cable Curl', '18:09', 50, 12)];
  const quiet = 17 * 60;

  it('the last set is the latest done-time of the day; none without a timed set', () => {
    expect(lastSetAt(day, DATE)).toBe(at('18:09'));
    expect(lastSetAt([set('Bench Press', null, 185, 8)], DATE)).toBeNull();
    // Another day's sets don't count, even later ones.
    expect(lastSetAt([...day, set('Bench Press', '19:00', 185, 8, { date: '2026-10-21' })], DATE)).toBe(at('18:09'));
  });

  it('closes by itself once nothing is logged for his quiet time, not a second before', () => {
    expect(sessionClose(day, DATE, at('18:09') + quiet * 1000 - 1000, { quiet }).how).toBeNull();
    const c = sessionClose(day, DATE, at('18:09') + quiet * 1000, { quiet });
    expect(c).toMatchObject({ how: 'auto', at: at('18:09') + quiet * 1000 });
  });

  it('(c) with no quiet time learned, it never closes by itself', () => {
    expect(sessionClose(day, DATE, at('23:59'), { quiet: null }).how).toBeNull();
  });

  it('a rest still running holds it open until the rest is over', () => {
    const until = at('18:09') + quiet * 1000 + 60_000;
    expect(sessionClose(day, DATE, until - 1000, { quiet, restUntil: until }).how).toBeNull();
    expect(sessionClose(day, DATE, until, { quiet, restUntil: until }).how).toBe('auto');
  });

  it('Finish closes it at once; a set logged after reopens it', () => {
    expect(sessionClose(day, DATE, at('18:10'), { quiet, tapped: at('18:10') })).toMatchObject({ how: 'finish', at: at('18:10') });
    const more = [...day, set('Cable Curl', '18:20', 50, 12)];
    expect(sessionClose(more, DATE, at('18:21'), { quiet, tapped: at('18:10') }).how).toBeNull();
    // ...and goes quiet again from that set.
    expect(sessionClose(more, DATE, at('18:20') + quiet * 1000, { quiet, tapped: at('18:10') }).how).toBe('auto');
  });

  it('a day with nothing timed never closes by itself', () => {
    expect(sessionClose([set('Bench Press', null, 185, 8)], DATE, at('23:00'), { quiet }).how).toBeNull();
  });
});

describe('finish: the summary card in the plan’s place', () => {
  const closed = { how: 'auto' as const, at: at('18:30'), lastAt: at('18:09') };
  const open = { how: null, at: null, lastAt: at('18:09') };

  it('shows once the plan is done, or the session is closed; never on a day with no working set', () => {
    expect(showSummary(open, true, null, true)).toBe(true);
    expect(showSummary(closed, false, null, true)).toBe(true);
    expect(showSummary(open, false, null, true)).toBe(false);
    expect(showSummary(closed, true, null, false)).toBe(false);
  });

  it('“Add more” brings the plan back until the session closes again after it', () => {
    expect(showSummary(open, true, at('18:12'), true)).toBe(false);
    expect(showSummary(closed, true, at('18:31'), true)).toBe(false); // tapped after it closed
    expect(showSummary({ ...closed, at: at('18:50') }, true, at('18:31'), true)).toBe(true); // closed again since
  });
});

describe('finish: what the summary says', () => {
  const profile = defaultProfile();
  const before = [
    set('Bench Press', '17:00', 180, 8, { date: '2026-10-13' }), set('Bench Press', '17:04', 180, 8, { date: '2026-10-13' }),
    // Earlier this week (Monday): chest and triceps sets that count toward the week, not today.
    set('Bench Press', '17:00', 180, 6, { date: '2026-10-19' }), set('Cable Pushdown', '17:10', 100, 12, { date: '2026-10-19' }),
  ];
  const today = [
    set('Bench Press', '18:00', 135, 5, { flags: ['warmup'] }),
    set('Bench Press', '18:03', 190, 8), set('Bench Press', '18:07', 185, 8),
    set('Cable Curl', '18:12', 50, 12), set('Plank', '18:16', 0, 60, { flags: ['hold'] }),
    set('Treadmill', '18:30', 0, null as unknown as number, { flags: ['cardio'], reps: null, cardio: { seconds: 600 } }),
  ];
  const s = finishSummary([...before, ...today], DATE, profile);

  it('counts the working sets, the tonnage (as the week’s is counted) and the time from first set to last', () => {
    expect(s.sets).toBe(4); // two bench, a curl, the plank; not the warm-up or the bout
    expect(s.bouts).toBe(1);
    expect(s.tonnage).toBe(135 * 5 + 190 * 8 + 185 * 8 + 50 * 12); // a hold and a bout carry no tonnage
    expect(s.minutes).toBe(Math.round((30 * 60 + 40) / 60)); // timing.sessionMinutes
  });

  it('names each lift’s PR set, the best one where there are several', () => {
    expect(s.prs.map((p) => [p.exercise, p.set.weight])).toEqual([['Bench Press', 190]]);
  });

  it('gives each muscle trained today its sets so far this week against its weekly band', () => {
    const chest = s.muscles.find((m) => m.muscle === 'Chest')!;
    expect(chest.today).toBe(2);
    expect(chest.week).toBe(3); // Monday's one and today's two
    expect(chest.band).toEqual(targetFor(profile, 'Chest'));
    expect(chest.status).toBe(chest.week < chest.band[0] ? 'under' : chest.week > chest.band[1] ? 'over' : 'on');
    // Triceps got only half sets today (a press works them indirectly) and Monday's pushdown: shown, with the week's count.
    expect(s.muscles.some((m) => m.muscle === 'Biceps')).toBe(true);
    expect(s.muscles.every((m) => m.today >= 1)).toBe(true);
    expect(s.muscles.length).toBeGreaterThan(1);
  });

  it('a later day in the week doesn’t count toward the day’s summary', () => {
    const later = finishSummary([...before, ...today, set('Bench Press', '18:00', 185, 8, { date: '2026-10-22' })], DATE, profile);
    expect(later.muscles.find((m) => m.muscle === 'Chest')!.week).toBe(3);
  });
});

describe('finish: the forward look', () => {
  const tueThu = Array.from({ length: 12 }, (_, w) => [2, 4].map((wd) => {
    const d = new Date(Date.UTC(2026, 6, 27 + 7 * w + (wd - 1))).toISOString().slice(0, 10); // 2026-07-27 is a Monday
    return set('Bench Press', '18:00', 185, 8, { date: d, id: `r${d}` });
  })).flat();
  const program = { key: 'program' as const, perSession: 6, createdAt: '2026-07-01', days: [{ name: 'Day A', slots: [] }, { name: 'Day B', slots: [] }] };
  const plans = [{ key: 'p', date: DATE, day: 0, skips: [], swaps: {} }];

  it('names the program’s next day, and the weekday his routine puts it on (b)', () => {
    const log = [...tueThu.filter((e) => e.date < DATE), set('Bench Press', '18:00', 185, 8)];
    const up = nextUp(log, program, plans, DATE, 'UTC');
    expect(up.day).toBe('Day B');
    expect(up.inDays).toBe(2); // Tuesday → Thursday
  });

  it('(c) no routine to go by: no weekday named; no program: no day', () => {
    const few = [set('Bench Press', '18:00', 185, 8)];
    expect(nextUp(few, program, plans, DATE, 'UTC')).toEqual({ day: 'Day B', inDays: null });
    expect(nextUp(few, null, [], DATE, 'UTC')).toEqual({ day: null, inDays: null });
  });
});
