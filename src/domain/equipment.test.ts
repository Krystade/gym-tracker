import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { availableSet, canDo, EQUIPMENT, EQUIPMENT_GROUPS, GEAR_VERSION, gearOf, NEEDS, NEW_GEAR, unasked, type Gym } from './equipment';

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
    expect(canDo(gym([]), 'Atlas Stone')).toBeNull();
    expect(canDo(gym([], { include: ['atlas stone'] }), 'Atlas Stone')).toBe(true);
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

describe('gear added after a gym was set up (round 15)', () => {
  it('is new gear, at the end of the list, in a group', () => {
    expect(EQUIPMENT.slice(-NEW_GEAR.length)).toEqual(NEW_GEAR);
    for (const e of NEW_GEAR) expect(EQUIPMENT_GROUPS.some(([, items]) => items.includes(e)), e).toBe(true);
  });
  it('counts as maybe at a gym set up before it: a lift it would make possible is neither there nor missing', () => {
    const old = gym(['dumbbells', 'barbell', 'flat bench']);
    expect(unasked(old)).toEqual(NEW_GEAR);
    expect(canDo(old, 'EZ-Bar Curl')).toBeNull();
    expect(canDo(old, 'Trap Bar Deadlift')).toBeNull();
    expect(canDo(old, 'EZ-Bar Skullcrusher')).toBeNull();
    // Something the new gear doesn't help with is still missing.
    expect(canDo(old, 'Cable Curl')).toBe(false);
    expect(canDo(old, 'Incline DB Fly')).toBe(false);
    // And what the gym already had still counts.
    expect(canDo(old, 'Barbell Curl')).toBe(true);
    // Ticked: there.
    expect(canDo(gym(['ez bar']), 'EZ-Bar Curl')).toBe(true);
    expect(unasked(gym(['ez bar']))).not.toContain('ez bar');
  });
  it('once the gym is checked against the new list, gear it doesn’t tick is missing', () => {
    const checked = gym(['dumbbells'], { gearVersion: GEAR_VERSION });
    expect(unasked(checked)).toEqual([]);
    expect(canDo(checked, 'EZ-Bar Curl')).toBe(false);
    expect(canDo(checked, 'Hack Squat')).toBe(false);
  });
  it('a maybe never makes a lift available to the program builder', () => {
    expect([...availableSet(gym(['dumbbells']), ['EZ-Bar Curl', 'DB Curl'])]).toEqual(['DB Curl']);
  });
});
