import { beforeEach, describe, expect, it, vi } from 'vitest';

// The lock-screen alert the Worker sends at the end of a rest: told the same end as the bar.
const { restPush } = vi.hoisted(() => ({ restPush: vi.fn() }));
vi.mock('../push/client', () => ({ restPush, restAlertState: () => null, subscribeRestAlert: () => () => {} }));
vi.mock('../push/config', () => ({ PUSH_ON: true }));
const { adjustRest, currentRest, revertSwitch, startRest } = await import('./RestTimer');

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

describe('±30 s (owner, 2026-10-19): the rest as set is kept for the lift', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T18:30:00')); startRest(0, 'x'); restPush.mockClear(); });

  it('moves the end either way, never before now, and keeps the rest it adds up to', () => {
    const t0 = Date.now(), keep = vi.fn();
    startRest(120, 'cable curl', 'Cable Curl · set 2 next', undefined, keep);
    adjustRest(30_000);
    expect(currentRest()?.until).toBe(t0 + 150_000);
    expect(keep).toHaveBeenLastCalledWith(150);
    adjustRest(-30_000); adjustRest(-30_000);
    expect(currentRest()?.until).toBe(t0 + 90_000);
    expect(keep).toHaveBeenLastCalledWith(90);
    expect(restPush).toHaveBeenLastCalledWith(t0 + 90_000, 'Cable Curl · set 2 next');
    // 80 s in, 10 s left: −30 s ends it now, not before.
    vi.setSystemTime(t0 + 80_000);
    adjustRest(-30_000);
    expect(currentRest()?.until).toBe(t0 + 80_000);
    expect(keep).toHaveBeenLastCalledWith(80);
    // The progress line's whole is the rest as it now stands.
    expect(currentRest()?.total).toBe(80_000);
  });

  it('keeps nothing from a superset’s switch; once it is the full rest, that rest is kept', () => {
    const t0 = Date.now(), keep = vi.fn();
    startRest(20, 'cable pushdown', 'Switch to Cable Pushdown', { seconds: 120, card: 'cable curl', label: 'Cable Curl · set 3 next' }, keep);
    adjustRest(30_000);
    expect(currentRest()?.until).toBe(t0 + 50_000);
    expect(keep).not.toHaveBeenCalled();
    revertSwitch();
    adjustRest(-30_000);
    expect(currentRest()?.until).toBe(t0 + 90_000);
    expect(keep).toHaveBeenLastCalledWith(90);
  });

  it('keeps at least 30 s: a rest ended early by −30 s is not a rest of nothing', () => {
    const t0 = Date.now(), keep = vi.fn();
    startRest(120, 'cable curl', undefined, undefined, keep);
    vi.setSystemTime(t0 + 10_000);
    for (let i = 0; i < 4; i++) adjustRest(-30_000);
    expect(currentRest()?.until).toBe(t0 + 10_000);
    expect(keep).toHaveBeenLastCalledWith(30);
  });
});
