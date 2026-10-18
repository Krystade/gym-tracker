import { beforeEach, describe, expect, it, vi } from 'vitest';

// The lock-screen alert the Worker sends at the end of a rest: told the same end as the bar.
const { restPush } = vi.hoisted(() => ({ restPush: vi.fn() }));
vi.mock('../push/client', () => ({ restPush, restAlertState: () => null, subscribeRestAlert: () => () => {} }));
vi.mock('../push/config', () => ({ PUSH_ON: true }));
const { revertSwitch, startRest } = await import('./RestTimer');

describe('the rest timer’s lock-screen alert', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T18:30:00')); restPush.mockClear(); startRest(0, 'x'); restPush.mockClear(); });

  it('goes out at the end of a superset’s switch, and at the full rest once it turns out not to be one', () => {
    const t0 = Date.now();
    startRest(20, 'cable pushdown', 'Switch to Cable Pushdown', { seconds: 120, card: 'cable curl', label: 'Cable Curl · set 3 next' });
    expect(restPush).toHaveBeenLastCalledWith(t0 + 20_000, 'Switch to Cable Pushdown');
    vi.setSystemTime(t0 + 5_000);
    revertSwitch();
    expect(restPush).toHaveBeenLastCalledWith(t0 + 120_000, 'Cable Curl · set 3 next');
    revertSwitch(); // a full rest has nothing to go back to
    expect(restPush).toHaveBeenCalledTimes(2);
  });

  it('leaves a plain rest alone', () => {
    const t0 = Date.now();
    startRest(120, 'cable curl', 'Cable Curl · set 2 next');
    revertSwitch();
    expect(restPush.mock.calls).toEqual([[t0 + 120_000, 'Cable Curl · set 2 next']]);
  });
});
