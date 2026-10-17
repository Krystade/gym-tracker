import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, resetDbForTests } from '../db/db';
import { readMeta, writeMeta } from './meta';
import type { TagPrefs } from '../domain/tags';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

describe('tags in the synced settings', () => {
  const prefs: TagPrefs = { key: 'tags', hidden: ['test'], custom: ['paused', 'band'] };
  it('go up with the rest of the settings, per profile', async () => {
    expect(await readMeta(boundDb('main'))).not.toHaveProperty('tags');
    await boundDb('main').putTags(prefs);
    expect((await readMeta(boundDb('main'))).tags).toEqual(prefs);
    expect(await readMeta(boundDb('p2'))).not.toHaveProperty('tags');
  });
  it('come down onto the phone', async () => {
    await writeMeta(boundDb('main'), { tags: prefs });
    expect(await boundDb('main').getTags()).toEqual(prefs);
  });
});
