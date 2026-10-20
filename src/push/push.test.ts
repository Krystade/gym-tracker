import { describe, expect, it, vi } from 'vitest';
import {
  acceptedNote, buildPayload, cut, DELIVERY, friendTopic, gymNote, messageNote, noteOf, pingNote, PRESET_KEYS, recapNote, remindNote, requestNote, restNote, testNote, withMore, type Kind,
} from './payload';
import { defaultPrefs, withDefaults } from './client';
import { isRoute, parseOpen, tabOf } from './routes';
import { onNotificationClick, onPush, type PushEventLike, type SwDeps } from './sw-push';

const APP = 'https://krystade.github.io/gym-tracker/';

describe('payload', () => {
  it('builds a declarative payload per kind, with an absolute navigate inside the app', () => {
    const p = buildPayload('rest', restNote('Bench Press · set 4 next'), APP);
    expect(p).toEqual({ web_push: 8030, mutable: true, notification: {
      title: 'Rest done', body: 'Bench Press · set 4 next', lang: 'en', navigate: `${APP}#open=rest`, data: { kind: 'rest', route: 'rest' } } });
    expect(buildPayload('recap', recapNote({ sessions: 4, sets: 61, prs: 2 }), APP).notification).toMatchObject({ body: 'This week: 4 sessions · 61 sets · 2 PRs', navigate: `${APP}#open=recap` });
    expect(buildPayload('remind', remindNote('Day B'), APP).notification).toMatchObject({ body: 'Day B is up · nothing logged yet', data: { route: 'today' } });
    for (const k of Object.keys(DELIVERY) as Kind[]) {
      const n = buildPayload(k, testNote(), APP).notification;
      expect(n.navigate.startsWith(APP)).toBe(true);
      expect(DELIVERY[k].topic.length).toBeLessThanOrEqual(32);
    }
  });

  it('words the edge cases', () => {
    expect(recapNote({ sessions: 1, sets: 1, prs: 1 }).body).toBe('This week: 1 session · 1 set · 1 PR');
    expect(recapNote({ sessions: 0, sets: 0, prs: 0 }).body).toBe('This week: no sessions logged');
    expect(recapNote(null).body).toBe('This week: no sessions logged');
    expect(recapNote({ sessions: 2, sets: 30, prs: 1, cardio: 1 }).body).toBe('This week: 2 sessions + 1 cardio day · 30 sets · 1 PR');
    expect(recapNote({ sessions: 0, sets: 0, prs: 0, cardio: 3 }).body).toBe('This week: no sessions · 3 cardio days');
    expect(remindNote(null).body).toBe('Nothing logged yet today');
    expect(restNote('').body).toBe('Time for your next set');
    expect(restNote('x'.repeat(200)).body).toHaveLength(60);
  });

  it('stays under 1 KB with the longest label', () => {
    const p = buildPayload('rest', restNote('💪'.repeat(200)), APP);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(1024);
  });

  it('words friend activity, lands it on the friend, and cuts a gym name without halving an emoji', () => {
    expect(requestNote('jake')).toEqual({ title: 'Friend request', body: 'jake wants to be friends' });
    expect(acceptedNote('jake').body).toBe('You and jake are friends');
    expect(gymNote('jake', 'Planet Fitness').body).toBe('jake sent you a gym: Planet Fitness');
    expect(gymNote('jake', '').body).toBe('jake sent you a gym: a gym');
    const long = `${'x'.repeat(39)}🏋️‍♀️ and more`;
    expect(cut(long, 40)).toBe(`${'x'.repeat(39)}🏋️‍♀️`);
    expect(cut(long, 39)).toBe('x'.repeat(39));
    expect(withMore({ title: 't', body: 'b' }, 2).body).toBe('b · +2 more');
    expect(withMore({ title: 't', body: 'b' }, 0).body).toBe('b');
    const p = buildPayload('gym', gymNote('jake', 'Home'), APP, { route: 'friend.u1' });
    expect(p.notification).toMatchObject({ navigate: `${APP}#open=friend.u1`, data: { kind: 'gym', route: 'friend.u1' } });
    expect(p.notification).not.toHaveProperty('app_badge');
    expect(buildPayload('request', requestNote('jake'), APP).notification.navigate).toBe(`${APP}#open=friends`);
  });

  it('words pings (the emoji alone) and messages with the friend as the title, and lands them on the friend with the badge', () => {
    expect(pingNote('jake', 'strong')).toEqual({ title: 'jake', body: '💪' });
    expect(PRESET_KEYS.map((k) => pingNote('j', k).body)).toEqual(['💪', '🔥', '👏', '🏋️', '👀', '🫡']);
    expect(pingNote('jake', 'kiss').body).toBe('sent you a ping'); // a ping this version doesn't know
    expect(pingNote('jake', undefined).body).toBe('sent you a ping');
    expect(messageNote('jake', '  see you at 6  ')).toEqual({ title: 'jake', body: 'see you at 6' });
    expect(messageNote('jake', 'line one\nline two\u0000').body).toBe('line one line two');
    expect(messageNote('jake', '').body).toBe('sent you a message');
    expect(messageNote('jake', '💪'.repeat(80)).body).toBe('💪'.repeat(70)); // 140 UTF-16 units, as the rules count
    expect(messageNote('jake', 'x'.repeat(139) + '💪').body).toBe('x'.repeat(139)); // never half an emoji
    const p = buildPayload('ping', pingNote('jake', 'fire'), APP, { route: 'friend.u1', badge: 3 });
    expect(p.notification).toMatchObject({ title: 'jake', body: '🔥', navigate: `${APP}#open=friend.u1`, app_badge: '3', data: { kind: 'ping', route: 'friend.u1' } });
    expect(buildPayload('message', messageNote('a', 'hi'), APP, { badge: 0 }).notification.app_badge).toBe('0');
  });

  it('keeps the biggest message under 1 KB', () => {
    const name = 'x'.repeat(20);
    for (const t of ['💪'.repeat(70), '頑'.repeat(140), '"\\'.repeat(70), '\u0001'.repeat(140), 'e\u0301'.repeat(70)]) {
      const p = buildPayload('message', messageNote(name, t), APP, { route: `friend.${'u'.repeat(28)}`, badge: 9999 });
      expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(1024);
    }
  });

  it('gives each sender a topic of 22 URL-safe characters, the same every time', async () => {
    const a = await friendTopic('uid-a');
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await friendTopic('uid-a')).toBe(a);
    expect(await friendTopic('uid-b')).not.toBe(a);
  });

  it('turns friend activity on for prefs saved before it existed, and keeps what was chosen', () => {
    const old = { kinds: { rest: false, remind: true, recap: false }, reminder: { days: [1], at: '07:00' }, recap: { day: 3, at: '09:00' } };
    expect(withDefaults(old as never, 2)).toEqual({ ...old, kinds: { rest: false, remind: true, recap: false, activity: true, friends: true } });
    expect(withDefaults({ ...defaultPrefs(2), kinds: { ...defaultPrefs(2).kinds, friends: false } }, 2).kinds.friends).toBe(false);
    expect(withDefaults({ ...defaultPrefs(2), kinds: { ...defaultPrefs(2).kinds, activity: false } }, 2).kinds.activity).toBe(false);
    expect(withDefaults(null, 2)).toEqual(defaultPrefs(2));
  });

  it('reads whatever arrived into something showable', () => {
    expect(noteOf(buildPayload('test', testNote(), APP))).toMatchObject({ title: 'Test notification', lang: 'en', data: { kind: 'test', route: 'today' } });
    expect(noteOf(null)).toEqual({ title: 'Gym Tracker', body: '', data: { kind: undefined, route: undefined } });
    expect(noteOf({ notification: { title: 7, body: ['x'] } })).toMatchObject({ title: 'Gym Tracker', body: '' });
    expect(noteOf({ notification: { title: 't', app_badge: '2' } }).badge).toBe(2);
  });
});

describe('routes', () => {
  it('parses #open= routes and nothing else', () => {
    expect(parseOpen('#open=rest')).toBe('rest');
    expect(parseOpen('#open=friend.Ab9_x')).toBe('friend.Ab9_x');
    expect(parseOpen('#open=friend.')).toBeNull();
    expect(parseOpen('#open=stats')).toBeNull();
    expect(parseOpen('#invite=abc')).toBeNull();
    expect(parseOpen('#open=rest&x')).toBeNull();
    expect(isRoute('recap')).toBe(true);
    expect(isRoute('javascript:alert(1)')).toBe(false);
    expect([tabOf('rest'), tabOf('today'), tabOf('recap'), tabOf('friends'), tabOf('friend.u1')]).toEqual(['today', 'today', 'today', 'friends', 'friends']);
  });
});

type Win = { focus: () => Promise<unknown>; postMessage: (m: unknown) => void };
function fakes(windows: Win[] = []) {
  const waits: Promise<unknown>[] = [];
  const d = {
    registration: { showNotification: vi.fn<SwDeps['registration']['showNotification']>(async () => {}) },
    clients: { matchAll: vi.fn<SwDeps['clients']['matchAll']>(async () => windows), openWindow: vi.fn<SwDeps['clients']['openWindow']>(async () => null) },
    setBadge: vi.fn<SwDeps['setBadge']>(async () => {}),
    record: vi.fn<(k: string, v: unknown) => Promise<void>>(async () => {}),
    scope: APP,
  } satisfies SwDeps;
  return { d, waits, waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
}

describe('service worker push', () => {
  it('shows the notification inside waitUntil, for a payload, a broken one and a declarative one', async () => {
    const data = (v: unknown) => ({ json: () => (typeof v === 'string' ? JSON.parse(v) : v), text: () => String(v) });
    const cases = [
      { data: data(buildPayload('rest', restNote('Squat · set 2 next'), APP)), title: 'Rest done', body: 'Squat · set 2 next' },
      { data: data('{not json'), title: 'Gym Tracker', body: '' },
      { data: null, title: 'Gym Tracker', body: '' },
      { notification: { title: 'Your week', body: 'This week: 1 session · 3 sets · 0 PRs', data: { kind: 'recap', route: 'recap' } }, title: 'Your week', body: 'This week: 1 session · 3 sets · 0 PRs' },
    ];
    for (const { title, body, ...event } of cases) {
      const f = fakes();
      let release!: () => void;
      f.d.registration.showNotification.mockImplementation(() => new Promise<void>((r) => { release = r; }));
      onPush({ ...event, waitUntil: f.waitUntil }, f.d);
      // waitUntil is called during the event, and what it waits for includes the notification being shown.
      expect(f.waits).toHaveLength(1);
      expect(f.d.registration.showNotification).toHaveBeenCalledWith(title, expect.objectContaining({ body }));
      let settled = false;
      void f.waits[0].then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false);
      release();
      await f.waits[0];
      expect(settled).toBe(true);
    }
  });

  it('still shows when the bookkeeping fails, and records the push and tells open windows', async () => {
    const win = { focus: vi.fn(async () => {}), postMessage: vi.fn() };
    const f = fakes([win]);
    f.d.record.mockRejectedValue(new Error('quota'));
    f.d.setBadge.mockRejectedValue(new Error('no badge'));
    onPush({ data: { json: () => ({ notification: { title: 't', body: 'b', app_badge: '3', data: { kind: 'test' } } }), text: () => '' }, waitUntil: f.waitUntil }, f.d);
    await f.waits[0];
    expect(f.d.registration.showNotification).toHaveBeenCalledTimes(1);
    expect(f.d.setBadge).toHaveBeenCalledWith(3);
    expect(f.d.record).toHaveBeenCalledWith('lastPush', expect.objectContaining({ kind: 'test' }));
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'push', kind: 'test', route: null });
  });

  it('what it shows keeps the tap’s place, `navigate`, as the declarative notification it replaces had it', async () => {
    // iOS 18.4+ opens a notification's `navigate` on a tap, without notificationclick (whose openWindow and focus are
    // WebKit 263687's): shown without one, a tap just opens the app wherever it was.
    const data = (v: unknown) => ({ json: () => (typeof v === 'string' ? JSON.parse(v) : v), text: () => String(v) });
    const cases: [Omit<PushEventLike, 'waitUntil'>, string][] = [
      [{ data: data(buildPayload('message', messageNote('jake', 'leg day?'), APP, { route: 'friend.u1' })) }, `${APP}#open=friend.u1`],
      [{ notification: { title: 'Your week', body: 'This week: 1 session · 3 sets · 0 PRs', data: { kind: 'recap', route: 'recap' } } }, `${APP}#open=recap`],
      [{ data: data(buildPayload('request', requestNote('jake'), APP)) }, `${APP}#open=friends`],
      [{ data: data({ notification: { title: 't', data: { route: 'https://evil.example/' } } }) }, `${APP}#open=today`],
      [{ data: data('{not json') }, `${APP}#open=today`],
    ];
    for (const [event, navigate] of cases) {
      const f = fakes();
      onPush({ ...event, waitUntil: f.waitUntil }, f.d);
      await f.waits[0];
      expect(f.d.registration.showNotification).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ navigate }));
    }
  });

  it('tells open windows which friend a push is about, so the app reads that thread again', async () => {
    const win = { focus: vi.fn(async () => {}), postMessage: vi.fn() };
    const f = fakes([win]);
    onPush({ data: { json: () => buildPayload('ping', pingNote('jake', 'fire'), APP, { route: 'friend.u1' }), text: () => '' }, waitUntil: f.waitUntil }, f.d);
    await f.waits[0];
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'push', kind: 'ping', route: 'friend.u1' });
  });

  it('a friend’s push shows your private tag beside their name, for whatever they sent', async () => {
    const show = async (payload: unknown, tags: Record<string, string> | undefined | Error) => {
      const f = fakes();
      const d: SwDeps = { ...f.d, tags: async () => { if (tags instanceof Error) throw tags; return tags; } };
      onPush({ data: { json: () => payload, text: () => '' }, waitUntil: f.waitUntil }, d);
      await f.waits[0];
      const [title, o] = f.d.registration.showNotification.mock.calls[0];
      return { title, body: o?.body };
    };
    const TAGS = { u1: 'Jake (gym)' };
    expect(await show(buildPayload('ping', pingNote('jake', 'fire'), APP, { route: 'friend.u1', from: 'u1', name: 'jake' }), TAGS)).toEqual({ title: 'Jake (gym) · @jake', body: '🔥' });
    expect(await show(buildPayload('request', requestNote('jake'), APP, { from: 'u1', name: 'jake' }), TAGS)).toEqual({ title: 'Friend request', body: 'Jake (gym) · @jake wants to be friends' });
    // Before the Worker carried who it's from: a ping or message still finds them by where it lands and its title.
    expect(await show(buildPayload('message', messageNote('jake', 'leg day?'), APP, { route: 'friend.u1' }), TAGS)).toEqual({ title: 'Jake (gym) · @jake', body: 'leg day?' });
    // No tag for them, no tags at all, or reading them failed: as it came.
    expect(await show(buildPayload('ping', pingNote('jake', 'fire'), APP, { route: 'friend.u1', from: 'u1', name: 'jake' }), { u2: 'Other' })).toEqual({ title: 'jake', body: '🔥' });
    expect(await show(buildPayload('ping', pingNote('jake', 'fire'), APP, { route: 'friend.u1', from: 'u1', name: 'jake' }), undefined)).toEqual({ title: 'jake', body: '🔥' });
    expect(await show(buildPayload('ping', pingNote('jake', 'fire'), APP, { route: 'friend.u1', from: 'u1', name: 'jake' }), new Error('idb'))).toEqual({ title: 'jake', body: '🔥' });
    // Not a friend's push: never looked up.
    expect(await show(buildPayload('rest', restNote('Squat'), APP), TAGS)).toEqual({ title: 'Rest done', body: 'Squat' });
  });

  it('a slow read of the tags never holds a friend’s push back for long', async () => {
    vi.useFakeTimers();
    try {
      const f = fakes();
      const d: SwDeps = { ...f.d, tags: () => new Promise(() => {}) };
      onPush({ data: { json: () => buildPayload('ping', pingNote('jake', 'fire'), APP, { route: 'friend.u1', from: 'u1', name: 'jake' }), text: () => '' }, waitUntil: f.waitUntil }, d);
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.d.registration.showNotification).toHaveBeenCalledWith('jake', expect.objectContaining({ body: '🔥' }));
    } finally { vi.useRealTimers(); }
  });

  it('a tap with a window open focuses it and tells it where to go', async () => {
    const win = { focus: vi.fn(async () => {}), postMessage: vi.fn() };
    const f = fakes([win]);
    const close = vi.fn();
    onNotificationClick({ notification: { close, data: { kind: 'recap', route: 'recap' } }, waitUntil: f.waitUntil }, f.d);
    await f.waits[0];
    expect(close).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'open', route: 'recap' });
    expect(f.d.clients.openWindow).not.toHaveBeenCalled();
    expect(f.d.record).toHaveBeenCalledWith('route', expect.objectContaining({ route: 'recap' }));
  });

  it('a tap with no window opens one on the route, and stores the route; a strange route goes to Today', async () => {
    const f = fakes();
    onNotificationClick({ notification: { close: vi.fn(), data: { route: 'rest' } }, waitUntil: f.waitUntil }, f.d);
    await f.waits[0];
    expect(f.d.clients.openWindow).toHaveBeenCalledWith(`${APP}#open=rest`);
    expect(f.d.record).toHaveBeenCalledWith('route', expect.objectContaining({ route: 'rest' }));

    const g = fakes();
    onNotificationClick({ notification: { close: vi.fn(), data: { route: 'https://evil.example/' } }, waitUntil: g.waitUntil }, g.d);
    await g.waits[0];
    expect(g.d.clients.openWindow).toHaveBeenCalledWith(`${APP}#open=today`);
  });
});
