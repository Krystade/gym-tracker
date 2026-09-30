import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteSet, getAllSets, putMany, putSet, resetDbForTests } from './db';
import { parseCsv } from '../domain/csv';

const CSV = 'date,exercise,set,weight_lb,reps,note,source\n2026-01-05,Cable Curl,1,52.5,12,"a, ""b""",s\n2026-01-05,Cable Curl,2,60,,,s\n';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

describe('db', () => {
  it('imports idempotently and preserves values', async () => {
    const { entries } = parseCsv(CSV);
    expect(await putMany(entries)).toEqual({ added: 2, updated: 0 });
    expect(await putMany(entries)).toEqual({ added: 0, updated: 2 });
    const all = await getAllSets();
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.setNo === 1)).toMatchObject({ weight: 52.5, note: 'a, "b"' });
    expect(all.find((e) => e.setNo === 2)?.reps).toBeNull();
  });
  it('puts and deletes single sets', async () => {
    const [e] = parseCsv(CSV).entries;
    await putSet(e);
    await deleteSet(e.id);
    expect(await getAllSets()).toEqual([]);
  });
});
