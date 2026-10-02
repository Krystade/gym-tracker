import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDay } from './format';

describe('fmtDay', () => {
  it('leaves the year out inside the current year', () => {
    const s = fmtDay('2026-09-29', '2026-10-02');
    expect(s).not.toContain('2026');
    expect(s).toContain('29');
    expect(fmtDate('2026-09-29').length).toBeGreaterThan(s.length);
  });
  it('keeps the year for another year, dropping the weekday so it still fits', () => {
    const s = fmtDay('2025-05-13', '2026-01-02');
    expect(s).toContain('2025');
    expect(s).toContain('13');
    expect(fmtDate('2025-05-13').length).toBeGreaterThan(s.length);
  });
});
