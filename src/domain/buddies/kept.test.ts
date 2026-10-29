import { describe, expect, it } from 'vitest';
import { isBuddyKey, mergeBuddyItem, mergeBuddyMeta, NAME_MAX, parseBuddies, parseLead } from './kept';
import { BUDDIES } from './roster';
import { rng, starter } from './gacha';
import { mergeMeta, metaHash } from '../cloud';

const [b0, b1, b2] = BUDDIES.map((b) => b.id);

describe('Gym Buddies’ kept items, read as untrusted', () => {
  it('prefs: names trimmed and cut, unknown slots and bad ids dropped, no time no prefs', () => {
    expect(parseBuddies({ [b0]: { name: `  ${'n'.repeat(30)} `, equip: { held: 'sword', hat: 'x', aura: 3 }, at: 5 }, 'bad id!': { at: 1 }, [b1]: { name: 'x' }, [b2]: null }))
      .toEqual({ [b0]: { name: 'n'.repeat(NAME_MAX), equip: { held: 'sword' }, at: 5 } });
    expect(parseBuddies([{ at: 1 }])).toEqual({});
    expect(parseLead({ id: b0, at: 1 })).toEqual({ id: b0, at: 1 });
    expect(parseLead({ id: b0 })).toBeNull();
    expect(parseLead(b0)).toBeNull();
  });
  it('the keys that are Gym Buddies’', () => {
    expect(['buddies', 'buddy-lead', 'buddy-start', 'spend:a1'].every(isBuddyKey)).toBe(true);
    expect(['spend:', 'achievements', 'status', 'buddy'].some(isBuddyKey)).toBe(false);
  });
});

describe('merging two phones’ items', () => {
  it('start: the earliest day; a side that isn’t a day loses', () => {
    expect(mergeBuddyItem('buddy-start', '2026-10-29', '2026-10-20')).toBe('2026-10-20');
    expect(mergeBuddyItem('buddy-start', 'soon', '2026-10-20')).toBe('2026-10-20');
  });
  it('lead: the later pick', () => {
    expect(mergeBuddyItem('buddy-lead', { id: b0, at: 2 }, { id: b1, at: 3 })).toEqual({ id: b1, at: 3 });
    expect(mergeBuddyItem('buddy-lead', { id: b0, at: 4 }, { id: b1, at: 3 })).toEqual({ id: b0, at: 4 });
  });
  it('prefs: per buddy, so a change on each phone to a different buddy keeps both', () => {
    expect(mergeBuddyItem('buddies', { [b0]: { name: 'A', at: 9 }, [b1]: { at: 1 } }, { [b0]: { name: 'Z', at: 3 }, [b1]: { name: 'B', at: 4 }, [b2]: { at: 2 } }))
      .toEqual({ [b0]: { name: 'A', at: 9 }, [b1]: { name: 'B', at: 4 }, [b2]: { at: 2 } });
  });
  it('a spend is kept as stored; a malformed one, or one under another id, is dropped', () => {
    const s = starter(b0, 1, '2026-10-28', 's1');
    expect(mergeBuddyItem('spend:s1', { id: 's1' }, s)).toBe(s);
    expect(mergeBuddyMeta({ 'spend:s1': { id: 's1' }, status: 'x' }, {})).toEqual({});
    expect(mergeBuddyMeta({}, { 'spend:s1': s, 'spend:s2': s })).toEqual({ 'spend:s1': s });
  });
  it('property: either order gives the same result, and merging again changes nothing (phones converge)', () => {
    const r = rng(7), ids = [b0, b1, b2], day = () => `2026-10-${String(10 + Math.floor(r() * 20)).padStart(2, '0')}`;
    const side = () => ({
      'buddy-start': day(), 'buddy-lead': { id: ids[Math.floor(r() * 3)], at: Math.floor(r() * 5) },
      buddies: Object.fromEntries(ids.filter(() => r() < 0.7).map((id) => [id, { ...(r() < 0.5 && { name: `n${Math.floor(r() * 3)}` }), at: Math.floor(r() * 4) }])),
    });
    let differed = 0;
    for (let i = 0; i < 500; i++) {
      const a = side(), b = side(), ab = mergeBuddyMeta(a, b);
      if (metaHash(ab) !== metaHash(mergeBuddyMeta(a, a))) differed++;
      expect(metaHash(ab)).toBe(metaHash(mergeBuddyMeta(b, a)));
      expect(metaHash(mergeBuddyMeta(ab, a))).toBe(metaHash(ab));
      expect(metaHash(mergeBuddyMeta(ab, b))).toBe(metaHash(ab));
    }
    expect(differed).toBeGreaterThan(400); // the sides really disagreed
  });
  it('the account sync merges them the same way: a rename on each phone, to different buddies, both stay', () => {
    const seen = { buddies: metaHash({ [b0]: { at: 1 }, [b1]: { at: 1 } }) };
    const mine = { buddies: { [b0]: { name: 'Rex', at: 5 }, [b1]: { at: 1 } } };
    const cloud = { buddies: { [b0]: { at: 1 }, [b1]: { name: 'Bee', at: 6 } } };
    const m = mergeMeta(mine, cloud, seen);
    expect(m.items.buddies).toEqual({ [b0]: { name: 'Rex', at: 5 }, [b1]: { name: 'Bee', at: 6 } });
    expect(m.pull.buddies).toEqual(m.items.buddies);
    expect(m.changed).toBe(true);
    expect(mergeMeta({ 'buddy-start': '2026-10-29' }, { 'buddy-start': '2026-10-21' }, {}).pull).toEqual({ 'buddy-start': '2026-10-21' });
  });
});
