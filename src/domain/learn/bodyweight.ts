import { liftFactsVersion, resolveLift, words } from '../lifts';
import type { SetEntry } from '../types';

// Item 14: lifts whose load is the body. A set's weight stays what was added to it (signed: + a belt or a plate, 0 bodyweight,
// − the help of an assisted machine or a band); what the body adds is worked out when it is read, never stored (14 §3).
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default that only holds back.

/**
 * (a) The share of body mass each catalog lift moves (14 §2):
 * - push-ups: peak ground reaction force as a share of body mass, force plate (Ebben et al. 2011, ISBS 29): 0.64 standard,
 *   0.55 hands raised 30 cm, 0.70 feet raised 30 cm (the app doesn't know the box, so the 30 cm figures). Grip width moves the
 *   hands, not the body's lever between hands and feet, so close-grip and diamond push-ups take the standard share.
 * - dips: the whole body less both hands and forearms, which stay on the bars: 1 − 2·(0.006 + 0.016) (Dempster's segment
 *   masses as tabled by Winter 2009, Biomechanics and Motor Control of Human Movement, table 4.1).
 * - pull-ups and chin-ups: the whole body less both hands, the only segments that don't move: 1 − 2·0.006 (the same table).
 * - bodyweight squat: the body less both shanks and feet, 1 − 2·(0.0465 + 0.0145) (the same table).
 * Nothing else: an inverted row, a bench dip, a leg raise or a Nordic curl moves a share that depends on angle and foot
 * position, and none is measured (14 §2), so those stay reps-only lifts as before.
 */
const PUSH = 0.64, PUSH_INCLINE = 0.55, PUSH_DECLINE = 0.7;
const r3 = (x: number) => Math.round(x * 1000) / 1000; // the table's own precision
const DIP = r3(1 - 2 * (0.006 + 0.016)), HANG = r3(1 - 2 * 0.006), SQUAT = r3(1 - 2 * (0.0465 + 0.0145));
export const BODY_SHARE: Readonly<Record<string, number>> = {
  'Push-up': PUSH, 'Weighted Push-up': PUSH, 'Close-Grip Push-up': PUSH, 'Diamond Push-up': PUSH,
  'Incline Push-up': PUSH_INCLINE, 'Decline Push-up': PUSH_DECLINE,
  'Forward-Lean Dips': DIP, 'Upright Dips': DIP,
  'Pull-up': HANG, 'Chin-up': HANG, 'Neutral-Grip Pull-up': HANG, 'Wide-Grip Pull-up': HANG, 'Weighted Pull-up': HANG, 'Weighted Chin-up': HANG,
  'Bodyweight Squat': SQUAT,
};

const SHARES = new Map<string, number | null>();
let sharesVersion = -1;
/**
 * The share of body mass a lift moves (BODY_SHARE), for a name that is that catalog lift, one of its other names, or a lift set to
 * work like it; null for anything else. A name only guessed from its words ("Archer Pulls") doesn't inherit one: its share isn't
 * known (14 §6). Nor does an assisted machine by name ("Assisted Pull-up"): the number on its stack is help, logged either way.
 */
export function bodyShare(name: string): number | null {
  const fv = liftFactsVersion();
  if (fv !== sharesVersion) { SHARES.clear(); sharesVersion = fv; }
  let f = SHARES.get(name);
  if (f === undefined) {
    const r = resolveLift(name);
    f = r.lift && r.how !== 'built' && r.how !== 'none' && !words(name).includes('assisted') ? BODY_SHARE[r.lift.name] ?? null : null;
    if (SHARES.size >= 2000) SHARES.clear();
    SHARES.set(name, f);
  }
  return f;
}

/** The note the paste import writes for "−20 × 10" (domain/notes): help it kept as words, on a set logged at weight 0. */
const ASSISTED = /\bassisted -(\d+(?:\.\d+)?) lb\b/;
/**
 * What was added to the body, lb: the set's weight, signed (+ added, 0 bodyweight, − help), or for a set at 0 the help its note
 * records ("assisted -30 lb", as older imports kept it). Read, never written back: the set is left as it was logged.
 */
export function addedLoad(e: Pick<SetEntry, 'weight' | 'note'>): number {
  if (e.weight !== 0 || !e.note) return e.weight;
  const m = ASSISTED.exec(e.note);
  return m ? -Number(m[1]) : 0;
}
