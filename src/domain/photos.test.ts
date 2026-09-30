import { describe, expect, it } from 'vitest';
import { comparePair, fitSize, photoId, timeline, weightNear, type PhotoMeta, type Pose } from './photos';

const m = (date: string, pose: Pose): PhotoMeta => ({ id: photoId(date, pose), date, pose, width: 900, height: 1600, addedAt: `${date}T08:00:00Z` });

describe('fitSize', () => {
  it('fits the long edge, keeps aspect, never upscales', () => {
    expect(fitSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1001, 3, 320)).toEqual({ width: 320, height: 1 });
  });
});

describe('timeline', () => {
  it('groups by date, newest first, poses in front/side/back order', () => {
    const t = timeline([m('2026-09-01', 'back'), m('2026-09-20', 'front'), m('2026-09-01', 'front'), m('2026-09-01', 'side')]);
    expect(t.map((d) => d.date)).toEqual(['2026-09-20', '2026-09-01']);
    expect(t[1].photos.map((p) => p.pose)).toEqual(['front', 'side', 'back']);
  });
});

describe('comparePair', () => {
  it('picks the earliest and latest dates with that pose', () => {
    const xs = [m('2026-08-01', 'front'), m('2026-09-01', 'front'), m('2026-09-20', 'front'), m('2026-09-25', 'side')];
    expect(comparePair(xs, 'front')).toEqual(['2026-08-01', '2026-09-20']);
    expect(comparePair(xs, 'side')).toBeNull();
    expect(comparePair(xs, 'back')).toBeNull();
  });
});

describe('weightNear', () => {
  const pts = [{ date: '2026-09-01', trend: 180 }, { date: '2026-09-05', trend: 181 }, { date: '2026-09-09', trend: 182 }];
  it('uses the nearest trend point within the window, earlier on a tie', () => {
    expect(weightNear('2026-09-05', pts)).toBe(181);
    expect(weightNear('2026-09-07', pts)).toBe(181);
    expect(weightNear('2026-09-12', pts)).toBe(182);
    expect(weightNear('2026-09-20', pts)).toBeNull();
  });
});
