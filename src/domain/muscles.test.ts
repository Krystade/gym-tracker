import { isCardio } from './cardio';
import { describe, expect, it } from 'vitest';
import { countsFor, muscleVector, MUSCLES, musclesText, worksLine } from './muscles';
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
  it('maps every catalog exercise except cardio, which counts minutes', () => {
    expect(CATALOG.filter((n) => muscleVector(n) == null && !isCardio(n))).toEqual([]);
  });
  it('has a plain barbell Deadlift, a hinge', () => {
    expect(CATALOG).toContain('Deadlift');
    expect(muscleVector('Deadlift')).toEqual(muscleVector('Romanian Deadlift'));
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
    // A close or narrow grip makes it a triceps press (round 15), as Close-Grip Bench Press: still not a row.
    expect(muscleVector('Narrow Grip Bench Press')?.Triceps).toBe(1);
    expect(muscleVector('Narrow Grip Bench Press')?.['Mid-Back']).toBeUndefined();
    expect(muscleVector('Neutral Grip Chin')?.Lats).toBe(1);
    expect(muscleVector('T-Bar Row')?.['Mid-Back']).toBe(1);
    expect(muscleVector('Landmine Press')).toEqual({ 'Front Delts': 1, Chest: 0.5, Triceps: 0.5 });
    expect(muscleVector('Landmine Row')?.Lats).toBe(1);
    expect(muscleVector('Landmine Squat')?.Quads).toBe(1);
    expect(muscleVector('Landmine Rotation')?.Abs).toBe(1);
    expect(muscleVector('Standing Cable Crunch')).toEqual({ Abs: 1 });
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

describe('pull bias', () => {
  const LAT = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5, Forearms: 0.5 };
  const CHIN = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.75, Forearms: 0.5 };
  it('every vertical pull is lats first; an underhand or close grip brings the biceps in more, short of direct work', () => {
    for (const n of ['Lat Pulldown', 'Pull-up']) expect(muscleVector(n), n).toEqual(LAT);
    for (const n of ['Chin-up', 'Close-Grip Lat Pulldown']) expect(muscleVector(n), n).toEqual(CHIN);
    expect(muscleVector('Chin-up')).not.toEqual(muscleVector('Pull-up'));
  });
  it('a pull logged under its own name reads its grip', () => {
    for (const n of ['Weighted Chin-up', 'Neutral Grip Chin', 'Supinated Lat Pulldown', 'Underhand Pulldown', 'Reverse-Grip Lat Pulldown',
      'Reverse Grip Pull-up', 'V-Bar Pulldown', 'Narrow Grip Pulldown']) expect(muscleVector(n), n).toEqual(CHIN);
    for (const n of ['Wide-Grip Lat Pulldown', 'Weighted Pull-up', 'Machine Pulldown', 'Wide Grip Pull-up']) expect(muscleVector(n), n).toEqual(LAT);
    // A row is a row, whatever the grip.
    for (const n of ['Underhand Row', 'Reverse-Grip Barbell Row', 'Close-Grip Cable Row']) expect(muscleVector(n)?.['Mid-Back'], n).toBe(1);
  });
});

describe('new catalog lifts', () => {
  it('DB Shoulder Press is an overhead press; Front Squat and Pendulum Squat are squats', () => {
    for (const n of ['DB Shoulder Press', 'Front Squat', 'Pendulum Squat']) expect(CATALOG, n).toContain(n);
    expect(muscleVector('DB Shoulder Press')).toEqual(muscleVector('Overhead Press'));
    expect(muscleVector('Front Squat')).toEqual(muscleVector('Barbell Squat'));
    expect(muscleVector('Pendulum Squat')).toEqual(muscleVector('Barbell Squat'));
  });
  it('and their logged spellings read the same', () => {
    for (const n of ['Dumbbell Shoulder Press', 'Seated DB Shoulder Press']) expect(muscleVector(n), n).toEqual(muscleVector('DB Shoulder Press'));
    for (const n of ['Barbell Front Squat', 'Pendulum Squat Machine']) expect(muscleVector(n), n).toEqual(muscleVector('Front Squat'));
  });
});

describe('muscles in words (round 15)', () => {
  it('most-worked first, fractions as written, nothing tracked or unknown said so', () => {
    expect(musclesText({ Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 })).toBe('chest · triceps ½ · front delts ½');
    expect(musclesText({ Biceps: 0.75, Lats: 1 })).toBe('lats · biceps ¾');
    expect(musclesText({})).toBe('no muscle the app tracks');
    expect(musclesText(null)).toBe('muscles unknown');
  });
  it('the Add row: what a new name will count for', () => {
    expect(countsFor('Paused Incline DB Press')).toBe('counts for chest · triceps ½ · front delts ½');
    expect(countsFor('Zercher Thing')).toBe('muscles unknown');
  });
  it('the lift page: muscles, pattern, gear, and a guess said to be one', () => {
    expect(worksLine('Incline DB Press')).toBe('Works chest · triceps ½ · front delts ½ · horizontal press · dumbbells');
    expect(worksLine('Spider Curl Cable')).toBe('Works biceps · cable · guessed from the name');
    expect(worksLine('Hex Bar Deadlift')).toBe('Works hamstrings · glutes ½ · erectors ½ · quads ½ · hinge · trap bar');
    expect(worksLine('Zercher Thing')).toBe('Muscles unknown');
  });
});
