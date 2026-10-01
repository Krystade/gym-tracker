import { describe, expect, it } from 'vitest';
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
