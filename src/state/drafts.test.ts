import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, getDraft, saveDraft } from './drafts';

describe('set-form drafts', () => {
  it('keeps a typed set per profile and exercise, for today only, until it is saved', () => {
    saveDraft('a', 'Bench Press', '2026-10-01', { weight: '135', reps: '7' });
    expect(getDraft('a', 'Bench Press', '2026-10-01')).toEqual({ weight: '135', reps: '7' });
    expect(getDraft('b', 'Bench Press', '2026-10-01')).toBeUndefined();
    expect(getDraft('a', 'Bench Press', '2026-10-02')).toBeUndefined();
    clearDraft('a', 'Bench Press');
    expect(getDraft('a', 'Bench Press', '2026-10-01')).toBeUndefined();
  });
});

describe('drafts across a reload', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  const session = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k) };
  };

  it('a fresh page reads what the last one typed, and a saved set leaves nothing behind', async () => {
    vi.stubGlobal('sessionStorage', session());
    (await import('./drafts')).saveDraft('a', 'Bench Press', '2026-10-01', { weight: '135' });
    (await import('./drafts')).saveDraft('a', 'Row', '2026-10-01', { weight: '95' });
    vi.resetModules(); // the reload: module memory is gone, the tab's session storage isn't
    const after = await import('./drafts');
    expect(after.getDraft('a', 'Bench Press', '2026-10-01')).toEqual({ weight: '135' });
    after.clearDraft('a', 'Row');
    vi.resetModules();
    expect((await import('./drafts')).getDraft('a', 'Row', '2026-10-01')).toBeUndefined();
  });

  it('works on in memory when session storage throws (a private window, blocked storage)', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } });
    const d = await import('./drafts');
    d.saveDraft('a', 'Bench Press', '2026-10-01', { weight: '135' });
    expect(d.getDraft('a', 'Bench Press', '2026-10-01')).toEqual({ weight: '135' });
  });
});

describe('dirty forms', () => {
  it('reports a form with unsaved changes until it is clean or gone', async () => {
    const { markDirty, anyDirty } = await import('./drafts');
    expect(anyDirty()).toBe(false);
    markDirty('f1', true); markDirty('f2', true);
    markDirty('f1', false);
    expect(anyDirty()).toBe(true);
    markDirty('f2', false);
    expect(anyDirty()).toBe(false);
  });
});
