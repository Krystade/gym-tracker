import { describe, expect, it } from 'vitest';
import { shortLine } from './ProgramScreen';
import type { Program } from '../domain/program';

const day = (name: string, sets: number[]) => ({ name, slots: sets.map((n, i) => ({ exercise: `L${i}`, sets: n, repMin: 8, repMax: 12 })) });

describe('shortLine (round 28: why a build stopped short of the sets asked)', () => {
  it('says how many of the sets asked each day holds, and why', () => {
    const p: Program = { key: 'program', perSession: 20, createdAt: '', days: [day('A', [4, 4, 4, 4, 2]), day('B', [4, 4, 4, 4, 2])], short: { why: 'tops' } };
    expect(shortLine(p)).toBe('18 of 20 sets a session: every priority muscle is at the top of its range.');
    const q: Program = { ...p, days: [day('A', [4, 4, 4, 4]), day('B', [4, 4, 4, 4, 2])], short: { why: 'lifts', muscles: ['Biceps'] } };
    expect(shortLine(q)).toBe('16–18 of 20 sets a session: every other priority muscle is at the top of its range, and no lift here has room for more Biceps.');
    expect(shortLine({ ...p, minutes: 60 })).toBe('Days are under your 60 min: every priority muscle is at the top of its range.');
  });
});
