import { describe, expect, it } from 'vitest';
import { copyGym, gymText, parseGymText } from './share';
import type { Gym } from './equipment';

const g: Gym = { id: 'g1', name: 'Downtown Fitness', equipment: ['barbell', 'squat rack', 'cable stack'], exclude: ['Hip Thrust'], include: ['Belt Squat', 'Sled Push'] };

describe('gym text', () => {
  it('round-trips name, equipment, exclude and include', () => {
    const r = parseGymText(gymText(g));
    expect(r).toEqual({ gym: { name: g.name, equipment: g.equipment, exclude: g.exclude, include: g.include }, unknown: [] });
  });
  it('leaves out empty lift lines', () => {
    expect(gymText({ ...g, exclude: [], include: [] })).not.toMatch(/Not here|Also here/);
  });
  it('tolerates case, spacing and text around the block', () => {
    const r = parseGymText('hey try my gym\n\n  gym tracker GYM:  Home  \nequipment:  Barbell ,dumbbells,  ,PULL-UP BAR\n');
    expect(r).toEqual({ gym: { name: 'Home', equipment: ['barbell', 'dumbbells', 'pull-up bar'], exclude: [], include: [] }, unknown: [] });
  });
  it('reports equipment it does not know', () => {
    const r = parseGymText('Gym Tracker gym: X\nEquipment: barbell, hovercraft');
    expect(r).toMatchObject({ gym: { equipment: ['barbell'] }, unknown: ['hovercraft'] });
  });
  it('says so when it is not a copied gym', () => {
    expect(parseGymText('Bench Press 3x8')).toEqual({ error: 'This doesn’t look like a copied gym.' });
  });
});

describe('copyGym', () => {
  it('gives a new id and a name not already used', () => {
    const c = copyGym(g, [g, { ...g, id: 'g2', name: 'Downtown Fitness (2)' }]);
    expect(c.id).not.toBe('g1');
    expect(c.name).toBe('Downtown Fitness (3)');
    expect(c.equipment).toEqual(g.equipment);
    expect(c.equipment).not.toBe(g.equipment);
  });
  it('keeps the name when it is free', () => {
    expect(copyGym(g, []).name).toBe('Downtown Fitness');
  });
});
