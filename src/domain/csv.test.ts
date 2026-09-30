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
