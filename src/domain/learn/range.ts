import { resolveLift } from '../lifts';
import { tagsOf } from './tags';

// Item 03: the rep range a lift progresses through, fitted to how far one weight step drops it (03-rep-ranges §3).
//
// (a) Growth is about equal anywhere from ~5 to ~30 reps when sets end near failure (Schoenfeld 2017, JSCR 31:3508; Lopez 2021,
// MSSE 53:1206; Lees 2025, J Physiol; Cumming 2025, J Appl Physiol 139:685), so a range is moved for mechanics, never for
// "growth": it must be wide enough that the first session at the next weight still lands inside it.
// (b) How far a step drops this lift: its learned drop (learn/jump), from his own weight increases.
// The rule (03 §3.2): landing = top − drop. Fits when landing ≥ bottom. If not, first raise the top (keep adding reps at this
// weight before going up), else lower the bottom, each inside the lift class's evidence envelope; if neither fits, the range
// stays and the reason says the step is too big for it. A smaller step (03 §3.2 step 1) is the ladder's job (learn/ladder).

/**
 * (a) Evidence envelope per class (03 §3.1). Barbell/Smith compounds 5–15: strength-relevant, high reps technique- and
 * cardio-limited (Nuckols, SBS "Hypertrophy range"; Schoenfeld 2021, Sports 9:32). Other compounds 6–20. Isolation 8–25: 25 reps
 * is ~55 % e1RM, above the ~30 % 1RM floor for growth (Lasevicius 2018, EJSS 18:772), and reps-in-reserve judgement degrades
 * past 12–15 reps (Halperin 2022, Sports Med 52:377), so not 30.
 */
export function envelope(exercise: string): { floor: number; cap: number } {
  if (resolveLift(exercise).iso) return { floor: 8, cap: 25 };
  const imp = tagsOf(exercise).imp;
  return imp === 'barbell' || imp === 'smith' ? { floor: 5, cap: 15 } : { floor: 6, cap: 20 };
}

export interface RangeFit {
  repMin: number; repMax: number;
  /** 'fits': unchanged; 'top': top raised; 'bottom': bottom lowered; 'too-big': no range in the envelope absorbs the step. */
  how: 'fits' | 'top' | 'bottom' | 'too-big';
}

/** The range to progress through, given the lift's set range and its learned drop at the next step (reps). */
export function fitRange(exercise: string, range: { repMin: number; repMax: number }, drop: number): RangeFit {
  const { repMin, repMax } = range;
  if (repMax - drop >= repMin) return { repMin, repMax, how: 'fits' };
  const { floor, cap } = envelope(exercise);
  const top = Math.ceil(repMin + drop);
  if (top <= cap) return { repMin, repMax: Math.max(repMax, top), how: 'top' };
  const bottom = Math.floor(repMax - drop);
  if (bottom >= floor) return { repMin: Math.min(repMin, bottom), repMax, how: 'bottom' };
  return { repMin, repMax, how: 'too-big' };
}
