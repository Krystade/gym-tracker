import { setId } from './ids';
import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv, CSV_HEADER } from './csv';
import type { SetEntry } from './types';

const base: Omit<SetEntry, 'id' | 'setNo' | 'seq'> = {
  date: '2026-01-05', exercise: 'Cable Curl', weight: 60, reps: 12, flags: [], source: 'sample',
};
const mk = (setNo: number, over: Partial<SetEntry> = {}): SetEntry => ({
  ...base, setNo, seq: setNo, id: `sample|2026-01-05|cable curl|${setNo}`, ...over,
});

describe('csv', () => {
  it('writes the exact header', () => {
    expect(toCsv([]).split('\r\n')[0]).toBe(CSV_HEADER.join(','));
  });

  it('round-trips decimals, nulls, flags, rir and awkward notes', () => {
    const entries = [
      mk(1, { weight: 52.5, rir: 2 }),
      mk(2, { reps: null, flags: ['partial', 'unsure'] }),
      mk(3, { weight: 0, reps: 15, flags: ['bodyweight'], note: 'felt "easy", then\nhard', asWritten: 'Cable curls ' }),
    ];
    const { entries: back, errors } = parseCsv(toCsv(entries));
    expect(errors).toEqual([]);
    expect(back.map(({ seq: _s, ...e }) => e)).toEqual(entries.map(({ seq: _s, ...e }) => e));
  });

  it('keeps session order through export', () => {
    const a = mk(1, { exercise: 'Zottman Curl', id: 'x|1', seq: 1 });
    const b = mk(1, { exercise: 'Bench Press', id: 'x|2', seq: 2 });
    const { entries } = parseCsv(toCsv([b, a]));
    expect(entries.map((e) => e.exercise)).toEqual(['Zottman Curl', 'Bench Press']);
  });

  it('reports bad rows with their row number and keeps the good ones', () => {
    const text = [
      CSV_HEADER.join(','),
      '2026-01-05,Cable Curl,,1,60,12,,,,s',
      '01/05/26,Cable Curl,,2,60,12,,,,s',
      '2026-01-05,Cable Curl,,3,sixty,12,,,,s',
      '2026-01-05,Cable Curl,,4,60,12,,sparkly,,s',
      '2026-01-05,,,5,60,12,,,,s',
    ].join('\n');
    const { entries, errors } = parseCsv(text);
    expect(entries).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
  });

  it('accepts a BOM, LF endings, missing optional columns and defaults the source', () => {
    const text = '﻿date,exercise,set,weight_lb,reps\n2026-02-01, Lat Pulldown ,1,100,12\n';
    const { entries, errors } = parseCsv(text, 'upload');
    expect(errors).toEqual([]);
    expect(entries[0]).toMatchObject({ exercise: 'Lat Pulldown', source: 'upload', id: 'upload|2026-02-01|lat pulldown|1' });
  });

  it('rejects a file without the required columns', () => {
    const { entries, errors } = parseCsv('foo,bar\n1,2\n');
    expect(entries).toEqual([]);
    expect(errors[0]).toMatchObject({ row: 1 });
  });
});

describe('fields for later modelling', () => {
  it('round-trips logged_at, the suggestion and the gym, and still reads files without them', () => {
    const e: SetEntry = { id: setId('app', '2026-10-02', 'Bench Press', 1), date: '2026-10-02', seq: 1, loggedAt: '2026-10-02T17:03:11.000Z',
      exercise: 'Bench Press', setNo: 1, weight: 135, reps: 10, flags: [], source: 'app', target: { weight: 135, reps: 10, sets: 3 }, gym: 'Downtown' };
    const back = parseCsv(toCsv([e])).entries[0];
    expect(back).toMatchObject({ loggedAt: e.loggedAt, target: e.target, gym: 'Downtown' });
    const old = 'date,exercise,set,weight_lb,reps\n2026-01-05,Cable Curl,1,50,12\n';
    expect(parseCsv(old).entries[0]).not.toHaveProperty('target');
    expect(parseCsv('date,exercise,set,weight_lb,reps,logged_at\n2026-01-05,Cable Curl,1,50,12,yesterday\n').errors[0].message).toMatch(/logged_at/);
  });
});

describe('Phase 12 review fixes', () => {
  it('keeps a first-session suggestion that has sets and reps but no weight', () => {
    const e: SetEntry = { id: setId('app', '2026-10-02', 'Hammer Curl', 1), date: '2026-10-02', seq: 1, exercise: 'Hammer Curl', setNo: 1,
      weight: 25, reps: 12, flags: [], source: 'app', target: { weight: null, reps: 10, sets: 3 } };
    expect(parseCsv(toCsv([e])).entries[0].target).toEqual({ weight: null, reps: 10, sets: 3 });
  });
});

describe('late sets in the CSV', () => {
  it('round-trips entered_at and keeps an untimed set untimed', () => {
    const e: SetEntry = { id: setId('app', '2026-10-01', 'Bench Press', 1), date: '2026-10-01', seq: 1, exercise: 'Bench Press', setNo: 1,
      weight: 135, reps: 8, flags: [], source: 'app', enteredAt: '2026-10-02T02:30:00.000Z' };
    const back = parseCsv(toCsv([e])).entries[0];
    expect(back.enteredAt).toBe(e.enteredAt);
    expect(back).not.toHaveProperty('loggedAt');
  });
});
