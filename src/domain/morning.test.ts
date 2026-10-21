import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { answered, asksFor, morningAsks, pushAsks } from './morning';
import { parseCsv, toCsv } from './csv';

// Synthetic logs only. The next-morning question (item 08, round 20).
let seq = 0;
const s = (date: string, exercise: string, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `q${seq}`, date, seq: seq++, exercise, setNo: seq, weight: 50, reps: 10, flags: [], source: 't', ...over,
});
const hurt = (sev?: 1 | 2 | 3, region?: SetEntry['painRegion'], more: Partial<SetEntry> = {}): Partial<SetEntry> =>
  ({ flags: ['pain'], ...(sev && { painSeverity: sev }), ...(region && { painRegion: region }), ...more });

describe('morningAsks: the day after pain, one question per region, until answered or dismissed', () => {
  const day = [
    s('2026-10-19', 'Bench Press'),
    s('2026-10-19', 'Cable Pushdown', hurt(1, 'elbow')),
    s('2026-10-19', 'Overhead DB Triceps Extension', hurt(2, 'elbow')),
    s('2026-10-19', 'Cable Pushdown', hurt(2, 'elbow')),
    s('2026-10-19', 'Leg Extension', hurt(3, 'knee')),
  ];
  it('the worst region first, its lifts in the order done', () => {
    expect(morningAsks(day, '2026-10-20')).toEqual([
      { date: '2026-10-19', region: 'knee', lifts: ['Leg Extension'], zone: 3 },
      { date: '2026-10-19', region: 'elbow', lifts: ['Cable Pushdown', 'Overhead DB Triceps Extension'], zone: 2 },
    ]);
  });
  it('only the day after: not the same day, not two days on; no pain, no question', () => {
    expect(morningAsks(day, '2026-10-19')).toEqual([]);
    expect(morningAsks(day, '2026-10-21')).toEqual([]);
    expect(morningAsks([s('2026-10-19', 'Bench Press')], '2026-10-20')).toEqual([]);
  });
  it('an answer, or a dismissal, on the region’s sets ends its question; the other region’s stays', () => {
    for (const m of ['settled', 'sore', 'worse', 'skipped'] as const) {
      const after = [...day.filter((e) => !answered(day, '2026-10-19', 'elbow', m).some((x) => x.id === e.id)), ...answered(day, '2026-10-19', 'elbow', m)];
      expect(morningAsks(after, '2026-10-20').map((a) => a.region)).toEqual(['knee']);
    }
  });
  it('a pain set with no region asks about the region its lift loads', () => {
    expect(asksFor([s('2026-10-19', 'Cable Pushdown', hurt())], '2026-10-19')).toEqual([{ date: '2026-10-19', region: 'elbow', lifts: ['Cable Pushdown'], zone: 2 }]);
  });
});

describe('answered: the answer on every pain set of that region that day', () => {
  const day = [s('2026-10-19', 'Cable Pushdown', hurt(2, 'elbow')), s('2026-10-19', 'Skullcrusher', hurt(1, 'elbow')),
    s('2026-10-19', 'Leg Extension', hurt(1, 'knee')), s('2026-10-19', 'Cable Pushdown'), s('2026-10-18', 'Cable Pushdown', hurt(2, 'elbow'))];
  it('those sets only, with the note when there is one; the same answer again changes nothing', () => {
    const a = answered(day, '2026-10-19', 'elbow', 'sore', '  stiff on waking ');
    expect(a.map((e) => e.id)).toEqual([day[0].id, day[1].id]);
    expect(a.every((e) => e.morning === 'sore' && e.morningNote === 'stiff on waking')).toBe(true);
    expect(answered(a, '2026-10-19', 'elbow', 'sore')).toEqual([]);
    expect(answered(a, '2026-10-19', 'elbow', 'sore', 'better by noon').map((e) => e.morningNote)).toEqual(['better by noon', 'better by noon']);
    expect(answered(day, '2026-10-19', 'elbow', 'settled')[0]).not.toHaveProperty('morningNote');
  });
  it('round-trips through the backup CSV', () => {
    const a = answered(day, '2026-10-19', 'elbow', 'worse', 'woke up stiff, "bad"');
    const back = parseCsv(toCsv(a)).entries;
    expect(back.map((e) => [e.morning, e.morningNote])).toEqual(a.map((e) => [e.morning, e.morningNote]));
  });
});

describe('pushAsks: what the Worker is told, for yesterday and today', () => {
  it('the worst unanswered region each day and the lift it hurt worst on; never a note or severity', () => {
    const e = [s('2026-10-19', 'Cable Pushdown', hurt(2, 'elbow', { note: 'private words' })), s('2026-10-19', 'Skullcrusher', hurt(2, 'elbow')),
      s('2026-10-20', 'Lunge', hurt(1, 'knee'))];
    expect(pushAsks(e, '2026-10-20')).toEqual([{ date: '2026-10-19', region: 'elbow', lift: 'Skullcrusher',
      hurts: [{ region: 'elbow', lift: 'Cable Pushdown' }, { region: 'elbow', lift: 'Skullcrusher' }] }, { date: '2026-10-20', region: 'knee', lift: 'Lunge' }]);
    expect(JSON.stringify(pushAsks(e, '2026-10-20'))).not.toMatch(/private|painSeverity|note/);
    expect(pushAsks(e, '2026-10-22')).toEqual([]);
    const done = e.map((x) => (x.date === '2026-10-19' ? { ...x, morning: 'settled' as const } : x));
    expect(pushAsks(done, '2026-10-20')).toEqual([{ date: '2026-10-20', region: 'knee', lift: 'Lunge' }]);
  });
  it('several regions and lifts in a day: every one, the worst region first, for the one push to name', () => {
    const e = [s('2026-10-19', 'Cable Pushdown', hurt(1, 'elbow')), s('2026-10-19', 'Overhead Press', hurt(2, 'shoulder')),
      s('2026-10-19', 'Skullcrusher', hurt(1, 'elbow')), s('2026-10-19', 'Leg Press', hurt(1, 'knee'))];
    const [a] = pushAsks(e, '2026-10-20');
    expect(a).toMatchObject({ date: '2026-10-19', region: 'shoulder', lift: 'Overhead Press' });
    expect(a.hurts!.slice(0, 1)).toEqual([{ region: 'shoulder', lift: 'Overhead Press' }]);
    expect(new Set(a.hurts!.map((h) => h.region))).toEqual(new Set(['shoulder', 'elbow', 'knee']));
    expect(a.hurts!.map((h) => h.lift).sort()).toEqual(['Cable Pushdown', 'Leg Press', 'Overhead Press', 'Skullcrusher']);
  });
});
