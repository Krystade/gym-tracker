// What remains of the pace layer (00-core §3; its fit, paceOf, went 2026-11-22: nothing read it, and learn/session forecasts a
// session's length better): the two numbers learn/session and learn/switch pool their gaps with.

/** Gaps in total before the person level replaces the defaults (00-core §3). */
export const PERSON_MIN = 3;
/**
 * (c) Prior for the pooling only: a lift's usual gap may sit ~30 % from the person's (log SD 0.3); the pool learns the actual
 * spread. The person's own level needs no prior: it is the median of their gaps.
 */
export const LIFT_LOG_SD = 0.3;
