import { describe, expect, it } from 'vitest';
import { comparePair, coverCrop, fitSize, photoId, relaxedIfOld, seeds, shotName, SHOTS, timeline, weightNear, type PhotoMeta, type Pose, type Variant } from './photos';

const m = (date: string, pose: Pose, variant: Variant = 'relaxed'): PhotoMeta => ({ id: photoId(date, pose, variant), date, pose, variant, width: 900, height: 1600, addedAt: `${date}T08:00:00Z` });

describe('fitSize', () => {
  it('fits the long edge, keeps aspect, never upscales', () => {
    expect(fitSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1001, 3, 320)).toEqual({ width: 320, height: 1 });
  });
});

describe('the routine', () => {
  it('walks each pose relaxed then flexed, front to back; relaxed is named as the plain pose', () => {
    expect(SHOTS.map(shotName)).toEqual(['Front', 'Front flexed', 'Side', 'Side flexed', 'Back', 'Back flexed']);
  });
  it('a photo from before variants is relaxed under its new id; one with a variant is left as it is', () => {
    const old = { id: '2026-09-01:side', date: '2026-09-01', pose: 'side' as const, width: 1, height: 1, addedAt: 'x' };
    expect(relaxedIfOld(old)).toEqual({ ...old, id: '2026-09-01:side:relaxed', variant: 'relaxed' });
    const flexed = m('2026-09-01', 'side', 'flexed');
    expect(relaxedIfOld(flexed)).toBe(flexed);
  });
});

describe('timeline', () => {
  it('groups by date, newest first, in the routine’s order', () => {
    const t = timeline([m('2026-09-01', 'back'), m('2026-09-20', 'front'), m('2026-09-01', 'front', 'flexed'), m('2026-09-01', 'side'), m('2026-09-01', 'front')]);
    expect(t.map((d) => d.date)).toEqual(['2026-09-20', '2026-09-01']);
    expect(t[1].photos.map(shotName)).toEqual(['Front', 'Front flexed', 'Side', 'Back']);
  });
});

describe('comparePair', () => {
  it('picks the earliest and latest dates with that pose and variant', () => {
    const xs = [m('2026-08-01', 'front'), m('2026-09-01', 'front'), m('2026-09-20', 'front'), m('2026-09-25', 'side'), m('2026-09-25', 'front', 'flexed')];
    expect(comparePair(xs, 'front', 'relaxed')).toEqual(['2026-08-01', '2026-09-20']);
    expect(comparePair(xs, 'front', 'flexed')).toBeNull();
    expect(comparePair([...xs, m('2026-10-02', 'front', 'flexed')], 'front', 'flexed')).toEqual(['2026-09-25', '2026-10-02']);
    expect(comparePair(xs, 'side', 'relaxed')).toBeNull();
    expect(comparePair(xs, 'back', 'relaxed')).toBeNull();
  });
});

describe('coverCrop', () => {
  it('takes the middle at the aspect, as object-fit: cover shows it', () => {
    expect(coverCrop(1080, 1920, 3 / 4)).toEqual({ x: 0, y: 240, width: 1080, height: 1440 }); // a portrait phone frame: top and bottom go
    expect(coverCrop(1920, 1080, 3 / 4)).toEqual({ x: 555, y: 0, width: 810, height: 1080 }); // landscape: the sides go
    expect(coverCrop(600, 800, 3 / 4)).toEqual({ x: 0, y: 0, width: 600, height: 800 });
  });
});

describe('seeds', () => {
  it('starts each shot’s scrubber in the middle of its time on screen; shots never reached get none', () => {
    expect(seeds([0, 10, 16], 30)).toEqual([5, 13, 23]);
    expect(seeds([0], 8)).toEqual([4]);
    expect(seeds([], 8)).toEqual([]);
    expect(seeds([0, 4], 3)).toEqual([1.5, 3]); // a mark past the end (the clocks a hair apart) stays in the recording
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

describe('photoDate', () => {
  it('files a camera shot under today whatever the date field says, and a library photo under the field', async () => {
    const { photoDate } = await import('./photos');
    expect(photoDate('camera', '2026-08-01', '2026-09-30')).toBe('2026-09-30');
    expect(photoDate('library', '2026-08-01', '2026-09-30')).toBe('2026-08-01');
    expect(photoDate('library', '2026-10-05', '2026-09-30')).toBeNull();
    expect(photoDate('library', '', '2026-09-30')).toBe('2026-09-30');
  });
});
