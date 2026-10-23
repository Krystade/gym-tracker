import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore, ts } from './fakeFirestore';
import { counted, whyRefused } from './limits';

// The counters every social write carries (r28), in the shapes firestore.rules want; the rules tests hold the rules to them.

const push = vi.hoisted(() => ({ limits: [] as unknown[][] }));
vi.mock('../push/client', () => ({ notifyFriend: () => {}, notifyLimit: (...a: unknown[]) => { push.limits.push(a); } }));

const NOW = Date.parse('2026-10-22T18:00:00Z');
const DAY = 864e5;
beforeEach(() => { push.limits.length = 0; });

describe('a counted write', () => {
  it('goes with your social counter (the first of a day at 1, then on) and the app’s counter for the day', async () => {
    const w = fakeFirestore({});
    await counted(w.cloud, 'me', null, (b) => b.set(w.cloud.F.doc(w.cloud.db, 'users/x/requests/me'), { username: 'me', sent: NOW }), NOW);
    expect(w.docs['users/x/requests/me']).toMatchObject({ username: 'me' });
    expect(w.docs['socialRate/me']).toMatchObject({ n: 1 });
    expect(w.docs['limits/20748']).toEqual({ n: 1 });
    await counted(w.cloud, 'me', null, () => {}, NOW + 1000);
    expect(w.docs['socialRate/me']).toMatchObject({ n: 2 });
    expect(w.docs['limits/20748']).toEqual({ n: 2 });
  });
  it('stops at 300 in your day, and tells the owner; a new day starts at 1', async () => {
    const w = fakeFirestore({ 'socialRate/me': { at: ts(NOW - 60_000), win: ts(NOW - 3600_000), n: 299 } });
    await counted(w.cloud, 'me', null, () => {}, NOW);
    expect(push.limits).toEqual([]);
    await expect(counted(w.cloud, 'me', null, () => {}, NOW)).rejects.toThrow(/300 today/);
    expect(push.limits).toEqual([['social']]);
    w.docs['socialRate/me'] = { at: ts(NOW - 60_000), win: ts(NOW - DAY - 1), n: 300 };
    await counted(w.cloud, 'me', null, () => {}, NOW);
    expect(w.docs['socialRate/me']).toMatchObject({ n: 1 });
  });
});

describe('why a write was refused', () => {
  it('the owner’s switch for it, then the app’s day full (the owner told), else nothing', async () => {
    const w = fakeFirestore({ 'config/switches': { messages: true }, 'limits/20748': { n: 2000 } });
    expect((await whyRefused(w.cloud, 'messages', NOW))?.message).toMatch(/Messages and shared gyms are closed/);
    expect(push.limits).toEqual([]);
    expect((await whyRefused(w.cloud, 'requests', NOW))?.message).toMatch(/limit for posts, messages and requests today/);
    expect(push.limits).toEqual([['global']]);
    w.docs['limits/20748'] = { n: 1999 };
    expect(await whyRefused(w.cloud, 'requests', NOW)).toBeNull();
  });
});
