import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore, ts } from './fakeFirestore';
import { banUser, createPost, keepPost, listReported, removePost, reportPost, sweepExpired, unbanUser } from './board';
import { OWNERS } from './owner';
import { POST_DAYS_MS } from '../domain/board';

// The board's writes, in the shapes firestore.rules want (the rules tests hold the rules themselves to it).

const push = vi.hoisted(() => ({ calls: [] as unknown[][], limits: [] as unknown[][] }));
vi.mock('../push/client', () => ({ notifyFriend: (...a: unknown[]) => { push.calls.push(a); }, notifyLimit: (...a: unknown[]) => { push.limits.push(a); } }));

const NOW = Date.parse('2026-10-22T18:00:00Z');
const MIN = 60_000, DAY = 864e5;
beforeEach(() => { push.calls.length = 0; push.limits.length = 0; vi.useFakeTimers({ now: NOW, toFake: ['Date'] }); });

const world = (extra: Record<string, Record<string, unknown>> = {}) => fakeFirestore({ 'users/me': { username: 'mara_lifts', displayName: 'Mara R.' }, ...extra });

describe('a post', () => {
  it('goes with your counter, under your profile’s name and @username as they are now', async () => {
    const w = world();
    const p = await createPost(w.cloud, 'me', 'Deload every 3rd week?', NOW);
    expect(w.docs[`board/${p.id}`]).toMatchObject({ uid: 'me', name: 'Mara R.', user: 'mara_lifts', t: 'Deload every 3rd week?', reports: 0, likes: 0 });
    expect(w.docs['boardRate/me']).toMatchObject({ n: 1 });
    expect(w.docs['limits/20748']).toEqual({ n: 1 }); // the app's counter for the day (r28)
  });
  it('waits a minute after the last, and stops at 5 in the day that began with the first', async () => {
    const w = world({ 'boardRate/me': { at: ts(NOW - 30_000), win: ts(NOW - 30_000), n: 1 } });
    await expect(createPost(w.cloud, 'me', 'again', NOW)).rejects.toThrow(/One post a minute/);
    w.docs['boardRate/me'] = { at: ts(NOW - 2 * MIN), win: ts(NOW - 3600_000), n: 5 };
    expect(push.limits).toEqual([]);
    await expect(createPost(w.cloud, 'me', 'sixth', NOW)).rejects.toThrow(/5 posts today/);
    expect(push.limits).toEqual([['board']]); // the owner hears of it (r28)
    w.docs['boardRate/me'] = { at: ts(NOW - 2 * MIN), win: ts(NOW - DAY - 1), n: 5 };
    await createPost(w.cloud, 'me', 'a new day', NOW);
    expect(w.docs['boardRate/me']).toMatchObject({ n: 1 });
  });
  it('needs a username', async () => {
    await expect(createPost(fakeFirestore({ 'users/me': {} }).cloud, 'me', 'hi', NOW)).rejects.toThrow(/username/);
  });
});

describe('a report', () => {
  it('is yours, the count up one, your counter, the post hidden for you, and a word to the owner’s Worker', async () => {
    const w = world({ 'board/p1': { uid: 'x', user: 'x', name: 'x', t: 'spam', at: ts(NOW - MIN), reports: 1, likes: 0 } });
    await reportPost(w.cloud, 'me', 'p1', 'spam', ['p1'], NOW);
    expect(w.docs['board/p1/reports/me']).toMatchObject({ why: 'spam' });
    expect(w.docs['board/p1'].reports).toBe(2);
    expect(w.docs['reportRate/me']).toMatchObject({ n: 1 });
    expect(w.docs['users/me/private/board']).toEqual({ hidden: ['p1'] });
    expect(push.calls).toEqual([['report', OWNERS[0], 'p1']]);
  });
  it('20 a day; the owner’s own reports ring nobody', async () => {
    const w = world({ 'reportRate/me': { at: ts(NOW - MIN), win: ts(NOW - 3600_000), n: 20 }, 'board/p1': { uid: 'x', user: 'x', t: 'x', at: ts(NOW), reports: 0, likes: 0 } });
    await expect(reportPost(w.cloud, 'me', 'p1', 'spam', [], NOW)).rejects.toThrow(/20 reports today/);
    expect(push.limits).toEqual([['report']]);
    const o = fakeFirestore({ 'board/p1': { uid: 'x', user: 'x', t: 'x', at: ts(NOW), reports: 0, likes: 0 } });
    await reportPost(o.cloud, OWNERS[0], 'p1', 'other', [], NOW);
    expect(push.calls).toEqual([]);
  });
});

describe('the owner', () => {
  const posts = () => ({
    'board/a': { uid: 'rex', user: 'rex_99', name: 'Rex', t: 'cheap gear', at: ts(NOW - MIN), reports: 3, likes: 1 },
    'board/a/reports/r1': { why: 'spam', at: ts(NOW) }, 'board/a/reports/r2': { why: 'spam', at: ts(NOW) }, 'board/a/reports/r3': { why: 'danger', at: ts(NOW) },
    'board/a/likes/l1': {},
    'board/b': { uid: 'rex', user: 'rex_99', name: 'Rex', t: 'more', at: ts(NOW - 2 * MIN), reports: 0, likes: 0 },
    'board/c': { uid: 'lena', user: 'lena_r', name: 'Lena', t: 'squat police', at: ts(NOW - 3 * MIN), reports: 1, likes: 0, kept: 1 },
    'board/c/reports/r1': { why: 'harass', at: ts(NOW) },
  });
  it('lists reported posts not yet reviewed, with the reasons tallied', async () => {
    const w = fakeFirestore(posts());
    expect(await listReported(w.cloud)).toEqual([{ post: expect.objectContaining({ id: 'a', reports: 3 }), why: { spam: 2, danger: 1 } }]);
  });
  it('keeps one: its reports so far reviewed', async () => {
    const w = fakeFirestore(posts());
    await keepPost(w.cloud, { id: 'a', reports: 3 } as never);
    expect(w.docs['board/a'].kept).toBe(3);
  });
  it('removes one with its likes and reports, and tells its author (a count on their notice)', async () => {
    const w = fakeFirestore({ ...posts(), 'notices/rex': { removed: 2, banned: false, at: ts(1) } });
    await removePost(w.cloud, { id: 'a', uid: 'rex' });
    expect(Object.keys(w.docs).filter((k) => k.startsWith('board/a'))).toEqual([]);
    expect(w.docs['notices/rex']).toMatchObject({ removed: 3, banned: false });
  });
  it('bans: every post of theirs gone, the ban written, and the notice says so; unbanning says so too', async () => {
    const w = fakeFirestore(posts());
    expect(await banUser(w.cloud, 'rex')).toBe(2);
    expect(Object.keys(w.docs).filter((k) => k.startsWith('board/'))).toEqual(['board/c', 'board/c/reports/r1']);
    expect(w.docs['banned/rex']).toBeDefined();
    expect(w.docs['notices/rex']).toMatchObject({ removed: 2, banned: true });
    await unbanUser(w.cloud, 'rex');
    expect(w.docs['banned/rex']).toBeUndefined();
    expect(w.docs['notices/rex']).toMatchObject({ removed: 2, banned: false });
  });
  it('clears posts over 30 days old with their likes and reports', async () => {
    const w = fakeFirestore({ ...posts(), 'board/old': { uid: 'x', user: 'x', t: 'x', at: ts(NOW - POST_DAYS_MS), reports: 1, likes: 0 }, 'board/old/reports/r': { why: 'spam' } });
    expect(await sweepExpired(w.cloud, NOW)).toBe(1);
    expect(w.docs['board/old']).toBeUndefined();
    expect(w.docs['board/old/reports/r']).toBeUndefined();
    expect(w.docs['board/a']).toBeDefined();
  });
});
