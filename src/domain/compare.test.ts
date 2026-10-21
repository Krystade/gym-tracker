import { describe, expect, it } from 'vitest';
import { addDays } from './analytics';
import {
  axisTicks, firsts, heatStep, MAX_FIRSTS, MAX_LIFTS, parseSummary, PERSON_COLOURS, personColours, POINTS, ranked, ranks, samples, sharedLifts, spread,
  strength, summarize, summaryKey, values, YOU_COLOUR, type Person, type Summary,
} from './compare';
import { e1rmChange } from './feed';
import { rangeFrom } from './statsLayout';
import type { SetEntry } from './types';

// Synthetic sets only. Today is Wed 21 Oct 2026.
const TODAY = '2026-10-21';
let n = 0;
const set = (exercise: string, date: string, weight: number, reps = 5, over: Partial<SetEntry> = {}): SetEntry => {
  n++;
  return { id: `t|${date}|${exercise}|${n}`, date, seq: n, exercise, setNo: 1, weight, reps, flags: [], source: 't', ...over };
};
/** A lift done every `every` days from `from` to `to`, its weight climbing `step` lb a session from `start`. */
function lift(exercise: string, from: string, to: string, start: number, step = 0, every = 7, sets = 3): SetEntry[] {
  const out: SetEntry[] = [];
  for (let d = from, k = 0; d <= to; d = addDays(d, every), k++) for (let i = 0; i < sets; i++) out.push(set(exercise, d, start + k * step));
  return out;
}

describe('samples: the 13 days a range is read at', () => {
  it('starts on the range’s first day, ends today, 13 in order', () => {
    for (const r of ['4w', '12w', '1y'] as const) {
      const s = samples(r, TODAY);
      expect(s).toHaveLength(POINTS);
      expect(s[0]).toBe(rangeFrom(r, TODAY));
      expect(s[POINTS - 1]).toBe(TODAY);
      expect([...s].sort()).toEqual(s);
      expect(new Set(s).size).toBe(POINTS);
    }
  });
});

describe('summarize: what your phone publishes', () => {
  const log = [
    ...lift('Bench Press', '2026-03-02', TODAY, 135, 2.5, 3), // a long, climbing bench
    ...lift('Barbell Squat', '2026-08-01', TODAY, 185, 5, 7),
    ...lift('Lat Pulldown', '2026-10-01', '2026-10-08', 100, 0, 7), // too new to say
  ];
  const s = summarize(log, TODAY, 3);

  it('holds the keys the rules allow and nothing else: no set, no note, no pain, no body', () => {
    expect(Object.keys(s).sort()).toEqual(['day', 'firsts', 'goal', 'r', 'streak', 'v']);
    for (const r of Object.values(s.r)) expect(Object.keys(r).sort()).toEqual(['lifts', 'met', 'prs', 'vol']);
    const painful = [set('Bench Press', TODAY, 135, 5, { flags: ['pain'], painRegion: 'shoulder' as SetEntry['painRegion'], painSeverity: 3, note: 'left shoulder twinge' })];
    const text = JSON.stringify(summarize([...log, ...painful], TODAY, 3));
    for (const word of ['pain', 'shoulder', 'twinge', 'note', 'energy', 'cycle', 'weight', 'reps']) expect(text).not.toContain(word);
  });
  it('a week string per range, oldest first, its own goal: 4, 12 and 52 weeks', () => {
    expect(s.r['4w'].met).toMatch(/^[01]{4}$/);
    expect(s.r['12w'].met).toMatch(/^[01]{12}$/);
    expect(s.r['1y'].met).toMatch(/^[01]{52}$/);
    // Bench every 3 days and squat weekly: two or three days a week, so a goal of 2 is met every full week since March.
    const two = summarize(log, TODAY, 2);
    expect(two.r['12w'].met.slice(0, 11)).toBe('1'.repeat(11));
    expect(summarize(log, TODAY, 7).r['12w'].met).toBe('0'.repeat(12));
    expect(two.goal).toBe(2);
    expect(summarize(log, TODAY, 0).goal).toBe(2); // no goal set: the app's default
    expect(summarize(log, TODAY, 9).goal).toBe(7);
  });
  it('each lift’s line ends where e1rmChange says, and every point is e1rmChange to that day', () => {
    for (const r of ['4w', '12w', '1y'] as const) {
      const from = rangeFrom(r, TODAY), at = samples(r, TODAY);
      for (const l of s.r[r].lifts) {
        expect(l.s).toHaveLength(POINTS);
        l.s.forEach((v, k) => expect(v).toBeCloseTo(e1rmChange(log, l.n, from, at[k])?.pct ?? 0, 1));
      }
    }
    expect(s.r['12w'].lifts.map((l) => l.n)).toEqual(['Bench Press', 'Barbell Squat']); // most sessions first; pulldown has no change
    expect(s.r['12w'].lifts[0].s[POINTS - 1]).toBeGreaterThan(0);
  });
  it('at most 12 lifts, names cut to 60 characters', () => {
    const many = Array.from({ length: 15 }, (_, i) => lift(`Lift ${String(i).padStart(2, '0')} ${'x'.repeat(70)}`, '2026-09-01', TODAY, 50, 5, 7)).flat();
    const lifts = summarize(many, TODAY, 3).r['12w'].lifts;
    expect(lifts).toHaveLength(MAX_LIFTS);
    for (const l of lifts) expect(Array.from(l.n).length).toBeLessThanOrEqual(60);
  });
  it('PRs: a count so far at each point, never going down, the last the range’s', () => {
    const p = s.r['12w'].prs;
    expect(p).toHaveLength(POINTS);
    for (let k = 1; k < POINTS; k++) expect(p[k]).toBeGreaterThanOrEqual(p[k - 1]);
    expect(p[POINTS - 1]).toBeGreaterThan(0);
    expect(summarize(lift('Bench Press', '2026-10-01', TODAY, 100, 0, 7), TODAY, 3).r['4w'].prs[0]).toBe(0);
  });
  it('volume: sets a week so far against their usual, null until a quarter of the range is in, none without a usual', () => {
    // Steady: one session of 3 sets every 7 days since March. Doubled in the last 4 weeks.
    const steady = lift('Bench Press', '2026-03-04', TODAY, 135, 0, 7);
    const doubled = [...steady, ...lift('Bench Press', addDays(rangeFrom('4w', TODAY), 0), TODAY, 135, 0, 7)];
    const v = summarize(doubled, TODAY, 2).r['4w'].vol;
    expect(v).toHaveLength(POINTS);
    expect(v.slice(0, 3)).toEqual([null, null, null]);
    expect(v[POINTS - 1]).toBeGreaterThan(60);
    const flat = summarize(steady, TODAY, 2).r['12w'].vol;
    expect(Math.abs(flat[POINTS - 1]!)).toBeLessThan(15);
    expect(summarize(lift('Bench Press', '2026-10-01', TODAY, 135), TODAY, 2).r['4w'].vol).toEqual([]); // started inside the range
  });
  it('a streak of weeks at their goal, the whole log read', () => {
    expect(summarize(log, TODAY, 2).streak).toBeGreaterThan(20);
    expect(summarize([], TODAY, 2)).toMatchObject({ streak: 0, firsts: [] });
  });
  it('the same log gives the same summary (what decides a write again)', () => {
    expect(summaryKey(summarize(log, TODAY, 3))).toBe(summaryKey(s));
    expect(summaryKey(summarize(log, addDays(TODAY, 1), 3))).not.toBe(summaryKey(s));
  });
  it('a long log is quick: three years of four sessions a week', () => {
    const big: SetEntry[] = [];
    const names = ['Bench Press', 'Barbell Squat', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Lat Pulldown', 'Leg Press', 'Curl', 'Triceps Pushdown', 'Lateral Raise', 'Pull-up', 'Leg Curl'];
    for (let d = addDays(TODAY, -3 * 365), k = 0; d <= TODAY; d = addDays(d, 1), k++) {
      if (k % 7 === 1 || k % 7 === 3 || k % 7 === 5 || k % 7 === 6) for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) big.push(set(names[(k + j) % names.length], d, 50 + (k / 10) + j * 10));
    }
    const t = performance.now();
    summarize(big, TODAY, 4);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(big.length).toBeGreaterThan(14_000);
  });
});

describe('firsts: raw-load milestones, the only loads that leave the phone', () => {
  it('a barbell compound’s first set at a plate milestone, once a lighter one came before', () => {
    const log = [set('Bench Press', '2026-09-01', 205), set('Bench Press', '2026-09-08', 225), set('Bench Press', '2026-09-15', 225)];
    expect(firsts(log, TODAY)).toEqual([{ n: 'Bench Press', w: 225, d: '2026-09-08' }]);
    expect(firsts([set('Deadlift', '2026-09-01', 315)], TODAY)).toEqual([]); // the first set ever is where they started, not a first
  });
  it('the highest crossed when one day crosses two; warm-ups, partials and machines don’t count', () => {
    const log = [set('Deadlift', '2026-09-01', 300), set('Deadlift', '2026-09-08', 405), set('Deadlift', '2026-09-08', 410)];
    expect(firsts(log, TODAY)).toEqual([{ n: 'Deadlift', w: 405, d: '2026-09-08' }]);
    expect(firsts([set('Barbell Squat', '2026-09-01', 200), set('Barbell Squat', '2026-09-08', 230, 5, { flags: ['warmup'] }), set('Barbell Squat', '2026-09-09', 230, null as unknown as number, { flags: ['partial'] })], TODAY)).toEqual([]);
    expect(firsts([set('Leg Press', '2026-09-01', 300), set('Leg Press', '2026-09-08', 405)], TODAY)).toEqual([]);
  });
  it('a first pull-up, chin-up or dip, once the log is four weeks old', () => {
    const old = set('Bench Press', '2026-08-01', 135);
    expect(firsts([old, set('Pull-up', '2026-10-09', 0, 1, { flags: ['bodyweight'] })], TODAY)).toEqual([{ n: 'Pull-up', w: 0, d: '2026-10-09' }]);
    expect(firsts([set('Bench Press', '2026-10-01', 135), set('Chin-up', '2026-10-09', 0, 3)], TODAY)).toEqual([]); // 8 days of log: where they started
    expect(firsts([old, set('Dips', '2026-10-01', 0, 8), set('Dips', '2026-10-09', 0, 10)], TODAY).map((f) => f.d)).toEqual(['2026-10-01']);
  });
  it('the last year’s only, newest first, at most 8', () => {
    const log = [set('Deadlift', '2024-01-01', 100), set('Deadlift', '2025-01-01', 135)]; // over a year ago
    expect(firsts(log, TODAY)).toEqual([]);
    const many = ['Bench Press', 'Barbell Squat', 'Deadlift', 'Overhead Press'].flatMap((l, i) => [
      set(l, '2026-01-01', 100), ...[135, 225, 315].map((w, j) => set(l, addDays('2026-02-01', i * 30 + j * 7), w)),
    ]);
    const f = firsts(many, TODAY);
    expect(f).toHaveLength(MAX_FIRSTS);
    expect([...f.map((x) => x.d)].sort().reverse()).toEqual(f.map((x) => x.d));
  });
});

const summary = (o: Partial<Summary> = {}, lifts: Record<string, number> = {}): Summary => {
  const line = (end: number) => Array.from({ length: POINTS }, (_, i) => (end * i) / (POINTS - 1));
  const range = (weeks: number) => ({ met: '1'.repeat(weeks), vol: line(10), prs: line(4).map(Math.round), lifts: Object.entries(lifts).map(([n, end]) => ({ n, s: line(end) })) });
  return { v: 1, day: TODAY, goal: 3, streak: 4, r: { '4w': range(4), '12w': range(12), '1y': range(52) }, firsts: [], ...o };
};

describe('parseSummary: a friend’s, read as untrusted', () => {
  it('reads back what summarize wrote, with when', () => {
    const s = summary({}, { 'Bench Press': 5 });
    expect(parseSummary({ ...s, at: { toMillis: () => 123 } })).toEqual({ ...s, at: 123 });
  });
  it('null for another version or a shape it doesn’t know: shown as not updated, never a crash', () => {
    for (const x of [null, 'x', 1, {}, { ...summary(), v: 2 }, { ...summary(), goal: 0 }, { ...summary(), day: 'today' },
      { ...summary(), r: { '4w': summary().r['4w'] } }, { ...summary(), r: { ...summary().r, '12w': { ...summary().r['12w'], met: '1' } } },
      { ...summary(), r: { ...summary().r, '1y': { ...summary().r['1y'], prs: [1] } } }]) expect(parseSummary(x)).toBeNull();
  });
  it('drops a bad lift or First further in (the rules check only the first of each)', () => {
    const s = summary({ firsts: [{ n: 'Deadlift', w: 315, d: '2026-10-01' }, { n: '', w: 1, d: 'x' } as never, { n: 'Bench Press', w: 9999, d: '2026-10-01' }] }, { 'Bench Press': 5, Squat: 3 });
    (s.r['12w'].lifts as unknown[]).push({ n: 'Row', s: [1, 2] }, 'Curl', { n: 'x'.repeat(61), s: s.r['12w'].lifts[0].s });
    const p = parseSummary(s)!;
    expect(p.r['12w'].lifts.map((l) => l.n)).toEqual(['Bench Press', 'Squat']);
    expect(p.firsts).toEqual([{ n: 'Deadlift', w: 315, d: '2026-10-01' }]);
    expect(parseSummary({ ...summary(), r: { ...summary().r, '4w': { ...summary().r['4w'], vol: [1, 'x'] } } })!.r['4w'].vol).toEqual([]);
  });
});

describe('strength: the mean change over the crew’s shared lifts', () => {
  const me: Person = { uid: 'me', me: true, s: summary({}, { 'Bench Press': 6, 'Barbell Squat': 10, 'Cable Fly': 40 }) };
  const sam: Person = { uid: 'sam', me: false, s: summary({}, { 'Flat Bench Press': 2, Deadlift: 8 }) };
  const kes: Person = { uid: 'kes', me: false, s: summary({}, { 'Back Squat': 4, Deadlift: 2 }) };
  it('counts a lift only when someone else shown has it too, matched as the catalog matches names', () => {
    const v = strength([me, sam, kes], '12w');
    expect(v.get('me')!.v).toBeCloseTo((6 + 10) / 2); // Cable Fly is only his
    expect(v.get('sam')!.v).toBeCloseTo((2 + 8) / 2); // "Flat Bench Press" is Bench Press
    expect(v.get('kes')!.v).toBeCloseTo((4 + 2) / 2); // "Back Squat" is Barbell Squat
    expect(v.get('me')!.line).toHaveLength(POINTS);
    expect(v.get('me')!.line![0]).toBe(0);
    expect(sharedLifts([me, sam, kes], '12w').get('me')).toEqual(['Bench Press', 'Barbell Squat']);
  });
  it('hiding someone changes what’s shared; alone, or with no summary, nothing to say', () => {
    expect(strength([me, sam], '12w').get('me')!.v).toBeCloseTo(6);
    expect(strength([me], '12w').get('me')).toEqual({ v: null, line: null });
    expect(strength([me, { uid: 'new', me: false, s: null }], '12w').get('new')).toEqual({ v: null, line: null });
  });
});

describe('values, ranks and the heat table', () => {
  const people: Person[] = [
    { uid: 'a', me: true, s: summary({ streak: 6 }) },
    { uid: 'b', me: false, s: summary({ streak: 11 }) },
    { uid: 'c', me: false, s: summary({ streak: 6 }) },
    { uid: 'd', me: false, s: null },
  ];
  it('each metric reads its own field; a person with no summary has no value', () => {
    expect(values(people, 'streak', '12w').get('b')).toEqual({ v: 11, line: null });
    expect(values(people, 'goal', '4w').get('a')!.v).toBe(4);
    expect(values(people, 'pr', '1y').get('a')!.v).toBe(4);
    expect(values(people, 'vol', '12w').get('a')!.v).toBeCloseTo(10);
    expect(values(people, 'vol', '12w').get('d')).toEqual({ v: null, line: null });
  });
  it('equal values share a rank, no value has none; you first among equals', () => {
    const v = values(people, 'streak', '12w');
    expect(Object.fromEntries(ranks(v))).toEqual({ a: 2, b: 1, c: 2, d: null });
    const named = people.map((p) => ({ ...p, name: p.uid === 'a' ? 'You' : p.uid }));
    expect(ranked(named, v).map((p) => p.uid)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('heat steps 1 to 4 by place among those shown; ties share; nothing to set against, no shade', () => {
    expect([1, 2, 3, 4, 5].map((v) => heatStep(v, [1, 2, 3, 4, 5]))).toEqual([1, 1, 2, 3, 4]);
    expect(heatStep(3, [3, 3, 1])).toBe(heatStep(3, [3, 1, 3]));
    expect([3, 3, 1].map((v) => heatStep(v, [3, 3, 1]))).toEqual([2, 2, 1]); // tied, so the same step: the one above the lowest
    expect(heatStep(5, [5])).toBe(0);
    expect(heatStep(null, [1, 2])).toBe(0);
    expect([1, 9].map((v) => heatStep(v, [1, 9]))).toEqual([1, 4]);
  });
});

// ---- The palette: computed, not eyeballed (OKLab ×100, Machado 2009 at full severity, WCAG contrast) ----
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
const lin = (h: string) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const oklab = ([r, g, b]: number[]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const sim = (rgb: number[], k?: keyof typeof MACHADO) => (k ? MACHADO[k].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))) : rgb);
const dE = (x: string, y: string, k?: keyof typeof MACHADO) => { const a = oklab(sim(lin(x), k)), b = oklab(sim(lin(y), k)); return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
const lum = (h: string) => { const [r, g, b] = lin(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (x: string, y: string) => { const [hi, lo] = [lum(x), lum(y)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05); };

describe('person colours', () => {
  const all = [YOU_COLOUR, ...PERSON_COLOURS];
  const minPair = (k?: keyof typeof MACHADO, xs = all) => { let m = Infinity; for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) m = Math.min(m, dE(xs[i], xs[j], k)); return m; };
  it('every pair of the 13 (You and 12 friends) apart in normal, protan and deutan vision; tritan recorded', () => {
    expect(minPair()).toBeGreaterThanOrEqual(8);
    expect(minPair('protan')).toBeGreaterThanOrEqual(8);
    expect(minPair('deutan')).toBeGreaterThanOrEqual(8);
    expect(minPair('tritan')).toBeGreaterThanOrEqual(3.5);
    // Fewer people, wider apart: the first few friends are the most distinct.
    expect(minPair(undefined, all.slice(0, 3))).toBeGreaterThanOrEqual(20);
    expect(minPair('deutan', all.slice(0, 5))).toBeGreaterThanOrEqual(12);
  });
  it('each legible on the dark surface, and none of them the app’s good, warning or bad', () => {
    for (const c of all) expect(contrast(c, '#18191c')).toBeGreaterThanOrEqual(4);
    for (const c of PERSON_COLOURS) for (const st of ['#69d98d', '#f97770', '#fa934e']) expect(dE(c, st)).toBeGreaterThanOrEqual(8);
  });
  it('follow the person, never their place: by when you became friends, unchanged by who is hidden', () => {
    const fs = [{ uid: 'z', since: 3 }, { uid: 'a', since: 5 }, { uid: 'm', since: 1 }, { uid: 'old' }];
    const c = personColours(fs);
    expect([c.get('m'), c.get('z'), c.get('a'), c.get('old')]).toEqual(PERSON_COLOURS.slice(0, 4));
    expect(personColours(fs.slice(0, 13)).get('a')).toBe(c.get('a'));
    const many = personColours(Array.from({ length: 14 }, (_, i) => ({ uid: `f${i}`, since: i })));
    expect(many.get('f12')).toBe(PERSON_COLOURS[0]); // past 12, colours come round again (each line still has its name)
  });
});

describe('spread: labels at line ends never overlap', () => {
  it('keeps each label a gap from the next, inside the plot, in the order given', () => {
    const ys = [50, 52, 51, 200, 199, 10];
    const out = spread(ys, 13, 0, 210);
    const sorted = [...out].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeGreaterThanOrEqual(13 - 1e-9);
    for (const y of out) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(210); }
    expect(out[5]).toBe(10); // far from the rest: where its line ends
  });
  it('12 lines in a short plot: as many as fit, still a gap apart', () => {
    const out = spread(Array(12).fill(100), 13, 0, 160).sort((a, b) => a - b);
    for (let k = 1; k < out.length; k++) expect(out[k] - out[k - 1]).toBeGreaterThanOrEqual(13 - 1e-9);
  });
});

describe('axisTicks', () => {
  it('runs from at or below the lowest value to at or above the highest, in round steps, so no line leaves the plot', () => {
    expect(axisTicks(-4.8, 19.6, false)).toEqual([-10, 0, 10, 20]); // the 12-friend chart: +19.6% once drew over the text above
    expect(axisTicks(0, 13.2, false)).toEqual([0, 5, 10, 15]);
    expect(axisTicks(0, 10, false)).toEqual([0, 2.5, 5, 7.5, 10]); // a round top is its own edge
    expect(axisTicks(0, 0, false)).toEqual([0, 0.5]); // a flat start still has height
    expect(axisTicks(0, 3, true)).toEqual([0, 1, 2, 3]); // PRs: whole numbers
    for (const [lo, hi] of [[-3, 41], [-0.2, 0.3], [-25, -1], [0, 138]] as const) {
      const t = axisTicks(lo, hi, false);
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi);
      expect(t.length).toBeLessThanOrEqual(6);
    }
  });
});
