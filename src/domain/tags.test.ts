import { describe, expect, it } from 'vitest';
import { addTag, cleanTag, defaultTags, hasTag, parseTags, removeTag, showTag } from './tags';
import { parseCsv, toCsv } from './csv';
import { buildAppSet } from './buildSet';
import type { SetEntry } from './types';

describe('tags', () => {
  it('adds a tag once, tidied, in the order added', () => {
    let p = addTag(defaultTags(), '  Slow   eccentric ');
    p = addTag(p, 'paused');
    p = addTag(p, 'slow eccentric');
    expect(p.custom).toEqual(['Slow eccentric', 'paused']);
  });
  it('a blank tag adds nothing', () => {
    expect(addTag(defaultTags(), '  ;  ')).toEqual(defaultTags());
  });
  it('a built-in name shows that built-in instead of adding a copy', () => {
    const hidden = showTag(defaultTags(), 'warmup', false);
    expect(hidden.hidden).toEqual(['warmup']);
    expect(hasTag(hidden, 'warm-up')).toBe(false);
    const back = addTag(hidden, 'WARM-UP');
    expect(back.hidden).toEqual([]);
    expect(back.custom).toEqual([]);
    expect(hasTag(back, 'Warm-up')).toBe(true);
  });
  it('hides a built-in once, and shows it again', () => {
    const p = showTag(showTag(defaultTags(), 'test', false), 'test', false);
    expect(p.hidden).toEqual(['test']);
    expect(showTag(p, 'test', true).hidden).toEqual([]);
  });
  it('removes one of their own', () => {
    expect(removeTag(addTag(addTag(defaultTags(), 'a'), 'b'), 'a').custom).toEqual(['b']);
  });
  it('keeps the CSV separator out of a tag, and caps its length', () => {
    expect(cleanTag('a;b')).toBe('a b');
    expect(cleanTag('x'.repeat(40))).toHaveLength(24);
  });
  it('reads a CSV cell without blanks or repeats', () => {
    expect(parseTags(' paused ;; Paused; band ')).toEqual(['paused', 'band']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('a set’s own tags', () => {
  const base: SetEntry = { id: 'sample|2026-01-05|cable curl|1', date: '2026-01-05', seq: 1, exercise: 'Cable Curl', setNo: 1, weight: 60, reps: 12, flags: [], source: 'sample' };
  it('round-trip in a tags column, ;-separated, and an older file without one reads as no tags', () => {
    const text = toCsv([{ ...base, tags: ['paused', 'band, light'] }, { ...base, id: 'sample|2026-01-05|cable curl|2', setNo: 2 }]);
    expect(text.split('\r\n')[0].split(',')).toContain('tags');
    const [a, b] = parseCsv(text).entries;
    expect(a.tags).toEqual(['paused', 'band, light']);
    expect(b).not.toHaveProperty('tags');
    expect(parseCsv('date,exercise,set,weight_lb,reps\n2026-01-05,Cable Curl,1,50,12\n').entries[0]).not.toHaveProperty('tags');
  });
  it('a hand-edited tags cell is tidied', () => {
    expect(parseCsv('date,exercise,set,weight_lb,reps,tags\n2026-01-05,Cable Curl,1,50,12, paused ;;Paused;band\n').entries[0].tags).toEqual(['paused', 'band']);
  });
  it('a logged set keeps the tags picked, and has none when none were', () => {
    const now = new Date('2026-10-02T19:30:00');
    const input = { date: '2026-10-02', exercise: 'Bench Press', weight: 135, reps: 8, flags: [] };
    expect(buildAppSet([], { ...input, tags: ['paused'] }, now).tags).toEqual(['paused']);
    expect(buildAppSet([], { ...input, tags: [] }, now)).not.toHaveProperty('tags');
    expect(buildAppSet([], input, now)).not.toHaveProperty('tags');
  });
});
