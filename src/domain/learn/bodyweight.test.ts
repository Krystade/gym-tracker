import { afterEach, describe, expect, it } from 'vitest';
import { LIFTS, setWorksLike } from '../lifts';
import { addedLoad, BODY_SHARE, bodyShare } from './bodyweight';

afterEach(() => setWorksLike([]));

describe('learn/bodyweight: which lifts carry the body, and what was added (item 14)', () => {
  it('every share is a catalog lift, and the shares are the cited ones (frozen: a change here moves every bodyweight level)', () => {
    const names = new Set(LIFTS.map((l) => l.name));
    for (const n of Object.keys(BODY_SHARE)) expect(names.has(n), n).toBe(true);
    expect(BODY_SHARE).toEqual({
      'Push-up': 0.64, 'Weighted Push-up': 0.64, 'Close-Grip Push-up': 0.64, 'Diamond Push-up': 0.64, 'Incline Push-up': 0.55, 'Decline Push-up': 0.7,
      'Forward-Lean Dips': 0.956, 'Upright Dips': 0.956,
      'Pull-up': 0.988, 'Chin-up': 0.988, 'Neutral-Grip Pull-up': 0.988, 'Wide-Grip Pull-up': 0.988, 'Weighted Pull-up': 0.988, 'Weighted Chin-up': 0.988,
      'Bodyweight Squat': 0.878,
    });
  });

  it('a catalog name, another of its names or a lift set to work like one carries its share; a guessed name does not', () => {
    expect(bodyShare('Pull-up')).toBe(0.988);
    expect(bodyShare('pull up')).toBe(0.988); // a spelling that folds to it
    expect(bodyShare('Dips')).toBe(0.956); // another name of Forward-Lean Dips
    expect(bodyShare('Air Squat')).toBe(0.878);
    expect(bodyShare('Archer Pulls')).toBeNull(); // read from its words only
    expect(bodyShare('Assisted Pull-up')).toBeNull(); // a machine's stack is help, whichever way it was logged
    expect(bodyShare('Hanging Leg Raise')).toBeNull(); // no measured share: reps only, as before
    expect(bodyShare('Bench Dip')).toBeNull();
    expect(bodyShare('Lat Pulldown')).toBeNull();
    expect(bodyShare('Ring Dips')).toBeNull();
    setWorksLike([['Ring Dips', 'Forward-Lean Dips']]);
    expect(bodyShare('Ring Dips')).toBe(0.956);
  });

  it('added load: the signed weight, or the help an older import kept in the note of a set at 0', () => {
    expect(addedLoad({ weight: 25 })).toBe(25);
    expect(addedLoad({ weight: -30 })).toBe(-30);
    expect(addedLoad({ weight: 0 })).toBe(0);
    expect(addedLoad({ weight: 0, note: 'assisted -20 lb' })).toBe(-20);
    expect(addedLoad({ weight: 0, note: 'assisted -37.5 lb; Stopped after 3 sets' })).toBe(-37.5);
    expect(addedLoad({ weight: 0, note: 'Much harder after pushdowns' })).toBe(0);
    // A logged weight wins over words in its note.
    expect(addedLoad({ weight: -10, note: 'assisted -20 lb' })).toBe(-10);
  });
});
