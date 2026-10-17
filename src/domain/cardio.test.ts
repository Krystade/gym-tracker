process.env.TZ = 'America/New_York';
import { describe, expect, it } from 'vitest';
import type { CardioData, SetEntry } from './types';
import { cardioSlots, cardioTarget, carrySeconds, fmtCardio, machineFor, pickMachine, readCardio, weeklyCardioMinutes } from './cardio';
import { parseCsv, toCsv } from './csv';
import { defaultProfile } from './profile';
import { adherence, buildProgram, nextDay, quickDay, type DayPlan } from './program';
import { parseNotes, toEntries } from './notes';
import { estimateSeconds, perSessionForMinutes, DEFAULT_PACE } from './timing';

let seq = 0;
const bout = (date: string, exercise: string, cardio: CardioData): SetEntry => ({
  id: `c${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 0, reps: null, flags: ['cardio'], source: 't', cardio,
});
const NOW = new Date('2026-10-16T12:00:00Z');
const tier = (t: 1 | 2 | 3 | 4) => ({ ...defaultProfile(), cardioTier: t });

describe('fmtCardio', () => {
  it('reads like the machine', () => {
    expect(fmtCardio({ seconds: 1200, miles: 1.25, incline: 3 })).toBe('20:00 · 1.25 mi · 3%');
    expect(fmtCardio({ seconds: 1200, miles: 1.3, incline: -2 })).toBe('20:00 · 1.3 mi · −2%');
    expect(fmtCardio({ seconds: 905, level: 8, floors: 52 })).toBe('15:05 · L8 · 52 floors');
    expect(fmtCardio({ seconds: 3725 })).toBe('1:02:05');
  });
});

describe('cardioTarget', () => {
  it('starts easy with no history, at least 10 minutes', () => {
    expect(cardioTarget([], 'Treadmill', null, '2026-10-16')).toMatchObject({ minutes: 10, aim: null, text: 'Easy start · 10 min' });
    expect(cardioTarget([], 'StairMaster', 20, '2026-10-16')).toMatchObject({ minutes: 20, level: 4, text: 'Easy start · 20 min' });
  });
  it('leaves incline empty unless the last session had one', () => {
    expect(cardioTarget([], 'Treadmill', 20, '2026-10-16').incline).toBeUndefined();
    expect(cardioTarget([], 'Elliptical', 20, '2026-10-16').incline).toBeUndefined();
    expect(cardioTarget([bout('2026-10-10', 'Treadmill', { seconds: 600, incline: 3 })], 'Treadmill', 20, '2026-10-16')).toMatchObject({ aim: null, incline: 3 });
  });
  it('scales the last pace to the planned minutes and adds 2% after a met aim, up to the next 0.1 mi', () => {
    // 1.0 mi in 10 min, no aim then: 0.1 mi/min × 20 min × 1.02 = 2.04, aimed at 2.1
    const t = cardioTarget([bout('2026-10-10', 'Treadmill', { seconds: 600, miles: 1, incline: 4 })], 'Treadmill', 20, '2026-10-16');
    expect(t).toMatchObject({ minutes: 20, aim: 2.1, unit: 'mi', incline: 4, text: '20 min · aim 2.1 mi' });
  });
  it('repeats the aim after a missed one, without float noise rounding it up', () => {
    for (const miles of [1.9, 1.3, 1.1, 2.3]) {
      const t = cardioTarget([bout('2026-10-10', 'Treadmill', { seconds: 1200, miles, aim: miles + 0.1 })], 'Treadmill', 20, '2026-10-16');
      expect(t.aim).toBe(miles);
    }
  });
  it('uses floors on the StairMaster', () => {
    const t = cardioTarget([bout('2026-10-10', 'StairMaster', { seconds: 900, floors: 50, level: 8 })], 'StairMaster', 15, '2026-10-16');
    expect(t).toMatchObject({ aim: 51, unit: 'floors', level: 8 });
  });
  it('ignores the day being logged', () => {
    expect(cardioTarget([bout('2026-10-16', 'Treadmill', { seconds: 600, miles: 1 })], 'Treadmill', 10, '2026-10-16').aim).toBeNull();
  });
});

describe('carrySeconds', () => {
  it('carries past 59 into minutes and borrows below 0', () => {
    expect(carrySeconds('10', '60')).toEqual(['11', '0']);
    expect(carrySeconds('10', '75')).toEqual(['11', '15']);
    expect(carrySeconds('', '60')).toEqual(['1', '0']);
    expect(carrySeconds('10', '-15')).toEqual(['9', '45']);
    expect(carrySeconds('10', '-5')).toEqual(['9', '55']);
  });
  it('has nothing to borrow at 0 minutes', () => {
    expect(carrySeconds('0', '-15')).toEqual(['0', '0']);
    expect(carrySeconds('', '-15')).toEqual(['', '0']);
  });
  it('leaves typing alone', () => {
    for (const sec of ['', '4', '45', '59', '4.', '-', 'x']) expect(carrySeconds('10', sec)).toEqual(['10', sec]);
  });
});

describe('weekly minutes and slots', () => {
  it('sums seconds inside the week only', () => {
    const es = [bout('2026-10-11', 'Treadmill', { seconds: 600 }), bout('2026-10-12', 'Treadmill', { seconds: 900 }), bout('2026-10-18', 'Elliptical', { seconds: 330 }), bout('2026-10-19', 'Treadmill', { seconds: 600 })];
    expect(weeklyCardioMinutes(es, '2026-10-12')).toBe(21); // 900 + 330 s, Mon 12 – Sun 18
  });
  it('splits the goal into slots of about 25 minutes, one a day, at least 10', () => {
    expect(cardioSlots(40, 3)).toEqual([20, 20]);
    expect(cardioSlots(60, 2)).toEqual([30, 30]);
    expect(cardioSlots(20, 3)).toEqual([20]);
    expect(cardioSlots(0, 3)).toEqual([]);
  });
  it('picks the machine used most at this gym, else the first it has', () => {
    const es = [bout('2026-10-01', 'StairMaster', { seconds: 1800 }), bout('2026-10-02', 'Treadmill', { seconds: 600 })];
    expect(pickMachine(es, '2026-10-16', () => true)).toBe('StairMaster');
    expect(pickMachine(es, '2026-10-16', (n) => n !== 'StairMaster')).toBe('Treadmill');
    expect(pickMachine([], '2026-10-16', (n) => n === 'Exercise Bike')).toBe('Exercise Bike');
    expect(pickMachine([], '2026-10-16', () => false)).toBeNull();
  });
});

describe('program', () => {
  it('priority 2 over 3 days plans two 20-minute slots, last in their days', () => {
    const p = buildProgram(tier(2), [], { days: 3, perSession: 12 }, NOW);
    const cardio = p.days.flatMap((d) => d.slots.filter((s) => s.minutes != null));
    expect(cardio.map((s) => [s.exercise, s.minutes])).toEqual([['Treadmill', 20], ['Treadmill', 20]]);
    for (const d of p.days) { const i = d.slots.findIndex((s) => s.minutes != null); if (i >= 0) expect(i).toBe(d.slots.length - 1); }
  });
  it('priority 4 (and no priority) plans none', () => {
    for (const prof of [tier(4), defaultProfile()]) expect(buildProgram(prof, [], { days: 3, perSession: 12 }, NOW).days.flatMap((d) => d.slots).some((s) => s.minutes != null)).toBe(false);
  });
  it('a gym with no cardio machine plans none and says so', () => {
    const p = buildProgram(tier(1), [], { days: 3, perSession: 12 }, NOW, { available: new Set(['Leg Press']) });
    expect(p.days.flatMap((d) => d.slots).some((s) => s.minutes != null)).toBe(false);
    expect(p.cardioUnavailable).toBe(true);
  });
  it('cardio minutes come out of a minutes budget', () => {
    const pace = { perSet: new Map<string, number>(), transition: DEFAULT_PACE.transition };
    const est = (d: { slots: { exercise: string; sets: number; minutes?: number }[] }) => estimateSeconds(d.slots, pace) / 60;
    const per = (t: 1 | 4) => perSessionForMinutes(50, (n) => buildProgram(tier(t), [], { days: 2, perSession: n }, NOW), est);
    expect(per(1)).toBeLessThan(per(4));
  });
  it('a logged cardio slot counts for adherence, and a cardio-only day moves the rotation', () => {
    const p = buildProgram(tier(2), [], { days: 2, perSession: 10 }, NOW);
    const d = p.days.findIndex((x) => x.slots.some((s) => s.minutes != null));
    const slot = p.days[d].slots.find((s) => s.minutes != null)!;
    const plan: DayPlan = { key: 'day:2026-10-15', date: '2026-10-15', day: d, skips: [], swaps: {} };
    const es = [bout('2026-10-15', slot.exercise, { seconds: slot.minutes! * 60 })];
    expect(adherence(p, [plan], es, '2026-10-01', '2026-10-16').done).toBe(1);
    expect(nextDay(p, [plan], es, '2026-10-16')).toBe((d + 1) % 2);
  });
  it('a quick day adds cardio only when it is a priority and behind', () => {
    const fits = () => true;
    const has = (q: ReturnType<typeof quickDay>) => q.some((s) => s.minutes != null);
    expect(has(quickDay(tier(1), [], '2026-10-16', fits))).toBe(true);
    expect(has(quickDay(tier(3), [], '2026-10-16', fits))).toBe(false);
    const done = [bout('2026-10-12', 'Treadmill', { seconds: 3600 })];
    expect(has(quickDay(tier(1), done, '2026-10-16', fits))).toBe(false);
  });
});

describe('csv', () => {
  it('round-trips every cardio column', () => {
    const e = { ...bout('2026-10-15', 'Treadmill', { seconds: 1200, miles: 1.3, incline: -2, aim: 1.28 }), id: 'app|2026-10-15|treadmill|1', source: 'app' };
    const back = parseCsv(toCsv([e]), 'app').entries[0];
    expect(back.cardio).toEqual(e.cardio);
    expect(back.flags).toEqual(['cardio']);
  });
  it('still reads a file from before the cardio columns', () => {
    const old = 'date,exercise,set,weight_lb,reps\n2026-10-01,Leg Press,1,200,10\n';
    expect(parseCsv(old).entries).toHaveLength(1);
  });
  it('a cardio row needs a duration', () => {
    const bad = 'date,exercise,set,weight_lb,reps,flags\n2026-10-01,Treadmill,1,0,,cardio\n';
    expect(parseCsv(bad).errors).toEqual([{ row: 2, message: 'Cardio row needs duration_s' }]);
  });
});

describe('notes', () => {
  it('reads cardio numbers in any order, the rest is the note', () => {
    expect(readCardio('20 min 1.2 mi 5%')).toEqual({ cardio: { seconds: 1200, miles: 1.2, incline: 5 } });
    expect(readCardio('15:00 L8 52 floors')).toEqual({ cardio: { seconds: 900, level: 8, floors: 52 } });
    expect(readCardio('1.5 miles in 25 min at -2% felt good')).toEqual({ cardio: { seconds: 1500, miles: 1.5, incline: -2 }, note: 'in at felt good' });
    expect(readCardio('1.2 mi')).toBeNull();
    expect(machineFor('Stair master')).toBe('StairMaster');
    expect(machineFor('bike')).toBe('Exercise Bike');
  });
  it('a pasted cardio line becomes one cardio entry', () => {
    const lines = parseNotes('Treadmill 20 min 1.2 mi 5%\nStairmaster 15:00 L8 52 floors\nLeg press 200x10', '2026-10-16', () => false);
    expect(lines.map((l) => [l.kind, l.name])).toEqual([['sets', 'Treadmill'], ['sets', 'StairMaster'], ['sets', 'Leg press']]);
    const { entries } = toEntries(lines, (n) => n, { ignored: new Set(), include: new Set() }, []);
    expect(entries.filter((e) => e.cardio).map((e) => [e.exercise, e.flags, e.cardio])).toEqual([
      ['Treadmill', ['cardio'], { seconds: 1200, miles: 1.2, incline: 5 }],
      ['StairMaster', ['cardio'], { seconds: 900, level: 8, floors: 52 }],
    ]);
  });
  it('a cardio line without a time is flagged, not guessed', () => {
    expect(parseNotes('Treadmill 1.2 mi', '2026-10-16', () => false)[0]).toMatchObject({ kind: 'unparsed', name: 'Treadmill' });
  });
});
