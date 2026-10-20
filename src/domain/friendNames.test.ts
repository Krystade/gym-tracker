import { describe, expect, it } from 'vitest';
import { CHANGE_GAP_MS, cleanTag, FORMERLY_MS, formerlyOf, MAX_TAG, nextChangeAt, tagged, tagNote } from './friendNames';

const DAY = 864e5;

describe('cleanTag', () => {
  it('trims, folds runs of space and drops control characters', () => {
    expect(cleanTag('  Sam   (gym)\n')).toBe('Sam (gym)');
    expect(cleanTag('a\u0000b\tc')).toBe('a b c');
    expect(cleanTag('   ')).toBe('');
  });
  it('is at most MAX_TAG characters as a person counts them, never half an emoji', () => {
    const long = 'x'.repeat(MAX_TAG + 10);
    expect(cleanTag(long)).toHaveLength(MAX_TAG);
    const emoji = '💪'.repeat(MAX_TAG + 1);
    expect([...cleanTag(emoji)]).toHaveLength(MAX_TAG);
  });
});

describe('tagged', () => {
  it('puts your tag beside their @username; without one, the @username alone', () => {
    expect(tagged('sam_k', 'Sam (gym)')).toBe('Sam (gym) · @sam_k');
    expect(tagged('sam_k', '')).toBe('@sam_k');
    expect(tagged('sam_k')).toBe('@sam_k');
  });
});

describe('formerlyOf', () => {
  const now = Date.UTC(2026, 9, 20);
  it('names the old username for 30 days after a change', () => {
    expect(formerlyOf({ prev: 'sammy', changedAt: now - DAY }, now)).toBe('sammy');
    expect(formerlyOf({ prev: 'sammy', changedAt: now - FORMERLY_MS + 1 }, now)).toBe('sammy');
  });
  it('then nothing; nor for a name never changed', () => {
    expect(formerlyOf({ prev: 'sammy', changedAt: now - FORMERLY_MS }, now)).toBeNull();
    expect(formerlyOf({}, now)).toBeNull();
    expect(formerlyOf({ prev: 'sammy' }, now)).toBeNull();
  });
});

describe('nextChangeAt', () => {
  it('a day after the last change; none for a name never changed or a day gone', () => {
    const now = 1_000 * DAY;
    expect(nextChangeAt(now - 3600_000, now)).toBe(now - 3600_000 + CHANGE_GAP_MS);
    expect(nextChangeAt(now - CHANGE_GAP_MS - 1, now)).toBeNull();
    expect(nextChangeAt(undefined, now)).toBeNull();
  });
});

describe('tagNote', () => {
  it('a ping or message: its title is the sender, so the title takes the tag', () => {
    expect(tagNote({ title: 'sam_k', body: '💪' }, 'ping', 'sam_k', 'Sam (gym)')).toEqual({ title: 'Sam (gym) · @sam_k', body: '💪' });
    // A message that happens to say their name keeps it as written.
    expect(tagNote({ title: 'sam_k', body: 'sam_k here' }, 'message', 'sam_k', 'Sam')).toEqual({ title: 'Sam · @sam_k', body: 'sam_k here' });
  });
  it('a request, a new friend, a gym: the name in the body takes it', () => {
    expect(tagNote({ title: 'Friend request', body: 'sam_k wants to be friends' }, 'request', 'sam_k', 'Sam')).toEqual({ title: 'Friend request', body: 'Sam · @sam_k wants to be friends' });
    expect(tagNote({ title: 'New friend', body: 'You and sam_k are friends' }, 'accepted', 'sam_k', 'Sam').body).toBe('You and Sam · @sam_k are friends');
    expect(tagNote({ title: 'Gym shared', body: 'sam_k sent you a gym: sam_k’s garage' }, 'gym', 'sam_k', 'Sam').body).toBe('Sam · @sam_k sent you a gym: sam_k’s garage');
  });
  it('no tag, no name, or a name the note doesn’t hold: as it came', () => {
    const n = { title: 'Friend request', body: 'sam_k wants to be friends' };
    expect(tagNote(n, 'request', 'sam_k', '')).toBe(n);
    expect(tagNote(n, 'request', undefined, 'Sam')).toBe(n);
    expect(tagNote(n, 'request', 'bob', 'Bob')).toBe(n);
    expect(tagNote({ title: 'Rest done', body: 'Bench' }, 'rest', 'sam_k', 'Sam')).toEqual({ title: 'Rest done', body: 'Bench' });
  });
  it('matches the whole name only, not inside a longer one', () => {
    expect(tagNote({ title: 'Friend request', body: 'sam_kk wants to be friends' }, 'request', 'sam_k', 'Sam').body).toBe('sam_kk wants to be friends');
  });
});
