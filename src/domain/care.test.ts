import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { BACK_BLOCK, isHold, likelyRegion, painReport, similarity, swapSuggestions } from './care';
import { parseCsv, toCsv } from './csv';
import { e1rm } from './stats';
import { fmtSet } from './format';
import { nextTarget } from './progression';
import { weeklySummary } from './analytics';

let seq = 0;
const s = (date: string, exercise: string, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 50, reps: 10, flags: [], source: 't', ...over,
});

describe('pain fields in the standard CSV', () => {
  it('round-trips region and severity, and still reads files without them', () => {
    const e = [s('2026-09-01', 'Cable Curl', { flags: ['pain'], painRegion: 'elbow', painSeverity: 2 }), s('2026-09-01', 'Cable Curl', { setNo: 2 })];
    const back = parseCsv(toCsv(e)).entries;
    expect(back[0]).toMatchObject({ painRegion: 'elbow', painSeverity: 2 });
    expect(back[1].painRegion).toBeUndefined();
    const old = parseCsv('date,exercise,set,weight_lb,reps\n2026-01-05,Cable Curl,1,60,12\n');
    expect(old.errors).toEqual([]);
    expect(old.entries[0].painRegion).toBeUndefined();
  });
  it('rejects unknown regions and severities', () => {
    const bad = parseCsv('date,exercise,set,weight_lb,reps,pain_region,pain_severity\n2026-01-05,Curl,1,60,12,ankle,\n2026-01-05,Curl,2,60,12,elbow,7\n');
    expect(bad.errors.map((x) => x.row)).toEqual([2, 3]);
  });
});

describe('similarity and regions', () => {
  it('is the cosine of muscle vectors', () => {
    expect(similarity('Cable Curl', 'DB Curl')).toBeCloseTo(1, 5);
    expect(similarity('Cable Curl', 'Leg Press')).toBe(0);
    expect(similarity('Lat Pulldown', 'Seated Cable Row')).toBeGreaterThan(0.5);
    expect(similarity('Mystery', 'Cable Curl')).toBe(0);
  });
  it('guesses the region an exercise loads', () => {
    expect(likelyRegion('Skullcrusher')).toBe('elbow');
    expect(likelyRegion('Romanian Deadlift')).toBe('lower back');
    expect(likelyRegion('DB Lateral Raise')).toBe('shoulder');
    expect(likelyRegion('Leg Extension')).toBe('knee');
  });
});

describe('swapSuggestions', () => {
  it('never suggests the exercise itself and prefers same-muscle lifts', () => {
    const r = swapSuggestions('Cable Pushdown', [], '2026-09-30');
    expect(r.map((x) => x.name)).not.toContain('Cable Pushdown');
    expect(r.length).toBe(5);
    for (const x of r) expect(similarity('Cable Pushdown', x.name)).toBeGreaterThan(0.5);
  });
  it('steers away from lifts that hurt recently and from elbow-heavy lifts while the elbow hurts', () => {
    const e = [s('2026-09-20', 'Skullcrusher', { flags: ['pain'], painRegion: 'elbow', painSeverity: 2 }), s('2026-09-20', 'Rope Pushdown')];
    const names = swapSuggestions('Cable Pushdown', e, '2026-09-30', 20).map((x) => x.name);
    expect(names.indexOf('Rope Pushdown')).toBeLessThan(names.indexOf('Skullcrusher') === -1 ? Infinity : names.indexOf('Skullcrusher'));
    const oh = names.indexOf('Overhead Cable Extension');
    expect(oh === -1 || oh > names.indexOf('Rope Pushdown')).toBe(true);
    const why = swapSuggestions('Cable Pushdown', e, '2026-09-30', 20).find((x) => x.name === 'Skullcrusher');
    if (why) expect(why.why).toMatch(/pain/);
  });
});

describe('holds', () => {
  const h = s('2026-09-29', 'Side Plank', { weight: 0, reps: 30, flags: ['bodyweight', 'hold'] });
  it('are recognised, formatted in seconds, and never feed e1RM or tonnage', () => {
    expect(isHold('Side Plank')).toBe(true);
    expect(isHold('Cable Curl')).toBe(false);
    expect(fmtSet(h)).toBe('BW × 30s');
    expect(e1rm({ ...h, weight: 20 })).toBeNull();
    expect(weeklySummary([{ ...h, weight: 20 }], 1, '2026-09-30')[0].tonnage).toBe(0);
  });
  it('get a seconds target', () => {
    const t = nextTarget([h], 'Side Plank', { key: 'side plank', repMin: 20, repMax: 40, increment: 5 }, '2026-09-30');
    expect(t?.text).toBe('BW × 35s+ on every set');
  });
  it('make up the back block', () => {
    expect(BACK_BLOCK.map((x) => x.exercise)).toEqual(['Bird Dog', 'Side Plank', 'McGill Curl-Up']);
    for (const x of BACK_BLOCK) expect(isHold(x.exercise)).toBe(true);
  });
});

describe('painReport', () => {
  const p = (date: string, ex: string, sev: 1 | 2 | 3 = 1, weight = 50) => s(date, ex, { flags: ['pain'], painRegion: 'elbow', painSeverity: sev, weight });
  it('counts weekly pain sets per region with exercises and loads', () => {
    const e = [p('2026-09-15', 'Skullcrusher', 2, 40), p('2026-09-22', 'Skullcrusher', 3, 50), s('2026-09-22', 'Cable Curl')];
    const r = painReport(e, '2026-09-30', 4);
    expect(r).toHaveLength(1);
    expect(r[0].region).toBe('elbow');
    expect(r[0].weekly).toEqual([0, 1, 1, 0]);
    expect(r[0].byExercise[0]).toMatchObject({ exercise: 'Skullcrusher', sets: 2, maxSeverity: 3, avgWeight: 45 });
  });
  it('calls a region rising only after two consecutive weekly increases', () => {
    const once = [p('2026-09-29', 'Skullcrusher'), p('2026-09-29', 'Skullcrusher')]; // [0,0,0,2]: one jump
    expect(painReport(once, '2026-09-30', 4)[0].rising).toBe(false);
    const twice = [p('2026-09-15', 'Skullcrusher'), p('2026-09-22', 'Skullcrusher'), p('2026-09-22', 'Skullcrusher'), p('2026-09-29', 'Skullcrusher'), p('2026-09-29', 'Skullcrusher'), p('2026-09-29', 'Skullcrusher')];
    expect(painReport(twice, '2026-09-30', 4)[0].rising).toBe(true);
  });
  it('treats a pain flag without a region as "other"', () => {
    expect(painReport([s('2026-09-29', 'Cable Curl', { flags: ['pain'] })], '2026-09-30', 2)[0].region).toBe('other');
  });
});

describe('pain fields on new sets', () => {
  it('are kept only while the set is flagged pain', async () => {
    const { buildAppSet } = await import('./buildSet');
    const now = new Date('2026-09-30T12:00:00Z');
    const a = buildAppSet([], { date: '2026-09-30', exercise: 'Cable Curl', weight: 50, reps: 10, flags: ['pain'], painRegion: 'elbow', painSeverity: 2 }, now);
    expect(a).toMatchObject({ painRegion: 'elbow', painSeverity: 2 });
    const b = buildAppSet([], { date: '2026-09-30', exercise: 'Cable Curl', weight: 50, reps: 10, flags: [], painRegion: 'elbow', painSeverity: 2 }, now);
    expect('painRegion' in b || 'painSeverity' in b).toBe(false);
  });
});

describe('Phase 5 review fixes', () => {
  it('never calls a longer hold a rep PR', async () => {
    const { prCheck } = await import('./progression');
    const a = s('2026-09-28', 'Side Plank', { weight: 0, reps: 30, flags: ['bodyweight', 'hold'] });
    const b = s('2026-09-29', 'Side Plank', { weight: 0, reps: 45, flags: ['bodyweight', 'hold'] });
    expect(prCheck([a, b], b)).toEqual({ e1rm: false, reps: false });
  });
  it('gives holds a seconds range and seconds in every target', async () => {
    const { defaultSettings } = await import('./progression');
    expect(defaultSettings('Plate Pinch Hold')).toMatchObject({ repMin: 20, repMax: 40 });
    const st = defaultSettings('Plate Pinch Hold');
    const done = [s('2026-09-28', 'Plate Pinch Hold', { weight: 25, reps: 40, flags: ['hold'] })];
    expect(nextTarget(done, 'Plate Pinch Hold', st, '2026-09-30')?.text).toBe('Go up: 30 lb × 20s+');
  });
  it('keeps unknown pain details unknown when editing an old pain set', async () => {
    const { painDefaults } = await import('./care');
    expect(painDefaults({ flags: ['pain'] }, 'Skullcrusher')).toEqual({ region: undefined, severity: undefined });
    expect(painDefaults({ flags: ['pain'], painRegion: 'wrist', painSeverity: 3 }, 'Skullcrusher')).toEqual({ region: 'wrist', severity: 3 });
    expect(painDefaults({ flags: [] }, 'Skullcrusher')).toEqual({ region: 'elbow', severity: 1 });
  });
  it('keeps a region rising through the start of a new week', () => {
    const p = (date: string) => s(date, 'Skullcrusher', { flags: ['pain'], painRegion: 'elbow' });
    // Complete weeks of 7, 14, 21 Sep: 1, 2, 3 pain sets. Viewed Monday 28 Sep, the new week has none yet.
    const e = [p('2026-09-08'), p('2026-09-15'), p('2026-09-16'), p('2026-09-22'), p('2026-09-23'), p('2026-09-24')];
    expect(painReport(e, '2026-09-27', 8)[0].rising).toBe(true);
    expect(painReport(e, '2026-09-28', 8)[0].rising).toBe(true);
  });
});
