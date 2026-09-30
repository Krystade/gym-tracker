import { describe, expect, it } from 'vitest';
import { muscleVector, MUSCLES } from './muscles';
import { CATALOG } from './catalog';

describe('muscleVector', () => {
  it('has 18 muscles', () => { expect(MUSCLES).toHaveLength(18); });
  it('maps catalog names exactly, case/space-insensitively', () => {
    expect(muscleVector('Cable Pushdown')).toEqual({ Triceps: 1 });
    expect(muscleVector('  lat   pulldown ')).toEqual({ Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5, Forearms: 0.5 });
    expect(muscleVector('Overhead Press')).toEqual({ 'Front Delts': 1, Triceps: 0.5, 'Side Delts': 0.5 });
  });
  it('falls back on keywords for unknown names', () => {
    expect(muscleVector('Spider Curl')).toEqual({ Biceps: 1 });
    expect(muscleVector('Rope Pushdown')).toEqual({ Triceps: 1 });
    expect(muscleVector('Egyptian Lateral Raise')).toEqual({ 'Side Delts': 1 });
    expect(muscleVector('Leg Curl Something')).toEqual({ Hamstrings: 1 });
  });
  it('returns null for names it cannot place', () => {
    expect(muscleVector('Zercher Thing')).toBeNull();
  });
});

describe('catalog coverage', () => {
  it('maps every catalog exercise', () => {
    expect(CATALOG.filter((n) => muscleVector(n) == null)).toEqual([]);
  });
});

describe('keyword fallback word boundaries', () => {
  it('does not read "machine" as chin-ups or "narrow" as rows', () => {
    expect(muscleVector('Hack Squat Machine')?.Quads).toBe(1);
    expect(muscleVector('Smith Machine Squat')?.Quads).toBe(1);
    expect(muscleVector('Pec Deck Machine')?.Chest).toBe(1);
    expect(muscleVector('Machine Fly')?.Chest).toBe(1);
    expect(muscleVector('Leg Press Machine')?.Quads).toBe(1);
    expect(muscleVector('Machine Incline Press')?.Chest).toBe(1);
    expect(muscleVector('Hip thrust machine')?.Glutes).toBe(1);
    expect(muscleVector('Narrow Grip Bench Press')?.Chest).toBe(1);
    expect(muscleVector('Neutral Grip Chin')?.Lats).toBe(1);
    expect(muscleVector('T-Bar Row')?.['Mid-Back']).toBe(1);
  });
});

describe('rows that mention a bench', () => {
  it('are back work, not chest', () => {
    for (const n of ['Incline Bench Row', 'Bench Supported Row', 'Bench-Supported DB Row']) {
      expect(muscleVector(n)?.['Mid-Back'], n).toBe(1);
      expect(muscleVector(n)?.Chest ?? 0, n).toBe(0);
    }
  });
});
