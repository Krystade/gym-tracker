import { describe, expect, it } from 'vitest';
import { friendNews, readFriend, readFriendWindow } from './friends';
import { fakeFirestore, ts } from './fakeFirestore';
import type { InboxDoc } from '../domain/messages';

const set = (date: string) => ({ id: `app|${date}|squat|1`, date, seq: 1, exercise: 'Barbell Squat', setNo: 1, weight: 100, reps: 5, flags: [], source: 'app' });

describe('readFriend: a friend’s whole log, never their body weight (owner, 2026-10-21)', () => {
  it('keeps their sets and settings and drops the body days their months carry', async () => {
    const w = fakeFirestore({
      'users/b/meta/index': { months: { '2026-09': 1, '2026-10': 1 }, meta: 1 },
      'users/b/months/2026-09': { sets: [set('2026-09-10')], body: [{ date: '2026-09-10', weight: 181.4, energy: 4 }] },
      'users/b/months/2026-10': { sets: [set('2026-10-16')], body: [{ date: '2026-10-16', weight: 180.2 }] },
      'users/b/meta/profile': { items: { status: JSON.stringify('legs') } },
    });
    const r = await readFriend(w.cloud, 'b');
    expect(r.sets.map((e) => e.date)).toEqual(['2026-09-10', '2026-10-16']);
    expect(r.meta).toEqual({ status: 'legs' });
    expect(Object.keys(r).sort()).toEqual(['meta', 'sets']);
    expect(JSON.stringify(r)).not.toMatch(/181\.4|180\.2|energy/);
  });
});

describe('readFriendWindow', () => {
  const world = () => fakeFirestore({
    'users/b/meta/index': { months: { '2026-06': 1, '2026-08': 1, '2026-09': 1, '2026-10': 1 }, meta: 7 },
    'users/b/months/2026-06': { sets: [set('2026-06-02')] },
    'users/b/months/2026-08': { sets: [set('2026-08-20'), set('2026-08-29')] },
    'users/b/months/2026-09': { sets: [set('2026-09-10')] },
    'users/b/months/2026-10': { sets: [set('2026-10-16'), set('2026-10-18')] },
    'users/b/meta/profile': { items: { status: JSON.stringify('  leg day   🦵 '), program: JSON.stringify({ secret: 1 }) } },
  });
  const FROM = '2026-08-23', TO = '2026-10-17';
  const dates = (w: { sets: { date: string }[] }) => w.sets.map((s) => s.date);
  /** Moves a month on, as a sync of theirs does: the month and its time in the index in one write. */
  const touch = (w: ReturnType<typeof world>, m: string, at: number, sets?: object[]) => {
    if (sets) w.docs[`users/b/months/${m}`] = { sets };
    (w.docs['users/b/meta/index'].months as Record<string, number>)[m] = at;
  };

  it('reads only the months the window touches, in one query, and keeps their days from `from` on and the status phrase', async () => {
    const w = world();
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO);
    expect(w.log).toEqual([
      { path: 'users/b/meta/index', n: 1 },
      { path: 'users/b/months', n: 3, filters: '__name__>=2026-08,__name__<=2026-10' },
      { path: 'users/b/meta/profile', n: 1 },
    ]);
    // A set dated after `to` (a friend a time zone ahead) is kept: Crew shows only up to today, and its month may never change again.
    expect(dates(r)).toEqual(['2026-08-29', '2026-09-10', '2026-10-16', '2026-10-18']);
    expect(r.status).toBe('leg day 🦵');
    expect(r.basis).toEqual({ months: { '2026-08': 1, '2026-09': 1, '2026-10': 1 }, meta: 7 });
  });

  it('with nothing changed, reads the index alone', async () => {
    const w = world();
    const first = await readFriendWindow(w.cloud, 'b', FROM, TO);
    w.take();
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: first, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }]);
    expect({ ...r }).toEqual({ ...first });
  });

  it('reads again only a month whose time moved, and the status only when the settings’ time moved', async () => {
    const w = world();
    const first = await readFriendWindow(w.cloud, 'b', FROM, TO);
    touch(w, '2026-10', 2, [set('2026-10-16'), set('2026-10-18'), set('2026-10-17')]);
    w.take();
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: first, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }, { path: 'users/b/months/2026-10', n: 1 }]);
    expect(dates(r)).toEqual(['2026-08-29', '2026-09-10', '2026-10-16', '2026-10-18', '2026-10-17']);
    w.docs['users/b/meta/profile'] = { items: { status: JSON.stringify('deload') } };
    w.docs['users/b/meta/index'].meta = 8;
    w.take();
    const s = await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: r, basis: r.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }, { path: 'users/b/meta/profile', n: 1 }]);
    expect(s.status).toBe('deload');
    expect(dates(s)).toEqual(dates(r));
  });

  it('a new day: the window moves on without reading a month that didn’t change, and drops the days before it', async () => {
    const w = world();
    const first = await readFriendWindow(w.cloud, 'b', FROM, TO);
    w.take();
    const r = await readFriendWindow(w.cloud, 'b', '2026-08-30', '2026-10-24', { from: FROM, win: first, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }]);
    expect(dates(r)).toEqual(['2026-09-10', '2026-10-16', '2026-10-18']);
    // A window starting earlier than the one kept (the phone's clock went back) can't come from it: read whole.
    w.take();
    await readFriendWindow(w.cloud, 'b', '2026-08-01', TO, { from: FROM, win: first, basis: first.basis });
    expect(w.log.map((l) => l.path)).toContain('users/b/months');
  });

  it('an account whose index has no settings time (from before it) has its status read every time', async () => {
    const w = world();
    delete w.docs['users/b/meta/index'].meta;
    const first = await readFriendWindow(w.cloud, 'b', FROM, TO);
    w.take();
    await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: first, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }, { path: 'users/b/meta/profile', n: 1 }]);
  });

  it('keeps their weekly goal from the settings read it already makes, and nothing else of their profile', async () => {
    const w = world();
    w.docs['users/b/meta/profile'] = { items: { status: JSON.stringify('cut'), profile: JSON.stringify({ key: 'profile', weeklyGoal: 4, tiers: { Chest: 1 } }) } };
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO);
    expect(w.log.filter((l) => l.path === 'users/b/meta/profile')).toHaveLength(1);
    expect(r.goal).toBe(4);
    expect(JSON.stringify(r)).not.toContain('tiers');
    // Not changed since: kept, no read. A profile with no goal (or a bad one) is the app's default, 2.
    w.take();
    const again = await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: r, basis: r.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }]);
    expect(again.goal).toBe(4);
    w.docs['users/b/meta/profile'] = { items: { profile: JSON.stringify({ weeklyGoal: 'lots' }) } };
    expect((await readFriendWindow(w.cloud, 'b', FROM, TO)).goal).toBe(2);
  });

  it('a window kept by an older version, with no goal, reads their settings once more for it', async () => {
    const w = world();
    const first = await readFriendWindow(w.cloud, 'b', FROM, TO);
    const { goal: _none, ...old } = first;
    w.take();
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: old, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }, { path: 'users/b/meta/profile', n: 1 }]);
    expect(r.goal).toBe(2);
  });

  it('keeps the day their achievements count from, from the same settings read (Together counts from it); none or a bad one is null', async () => {
    const w = world();
    w.docs['users/b/meta/profile'] = { items: { status: JSON.stringify('cut'), achievements: JSON.stringify('2026-10-22') } };
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO);
    expect(w.log.filter((l) => l.path === 'users/b/meta/profile')).toHaveLength(1);
    expect(r.start).toBe('2026-10-22');
    // Not changed since: kept with the window, no read.
    w.take();
    expect((await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: r, basis: r.basis })).start).toBe('2026-10-22');
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }]);
    for (const bad of [undefined, JSON.stringify('soon'), JSON.stringify(20261022), '{not json']) {
      w.docs['users/b/meta/profile'] = { items: { ...(bad !== undefined && { achievements: bad }) } };
      expect((await readFriendWindow(w.cloud, 'b', FROM, TO)).start).toBeNull();
    }
  });

  it('a window kept by an older version, with no start, reads their settings once more for it; a null start is kept', async () => {
    const w = world();
    const first = await readFriendWindow(w.cloud, 'b', FROM, TO);
    expect(first.start).toBeNull();
    w.take();
    await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: first, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }]);
    const { start: _none, ...old } = first;
    w.take();
    await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: old, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }, { path: 'users/b/meta/profile', n: 1 }]);
  });

  it('keeps the PR ids each month’s document carries, per month, through a read that skips the month', async () => {
    const w = world();
    w.docs['users/b/months/2026-10'] = { sets: [set('2026-10-16'), set('2026-10-18')], prs: ['app|2026-10-18|squat|1'] };
    const first = await readFriendWindow(w.cloud, 'b', FROM, TO);
    // September's document has none (an older app wrote it): not there, so the PRs there are worked out from the sets.
    expect(first.prs).toEqual({ '2026-10': ['app|2026-10-18|squat|1'] });
    touch(w, '2026-09', 2, [set('2026-09-10'), set('2026-09-12')]);
    w.docs['users/b/months/2026-09'].prs = [];
    w.take();
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO, { from: FROM, win: first, basis: first.basis });
    expect(w.log).toEqual([{ path: 'users/b/meta/index', n: 1 }, { path: 'users/b/months/2026-09', n: 1 }]);
    expect(r.prs).toEqual({ '2026-09': [], '2026-10': ['app|2026-10-18|squat|1'] });
  });

  it('has no status when none was set, and a window with no months reads none', async () => {
    const w = fakeFirestore({ 'users/b/meta/index': { months: {} } });
    const r = await readFriendWindow(w.cloud, 'b', FROM, TO);
    expect({ sets: r.sets, status: r.status }).toEqual({ sets: [], status: '' });
    expect(w.log.some((l) => l.path.includes('/months'))).toBe(false);
  });
});

describe('friendNews: your inbox read whole once, then only what came since', () => {
  const T = Date.parse('2026-10-18T17:00:00Z'), H = 3600_000, D = 24 * H;
  const ping = (from: string, at: number) => ({ from, kind: 'p', e: 'strong', at: ts(at) });
  function world() {
    return fakeFirestore({
      'users/jake': { username: 'jake' }, 'users/ana': { username: 'ana' },
      'users/me/friends/jake': { since: 1, readAt: ts(T - 2 * D) }, 'users/me/friends/ana': { since: 1, readAt: ts(T), muted: true },
      'users/me/inbox/j1': ping('jake', T - 3 * D), // read
      'users/me/inbox/j2': { from: 'jake', kind: 'm', t: 'gym at 6?', at: ts(T - D) }, // unread
      'users/me/inbox/a1': ping('ana', T - H), // read
      'users/me/inbox/j0': ping('jake', T - 31 * D), // over 30 days: cleared
      'users/me/inbox/g1': ping('gone', T - H), // no longer a friend: cleared
    });
  }
  const bare = ({ inbox: _i, ...n }: Awaited<ReturnType<typeof friendNews>>) => n;
  const ids = (xs: InboxDoc[]) => xs.map((d) => d.id).sort();

  it('a first read takes the whole inbox, clears what’s stale, and hands back what it kept', async () => {
    const w = world();
    const r = await friendNews(w.cloud, 'me', T);
    expect(bare(r)).toEqual({ requests: 0, gyms: 0, total: 1, unread: { jake: 1 }, latest: { jake: { text: 'gym at 6?', at: T - D }, ana: { text: '💪', at: T - H } },
      top: { uid: 'jake', name: 'jake', text: 'gym at 6?' }, muted: ['ana'] });
    expect(ids(r.inbox)).toEqual(['a1', 'j1', 'j2']);
    expect(w.log.filter((l) => l.path === 'users/me/inbox')).toEqual([{ path: 'users/me/inbox', n: 5 }]);
    await Promise.resolve();
    expect(Object.keys(w.docs).filter((p) => p.includes('/inbox/')).sort()).toEqual(['users/me/inbox/a1', 'users/me/inbox/j1', 'users/me/inbox/j2']);
  });

  it('then reads only what came after the newest it holds (a minute’s overlap), and says the same as a whole read', async () => {
    const w = world();
    const first = await friendNews(w.cloud, 'me', T);
    w.docs['users/me/inbox/j3'] = ping('jake', T + 5 * 60_000);
    w.docs['users/me/inbox/a2'] = { from: 'ana', kind: 'm', t: 'nice', at: ts(T + 6 * 60_000) };
    w.take();
    const r = await friendNews(w.cloud, 'me', T + 10 * 60_000, { inbox: first.inbox, names: { jake: 'jake', ana: 'ana' } });
    // friends 2, requests 1, gyms 1, and the inbox from a minute before a1 (the newest held): a1 again, j3, a2. No name read.
    expect(w.log).toContainEqual({ path: 'users/me/inbox', n: 3, filters: `at>${T - H - 60_000}` });
    expect(w.take()).toBe(7);
    expect(ids(r.inbox)).toEqual(['a1', 'a2', 'j1', 'j2', 'j3']);
    const whole = await friendNews(w.cloud, 'me', T + 10 * 60_000);
    expect(bare(r)).toEqual(bare(whole));
    expect(r.unread).toEqual({ jake: 2, ana: 1 });
  });

  it('nothing new: one read for the inbox', async () => {
    const w = world();
    const first = await friendNews(w.cloud, 'me', T);
    w.take();
    const r = await friendNews(w.cloud, 'me', T + 60_000, { inbox: first.inbox, names: { jake: 'jake' } });
    expect(w.log.find((l) => l.path === 'users/me/inbox')).toMatchObject({ n: 1 }); // a1, the newest, in the overlap
    expect(bare(r)).toEqual(bare(first));
  });

  it('what it held from someone no longer a friend, or now over 30 days old, stops counting and is cleared', async () => {
    const w = world();
    const first = await friendNews(w.cloud, 'me', T);
    delete w.docs['users/me/friends/jake']; // removed on another phone
    const r = await friendNews(w.cloud, 'me', T + 60_000, { inbox: first.inbox });
    expect(r.unread).toEqual({});
    expect(r.top).toBeNull();
    expect(ids(r.inbox)).toEqual(['a1']);
    await Promise.resolve();
    expect(Object.keys(w.docs).filter((p) => p.includes('/inbox/'))).toEqual(['users/me/inbox/a1']);
  });
});
