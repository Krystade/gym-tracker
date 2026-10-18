import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { availableSet, canDo, EQUIPMENT, EQUIPMENT_GROUPS, gearOf, NEEDS, type Gym } from './equipment';

const gym = (equipment: Gym['equipment'], over: Partial<Gym> = {}): Gym => ({ id: 'g', name: 'G', equipment, exclude: [], include: [], ...over });

describe('equipment', () => {
  it('knows the gear for every catalog exercise', () => {
    expect(CATALOG.filter((n) => !(n in NEEDS))).toEqual([]);
  });
  it('allows a lift when any alternative is fully present', () => {
    expect(canDo(gym(['dumbbells']), 'DB Curl')).toBe(true);
    expect(canDo(gym(['dumbbells']), 'Cable Curl')).toBe(false);
    expect(canDo(gym(['cable stack']), 'cable curl')).toBe(true);
    expect(canDo(gym(['barbell']), 'Bench Press')).toBe(false);
    expect(canDo(gym(['barbell', 'flat bench']), 'Bench Press')).toBe(true);
    expect(canDo(gym([]), 'Plank')).toBe(true);
  });
  it('a deadlift needs a barbell', () => {
    expect(canDo(gym(['barbell']), 'Deadlift')).toBe(true);
    expect(canDo(gym(['dumbbells']), 'Deadlift')).toBe(false);
  });
  it('a landmine needs a bar in it', () => {
    expect(canDo(gym(['landmine']), 'Landmine Press')).toBe(false);
    expect(canDo(gym(['landmine', 'barbell']), 'Landmine Press')).toBe(true);
    expect(canDo(gym(['landmine', 'barbell']), 't-bar row')).toBe(true);
  });
  it('lets exclusions beat the gear, and inclusions cover unknown lifts', () => {
    expect(canDo(gym(['cable stack'], { exclude: ['Cable Curl'] }), 'Cable Curl')).toBe(false);
    expect(canDo(gym([]), 'Zercher Squat')).toBeNull();
    expect(canDo(gym([], { include: ['zercher squat'] }), 'Zercher Squat')).toBe(true);
  });
  it('treats no gym as everything available', () => {
    expect(canDo(null, 'Leg Press')).toBe(true);
    expect(availableSet(gym(['leg press']), ['Leg Press', 'Leg Extension', 'Zercher Squat'])).toEqual(new Set(['Leg Press']));
  });
});

describe('equipment review fixes', () => {
  it('counts a dual cable station as a cable stack', () => {
    for (const ex of ['Cable Curl', 'Face Pull', 'Cable Pushdown']) expect(canDo(gym(['dual cable']), ex), ex).toBe(true);
  });
});

describe('round 13 lifts', () => {
  it('a DB shoulder press needs dumbbells; a front squat a barbell in a rack; a pendulum squat its machine', () => {
    expect(canDo(gym(['dumbbells']), 'DB Shoulder Press')).toBe(true);
    expect(canDo(gym(['barbell', 'squat rack']), 'DB Shoulder Press')).toBe(false);
    expect(canDo(gym(['barbell', 'squat rack']), 'Front Squat')).toBe(true);
    expect(canDo(gym(['barbell']), 'Front Squat')).toBe(false);
    expect(canDo(gym(['pendulum squat']), 'Pendulum Squat')).toBe(true);
    expect(canDo(gym(['leg press', 'smith machine', 'barbell', 'squat rack']), 'Pendulum Squat')).toBe(false);
  });
  it('the pendulum squat is gear a gym can tick, with the machines', () => {
    expect(EQUIPMENT).toContain('pendulum squat');
    expect(EQUIPMENT_GROUPS.find(([g]) => g === 'Machines')![1]).toContain('pendulum squat');
    expect(gearOf('Pendulum Squat')).toBe('machine');
    expect(gearOf('Front Squat')).toBe('barbell');
    expect(gearOf('DB Shoulder Press')).toBe('dumbbells');
  });
});
