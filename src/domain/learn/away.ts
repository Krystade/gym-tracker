// Days since a lift (owner, 2026-11-23; scripts/backtest-rules §G): the backtest found his first sets beat the rule's target by
// about 0.1 rep for each day more since the lift was last done (to 14 days). A number like that is his, not a rule: so it is a
// learned coefficient on top of the per-set rule (progression repStep), fitted on his log before the day, starting at none and
// moving only as far as his own sessions pin it.
//
// The fit: one point per lift-session that the rule would have aimed (`x` its days since the lift, capped; `r` its sets' mean
// reps over the rule's targets), r ≈ a + c·(x − x̄), and c shrunk toward 0 by a normal prior N(0, PRIOR_SD²) (the posterior mean:
// least squares with a ridge of s²/PRIOR_SD², s² the points' own residual variance). The intercept is not applied: at his usual
// days away (x̄) the rule is left as it is, so the term moves only how a longer or shorter gap than usual changes a target.
// No data, a single day away, or too few points: c = 0, and the rule stands.

/** Days away counted at most: past this the 15+ day layoff rule (progression LAYOFF_AVERAGE_DAYS) takes over. */
export const AWAY_CAP = 14;
/**
 * (c) The prior on the coefficient (reps a set, per day away): none, with an SD of 0.05. Strong on purpose: two SDs spread over
 * his usual 1–14 days is about ±1¼ reps, and with his log's SE today (about 0.04) the fit keeps about half of what it reads.
 */
export const AWAY_PRIOR_SD = 0.05;
/** Fewer lift-sessions than this: no fit (c = 0). */
export const AWAY_MIN_POINTS = 8;

/** One lift-session the rule aimed: `x` days since the lift (1–AWAY_CAP), `r` its sets' mean reps less the rule's targets. */
export interface AwayPoint { x: number; r: number; /** Which lift-session it is (for the backtest's check of the replay). */ date?: string; key?: string }
/** `c`: reps a set per day away past `ref` (his mean days away); `sd`: the posterior SD of c; `n`: lift-sessions; `ols`: c unshrunk. */
export interface AwayFit { c: number; ref: number; sd: number; n: number; ols: number | null }
export const NO_AWAY: AwayFit = { c: 0, ref: 0, sd: AWAY_PRIOR_SD, n: 0, ols: null };

/** The shrunk per-day coefficient from `points` (see the file's head). */
export function awaySlope(points: readonly AwayPoint[], priorSd = AWAY_PRIOR_SD): AwayFit {
  const n = points.length;
  if (n < AWAY_MIN_POINTS) return { ...NO_AWAY, n };
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.r; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0;
  for (const p of points) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.r - my); }
  if (!(sxx > 0)) return { ...NO_AWAY, n, ref: mx };
  const ols = sxy / sxx;
  let sse = 0;
  for (const p of points) sse += (p.r - my - ols * (p.x - mx)) ** 2;
  const s2 = Math.max(1e-6, sse / (n - 2));
  // Posterior of c under N(0, priorSd²): precision sxx/s² + 1/priorSd², mean (sxy/s²) / that.
  const prec = sxx / s2 + (Number.isFinite(priorSd) && priorSd > 0 ? 1 / priorSd ** 2 : 0);
  return { c: sxy / s2 / prec, ref: mx, sd: Math.sqrt(1 / prec), n, ols };
}

/**
 * Reps a set the fit adds (or takes off) at `away` days since the lift, whole: c·(min(away, AWAY_CAP) − ref), rounded half away
 * from 0 (so −0.5 and +0.5 move alike). 0 under a day, or from LAYOFF days on (`layoff`: the layoff rule's own threshold).
 */
export function awayShift(fit: AwayFit, away: number, layoff: number): number {
  if (!(away >= 1) || away >= layoff || fit.c === 0) return 0;
  const d = fit.c * (Math.min(away, AWAY_CAP) - fit.ref);
  return Math.sign(d) * Math.round(Math.abs(d)) || 0;
}
