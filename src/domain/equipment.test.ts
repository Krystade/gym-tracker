import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { availableSet, canDo, NEEDS, type Gym } from './equipment';

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
