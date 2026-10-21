import { beforeEach, describe, expect, it, vi } from 'vitest';

// The lock-screen alert the Worker sends at the end of a rest: told the same end as the bar.
const { restPush } = vi.hoisted(() => ({ restPush: vi.fn() }));
vi.mock('../push/client', () => ({ restPush, restAlertState: () => null, subscribeRestAlert: () => () => {} }));
vi.mock('../push/config', () => ({ PUSH_ON: true }));
const { adjustRest, closeTimers, currentOffer, currentRest, finishNow, keepGoing, nextOf, offerFinish, restLines, revertSwitch, startRest } = await import('./RestTimer');

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

describe('why the rest is its length (the bar’s “?”)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T18:30:00')); startRest(0, 'x'); restPush.mockClear(); });
  const base = { what: 'Research default', s: 120, note: 'small lift' }, sw = { what: 'Superset switch', s: 20, note: 'default until 3 switches are timed' };

  it('carries the switch’s lines and the full rest’s, and adds the ±30 s taps as a line of their own', () => {
    startRest(20, 'cable pushdown', 'Switch to Cable Pushdown', { seconds: 120, card: 'cable curl', label: 'Cable Curl · set 3 next', why: [base] }, vi.fn(), [sw]);
    expect(restLines(currentRest()!)).toEqual({ total: 20, parts: [sw] });
    adjustRest(30_000);
    // A switch's taps aren't kept for the lift: no note saying so.
    expect(restLines(currentRest()!)).toEqual({ total: 50, parts: [sw, { what: 'Your ±30 s', s: 30, add: true }] });
    revertSwitch();
    expect(restLines(currentRest()!)).toEqual({ total: 120, parts: [base] });
    adjustRest(-30_000); adjustRest(-30_000);
    expect(restLines(currentRest()!)).toEqual({ total: 60, parts: [base, { what: 'Your ±30 s', s: -60, add: true, note: 'kept for this lift' }] });
  });

  it('counts only what −30 s took off: never before now; taps that cancel out leave no line', () => {
    const t0 = Date.now();
    startRest(120, 'cable curl', undefined, undefined, undefined, [base]);
    adjustRest(30_000); adjustRest(-30_000);
    expect(restLines(currentRest()!)).toEqual({ total: 120, parts: [base] });
    vi.setSystemTime(t0 + 110_000);
    adjustRest(-30_000); // 10 s left: ends now, 10 s off
    expect(restLines(currentRest()!)).toEqual({ total: 110, parts: [base, { what: 'Your ±30 s', s: -10, add: true }] });
  });

  it('a rest started without its lines has nothing to explain', () => {
    startRest(120, 'cable curl');
    expect(restLines(currentRest()!)).toBeNull();
  });
});

describe('after the plan’s last set (owner, 2026-10-20): no rest, Finish or Keep going in the bar’s place', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T18:30:00')); startRest(0, 'x'); restPush.mockClear(); });

  it('ends the rest before it and calls off its lock-screen alert; no rest starts, so no alert is set', () => {
    startRest(120, 'cable curl', 'Cable Curl · set 3 next');
    restPush.mockClear();
    offerFinish({ finish: vi.fn() });
    expect(currentRest()).toBeNull();
    expect(currentOffer()).not.toBeNull();
    expect(restPush.mock.calls).toEqual([[null, undefined]]);
  });

  it('Keep going takes the offer away and starts the rest it held back, from the set’s own time', () => {
    const t0 = Date.now(), resume = vi.fn(() => startRest(120, 'cable curl', 'Cable Curl · set 4 next', undefined, undefined, undefined, t0));
    offerFinish({ finish: vi.fn(), resume });
    vi.setSystemTime(t0 + 20_000);
    keepGoing();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(currentOffer()).toBeNull();
    expect(currentRest()?.until).toBe(t0 + 120_000); // 1:40 left, not a fresh 2:00
    expect(restPush).toHaveBeenLastCalledWith(t0 + 120_000, 'Cable Curl · set 4 next');
  });

  it('Finish takes the offer away and says so; nothing starts', () => {
    const finish = vi.fn();
    offerFinish({ finish, resume: vi.fn() });
    restPush.mockClear();
    finishNow();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(currentOffer()).toBeNull();
    expect(currentRest()).toBeNull();
  });

  it('a further set logged instead starts its rest as usual, and the offer goes', () => {
    offerFinish({ finish: vi.fn() });
    startRest(90, 'leg curl', 'Leg Curl · set 2 next');
    expect(currentOffer()).toBeNull();
    expect(currentRest()?.card).toBe('leg curl');
  });

  it('ignored, it stays; the session closing by itself takes it and any rest away, alert and all', () => {
    offerFinish({ finish: vi.fn() });
    vi.setSystemTime(Date.now() + 3600e3);
    expect(currentOffer()).not.toBeNull();
    restPush.mockClear();
    closeTimers();
    expect(currentOffer()).toBeNull();
    expect(restPush.mock.calls).toEqual([[null, undefined]]);
    // Nothing running: nothing to call off.
    restPush.mockClear();
    closeTimers();
    expect(restPush).not.toHaveBeenCalled();
  });
});

describe('what the bar says comes next', () => {
  it('this lift’s next set under “Rest”; another lift on a line of its own; the plan done under “Rest”', () => {
    expect(nextOf('Cable Pushdown · set 3 next', 'cable pushdown')).toEqual({ sub: 'Set 3 next' });
    expect(nextOf('Next: Machine Chest Press', 'cable pushdown')).toEqual({ row: 'Machine Chest Press' });
    expect(nextOf('Switch to Cable Curl', 'cable pushdown')).toEqual({ row: 'Cable Curl' });
    expect(nextOf('Cable Curl · set 3 next', 'cable pushdown')).toEqual({ row: 'Cable Curl · set 3' });
    expect(nextOf('Plan done', 'cable pushdown')).toEqual({ sub: 'Plan done' });
    expect(nextOf(undefined, 'x')).toEqual({});
  });
});
