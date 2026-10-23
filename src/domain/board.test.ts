import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_AGE_MS, CONTENT_RULES, HIDE_AT, POST_DAYS_MS, cleanPost, gateSteps, heldByReports, mergePosts, nextPostAt, personalWarning,
  postAgo, postError, postOf, rateNext, reviewOrder, rowsOf, shownCount, tally, toggleIn, type Filters, type Post,
} from './board';

const NOW = Date.parse('2026-10-22T18:00:00Z');
const DAY = 864e5;
const p = (id: string, over: Partial<Post> = {}): Post => ({ id, uid: 'u', name: 'u', user: 'u', t: id, at: NOW - 1000, reports: 0, likes: 0, ...over });
const f = (over: Partial<Filters> = {}): Filters => ({ me: 'me', hidden: new Set(), muted: new Set(), blocked: new Set(), ...over });

describe('writing a post', () => {
  it('cleans what was typed: invisible and direction characters out, line ends trimmed, at most one blank line', () => {
    expect(cleanPost('  hi​ there ‮ \n\n\n\nnext\r\n  ')).toBe('hi there\n\nnext');
    expect(cleanPost('é')).toBe('é');
  });
  it('refuses nothing, over 280, and links (as the rules do)', () => {
    expect(postError('')).toMatch(/Write something/);
    expect(postError('x'.repeat(280))).toBeNull();
    expect(postError('x'.repeat(281))).toMatch(/Too long/);
    expect(postError('see https://x.co')).toMatch(/No links/);
    expect(postError('www.shop.com')).toMatch(/No links/);
    expect(postError('5/3/1 and 3x5 at 100kg')).toBeNull();
  });
  it('warns of an email, a phone number or a street address, and not of weights, reps or dates', () => {
    expect(personalWarning('mail me a@b.co')).toMatch(/email/);
    expect(personalWarning('call 555 123 4567')).toMatch(/phone/);
    expect(personalWarning('+44 20 7946 0958')).toMatch(/phone/);
    expect(personalWarning('meet at 12 Baker Street')).toMatch(/street/);
    expect(personalWarning('3x5 at 100 kg, 5 sets of 225 lbs on 2026-10-22')).toBeNull();
    expect(personalWarning('First 100 kg bench today after 14 months.')).toBeNull();
  });
});

describe('the post counter', () => {
  it('60 s apart and 5 a day, by the day that began with the first', () => {
    expect(nextPostAt(null, NOW)).toBeNull();
    expect(nextPostAt({ at: NOW - 30_000, win: NOW - 30_000, n: 1 }, NOW)?.why).toBe('gap');
    expect(nextPostAt({ at: NOW - 61_000, win: NOW - 61_000, n: 1 }, NOW)).toBeNull();
    expect(nextPostAt({ at: NOW - 3600_000, win: NOW - 2 * 3600_000, n: 5 }, NOW)).toEqual({ at: NOW - 2 * 3600_000 + DAY, why: 'day' });
    expect(nextPostAt({ at: NOW - 3600_000, win: NOW - DAY, n: 5 }, NOW)).toBeNull();
  });
  it('counts on within the day, from 1 after it; `flip` judges the edge the other way', () => {
    expect(rateNext(null, NOW)).toEqual({ keep: false, n: 1 });
    expect(rateNext({ at: NOW - 1, win: NOW - 1, n: 2 }, NOW)).toEqual({ keep: true, n: 3 });
    expect(rateNext({ at: NOW - 1, win: NOW - DAY, n: 5 }, NOW)).toEqual({ keep: false, n: 1 });
    expect(rateNext({ at: NOW - 1, win: NOW - DAY, n: 5 }, NOW, true)).toEqual({ keep: true, n: 6 });
  });
});

describe('reading the board', () => {
  it('a post only in shape: nothing written round the app breaks a screen', () => {
    expect(postOf('a', { uid: 'u', user: 'u', t: 'hi', reports: -3, likes: 2.7 }, 5)).toEqual({ id: 'a', uid: 'u', user: 'u', name: 'u', t: 'hi', at: 5, reports: 0, likes: 2 });
    expect(postOf('a', { uid: 'u', user: 'u', t: '' }, 5)).toBeNull();
    expect(postOf('a', { uid: 'u', t: 'x' }, 5)).toBeNull();
    expect(postOf('a', { uid: 'u', user: 'u', t: 'x' }, undefined)).toBeNull();
  });
  it('rows: newest first; hidden, muted, blocked and 30-day-old posts gone; held ones a line for others', () => {
    const posts = [
      p('old', { at: NOW - POST_DAYS_MS }), p('a', { at: NOW - 3 }), p('b', { at: NOW - 1 }), p('hid', { at: NOW - 2 }),
      p('mut', { uid: 'm' }), p('blk', { uid: 'x' }), p('held', { at: NOW - 4, reports: HIDE_AT }), p('mine', { uid: 'me', at: NOW - 5, reports: HIDE_AT }),
    ];
    const rows = rowsOf(posts, f({ hidden: new Set(['hid']), muted: new Set(['m']), blocked: new Set(['x']) }), NOW);
    expect(rows.map((r) => (r.kind === 'post' ? `${r.post.id}${r.held ? '*' : ''}` : `[${r.id}]`))).toEqual(['b', 'a', '[held]', 'mine*']);
    expect(rowsOf(posts, f({ owner: true }), NOW).find((r) => r.kind === 'post' && r.post.id === 'held')).toMatchObject({ held: true });
    expect(shownCount(posts, f(), NOW)).toBe(6);
  });
  it('held at 3 reports since the owner last kept it', () => {
    expect(heldByReports({ reports: 2 })).toBe(false);
    expect(heldByReports({ reports: 3 })).toBe(true);
    expect(heldByReports({ reports: 4, kept: 3 })).toBe(false);
    expect(heldByReports({ reports: 6, kept: 3 })).toBe(true);
  });
  it('merges by id, the newer read winning', () => {
    expect(mergePosts([p('a', { at: 1, likes: 1 }), p('b', { at: 2 })], [p('a', { at: 1, likes: 5 }), p('c', { at: 3 })]).map((x) => `${x.id}${x.likes}`)).toEqual(['c0', 'b0', 'a5']);
  });
  it('an age that never says when someone trains past a day', () => {
    expect(postAgo(NOW - 10_000, NOW)).toBe('now');
    expect(postAgo(NOW - 38 * 60_000, NOW)).toBe('38m');
    expect(postAgo(NOW - 5 * 3600_000, NOW)).toBe('5h');
    expect(postAgo(Date.parse('2026-10-20T07:13:00Z'), NOW)).toBe('Oct 20');
  });
});

describe('the gate', () => {
  const ok = { username: 'me', accepted: true, createdAt: NOW - ACCOUNT_AGE_MS - 1, banned: false };
  it('open past every step; each one missing, in order; banned is all there is', () => {
    expect(gateSteps(ok, NOW)).toEqual([]);
    expect(gateSteps({ ...ok, username: null, accepted: false, createdAt: undefined }, NOW)).toEqual(['username', 'accept', 'age']);
    expect(gateSteps({ ...ok, createdAt: NOW - ACCOUNT_AGE_MS }, NOW)).toEqual(['age']);
    expect(gateSteps({ ...ok, banned: true, username: null }, NOW)).toEqual(['banned']);
  });
  it('the rules: five, the last naming 16+', () => {
    expect(CONTENT_RULES).toHaveLength(5);
    expect(CONTENT_RULES[4]).toMatch(/16\+/);
  });
});

describe('the owner’s review', () => {
  it('a minor at risk first, then held, then most reported; kept-through ones gone', () => {
    const r = (id: string, reports: number, why: Record<string, number>, kept?: number) => ({ post: p(id, { reports, kept }), why });
    const out = reviewOrder([r('one', 1, { spam: 1 }), r('held', 3, { spam: 3 }), r('minor', 1, { sexual: 1 }), r('two', 2, { harass: 2 }), r('kept', 3, { spam: 3 }, 3)]);
    expect(out.map((x) => x.post.id)).toEqual(['minor', 'held', 'two', 'one']);
    expect(tally({ spam: 2, danger: 1 })).toBe('Spam or selling ×2 · Dangerous advice ×1');
  });
  it('a list of yours: added at the end, taken out, the oldest dropped past the cap', () => {
    expect(toggleIn(['a', 'b'], 'a', true, 3)).toEqual(['b', 'a']);
    expect(toggleIn(['a', 'b'], 'a', false, 3)).toEqual(['b']);
    expect(toggleIn(['a', 'b', 'c'], 'd', true, 3)).toEqual(['b', 'c', 'd']);
  });
});
