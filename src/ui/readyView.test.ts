import { createElement as h, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../domain/profile';
import type { DayPlan, Program, Slot } from '../domain/program';
import type { SetEntry } from '../domain/types';
import { simulateRecovery } from '../domain/learn/recoverySim.sample';
import { ReadyTile, WeekRow, WeekStrip, WhyBody } from './ReadyTile';
import { readyNow, shownNumber, stripView, suggestedDay, tileView, todayMuscles, whyView, type ReadyInput } from './readyView';

// Readiness S4: every string the READY tile, the week strip and the Why sheet render, over synthetic weeks (every weekday, every
// goal, sore legs, a light week, a layoff, a new user). Owner Q2: a day, never a clock time; and never a 0 for a number.

const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const nextMonday = (d: string) => { let x = addD(d, 1); while (wd(x) !== 1) x = addD(x, 1); return x; };
const session = (date: string, exercise: string, n: number, reps: number, fail: boolean): SetEntry[] =>
  Array.from({ length: n }, (_, k) => ({
    id: `t|${date}|${exercise}|${k + 1}`, date, seq: k, loggedAt: new Date(Date.parse(`${date}T17:00:00Z`) + k * 180e3).toISOString(),
    exercise, setNo: k + 1, weight: 100, reps, flags: [], source: 'test', rir: fail ? 0 : 3,
  }));
const slot = (exercise: string, sets = 3): Slot => ({ exercise, sets, repMin: 8, repMax: 12 });
const UL: Program = { key: 'program', perSession: 12, createdAt: '', days: [
  { name: 'Upper', slots: [slot('Bench Press', 4), slot('Lat Pulldown', 4), slot('DB Curl', 3)] },
  { name: 'Legs', slots: [slot('Leg Press', 4), slot('Leg Extension', 3)] },
] };
const plan = (date: string, day: number): DayPlan => ({ key: `day:${date}`, date, day, skips: [], swaps: {} });

/** A clock time: "17:40", "7:05", "5pm", "5 am" (learn/readiness's detector). */
const CLOCK = /\d{1,2}:\d{2}|\b\d{1,2}\s?(am|pm)\b/i;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

const { entries: base } = simulateRecovery(1, { sessions: 60, failFrac: 0.3 });
const MON = nextMonday(addD(base.at(-1)!.date, 1));
const input = (over: Partial<ReadyInput> & { goal?: number }): ReadyInput => ({
  entries: base, body: [], program: UL, plans: [plan(base.at(-1)!.date, 0)], quick: null, today: MON, tz: 'UTC', tapped: null,
  ...over, profile: { ...defaultProfile(), weeklyGoal: over.goal ?? 3 },
});

/** The tile, the strip and the Why sheet as rendered, and their views. */
function render(i: ReadyInput) {
  const r = readyNow(i);
  const t = tileView(r), s = stripView(r), w = whyView(r, i, null);
  const html = renderToStaticMarkup(h(Fragment, null,
    h(ReadyTile, { t, onWhy: () => {}, onFold: () => {} }),
    s && h(WeekStrip, { s }),
    h(WhyBody, { w, t })));
  return { r, t, s, w, html, text: text(html) };
}

describe('the READY tile, the week strip and the Why sheet, rendered', () => {
  const cases: [string, ReadyInput][] = [];
  for (let k = 0; k < 7; k++) for (const goal of [1, 2, 3, 4, 5, 6, 7]) {
    const today = addD(MON, k);
    const sore = [...session(addD(today, -1), 'Leg Press', 5, 12, true), ...session(addD(today, -1), 'Leg Extension', 4, 12, true)];
    cases.push([`${today} goal ${goal}`, input({ today, goal })]);
    cases.push([`${today} goal ${goal} sore`, input({ today, goal, entries: [...base, ...sore] })]);
    cases.push([`${today} goal ${goal} light`, input({ today, goal, tapped: { from: MON }, entries: [...base, ...sore] })]);
  }
  cases.push(['layoff', input({ today: addD(MON, 9) })]);
  cases.push(['new user', input({ entries: [], plans: [] })]);
  cases.push(['new user, no program', input({ entries: [], plans: [], program: null, quick: [slot('Bench Press')] })]);

  // Rendered once for the tests below (147 weeks planned: seconds on a slow CI runner).
  let all: (ReturnType<typeof render> & { name: string })[] | null = null;
  const rendered = () => (all ??= cases.map(([name, i]) => ({ name, ...render(i) })));

  it('no clock time in any string, and a number that is never 0', () => {
    const kinds = new Set<string>();
    for (const { name, t, html, text: tx } of rendered()) {
      kinds.add(t.kind + (t.verdict.startsWith('Goal met') ? ' goal-met' : ''));
      expect(tx.match(CLOCK), `${name}: ${tx}`).toBeNull();
      if (t.number != null) expect(t.number, name).toMatch(/^(<1|[1-9]\d*)$/);
      expect(html, name).not.toMatch(/class="ready-n"[^>]*>0</);
    }
    // The grid reaches every verdict, so the checks above read each one's strings.
    expect([...kinds].sort()).toEqual(['go', 'go goal-met', 'light', 'light goal-met', 'rest', 'tight']);
  }, 60_000);

  it('a new user: the calm line, no number; with a log, a number and its sets (pair)', () => {
    for (const i of [input({ entries: [], plans: [] }), input({ entries: [], plans: [], program: null, quick: [slot('Bench Press')] })]) {
      const { t, html } = render(i);
      expect(t.number).toBeNull();
      expect(t.note).toMatch(/^Log a few sessions/);
      expect(html).not.toContain('class="ready-n"');
      expect(html).not.toContain('sets at full strength');
    }
    const { t, html } = render(input({ goal: 3 }));
    expect(t.number).toMatch(/^(<1|[1-9]\d*)$/);
    expect(html).toContain('class="ready-n"');
    expect(t.sets).toMatch(/^\d+ of \d+ sets at full strength$/);
  });

  it('shownNumber: never a 0, "<1" under one', () => {
    expect([shownNumber(null), shownNumber(0), shownNumber(0.4), shownNumber(0.99), shownNumber(1), shownNumber(1.4), shownNumber(99.6)]).toEqual([null, '<1', '<1', '<1', '1', '1', '100']);
  });

  it('Today suggests the plan’s session for today, else the readiest candidate', () => {
    // Legs to failure yesterday, Upper the plan's next: Today suggests what the plan trains today.
    const today = addD(MON, 1);
    const r = readyNow(input({ today, entries: [...base, ...session(addD(today, -1), 'Leg Press', 5, 12, true)] }));
    const d0 = r.plan!.days[0];
    if (d0.train) expect(suggestedDay(r)).toBe(d0.session!.day);
    else expect(suggestedDay(r)).toBe(r.best!.day);
    // No program: nothing to suggest.
    expect(suggestedDay(readyNow(input({ program: null, quick: [slot('Bench Press')] })))).toBeNull();
  });

  // IA A9 (owner, 2026-10-21): Why names the muscles today's plan touches, not every muscle; All muscles › has the rest.
  it('Why: the muscles today’s plan touches, most sets first, with what it adds to the week', () => {
    const i = input({ goal: 3 });
    // Upper: bench 4 (chest 1, triceps ½, front delts ½), pulldown 4 (lats 1, mid-back, biceps, forearms ½), curl 3 (biceps 1);
    // ties in the app's muscle order.
    const upper = todayMuscles(UL.days[0].slots, i);
    expect(upper.map((x) => [x.muscle, x.add])).toEqual([['Biceps', 5], ['Chest', 4], ['Lats', 4], ['Triceps', 2], ['Front Delts', 2], ['Mid-Back', 2], ['Forearms', 2]]);
    // Legs: no upper-body muscle at all.
    const legs = todayMuscles(UL.days[1].slots, i);
    expect(legs[0]).toMatchObject({ muscle: 'Quads', add: 7 });
    expect(legs.map((x) => x.muscle)).not.toContain('Chest');
    // Each row: this week's sets before today plus the plan's, against the muscle's range.
    for (const x of upper) expect(x.text).toBe(`${Math.round((x.done + x.add) * 10) / 10} of ${x.band[0]}–${x.band[1]}`);
    const r = readyNow(i), w = whyView(r, i, null, UL.days[0].slots);
    expect(w.today).toEqual(upper);
    const html = renderToStaticMarkup(h(WhyBody, { w, t: tileView(r), onAllMuscles: () => {} }));
    expect(html).toContain('Today’s muscles');
    expect(html).toContain('All muscles');
    expect(html).not.toContain('This week’s sets');
    expect(html.match(/class="why-vol-m"/g)).toHaveLength(7);
    // Nothing planned: a line, never an empty list.
    expect(renderToStaticMarkup(h(WhyBody, { w: whyView(r, i, null, []), t: tileView(r) }))).toContain('No lifts planned today.');
  });

  it('the Week row: one line of marks and "done of goal", the full strip a tap away', () => {
    const r = readyNow(input({ goal: 3 })), s = stripView(r)!;
    expect(s.count).toBe(`${r.week.done} of ${r.week.goal}`);
    const html = renderToStaticMarkup(h(WeekRow, { s }));
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/class="ws-mark"/g)).toHaveLength(s.days.length);
    expect(html).toContain(`>${s.count}<`);
    // Folded: no rest reasons yet (they're in the strip it opens to).
    expect(html).not.toContain('ws-why');
  });

  it('the goal met: the strip marks today optional, never rest', () => {
    const goalMet = rendered().filter((x) => x.t.verdict.startsWith('Goal met'));
    expect(goalMet.length).toBeGreaterThan(0);
    for (const x of goalMet) expect(x.s!.days[0].mark).toBe('optional');
  }, 60_000);
});
