import { describe, expect, it } from 'vitest';
import { arrange, dayOrder, forViewer, isRange, layoutOf, NO_LAYOUT, OWNER_ONLY, rangeDays, rangeFrom, rangeLabel, RANGES, rangeWeeks, rows, toggleHide, togglePin, WINDOW_RANGE, type Placed } from './statsLayout';

const t = (id: string, wide = false): Placed => ({ id, ...(wide && { wide }) });
const ids = (xs: Placed[]) => xs.map((x) => x.id);
const SECTIONS = [
  { id: 'progress', tiles: [t('lift:a'), t('lift:b'), t('prs'), t('miles')] },
  { id: 'load', tiles: [t('muscles'), t('tons')] },
  { id: 'consistency', tiles: [t('calendar', true), t('sessions')] },
];

describe('rows: tiles two to a row, a wide tile on a row of its own', () => {
  it('pairs tiles in order and gives a wide one its own row', () => {
    expect(rows([t('a'), t('b'), t('c')]).map(ids)).toEqual([['a', 'b'], ['c']]);
    expect(rows([t('a'), t('w', true), t('b'), t('c')]).map(ids)).toEqual([['a'], ['w'], ['b', 'c']]);
    expect(rows([t('w', true), t('a')]).map(ids)).toEqual([['w'], ['a']]);
    expect(rows([])).toEqual([]);
  });
});

describe('the range: one for every tile', () => {
  it('counts back from today, today included', () => {
    expect(rangeDays('4w')).toBe(28);
    expect(rangeDays('12w')).toBe(84);
    expect(rangeDays('1y')).toBe(364);
    expect(rangeFrom('4w', '2026-10-21')).toBe('2026-09-24');
    expect(rangeFrom('12w', '2026-10-21')).toBe('2026-07-30');
  });
});

describe('arrange: pins, hidden tiles and the day’s news order', () => {
  it('leaves every section as it is with nothing kept', () => {
    const a = arrange(SECTIONS, NO_LAYOUT, []);
    expect(a.pinned).toEqual([]);
    expect(a.sections.map((s) => ids(s.shown))).toEqual([['lift:a', 'lift:b', 'prs', 'miles'], ['muscles', 'tons'], ['calendar', 'sessions']]);
    expect(a.sections.every((s) => !s.hidden.length)).toBe(true);
  });
  it('moves pinned tiles (not copies) to Pinned, in the order pinned', () => {
    const a = arrange(SECTIONS, { pins: ['tons', 'lift:b'], hidden: [] }, []);
    expect(ids(a.pinned)).toEqual(['tons', 'lift:b']);
    expect(ids(a.sections[0].shown)).toEqual(['lift:a', 'prs', 'miles']);
    expect(ids(a.sections[1].shown)).toEqual(['muscles']);
  });
  it('drops a pin whose tile has nothing to show today, and keeps it for when it does', () => {
    const p = { pins: ['lift:gone', 'prs'], hidden: [] };
    expect(ids(arrange(SECTIONS, p, []).pinned)).toEqual(['prs']);
    expect(p.pins).toEqual(['lift:gone', 'prs']);
  });
  it('takes hidden tiles out of the grid into their section’s hidden row, in the section’s order', () => {
    const a = arrange(SECTIONS, { pins: [], hidden: ['miles', 'lift:a'] }, []);
    expect(ids(a.sections[0].shown)).toEqual(['lift:b', 'prs']);
    expect(ids(a.sections[0].hidden)).toEqual(['lift:a', 'miles']);
  });
  it('puts the tiles with news first in their own section, each group in the section’s order', () => {
    const a = arrange(SECTIONS, NO_LAYOUT, ['sessions', 'miles', 'lift:b']);
    expect(ids(a.sections[0].shown)).toEqual(['lift:b', 'miles', 'lift:a', 'prs']);
    expect(ids(a.sections[1].shown)).toEqual(['muscles', 'tons']);
    expect(ids(a.sections[2].shown)).toEqual(['sessions', 'calendar']);
  });
  it('never moves a hidden or pinned tile with news', () => {
    const a = arrange(SECTIONS, { pins: ['prs'], hidden: ['miles'] }, ['prs', 'miles']);
    expect(ids(a.pinned)).toEqual(['prs']);
    expect(ids(a.sections[0].shown)).toEqual(['lift:a', 'lift:b']);
    expect(ids(a.sections[0].hidden)).toEqual(['miles']);
  });
});

describe('pin and hide', () => {
  it('pins to the end, unpins, and pinning shows a hidden tile again', () => {
    let p = togglePin(NO_LAYOUT, 'a');
    p = togglePin(p, 'b');
    expect(p.pins).toEqual(['a', 'b']);
    expect(togglePin(p, 'a').pins).toEqual(['b']);
    expect(togglePin({ pins: [], hidden: ['c'] }, 'c')).toEqual({ pins: ['c'], hidden: [] });
  });
  it('hides (unpinning) and shows again', () => {
    expect(toggleHide({ pins: ['a', 'b'], hidden: [] }, 'a')).toEqual({ pins: ['b'], hidden: ['a'] });
    expect(toggleHide({ pins: [], hidden: ['a', 'c'] }, 'a')).toEqual({ pins: [], hidden: ['c'] });
  });
  it('reads what was kept, whatever shape it’s in', () => {
    expect(layoutOf(undefined)).toEqual(NO_LAYOUT);
    expect(layoutOf({ pins: ['a', 'a', 3], hidden: ['a', 'b'] })).toEqual({ pins: ['a'], hidden: ['b'] });
    expect(layoutOf('junk')).toEqual(NO_LAYOUT);
  });
});

describe('dayOrder: the news order, at most once a day', () => {
  it('works it out on the day’s first open', () => {
    let asked = 0;
    const o = dayOrder(undefined, '2026-10-21', () => { asked++; return ['prs']; });
    expect(o).toEqual({ day: '2026-10-21', front: ['prs'] });
    expect(asked).toBe(1);
  });
  it('keeps the first open’s order for the rest of the day, whatever has news since', () => {
    let asked = 0;
    const o = dayOrder({ day: '2026-10-21', front: ['prs'] }, '2026-10-21', () => { asked++; return ['muscles']; });
    expect(o.front).toEqual(['prs']);
    expect(asked).toBe(0);
  });
  it('works it out again on the next day’s first open', () => {
    expect(dayOrder({ day: '2026-10-20', front: ['prs'] }, '2026-10-21', () => ['muscles'])).toEqual({ day: '2026-10-21', front: ['muscles'] });
    expect(dayOrder({ day: '2026-10-21' }, '2026-10-21', () => ['muscles']).front).toEqual(['muscles']);
  });
});

describe('a friend’s page: their 8 weeks, and only the tiles a friend may see and their line can fill', () => {
  // Every tile Stats v2 S1 and S2 can show (StatsTiles useTiles), and whether a friend gets it on their page, from what Friends
  // keeps of them (8 weeks of sets, their goal, their PR ids) or from their whole log (their Stats link).
  const ALL = ['lift:bench press', 'rate', 'prs', 'plateaus', 'milestones', 'hitrate', 'muscles', 'effort', 'rest', 'pullpush', 'tonnage', 'lifts',
    'calendar', 'sessions', 'days', 'start', 'pain', 'energy', 'weight'];
  const tiles = ALL.map((id) => t(id));
  it('the owner sees every tile', () => expect(ids(forViewer(tiles, { owner: true }))).toEqual(ALL));
  it('a friend never sees energy or body weight: both come from the owner’s own body log (owner, 2026-10-21)', () => {
    expect(OWNER_ONLY).toEqual(['energy', 'weight']);
    expect(ids(forViewer(tiles, { owner: false }))).toEqual(['lift:bench press', 'rate', 'prs', 'plateaus', 'milestones', 'hitrate', 'muscles', 'effort',
      'rest', 'pullpush', 'tonnage', 'lifts', 'calendar', 'sessions', 'days', 'start', 'pain']);
    expect(ids(forViewer(tiles, { owner: false, window: true }))).not.toContain('weight');
  });
  it('their page leaves out what 8 weeks of sets can’t say: muscles (priorities), rest (timers), lifts in rotation (new, dropped)', () => {
    expect(ids(forViewer(tiles, { owner: false, window: true }))).toEqual(
      ['lift:bench press', 'rate', 'prs', 'plateaus', 'milestones', 'hitrate', 'effort', 'pullpush', 'tonnage', 'calendar', 'sessions', 'days', 'start', 'pain']);
  });
  it('its one range is the 8 weeks Friends keeps, never one your own Stats offers or keeps', () => {
    expect(rangeWeeks(WINDOW_RANGE)).toBe(8);
    expect(rangeLabel(WINDOW_RANGE)).toBe('8 wk');
    expect(rangeFrom(WINDOW_RANGE, '2026-10-21')).toBe('2026-08-27'); // state/friendCache crewRange: 56 days, today included
    expect(RANGES.map((r) => r.id)).not.toContain(WINDOW_RANGE);
    expect(isRange(WINDOW_RANGE)).toBe(false);
  });
});
