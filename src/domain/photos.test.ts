import { describe, expect, it } from 'vitest';
import { apartLine, comparePair, coverCrop, fitSize, lastOf, lightVs, meanLuma, photoDayDue, photoId, relaxedIfOld, seeds, shotDates, shotName, SHOTS, timeline, videoType, weightNear, type PhotoMeta, type Pose, type Variant } from './photos';

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
  it('Auto: near the end of each pose, when he has settled into it', () => {
    expect(seeds([0, 4, 8], 12, true)).toEqual([3.6, 7.6, 11.6]);
    expect(seeds([0, 1], 2, true)).toEqual([0.8, 1.8]); // tapped Next early: a fifth before the end
    expect(seeds([0], 0, true)).toEqual([0]);
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

describe('the ghost and the same-light check', () => {
  it('the ghost is the shot’s latest photo, that pose and variant only', () => {
    const ms = [m('2026-10-01', 'front'), m('2026-10-15', 'front'), m('2026-10-20', 'front', 'flexed'), m('2026-10-22', 'side')];
    expect(lastOf(ms, { pose: 'front', variant: 'relaxed' })?.date).toBe('2026-10-15');
    expect(lastOf(ms, { pose: 'front', variant: 'flexed' })?.date).toBe('2026-10-20');
    expect(lastOf(ms, { pose: 'back', variant: 'relaxed' })).toBeNull();
  });
  it('brightness is the mean luma; more than 25 % off last time is said', () => {
    expect(meanLuma([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(127.5, 5);
    expect(meanLuma([])).toBe(0);
    expect(lightVs(100, 100)).toBeNull();
    expect(lightVs(76, 100)).toBeNull();
    expect(lightVs(74, 100)).toBe('darker');
    expect(lightVs(126, 100)).toBe('brighter');
    expect(lightVs(50, 2)).toBeNull();
  });
});

describe('the progress video and the before and after', () => {
  it('takes one shot’s dates, oldest first, within the range', () => {
    const ms = [m('2026-09-20', 'front'), m('2026-08-01', 'front'), m('2026-08-01', 'front', 'flexed'), m('2026-09-01', 'side'), m('2026-10-05', 'front')];
    expect(shotDates(ms, { pose: 'front', variant: 'relaxed' })).toEqual(['2026-08-01', '2026-09-20', '2026-10-05']);
    expect(shotDates(ms, { pose: 'front', variant: 'relaxed' }, '2026-08-02', '2026-09-30')).toEqual(['2026-09-20']);
  });
  it('records MP4 where it can, WebM else, and nothing (the flipbook) with no recorder', () => {
    expect(videoType((t) => t.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1');
    expect(videoType((t) => t === 'video/mp4')).toBe('video/mp4');
    expect(videoType((t) => t === 'video/webm')).toBe('video/webm');
    expect(videoType(() => false)).toBeNull();
    expect(videoType(() => { throw new Error('no'); })).toBeNull();
  });
  it('says how far apart and the PRs between', () => {
    expect(apartLine('2026-08-01', '2026-10-24', 3)).toBe('12 weeks apart · 3 PRs between');
    expect(apartLine('2026-08-01', '2026-08-02', 1)).toBe('1 day apart · 1 PR between');
    expect(apartLine('2026-08-01', '2026-08-11', 0)).toBe('10 days apart · no PRs between');
  });
});

describe('the photo-day line', () => {
  const ms = [m('2026-10-01', 'front'), m('2026-09-01', 'back')];
  it('is due every N days since the last photo, with the days', () => {
    expect(photoDayDue(ms, '2026-10-14', 14)).toBeNull();
    expect(photoDayDue(ms, '2026-10-15', 14)).toBe(14);
    expect(photoDayDue(ms, '2026-10-08', 7)).toBe(7);
  });
  it('never with no photos, when off, or while put off', () => {
    expect(photoDayDue([], '2026-12-01', 14)).toBeNull();
    expect(photoDayDue(ms, '2026-12-01', 0)).toBeNull();
    expect(photoDayDue(ms, '2026-10-20', 14, '2026-10-21')).toBeNull();
    expect(photoDayDue(ms, '2026-10-21', 14, '2026-10-21')).toBe(20);
  });
  it('goes once today’s photos are in', () => {
    expect(photoDayDue([...ms, m('2026-10-20', 'side')], '2026-10-20', 14)).toBeNull();
  });
});
