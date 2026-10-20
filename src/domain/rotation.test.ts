import { describe, expect, it } from 'vitest';
import type { Flag, SetEntry } from './types';
import { CATALOG, PATTERNS, VARIATIONS } from './catalog';
import { NEEDS } from './equipment';
import { muscleVector } from './muscles';
import { biasOf, carryOver, mainMuscle, nextVariation, patternOf, rotateProgram, rotation, rotationReason, sinceProgress, stall } from './rotation';
import { trendLog, weekEnd, type TrendLift } from './learn/trendSim.sample';
import { defaultSettings, nextTarget } from './progression';
import type { Program } from './program';
import { strength } from './estimators';

// Synthetic logs only. A session is a lift on a date with sets written "185x8".
let seq = 0;
const session = (date: string, exercise: string, sets: string[], flags: Flag[] = []): SetEntry[] => sets.map((t, i) => {
  const [w, r] = t.split('x').map(Number);
  return { id: `r${seq}`, date, seq: seq++, exercise, setNo: i + 1, weight: w, reps: r, flags, source: 't' };
});
const log = (exercise: string, days: [string, string[]][]): SetEntry[] => days.flatMap(([d, s]) => session(d, exercise, s));

// Progress on 1 and 8 September, then three sessions over two weeks with nothing better.
const PLATEAU: [string, string[]][] = [
  ['2026-09-01', ['185x8', '185x8', '185x8']],
  ['2026-09-08', ['185x9', '185x8', '185x8']],
  ['2026-09-15', ['185x9', '185x8', '185x8']],
  ['2026-09-22', ['185x9', '185x8', '185x7']],
  ['2026-09-29', ['185x8', '185x8', '185x8']],
];
const TODAY = '2026-10-01';

describe('patterns', () => {
  it('every variation is a catalog lift with its gear known, in exactly one pattern', () => {
    const all = PATTERNS.flatMap((p) => VARIATIONS[p]);
    expect(new Set(all).size).toBe(all.length);
    for (const ex of all) {
      expect(CATALOG).toContain(ex);
      expect(NEEDS[ex]).toBeDefined();
    }
  });
  it('each pattern trains its muscles: the main muscle is the one listed', () => {
    const main = (ex: string) => mainMuscle(ex);
    for (const ex of VARIATIONS['Horizontal press']) expect(main(ex)).toBe(ex === 'Close-Grip Bench Press' ? 'Triceps' : 'Chest');
    for (const ex of VARIATIONS['Horizontal pull']) expect(main(ex)).toBe(['Machine Row', 'Landmine Row'].includes(ex) ? 'Lats' : 'Mid-Back');
    for (const ex of VARIATIONS['Vertical press']) expect(main(ex)).toBe('Front Delts');
    for (const ex of VARIATIONS['Vertical pull']) expect(main(ex)).toBe('Lats');
    for (const ex of VARIATIONS.Squat) expect(main(ex)).toBe('Quads');
    for (const ex of VARIATIONS.Hinge) expect(main(ex)).toBe('Hamstrings');
    // Lats lead every vertical pull; the underhand and close grips bring the biceps in more.
    for (const ex of VARIATIONS['Vertical pull']) expect(muscleVector(ex)?.Biceps, ex).toBe(['Chin-up', 'Close-Grip Lat Pulldown'].includes(ex) ? 0.75 : 0.5);
  });
  it('the bias is the main muscle and any other trained at three quarters or more', () => {
    expect(biasOf('Lat Pulldown')).toEqual(['Lats']);
    expect(biasOf('Pull-up')).toEqual(['Lats']);
    expect(biasOf('Chin-up')).toEqual(['Lats', 'Biceps']);
    expect(biasOf('Close-Grip Lat Pulldown')).toEqual(['Lats', 'Biceps']);
    expect(biasOf('Seated Cable Row')).toEqual(['Mid-Back']);
    expect(biasOf('Close-Grip Bench Press')).toEqual(['Triceps']);
    expect(biasOf('Zercher Thing')).toEqual([]);
  });
  it('the new lifts have their patterns, and their logged spellings too', () => {
    expect(VARIATIONS['Vertical press']).toContain('DB Shoulder Press');
    expect(VARIATIONS.Squat).toEqual(expect.arrayContaining(['Front Squat', 'Pendulum Squat']));
    for (const n of ['DB Shoulder Press', 'Dumbbell Shoulder Press']) expect(patternOf(n), n).toBe('Vertical press');
    for (const n of ['Front Squat', 'Pendulum Squat', 'Barbell Front Squat', 'Pendulum Squat Machine']) expect(patternOf(n), n).toBe('Squat');
  });
  it('a catalog lift gets its pattern; a lift outside the six gets none', () => {
    expect(patternOf('Bench Press')).toBe('Horizontal press');
    expect(patternOf('bench  press')).toBe('Horizontal press');
    expect(patternOf('Romanian Deadlift')).toBe('Hinge');
    for (const ex of ['Cable Curl', 'Leg Extension', 'Seated Calf Raise', 'Push-up', 'Forward-Lean Dips', 'Straight-Arm Pulldown', 'Lat Pull-In', 'Hip Thrust',
      'Back Extension', 'Plank', 'Treadmill', 'DB Lateral Raise', 'Cable Pushdown']) expect(patternOf(ex), ex).toBeNull();
  });
  it('a lift logged under its own name gets one from its words, unless it reads as isolation', () => {
    expect(patternOf('Hack Squat')).toBe('Squat');
    expect(patternOf('Pendulum Squat')).toBe('Squat');
    expect(patternOf('Stiff-Leg Deadlift')).toBe('Hinge');
    expect(patternOf('Barbell RDL')).toBe('Hinge');
    expect(patternOf('Barbell Row')).toBe('Horizontal pull');
    expect(patternOf('Kroc Row')).toBe('Horizontal pull');
    expect(patternOf('Military Press')).toBe('Vertical press');
    expect(patternOf('Seated DB Shoulder Press')).toBe('Vertical press');
    expect(patternOf('Weighted Pull-up')).toBe('Vertical pull');
    expect(patternOf('Machine Pulldown')).toBe('Vertical pull');
    expect(patternOf('Decline Bench Press')).toBe('Horizontal press');
    expect(patternOf('Hammer Strength Chest Press')).toBe('Horizontal press');
    expect(patternOf('DB Floor Press')).toBe('Horizontal press');
    for (const ex of ['Cable Pullover', 'Upright Row', 'Straight Arm Pulldown', 'Leg Press Calf Raise', 'Hammer Curl', 'Rope Face Pull'])
      expect(patternOf(ex), ex).toBeNull();
  });
});

describe('sinceProgress', () => {
  it('the last session that progressed, and the sessions since with nothing better', () => {
    expect(sinceProgress(log('Bench Press', PLATEAU), 'Bench Press', TODAY)).toEqual({ since: '2026-09-08', sessions: 3, last: '2026-09-29' });
    expect(sinceProgress(log('Bench Press', PLATEAU.slice(0, 2)), 'Bench Press', TODAY)).toBeNull();
  });
  it('one set with more reps at the top weight is a step-up, though the e1RM is no best and the total is lower', () => {
    const base = ['225x3', '185x9', '185x9', '185x9']; // 225 × 3 = 247.5 is the e1RM to beat
    const days: [string, string[]][] = [['2026-09-01', base], ['2026-09-08', base], ['2026-09-15', base], ['2026-09-22', ['185x10', '185x6', '185x6']]];
    expect(sinceProgress(log('Bench Press', days), 'Bench Press', TODAY)).toBeNull();
    expect(sinceProgress(log('Bench Press', days.slice(0, 3).concat([['2026-09-22', base]])), 'Bench Press', TODAY)).not.toBeNull();
  });
  it('a new best e1RM resets it', () => {
    // 180 × 13 ≈ 258 beats 185 × 9 ≈ 240.5, at a lighter weight than before: only the e1RM says it's better.
    const days: [string, string[]][] = [...PLATEAU.slice(0, 4), ['2026-09-29', ['180x13', '180x8']]];
    expect(sinceProgress(log('Bench Press', days), 'Bench Press', TODAY)).toBeNull();
  });
  it('a weight step-up resets it, even with fewer reps', () => {
    const days: [string, string[]][] = [...PLATEAU.slice(0, 4), ['2026-09-29', ['190x6', '190x6', '190x5']]];
    expect(sinceProgress(log('Bench Press', days), 'Bench Press', TODAY)).toBeNull();
  });
  it('a rep step-up at the same weight resets it: one set, or more reps over the same sets', () => {
    const one: [string, string[]][] = [...PLATEAU.slice(0, 4), ['2026-09-29', ['185x10', '185x7', '185x7']]];
    expect(sinceProgress(log('Bench Press', one), 'Bench Press', TODAY)).toBeNull();
    const total: [string, string[]][] = [...PLATEAU.slice(0, 4), ['2026-09-29', ['185x9', '185x9', '185x8']]];
    expect(sinceProgress(log('Bench Press', total), 'Bench Press', TODAY)).toBeNull();
    // A fourth set adds reps but isn't a step-up over the same three sets.
    const extra: [string, string[]][] = [...PLATEAU.slice(0, 4), ['2026-09-29', ['185x9', '185x8', '185x8', '185x6']]];
    expect(sinceProgress(log('Bench Press', extra), 'Bench Press', TODAY)).not.toBeNull();
  });
  it('a lighter session with more reps is no step-up, and a zig-zag in weight is no progress', () => {
    const lighter: [string, string[]][] = [...PLATEAU.slice(0, 4), ['2026-09-29', ['165x11', '165x11', '165x10']]];
    expect(sinceProgress(log('Bench Press', lighter), 'Bench Press', TODAY)).not.toBeNull();
    const zig: [string, string[]][] = [...PLATEAU.slice(0, 2), ['2026-09-15', ['180x9', '180x9', '180x9']], ['2026-09-22', ['185x9', '185x8', '185x8']], ['2026-09-29', ['180x9', '180x9', '180x9']]];
    expect(sinceProgress(log('Bench Press', zig), 'Bench Press', TODAY)).not.toBeNull();
  });
  it('warm-ups and partials are left out; test sets count (owner, 2026-10-19)', () => {
    const entries = [...log('Bench Press', PLATEAU),
      ...session('2026-09-29', 'Bench Press', ['225x5'], ['warmup']),
      ...session('2026-09-29', 'Bench Press', ['225x6'], ['partial'])];
    expect(sinceProgress(entries, 'Bench Press', TODAY)).toMatchObject({ since: '2026-09-08', sessions: 3 });
    // A heavier test is a weight step-up, in a session of working sets or on its own.
    expect(sinceProgress([...entries, ...session('2026-09-29', 'Bench Press', ['230x3'], ['test'])], 'Bench Press', TODAY)).toBeNull();
    expect(sinceProgress([...entries, ...session('2026-09-30', 'Bench Press', ['235x2'], ['test'])], 'Bench Press', TODAY)).toBeNull();
    // A test no better than the sessions before it is one more flat session.
    expect(sinceProgress([...entries, ...session('2026-09-30', 'Bench Press', ['185x8'], ['test'])], 'Bench Press', TODAY)).toMatchObject({ sessions: 4, last: '2026-09-30' });
  });
  it('the first two sessions of a lift, and after a break of six weeks or more, are fresh starts (owner rule)', () => {
    const back: [string, string[]][] = [['2026-06-01', ['225x8', '225x8']], ['2026-06-08', ['225x8', '225x8']],
      ['2026-08-31', ['165x8', '165x8']], ['2026-09-08', ['165x8', '165x8']], ['2026-09-15', ['165x8', '165x8']], ['2026-09-29', ['165x8', '165x8']]];
    expect(sinceProgress(log('Bench Press', back), 'Bench Press', TODAY)).toMatchObject({ since: '2026-09-08', sessions: 2 });
    // Rebuilding toward the old weight is progress, though it's under the old best.
    const rebuild: [string, string[]][] = [...back.slice(0, 3), ['2026-09-08', ['175x8', '175x8']], ['2026-09-15', ['185x8', '185x8']], ['2026-09-29', ['195x8', '195x8']]];
    expect(sinceProgress(log('Bench Press', rebuild), 'Bench Press', TODAY)).toBeNull();
  });
  it('sessions after today are ignored, and today counts', () => {
    expect(sinceProgress(log('Bench Press', PLATEAU), 'Bench Press', '2026-09-28')).toMatchObject({ sessions: 2, last: '2026-09-22' });
    const today = [...log('Bench Press', PLATEAU), ...session(TODAY, 'Bench Press', ['185x10'])];
    expect(sinceProgress(today, 'Bench Press', TODAY)).toBeNull();
  });
});

describe('a plateau doesn’t count sessions pain shaped (item 08)', () => {
  // Pain on a session's last set: that session hurt, and the next one is held (moderate) or not (mild).
  const sore = (sev: 1 | 2, dates: string[]) => log('Bench Press', PLATEAU).map((e) => (dates.includes(e.date) && e.setNo === 3 ? { ...e, flags: ['pain' as const], painSeverity: sev } : e));
  it('sinceProgress counts neither a session that hurt nor one the pain gate held', () => {
    expect(sinceProgress(sore(2, ['2026-09-22']), 'Bench Press', TODAY)).toEqual({ since: '2026-09-08', sessions: 1, last: '2026-09-29' });
    // Mild pain: that session's sets are lower bounds, so it doesn't count; the next one, not held, does.
    expect(sinceProgress(sore(1, ['2026-09-22']), 'Bench Press', TODAY)).toEqual({ since: '2026-09-08', sessions: 2, last: '2026-09-29' });
    // Every session since the last progress hurt or was held: nothing says plateau.
    expect(sinceProgress(sore(2, ['2026-09-15', '2026-09-22']), 'Bench Press', TODAY)).toBeNull();
  });
  it('a session that hurt still counts as progress when it beat the ones before', () => {
    expect(sinceProgress(sore(2, ['2026-09-08']), 'Bench Press', TODAY)).toEqual({ since: '2026-09-08', sessions: 2, last: '2026-09-29' });
  });
  it('so the stall only ever goes away: none while the sessions since progress all hurt or were held', () => {
    expect(stall(log('Bench Press', PLATEAU), 'Bench Press', TODAY)).not.toBeNull();
    expect(stall(sore(2, ['2026-09-15', '2026-09-22']), 'Bench Press', TODAY)).toBeNull();
    expect(stall(sore(1, ['2026-09-15', '2026-09-22']), 'Bench Press', TODAY)).not.toBeNull();
  });
});

describe('stall (item 12: the fatigue-adjusted level reads flat)', () => {
  const others: TrendLift[] = [
    { name: 'Lat Pulldown', E0: 200, step: 5, slope: () => 0.01 },
    { name: 'Seated Cable Row', E0: 220, step: 5, slope: () => 0.006 },
    { name: 'Leg Press', E0: 500, step: 10, slope: (w) => (w < 10 ? 0.012 : 0) },
    { name: 'Machine Chest Press', E0: 200, step: 5, slope: () => 0 },
  ];
  it('a short plateau with nothing better is a stall only once the level reads flat, and carries the evidence', () => {
    const s = stall(log('Bench Press', PLATEAU), 'Bench Press', TODAY);
    expect(s).toMatchObject({ since: '2026-09-08', sessions: 3, last: '2026-09-29' });
    expect(s!.flat.p).toBeGreaterThan(0.5);
    expect(s!.weeks).toBe(Math.floor(s!.flat.slope.days / 7));
  });
  it('a latest session with a new best is never a stall, whatever the trend', () => {
    const days: [string, string[]][] = [...PLATEAU.slice(0, 4), ['2026-09-29', ['190x6', '190x6', '190x5']]];
    expect(stall(log('Bench Press', days), 'Bench Press', TODAY)).toBeNull();
  });
  it('a plateau whose last session is over six weeks old is stale', () => {
    expect(stall(log('Bench Press', PLATEAU), 'Bench Press', '2026-10-20')).not.toBeNull();
    expect(stall(log('Bench Press', PLATEAU), 'Bench Press', '2026-11-11')).toBeNull();
  });
  it('bodyweight lifts have no level yet and holds never stall', () => {
    const pull = log('Pull-up', PLATEAU.map(([d, s]) => [d, s.map((x) => `0x${x.split('x')[1]}`)]));
    expect(stall(pull, 'Pull-up', TODAY)).toBeNull();
    const plank = log('Plank', PLATEAU.map(([d]) => [d, ['0x40', '0x40']]));
    expect(stall(plank, 'Plank', TODAY)).toBeNull();
  });
  it('on synthetic logs with a known trend: few false alarms while progressing at 1 %/wk, and a real plateau caught within about 2 months', () => {
    const N = 10;
    let fa = 0;
    for (let seed = 1; seed <= N; seed++) {
      const lg = trendLog(seed, [{ name: 'Bench Press', E0: 250, step: 5, slope: () => 0.01 }, ...others], { weeks: 20 });
      let hit = false;
      for (let wk = 10; wk < 20 && !hit; wk++) { const d = weekEnd(wk); hit = !!stall(lg.filter((e) => e.date <= d), 'Bench Press', d); }
      if (hit) fa++;
    }
    const det: number[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const lg = trendLog(100 + seed, [{ name: 'Bench Press', E0: 250, step: 5, slope: (w) => (w < 10 ? 0.01 : 0) }, ...others], { weeks: 22 });
      for (let wk = 10; wk < 22; wk++) { const d = weekEnd(wk); if (stall(lg.filter((e) => e.date <= d), 'Bench Press', d)) { det.push(wk - 9); break; } }
    }
    det.sort((a, b) => a - b);
    expect(fa).toBeLessThanOrEqual(2);
    expect(det.length).toBeGreaterThanOrEqual(N - 1);
    expect(det[Math.floor(det.length / 2)]).toBeLessThanOrEqual(9);
  }, 600_000);
});

const days = (n: number, from = '2025-01-06'): string[] => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + 7 * i * 864e5).toISOString().slice(0, 10));
/** A few sessions of a lift ending on `last`. */
const trained = (exercise: string, last: string, w = 100): SetEntry[] => log(exercise, days(3, new Date(Date.parse(last) - 14 * 864e5).toISOString().slice(0, 10)).map((d) => [d, [`${w}x10`, `${w}x10`]]));

describe('nextVariation', () => {
  const bench = log('Bench Press', PLATEAU);
  it('the next variation is in the same pattern: the first not trained, in table order', () => {
    expect(nextVariation(bench, 'Bench Press', TODAY)).toBe('Machine Chest Press');
    expect(nextVariation(log('Deadlift', PLATEAU), 'Deadlift', TODAY)).toBe('Romanian Deadlift');
    expect(nextVariation(log('Lat Pulldown', PLATEAU), 'Lat Pulldown', TODAY)).toBe('Pull-up');
    expect(nextVariation([], 'Cable Curl', TODAY)).toBeNull();
  });
  it('cycles through three variations and back to the first', () => {
    // Bench → Machine Chest Press (never trained), then Incline (never), then back to Bench (the longest ago).
    const a = [...trained('Bench Press', '2026-05-01'), ...trained('Machine Chest Press', '2026-08-01')];
    expect(nextVariation(a, 'Machine Chest Press', TODAY)).toBe('Incline Bench Press');
    const b = [...a, ...trained('Incline Bench Press', '2026-09-28')];
    expect(nextVariation(b, 'Incline Bench Press', TODAY)).toBe('Bench Press');
    const c = [...b, ...trained('Bench Press', '2026-12-01')];
    expect(nextVariation(c, 'Bench Press', '2026-12-02')).toBe('Machine Chest Press');
  });
  it('the variations you know come before new ones, least recently trained first', () => {
    const e = [...trained('Barbell Squat', '2026-09-29'), ...trained('Hack Squat', '2026-03-01'), ...trained('Leg Press', '2026-07-01')];
    expect(nextVariation(e, 'Barbell Squat', TODAY)).toBe('Hack Squat');
  });
  it('the same main muscle comes first; another bias only when there is none', () => {
    expect(nextVariation(log('Seated Cable Row', PLATEAU), 'Seated Cable Row', TODAY)).toBe('Chest-Supported Row');
    // Machine Row is a lats row: the next is the other lats row, ahead of the mid-back rows listed before it.
    expect(nextVariation(log('Machine Row', PLATEAU), 'Machine Row', TODAY)).toBe('Landmine Row');
    // Mid-back rows you know don't come before a lats row you haven't done.
    const known = [...log('Machine Row', PLATEAU), ...trained('Seated Cable Row', '2026-06-01'), ...trained('Chest-Supported Row', '2026-08-01')];
    expect(nextVariation(known, 'Machine Row', TODAY)).toBe('Landmine Row');
    // No other lats row at this gym: the closest mid-back row.
    const gym = new Set(['Machine Row', 'Seated Cable Row', 'Chest-Supported Row']);
    expect(nextVariation(log('Machine Row', PLATEAU), 'Machine Row', TODAY, { available: gym })).toBe('Chest-Supported Row');
    // Close-grip bench is triceps-led: a chest press stays a chest press.
    const gym2 = new Set(['Bench Press', 'Close-Grip Bench Press', 'Incline Bench Press']);
    expect(nextVariation(bench, 'Bench Press', TODAY, { available: gym2 })).toBe('Incline Bench Press');
  });
  it('a pull keeps its bias: lats-led to lats-led, biceps-heavy to biceps-heavy', () => {
    // With one profile for every pull, a stalled chin-up would go to the pattern's first, the lat pulldown.
    expect(nextVariation(log('Chin-up', PLATEAU), 'Chin-up', TODAY)).toBe('Close-Grip Lat Pulldown');
    expect(nextVariation(log('Close-Grip Lat Pulldown', PLATEAU), 'Close-Grip Lat Pulldown', TODAY)).toBe('Chin-up');
    expect(nextVariation(log('Pull-up', PLATEAU), 'Pull-up', TODAY)).toBe('Lat Pulldown');
    // A close-grip pulldown you know, from longer ago, still waits behind the pull-up: the same bias comes first.
    const known = [...log('Lat Pulldown', PLATEAU), ...trained('Close-Grip Lat Pulldown', '2026-03-01'), ...trained('Pull-up', '2026-07-01')];
    expect(nextVariation(known, 'Lat Pulldown', TODAY)).toBe('Pull-up');
    // And round again: the lats-led pair alternate, with nothing biceps-heavy in between.
    const back = [...known, ...trained('Pull-up', '2026-09-29')];
    expect(nextVariation(back, 'Pull-up', TODAY)).toBe('Lat Pulldown');
  });
  it('with no pull of the same bias here, the closest of the rest, still lats-led', () => {
    expect(nextVariation(log('Lat Pulldown', PLATEAU), 'Lat Pulldown', TODAY, { available: new Set(['Lat Pulldown', 'Close-Grip Lat Pulldown']) })).toBe('Close-Grip Lat Pulldown');
    expect(nextVariation(log('Chin-up', PLATEAU), 'Chin-up', TODAY, { available: new Set(['Chin-up', 'Pull-up', 'Lat Pulldown']) })).toBe('Lat Pulldown');
  });
  it('only what this gym can do; nothing when nothing fits', () => {
    const gym = new Set(['Bench Press', 'Flat DB Press', 'Cable Curl']);
    expect(nextVariation(bench, 'Bench Press', TODAY, { available: gym })).toBe('Flat DB Press');
    expect(nextVariation(bench, 'Bench Press', TODAY, { available: new Set(['Bench Press']) })).toBeNull();
  });
  it('a lift added to the gym by hand is offered; a lift already in the program or that hurt lately is not', () => {
    const program: Program = { key: 'program', perSession: 12, createdAt: '', days: [{ name: 'Day A', slots: [
      { exercise: 'Bench Press', sets: 3, repMin: 8, repMax: 12 }, { exercise: 'Machine Chest Press', sets: 2, repMin: 8, repMax: 12 }] }] };
    expect(nextVariation(bench, 'Bench Press', TODAY, { program })).toBe('Incline Bench Press');
    const hurt = [...bench, ...session('2026-09-20', 'Machine Chest Press', ['100x10'], ['pain'])];
    expect(nextVariation(hurt, 'Bench Press', TODAY)).toBe('Incline Bench Press');
    const two = { available: new Set(['Bench Press', 'Machine Chest Press']) };
    expect(nextVariation(hurt, 'Bench Press', TODAY, two)).toBeNull();
    // Item 08: no flat 60 days. With a log this short, how fast pain fades is unknown (every half-life to seven months weighs
    // alike), so a pain 103 days ago still reads likelier than not worse than the region's; two years on, it doesn't.
    const old = (date: string) => [...bench, ...session(date, 'Machine Chest Press', ['100x10'], ['pain'])];
    expect(nextVariation(old('2026-06-20'), 'Bench Press', TODAY, two)).toBeNull();
    expect(nextVariation(old('2024-09-20'), 'Bench Press', TODAY, two)).toBe('Machine Chest Press');
    // Clean sessions of it since release it sooner (if he did it anyway): its own record outweighs the one pain.
    const since = [...old('2026-06-20'), ...log('Machine Chest Press', [['2026-07-01', ['100x10']], ['2026-07-08', ['100x10']], ['2026-07-15', ['100x10']]])];
    expect(nextVariation(since, 'Bench Press', TODAY, two)).toBe('Machine Chest Press');
    expect(nextVariation(bench, 'Bench Press', TODAY, { available: new Set(['Bench Press', 'Svend Press']), include: ['Svend Press'] })).toBeNull(); // not a pattern
    expect(nextVariation(bench, 'Bench Press', TODAY, { available: new Set(['Bench Press', 'Decline Bench Press']), include: ['Decline Bench Press'] })).toBe('Decline Bench Press');
  });
});

describe('nextVariation and pain elsewhere (item 08)', () => {
  const bench = log('Bench Press', PLATEAU);
  const two = { available: new Set(['Bench Press', 'Machine Chest Press']) };
  it(`a region that hurt (moderate or worse) on another lift in the last ${3} days keeps its lifts out; mild pain doesn't`, () => {
    const hurt = (sev: 1 | 2, date = '2026-09-29') => [...bench, ...session(date, 'Bench Press', ['185x8'], ['pain']).map((e) => ({ ...e, painSeverity: sev }))];
    expect(nextVariation(hurt(2), 'Bench Press', TODAY, two)).toBeNull();
    expect(nextVariation(hurt(1), 'Bench Press', TODAY, two)).toBe('Machine Chest Press');
    expect(nextVariation(hurt(2, '2026-09-27'), 'Bench Press', TODAY, two)).toBe('Machine Chest Press'); // 4 days: settled
  });
});

describe('rotation', () => {
  it('a stalled lift with a next variation; null otherwise', () => {
    const r = rotation(log('Bench Press', PLATEAU), 'Bench Press', TODAY);
    expect(r).toMatchObject({ from: 'Bench Press', to: 'Machine Chest Press', pattern: 'Horizontal press', muscle: 'Chest', sameMuscle: true, stall: { since: '2026-09-08', last: '2026-09-29' } });
    expect(rotation(log('Bench Press', PLATEAU.slice(0, 4)), 'Bench Press', TODAY)).toBeNull();
    expect(rotation(log('Bench Press', PLATEAU), 'Bench Press', TODAY, { available: new Set(['Bench Press']) })).toBeNull();
    expect(rotation(log('Cable Curl', PLATEAU), 'Cable Curl', TODAY)).toBeNull();
    const gym = new Set(['Machine Row', 'Seated Cable Row']);
    expect(rotation(log('Machine Row', PLATEAU), 'Machine Row', TODAY, { available: gym })).toMatchObject({ to: 'Seated Cable Row', sameMuscle: false, sameBias: false });
  });
  it('names what held: the muscles of a two-muscle bias, else the main muscle, else the closest', () => {
    const r = (lift: string, available?: string[]) => rotationReason(rotation(log(lift, PLATEAU), lift, TODAY, available ? { available: new Set(available) } : {})!);
    expect(r('Chin-up')).toBe('same pattern and muscles (lats and biceps)');
    expect(r('Bench Press')).toBe('same pattern and main muscle (chest)');
    expect(r('Lat Pulldown')).toBe('same pattern and main muscle (lats)');
    expect(r('Chin-up', ['Chin-up', 'Lat Pulldown'])).toBe('same pattern and main muscle (lats)');
    expect(r('Machine Row', ['Machine Row', 'Seated Cable Row'])).toBe('same pattern, the closest muscles this gym has');
  });
  it('says whether the bias held, as well as the main muscle', () => {
    expect(rotation(log('Chin-up', PLATEAU), 'Chin-up', TODAY))
      .toMatchObject({ to: 'Close-Grip Lat Pulldown', muscle: 'Lats', bias: ['Lats', 'Biceps'], sameMuscle: true, sameBias: true });
    expect(rotation(log('Chin-up', PLATEAU), 'Chin-up', TODAY, { available: new Set(['Chin-up', 'Lat Pulldown']) }))
      .toMatchObject({ to: 'Lat Pulldown', sameMuscle: true, sameBias: false });
  });
});

describe('carryOver', () => {
  const st = defaultSettings('Incline Bench Press'); // 8–12, +5
  it('from the catalog ratio at its lower bound, a weight that leaves the range bottom plus the habit, on the step (00-core 1.1)', () => {
    const e = log('Bench Press', PLATEAU);
    const c = carryOver(e, 'Bench Press', 'Incline Bench Press', TODAY, st)!;
    const now = strength(e, 'Bench Press', TODAY)!;
    const plain = now.e1rm * 0.8; // the catalog's incline : bench
    expect(c).toMatchObject({ reps: 8, basis: 'catalog' });
    // The lower bound: under the plain ratio by at least the level's own uncertainty, and not absurdly far.
    expect(c.e1rm).toBeLessThan(plain * Math.exp(-now.u));
    expect(c.e1rm).toBeGreaterThan(plain * 0.75);
    expect(c.weight % 5).toBe(0);
    expect(c.weight).toBeLessThan(c.e1rm / (1 + 8 / 30));
    // Other pairs: an RDL under the deadlift, a squat from a Smith squat, a front squat under the back squat.
    const rdl = carryOver(log('Deadlift', [['2026-09-29', ['315x5']]]), 'Deadlift', 'Romanian Deadlift', TODAY, defaultSettings('Romanian Deadlift'))!;
    expect(rdl.basis).toBe('catalog');
    expect(rdl.weight).toBeLessThan(315);
    const front = carryOver(log('Barbell Squat', [['2026-09-29', ['225x8']]]), 'Barbell Squat', 'Front Squat', TODAY, defaultSettings('Front Squat'))!;
    const smith = carryOver(log('Smith Squat', [['2026-09-29', ['225x8']]]), 'Smith Squat', 'Barbell Squat', TODAY, defaultSettings('Barbell Squat'))!;
    expect(front.weight).toBeLessThan(smith.weight);
  });
  it('from your own history of both, when they were trained around the same time', () => {
    const e = [...log('Bench Press', [['2025-09-01', ['185x8']], ['2025-09-15', ['185x8']]]), ...log('Incline Bench Press', [['2025-09-10', ['135x10']]]),
      ...log('Bench Press', [['2026-09-29', ['225x8']]])];
    const c = carryOver(e, 'Bench Press', 'Incline Bench Press', TODAY, st)!;
    expect(c).toMatchObject({ reps: 8, basis: 'history' });
    expect(c.e1rm).toBeLessThan(strength(e, 'Bench Press', TODAY)!.e1rm * 0.8);
  });
  it('an old session of the new lift with nothing of the old one near it falls back to the catalog', () => {
    const e = [...log('Bench Press', PLATEAU), ...log('Incline Bench Press', [['2024-01-10', ['135x10']]])];
    expect(carryOver(e, 'Bench Press', 'Incline Bench Press', TODAY, st)).toMatchObject({ basis: 'catalog' });
  });
  it('nothing for dumbbells, machines, bodyweight, or a lift trained in the last six weeks', () => {
    const bench = log('Bench Press', PLATEAU);
    expect(carryOver(bench, 'Bench Press', 'Flat DB Press', TODAY, defaultSettings('Flat DB Press'))).toBeNull();
    expect(carryOver(bench, 'Bench Press', 'Machine Chest Press', TODAY, defaultSettings('Machine Chest Press'))).toBeNull();
    expect(carryOver(log('Pull-up', [['2026-09-29', ['0x10']]]), 'Pull-up', 'Lat Pulldown', TODAY, defaultSettings('Lat Pulldown'))).toBeNull();
    const recent = [...bench, ...log('Incline Bench Press', [['2026-08-25', ['135x10']]])];
    expect(carryOver(recent, 'Bench Press', 'Incline Bench Press', TODAY, st)).toBeNull();
    // With machines, your own history of both still gives a ratio.
    const both = [...bench, ...log('Machine Chest Press', [['2026-05-05', ['150x10']]]), ...log('Bench Press', [['2026-05-01', ['175x8']]])];
    expect(carryOver(both, 'Bench Press', 'Machine Chest Press', TODAY, defaultSettings('Machine Chest Press'))).toMatchObject({ basis: 'history' });
  });
});

describe('rotateProgram', () => {
  const P: Program = { key: 'program', perSession: 12, createdAt: '', newToYou: ['Bench Press'], days: [
    { name: 'Day A', slots: [{ exercise: 'Bench Press', sets: 3, repMin: 8, repMax: 12 }, { exercise: 'Cable Curl', sets: 2, repMin: 10, repMax: 15 }] },
    { name: 'Day B', slots: [{ exercise: 'Lat Pulldown', sets: 3, repMin: 8, repMax: 12 }, { exercise: 'Bench Press', sets: 2, repMin: 8, repMax: 12 }] },
  ] };
  it('every slot of the lift becomes the next variation, with its range, and the program counts as edited', () => {
    const p = rotateProgram(P, 'bench press', 'Incline Bench Press', { repMin: 6, repMax: 10 });
    expect(p.edited).toBe(true);
    expect(p.days[0].slots).toEqual([{ exercise: 'Incline Bench Press', sets: 3, repMin: 6, repMax: 10 }, P.days[0].slots[1]]);
    expect(p.days[1].slots).toEqual([P.days[1].slots[0], { exercise: 'Incline Bench Press', sets: 2, repMin: 6, repMax: 10 }]);
    expect(p.newToYou).toEqual([]);
    expect(P.days[0].slots[0].exercise).toBe('Bench Press'); // the original is left alone
  });
});

describe('nextTarget with a carried-over seed', () => {
  const seed = { weight: 120, reps: 8, from: 'Bench Press', date: '2026-10-01' };
  const st = { ...defaultSettings('Incline Bench Press'), seed };
  it('starts from the seed until the lift has a session on or after the switch', () => {
    expect(nextTarget([], 'Incline Bench Press', st, '2026-10-01')).toMatchObject({ kind: 'carry', weight: 120, reps: 8 });
    const old = log('Incline Bench Press', [['2025-06-01', ['95x12', '95x12', '95x11']]]);
    expect(nextTarget(old, 'Incline Bench Press', st, '2026-10-01')).toMatchObject({ kind: 'carry', weight: 120 });
    expect(nextTarget(old, 'Incline Bench Press', st, '2026-10-01')?.text).toBe('Estimate: 120 lb × 8+');
    const after = [...old, ...log('Incline Bench Press', [['2026-10-01', ['120x10', '120x9', '120x9']]])];
    expect(nextTarget(after, 'Incline Bench Press', st, '2026-10-03')).toMatchObject({ kind: 'reps', weight: 120 });
  });
});
