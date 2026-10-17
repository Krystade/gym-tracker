import { describe, expect, it, vi } from 'vitest';
import { buildPayload, DELIVERY, noteOf, recapNote, remindNote, restNote, testNote, type Kind } from './payload';
import { isRoute, parseOpen, tabOf } from './routes';
import { onNotificationClick, onPush, type SwDeps } from './sw-push';

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
    expect(remindNote(null).body).toBe('Nothing logged yet today');
    expect(restNote('').body).toBe('Time for your next set');
    expect(restNote('x'.repeat(200)).body).toHaveLength(60);
  });

  it('stays under 1 KB with the longest label', () => {
    const p = buildPayload('rest', restNote('💪'.repeat(200)), APP);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(1024);
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
    expect([tabOf('rest'), tabOf('today'), tabOf('recap'), tabOf('friends'), tabOf('friend.u1')]).toEqual(['today', 'today', 'stats', 'friends', 'friends']);
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
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'push', kind: 'test' });
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
