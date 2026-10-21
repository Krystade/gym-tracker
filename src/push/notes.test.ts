import { describe, expect, it } from 'vitest';
import { tagNote } from '../domain/friendNames';
import { acceptedNote, clip, gymNote, MAX_BODY, MAX_TITLE, painNote, PAIN_REGIONS, pingNote, recapNote, remindNote, requestNote, restNote, testNote } from './payload';

// What iOS shows of a notification on the lock screen and in a banner of the 13 mini: one line of title (about 30 characters)
// and about two lines of body. Owner, 2026-10-20: cut-off texts. Every kind, with its longest inputs.
const LIFT = 'Single-Arm Cable Lateral Raise with a Long Name Here'; // over every limit
const NAME = 'abcdefghij_klmnopqrst'.slice(0, 20); // a username's most: 20
const TAG = 'Sam from the early gym x'; // a tag's most: 24
const len = (s: string) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;

describe('notification texts fit the lock screen', () => {
  const notes = [
    ['test', testNote()], ['rest', restNote(`${'Next: '}${LIFT}`)], ['rest, set', restNote(`${LIFT} · set 12 next`)], ['rest, none', restNote()],
    ['remind', remindNote(LIFT.slice(0, 40))], ['recap', recapNote({ sessions: 7, sets: 999, prs: 99, cardio: 7 })],
    ...PAIN_REGIONS.map((r) => [`pain ${r}`, painNote([{ region: r, lift: LIFT }])] as const),
    ['request', tagNote(requestNote(NAME), 'request', NAME, TAG)], ['accepted', tagNote(acceptedNote(NAME), 'accepted', NAME, TAG)],
    ['gym', tagNote(gymNote(NAME, 'x'.repeat(80)), 'gym', NAME, TAG)], ['ping', tagNote(pingNote(NAME, 'strong'), 'ping', NAME, TAG)],
  ] as const;
  it.each(notes)('%s: a title of 30 characters or fewer, a body of two lines', (_, n) => {
    expect(len(n.title), n.title).toBeLessThanOrEqual(MAX_TITLE);
    expect(len(n.body), n.body).toBeLessThanOrEqual(MAX_BODY);
    expect(n.body.length).toBeGreaterThan(0);
  });
  it('the limits are the lock screen’s, not whatever the code allows', () => {
    expect(MAX_TITLE).toBeLessThanOrEqual(30);
    expect(MAX_BODY).toBeLessThanOrEqual(90);
  });
  it('a ping from a long tag and name: the tag is the title, the @name leads the body', () => {
    expect(tagNote(pingNote(NAME, 'strong'), 'ping', NAME, TAG)).toEqual({ title: TAG, body: `@${NAME} · 💪` });
    // Short enough, as it was.
    expect(tagNote(pingNote('sam_k', 'strong'), 'ping', 'sam_k', 'Sam')).toEqual({ title: 'Sam · @sam_k', body: '💪' });
  });
});

describe('clip', () => {
  it('leaves what fits alone', () => expect(clip('Cable Pushdown', 40)).toBe('Cable Pushdown'));
  it('cuts at a word, with an ellipsis, never mid-word', () => {
    const c = clip('Dumbbell Single-Arm Row on an Incline Bench', 20);
    expect(c).toBe('Dumbbell Single-Arm…');
    expect(len(c)).toBeLessThanOrEqual(20);
  });
  it('a single word too long for the room is cut, with the ellipsis', () => expect(clip('Supercalifragilistic', 8)).toBe('Superca…'));
  it('drops a trailing separator before the ellipsis', () => expect(clip('Bench Press · set 4 next', 14)).toBe('Bench Press…'));
});

describe('the morning pain push names everything that hurt yesterday', () => {
  // Every set of regions (63 of them), each on its own long-named lift, and one lift that hurt two regions.
  const subsets = Array.from({ length: (1 << PAIN_REGIONS.length) - 1 }, (_, m) => PAIN_REGIONS.filter((_, i) => (m + 1) & (1 << i)));
  it.each(subsets.map((rs) => [rs.join(' + '), rs] as const))('%s: every region in the title or body, one line and two', (_, rs) => {
    const n = painNote(rs.map((region, i) => ({ region, lift: i % 2 ? LIFT : 'Cable Pushdown' })));
    for (const r of rs) if (r !== 'other') expect(`${n.title} ${n.body}`.toLowerCase(), r).toContain(r);
    if (rs.length === 1 && rs[0] === 'other') expect(n.title).toBe('How’s the pain this morning?');
    expect(len(n.title), n.title).toBeLessThanOrEqual(MAX_TITLE);
    expect(len(n.body), n.body).toBeLessThanOrEqual(MAX_BODY);
  });
  it('one region, two, more', () => {
    expect(painNote([{ region: 'elbow', lift: 'Cable Pushdown' }])).toEqual({ title: 'How’s your elbow this morning?', body: 'After Cable Pushdown yesterday · settled, still sore or worse?' });
    expect(painNote([{ region: 'elbow', lift: 'Cable Pushdown' }, { region: 'knee', lift: 'Leg Press' }]).title).toBe('Morning pain check');
    expect(painNote([{ region: 'elbow', lift: 'Cable Pushdown' }, { region: 'knee', lift: 'Leg Press' }]).body).toBe('Elbow, knee: after Cable Pushdown, Leg Press yesterday · tap to answer');
    expect(painNote([{ region: 'elbow', lift: 'Cable Pushdown' }, { region: 'elbow', lift: 'Overhead Press' }])).toEqual({ title: 'How’s your elbow this morning?', body: 'After Cable Pushdown, Overhead Press yesterday · tap to answer' });
  });
});
