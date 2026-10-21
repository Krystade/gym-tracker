import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { fitCore } from './capacity';
import { BETA_PRIOR, dataShare, fitRecovery, isFailure, PHI_PRIOR, REF_MINUTES, TAU_D_PRIOR, type RecoveryCore, type RecoveryFit } from './recovery';
import { shuffleSessions, simulateRecovery } from './recoverySim.sample';

// learn/recovery: the deficit model's arithmetic (exact, on a hand-built core), its time course against the papers S0 fitted,
// and what it learns from a synthetic lifter with KNOWN recovery (learn/recoverySim.sample). Synthetic only.

const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const hourOf = (iso: string) => Date.parse(iso) / 36e5; // UTC: the day axis is dayOf·24 + local hours
/** A core whose persistent loss per set is ρA (no lifts known: κ = 30 for all). */
const coreWith = (rhoA: number): RecoveryCore => ({
  drift: 0.01, gap: 180, fit: { theta: [1, 0.5, 0.05] },
  rest: { cells: [{ w: 1, rho: 0.5, theta: [2 * rhoA, 0.5, 0.05] }] }, lifts: new Map(),
});
/** `n` sets of `reps` of a lift on `date` from 17:00, three minutes apart; RIR 0 when `fail`. */
const session = (date: string, exercise: string, n: number, reps: number, fail: boolean): SetEntry[] =>
  Array.from({ length: n }, (_, k) => ({
    id: `t|${date}|${exercise}|${k + 1}`, date, seq: k, loggedAt: new Date(Date.parse(`${date}T17:00:00Z`) + k * 180e3).toISOString(),
    exercise, setNo: k + 1, weight: 100, reps, flags: [], source: 'test', ...(fail ? { rir: 0 } : { rir: 3 }),
  }));
const endOf = (es: SetEntry[]) => hourOf(es.at(-1)!.loggedAt!);
/** Hours from the session's end until P(recovered) first passes ½ (a 15-minute grid). */
const hoursToFresh = (f: RecoveryFit, end: number, muscle: 'Quads'): number => {
  for (let h = 0; h < 24 * 60; h += 0.25) if (f.pAtHour(muscle, end + h) > 0.5) return h;
  return Infinity;
};

describe('learn/recovery: the deficit', () => {
  it('right after a session: Σ v·ρA/(κ + reps), each set decayed from its own time, per τ′ cell', () => {
    const es = session('2026-03-02', 'Leg Press', 3, 10, false); // Quads 1, Glutes ½, Hamstrings ½; no failure
    const f = fitRecovery(es, coreWith(0.6), '2026-03-02', 'UTC');
    const end = endOf(es);
    for (const [m, v] of [['Quads', 1], ['Glutes', 0.5]] as const) {
      const cells = f.cells(m, end);
      expect(cells.length).toBe(7 * 8); // every φ (all alike here) × every τ′ cell
      for (const c of cells) {
        const want = [0, 1, 2].reduce((a, k) => a + v * 0.6 / (30 + 10) * Math.exp(-(6 - 3 * k) / 60 / c.tau), 0);
        expect(c.x).toBeCloseTo(want, 12);
      }
    }
    // Nothing on a muscle the lift doesn't work, and nothing before the session ended.
    expect(f.cells('Biceps', end).every((c) => c.x === 0)).toBe(true);
    expect(f.cells('Quads', end - 0.01).every((c) => c.x === 0)).toBe(true);
    expect(f.pAtHour('Biceps', end)).toBeCloseTo(1, 12);
  });

  it('failure is a logged RIR of 0 or a missed target at its weight; never a light week, never an unlogged set', () => {
    const s = (x: Partial<SetEntry>): SetEntry => ({ id: 'x', date: '2026-01-01', seq: 0, exercise: 'Bench Press', setNo: 1, weight: 100, reps: 8, flags: [], source: 't', ...x });
    expect(isFailure(s({ rir: 0 }))).toBe(true);
    expect(isFailure(s({ rir: 1 }))).toBe(false);
    expect(isFailure(s({}))).toBe(false);
    expect(isFailure(s({ target: { weight: 100, reps: 10, sets: 3 } }))).toBe(true);
    expect(isFailure(s({ target: { weight: 105, reps: 10, sets: 3 } }))).toBe(false);
    expect(isFailure(s({ rir: 0, flags: ['light'] }))).toBe(false);
  });

  // S0 §6.2: the Morán-Navarro volume-matched pair, at S0's assumed D0 brackets (non-failure 3.5–8 %, failure 10–25 %): the
  // non-failure session is back by 6 h, the failure one still impaired at 48 h. Built at the brackets' middles (5.5 %, 17.5 %).
  // The ρA that gives each D0 is set on the core; the time course is the model's.
  const pair = () => {
    const easy = session('2026-03-02', 'Leg Extension', 6, 5, false);
    const hard = session('2026-03-02', 'Leg Extension', 3, 10, true);
    const fe = fitRecovery(easy, coreWith(0.055 / 6 * 35), '2026-03-02', 'UTC');
    const fh = fitRecovery(hard, coreWith(0.175 / 3 * 40), '2026-03-02', 'UTC');
    return { fe, fh, ee: endOf(easy), he: endOf(hard) };
  };
  it('Morán-Navarro 2017: non-failure recovered by 6 h, failure still impaired at 48 h (prior φ and τ′)', () => {
    const { fe, fh, ee, he } = pair();
    // D0 as built (β = 1): within the bracket each side.
    expect(fe.deficit('Quads', '2026-03-02').mean).toBeGreaterThan(0); // the 18:00 reference is after 17:15
    expect(fe.pAtHour('Quads', ee + 6)).toBeGreaterThan(0.5);
    expect(fh.pAtHour('Quads', he + 48)).toBeLessThan(0.5);
  });

  it('φ lengthens recovery more than any D0 scaling could: failure outlasts a non-failure session with φ× its D0', () => {
    const hard = session('2026-03-02', 'Leg Extension', 3, 10, true);
    const same = session('2026-03-02', 'Leg Extension', 3, 10, false);
    const fh = fitRecovery(hard, coreWith(2), '2026-03-02', 'UTC'); // D0 0.15, five times READY
    const fs = fitRecovery(same, coreWith(2 * PHI_PRIOR.median), '2026-03-02', 'UTC');
    const th = hoursToFresh(fh, endOf(hard), 'Quads'), ts = hoursToFresh(fs, endOf(same), 'Quads');
    expect(ts).toBeGreaterThan(0); // the scaled session isn't fresh at once (else the comparison is empty)
    expect(th).toBeGreaterThan(1.5 * ts);
  });

  it('with no log: the priors, nothing learned, every muscle fresh today', () => {
    const f = fitRecovery([], coreWith(0.5), '2026-03-02', 'UTC');
    expect(f.readings).toBe(0);
    expect(f.beta.mean).toBeCloseTo(BETA_PRIOR.mean, 9);
    for (const v of Object.values(f.fromData)) expect(v).toBeCloseTo(0, 9);
    expect(f.phi.median).toBeCloseTo(PHI_PRIOR.median, 0);
    const q = f.muscles.get('Chest')!;
    expect(q.tau.median).toBeGreaterThan(TAU_D_PRIOR.median / 1.5);
    expect(q.tau.median).toBeLessThan(TAU_D_PRIOR.median * 1.5);
    expect(q.fromData.both).toBe(0);
    expect(f.freshBy('Chest')).toBe('2026-03-02');
    expect(f.refMinutes('2026-03-02')).toBe(REF_MINUTES);
  });

  it('the reference time is his median start on that weekday, else on any day; d* is a day, never an hour', () => {
    // Mondays at 07:00 and 09:00, a Wednesday at 19:00.
    const at = (date: string, h: number) => session(date, 'DB Curl', 3, 10, false).map((e, k) => ({ ...e, loggedAt: new Date(Date.parse(`${date}T${String(h).padStart(2, '0')}:00:00Z`) + k * 180e3).toISOString() }));
    const es = [...at('2026-03-02', 7), ...at('2026-03-09', 9), ...at('2026-03-11', 19)];
    const f = fitRecovery(es, coreWith(0.5), '2026-03-12', 'UTC');
    expect(f.refMinutes('2026-03-16')).toBe(8 * 60); // Monday: the median of 7:00 and 9:00
    expect(f.refMinutes('2026-03-18')).toBe(19 * 60); // Wednesday
    expect(f.refMinutes('2026-03-13')).toBe(9 * 60); // Friday: never seen, the median over all days
    expect(f.freshBy('Biceps')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the share from his data is 1 − σ²_post/σ²_prior, in [0, 1]', () => {
    expect(dataShare(1, 1)).toBe(0);
    expect(dataShare(0.5, 1)).toBeCloseTo(0.75, 12);
    expect(dataShare(2, 1)).toBe(0);
    expect(dataShare(0, 1)).toBe(1);
  });
});

describe('learn/recovery: learning from a synthetic lifter (true τ′ 32 h, φ 8, β 1)', () => {
  const fitOf = (entries: SetEntry[]) => fitRecovery(entries, fitCore(entries), dayAfter(entries.at(-1)!.date), 'UTC');
  const TRAINED = ['Biceps', 'Chest', 'Triceps', 'Lats'] as const;

  it('gate: 150 sessions recover τ′ within 1 SD for every well-trained muscle, mostly from his data', () => {
    const f = fitOf(simulateRecovery(1, { sessions: 150, failFrac: 0.2 }).entries);
    for (const m of TRAINED) {
      const r = f.muscles.get(m)!;
      expect(r.readings, m).toBeGreaterThan(100);
      expect(Math.abs(Math.log(r.tau.median / 32)), m).toBeLessThanOrEqual(r.tau.logSd);
      // Discriminating: the prior's median (4 h) is 2.6 prior SDs away, so this is learned, not the prior's.
      expect(r.fromData.tau, m).toBeGreaterThan(0.75);
    }
    expect(f.logScore).toBeGreaterThan(f.flatScore + 20); // the recovery term predicts what no-recovery can't
  });

  it('coverage: τ′ within 2 SD of the truth on ≥ 7 of 8 seeds (biceps)', () => {
    let hits = 0;
    for (let seed = 2; seed <= 9; seed++) {
      const r = fitOf(simulateRecovery(seed, { sessions: 150, failFrac: 0.2 }).entries).muscles.get('Biceps')!;
      if (Math.abs(Math.log(r.tau.median / 32)) <= 2 * r.tau.logSd) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(7);
  });

  it('negative control: with the sessions shuffled in time, τ′ and β stay at their priors', () => {
    const { entries } = simulateRecovery(1, { sessions: 150, failFrac: 0.2 });
    const f = fitOf(shuffleSessions(entries, 11));
    expect(f.readings).toBeGreaterThan(300); // as much to learn from as the real order
    expect(f.fromData.beta).toBeLessThan(0.25);
    expect(f.fromData.tau).toBeLessThan(0.25);
    for (const m of TRAINED) {
      const r = f.muscles.get(m)!;
      expect(Math.abs(Math.log(r.tau.median / 32)), m).toBeGreaterThan(1); // nowhere near the truth it can't see
    }
  });

  it('the share from his data grows with sessions: some by session 10, more at 30, most at 150', () => {
    const { entries } = simulateRecovery(1, { sessions: 150, failFrac: 0.2 });
    const dates = [...new Set(entries.map((e) => e.date))];
    const at = (n: number) => fitOf(entries.filter((e) => e.date <= dates[n - 1])).muscles.get('Biceps')!.fromData;
    const a = at(10), b = at(30), c = at(150);
    expect(a.beta).toBeGreaterThan(0.02); // from the first sessions: no switch-over point
    expect(b.beta).toBeGreaterThan(a.beta);
    expect(b.both).toBeGreaterThan(a.both);
    expect(c.both).toBeGreaterThan(b.both);
  });

  it('φ is learned: a lifter whose failure costs ×2 (or ×32) moves it from the prior’s 8 toward the truth', () => {
    const lo = fitOf(simulateRecovery(5, { sessions: 150, failFrac: 0.4, truth: { phi: 2, tau: 16 } }).entries);
    expect(lo.phi.median).toBeLessThan(4);
    expect(lo.fromData.phi).toBeGreaterThan(0.3);
    const hi = fitOf(simulateRecovery(3, { sessions: 150, failFrac: 0.3, truth: { phi: 32 } }).entries);
    expect(hi.phi.median).toBeGreaterThan(16);
    expect(hi.fromData.phi).toBeGreaterThan(0.3);
  });

  it('negative control for φ: logs shaped like his (≈ 90 sessions, ≈ 45 RIR sets, ≈ 9 at RIR 0) leave it near its prior', () => {
    for (const seed of [4, 5, 6, 7]) {
      const { entries } = simulateRecovery(seed, { sessions: 90, pLog: 0.04, timedFrac: 0.1 });
      const logged = entries.flatMap((e, i) => (e.rir != null ? [i] : []));
      const zero = new Set(logged.filter((_, k) => k % 5 === 0).slice(0, 10)); // a few scattered sets called failure
      const f = fitOf(entries.map((e, i) => (zero.has(i) ? { ...e, rir: 0 } : e)));
      expect(Math.abs(Math.log(f.phi.median / PHI_PRIOR.median)), `seed ${seed}`).toBeLessThan(PHI_PRIOR.logSd);
      expect(f.fromData.phi, `seed ${seed}`).toBeLessThan(0.75);
    }
  });
});

describe('learn/recovery: incremental equals batch', () => {
  /** Every number the fit gives, in a fixed order. */
  const digest = (f: RecoveryFit): number[] => {
    const out = [f.beta.mean, f.beta.sd, f.birge, f.logScore, f.flatScore, f.phi.median, f.phi.logSd, f.person.median, f.person.logSd, ...f.halfLife.flat()];
    for (const r of f.muscles.values()) out.push(r.tau.median, r.tau.logSd, ...r.tau.w, r.beta.mean, r.beta.sd, r.readings);
    for (const m of ['Biceps', 'Chest', 'Quads'] as const) out.push(f.pRecovered(m, f.today), f.pRecovered(m, dayAfter(f.today)));
    return out;
  };
  const worst = (a: number[], b: number[]) => (a.length !== b.length ? Infinity : Math.max(0, ...a.map((x, i) => Math.abs(x - b[i]) / Math.max(1, Math.abs(x), Math.abs(b[i])))));
  const cold = (es: readonly SetEntry[]) => es.map((e) => structuredClone(e));

  it('a fit that reuses cached sessions equals a cold one, whether the log grew a session at a time or arrived whole', () => {
    const { entries } = simulateRecovery(7, { sessions: 60, failFrac: 0.2 });
    const today = dayAfter(entries.at(-1)!.date);
    const core = fitCore(entries);
    const dates = [...new Set(entries.map((e) => e.date))];
    for (const d of dates.slice(-10)) fitRecovery(entries.filter((e) => e.date <= d), core, today, 'UTC'); // one session at a time
    const warm = digest(fitRecovery([...entries], core, today, 'UTC'));
    const batch = digest(fitRecovery(cold(entries), core, today, 'UTC'));
    expect(warm.every(Number.isFinite)).toBe(true);
    expect(warm.length).toBeGreaterThan(100);
    expect(worst(warm, batch)).toBeLessThanOrEqual(1e-9);
    // An edited old set (a new object) is read again: the fit changes, and still equals its cold fit.
    const at = entries.findIndex((e) => e.date === dates[20]);
    const edited = entries.map((e, i) => (i === at ? { ...e, reps: (e.reps as number) + 4, rir: 0 } : e));
    const we = digest(fitRecovery(edited, core, today, 'UTC'));
    expect(worst(we, digest(fitRecovery(cold(edited), core, today, 'UTC')))).toBeLessThanOrEqual(1e-9);
    expect(worst(we, warm)).toBeGreaterThan(1e-9);
  });
});
