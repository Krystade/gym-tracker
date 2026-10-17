import { describe, expect, it } from 'vitest';
import { itemShort, itemText, KEEP_MS, latestOf, messageOk, shortAgo, thread, toClear, unreadOf, type InboxDoc } from './messages';

const p = (id: string, from: string, at: number, e = 'strong'): InboxDoc => ({ id, from, kind: 'p', e, at });
const m = (id: string, from: string, at: number, t: string): InboxDoc => ({ id, from, kind: 'm', t, at });

describe('messages', () => {
  it('words pings and messages, and an unknown ping plainly', () => {
    expect(itemText(p('1', 'a', 0, 'fire'))).toBe('🔥 On fire');
    expect(itemText(p('1', 'a', 0, 'kiss'))).toBe('Ping');
    expect(itemText(m('1', 'a', 0, 'gym at 6?'))).toBe('gym at 6?');
    expect(itemShort(p('1', 'a', 0, 'salute'))).toBe('🫡');
    expect(itemShort(m('1', 'a', 0, 'see you   at the\nsquat rack tonight then'))).toBe('see you at the squat ra…');
  });

  it('merges a thread oldest first, mine and theirs and their gyms, keeping the last 20', () => {
    const t = thread([p('m1', 'me', 10), m('m2', 'me', 30, 'hi')], [p('t1', 'jake', 20, 'clap')], [{ id: 'g1', sent: 25, name: 'Home' }]);
    expect(t.map((x) => [x.id, x.mine, x.kind, x.text])).toEqual([
      ['m1', true, 'p', '💪 Strong'], ['t1', false, 'p', '👏 Nice work'], ['g1', false, 'gym', 'Home'], ['m2', true, 'm', 'hi'],
    ]);
    const many = Array.from({ length: 30 }, (_, i) => p(`x${String(i).padStart(2, '0')}`, 'jake', i));
    expect(thread([], many, []).map((x) => x.id)).toEqual(many.slice(10).map((x) => x.id));
  });

  it('counts unread per friend after their read time, only for friends; finds each one\'s latest', () => {
    const inbox = [p('1', 'jake', 100), p('2', 'jake', 200), m('3', 'jake', 300, 'yo'), p('4', 'ana', 50), p('5', 'gone', 999)];
    expect(unreadOf(inbox, { jake: 150 }, new Set(['jake', 'ana']))).toEqual({ jake: 2, ana: 1 });
    expect(unreadOf(inbox, { jake: 300, ana: 50 }, new Set(['jake', 'ana']))).toEqual({});
    expect(latestOf(inbox).jake.id).toBe('3');
  });

  it('clears what is over 30 days old or from someone no longer a friend', () => {
    const now = 100 * 864e5;
    expect(toClear([p('old', 'jake', now - KEEP_MS - 1), p('new', 'jake', now - 1000), p('ex', 'gone', now)], new Set(['jake']), now)).toEqual(['old', 'ex']);
  });

  it('says how long ago in a few characters', () => {
    const now = 10 * 864e5;
    expect([30e3, 5 * 60e3, 2 * 3600e3, 3 * 864e5].map((d) => shortAgo(now - d, now))).toEqual(['now', '5m', '2h', '3d']);
    expect(shortAgo(now + 5000, now)).toBe('now'); // a clock a little ahead
  });

  it('takes 1 to 140 characters as the rules count them (an emoji like 💪 is two)', () => {
    expect([messageOk(''), messageOk('   '), messageOk('x'), messageOk('x'.repeat(140)), messageOk('x'.repeat(141))]).toEqual([false, false, true, true, false]);
    expect([messageOk('💪'.repeat(70)), messageOk('💪'.repeat(71))]).toEqual([true, false]);
  });
});
