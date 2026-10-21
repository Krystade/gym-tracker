import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({ PUSH_ON: true, VAPID_PUBLIC_KEY: '', WORKER_REACHABLE: true, WORKER_URL: 'https://worker.test' }));
vi.mock('../cloud/firebase', () => ({ loadCloud: async () => ({ auth: { authStateReady: async () => {}, currentUser: { getIdToken: async () => 'token' } } }) }));

const { restPush } = await import('./client');

describe('the rest timer’s lock-screen alert', () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  beforeEach(() => {
    const store = new Map([['gym-tracker:push', JSON.stringify({ device: 'd1', prefs: { kinds: { rest: true } } })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    vi.stubGlobal('fetch', fetch);
    fetch.mockClear();
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const calls = () => fetch.mock.calls.map((c) => { const [url, init] = c as unknown as [string, { method: string; body?: string }]; return [init.method, url.replace('https://worker.test', ''), init.body && JSON.parse(init.body).seconds]; });

  it('is sent for a rest, and called off for one too short to push (a superset’s switch can be 0:00)', async () => {
    restPush(Date.now() + 120_000, 'Cable Curl · set 2 next');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    restPush(Date.now() + 3_000, 'Switch to Cable Pushdown');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    restPush(null);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(calls()).toEqual([['POST', '/timer', 120], ['DELETE', '/timer', undefined], ['DELETE', '/timer', undefined]]);
  });
});
