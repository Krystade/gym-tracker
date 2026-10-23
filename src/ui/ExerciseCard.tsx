import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { byOrderDone, lastSession, sameExercise } from '../domain/stats';
import { estimateRir, isTest, isWorking, nextTarget, priorE1rm, rirOffset } from '../domain/progression';
import { ladderOf } from '../domain/learn/ladder';
import { prToast, records } from '../domain/records';
import { fmtDay, fmtSet, fmtWeight, plural } from '../domain/format';
import type { Flag, SetEntry } from '../domain/types';
import { SetForm, type SetFormValue } from './SetForm';
import { isHoldLift, loadsRegion } from '../domain/care';
import { painToday } from '../domain/painPlan';
import { SetRowContent } from './SetRow';
import { nextSet, suggest } from '../domain/suggest';
import { Icon } from './icons';
import { fmtLoad, fmtRamp } from './SuggestionCard';
import { hhmm, paces, restFor, suggestTime, type RestPart } from '../domain/timing';
import { kneeAfter } from '../domain/learn/rest';
import { andList } from '../domain/superset';
import { upNext } from '../domain/upNext';
import { startRest } from './RestTimer';
import { localDate } from '../domain/ids';
import { addDays } from '../domain/analytics';
import { bodyShare } from '../domain/learn/bodyweight';
import { gearOf } from '../domain/equipment';
import { prSetIds } from '../domain/summary';
import { fmtPerSide, PLATE_SIZES } from '../domain/plates';
import { isCardio } from '../domain/cardio';
import { CardioCard } from './CardioCard';
import { FoldLine } from './FoldLine';
import { useCardFold } from '../state/cardFold';
import { AchLines } from './AchievementsSheet';
import { WhyWeightSheet } from './WhyWeight';
import { useAchLines, useAchOpen } from '../state/useAchievements';

const TARGET_LEAD: Partial<Record<string, string>> = { increase: 'Go up: ', test: 'From your test: ', carry: 'Estimate: ', hold: 'Hold: ', ease: 'Lighter: ', light: 'Light week: ' };

type CardProps = Parameters<typeof LiftCard>[0] & { plannedMinutes?: number | null };
/** A cardio machine gets its own card: time and distance, not weight and reps. */
export function ExerciseCard({ plannedMinutes, ...p }: CardProps) {
  return isCardio(p.exercise)
    ? <CardioCard exercise={p.exercise} date={p.date} today={p.today} store={p.store} onOpen={p.onOpen} plannedMinutes={plannedMinutes} gym={p.gym} who={p.who} openReq={p.openReq}
      completesPlan={p.completesPlan} onPlanDone={p.onPlanDone && (() => p.onPlanDone!(() => {}))} />
    : <LiftCard {...p} />;
}

function LiftCard({ exercise, date, today: realToday = date, store, settings, onOpen, plannedSets = null, gym, plates = PLATE_SIZES, openReq = null, who, swappedFrom, left = [], onGo,
  supersetWith, onNotSuperset, switchAfter, roundAfter, onSwitch, aside, restDelta, light = false, completesPlan, onPlanDone, plannedOf, onLiftAfter, onTouch }: {
  exercise: string; date: string; today?: string; store: SetsStore; settings: SettingsStore; onOpen: (name: string) => void; plannedSets?: number | null; gym?: string;
  /** The plate sizes at this gym, for the per-side line. */
  plates?: readonly number[];
  /** The plan sent you to this card: open it if it's folded. Each request once (a render of the card's own keeps it). */
  openReq?: object | null;
  /** Named on Add set when several people share the phone. */
  who?: string;
  /** The planned lift this one was swapped in for. */
  swappedFrom?: string;
  /** The plan's lifts still to do, offered on the card you just finished so you can take whichever machine is free. */
  left?: string[]; onGo?: (exercise: string) => void;
  /** The other lifts of its superset today, and the tap that says it isn't one. */
  supersetWith?: string[]; onNotSuperset?: () => void;
  /** With the log as it is after the set `id`: the superset's next lift to switch to, null for its full rest, undefined if in none. */
  switchAfter?: (entries: SetEntry[], id: string) => { to: string; seconds: number; parts: RestPart[] } | null | undefined;
  /** With the log as it is after the set `id`: when that set ended a superset's round, the superset's lifts in order. */
  roundAfter?: (entries: SetEntry[], id: string) => readonly string[] | undefined;
  /** Any lift's sets planned today (null for none), for what the rest after a set leads to; without it, this card's alone. */
  plannedOf?: (exercise: string) => number | null | undefined;
  onSwitch?: (exercise: string) => void;
  /** Shown under the card's head, before its numbers: the suggestion to rotate a stalled lift. */
  aside?: ReactNode;
  /** The day's δ for his rest knee (TodayPlan dayRestDelta); the plain one without a plan. */
  restDelta?: number;
  /** A light week is on (item 06): its targets, and its working sets marked light. */
  light?: boolean;
  /** With the log as it is after a set: that set did the plan's last planned set (no rest then: `onPlanDone`, given the rest held back). */
  completesPlan?: (entries: SetEntry[]) => boolean; onPlanDone?: (resume: () => void) => void;
  /** With the log as it is after a set here: the other lift he's on (domain/upNext onLift), which this one's last set leads to. */
  onLiftAfter?: (entries: SetEntry[]) => string | undefined;
  /** A tap anywhere on the card: he's on this lift. */
  onTouch?: () => void;
}) {
  const [editing, setEditing] = useState<SetEntry | null>(null);
  // Folded or open as the user last chose: true folded, false open; null, automatic: folded once the plan's sets are done.
  // Opening a finished card keeps it open (more sets are theirs to add); a reload starts every card automatic again. Kept
  // outside the card (state/cardFold), so the exercise picker taking Today's place doesn't open them all again.
  const [shut, setShut] = useCardFold(date, exercise);
  const [pr, setPr] = useState<string | null>(null);
  useEffect(() => { if (!pr) return; const t = setTimeout(() => setPr(null), 6000); return () => clearTimeout(t); }, [pr]);
  // What the set just saved unlocked: lines under the PR line (plan §6), tapped open on Stats.
  const ach = useAchLines(), openAch = useAchOpen();
  // A delete happens straight away; for 8 s the set can come back.
  const [gone, setGone] = useState<{ set: SetEntry; no: number } | null>(null);
  // Started before paint, so the 8 s run from when the offer first shows.
  useLayoutEffect(() => { if (!gone) return; const t = setTimeout(() => setGone(null), 8000); return () => clearTimeout(t); }, [gone]);
  const today = store.entries.filter((e) => e.date === date && sameExercise(e.exercise, exercise)).sort(byOrderDone); // in the order done: a late set sits where it happened
  // The set being edited may vanish (deleted in another tab, an import): close the editor rather than offer "Delete set 0".
  if (editing && !today.some((x) => x.id === editing.id)) setEditing(null);
  const editBox = useRef<HTMLDivElement>(null);
  const hold = isHoldLift(exercise, store.entries);
  // With several sets and cards below, Save sits off-screen; 'nearest' moves nothing when it is already in view.
  useEffect(() => { if (editing) editBox.current?.scrollIntoView({ block: 'nearest' }); }, [editing?.id]);
  const last = lastSession(store.entries, exercise, date);
  // Item 14: a bodyweight lift's e1RM would be of the weight added alone, which isn't its load: none shown.
  const best = useMemo(() => (bodyShare(exercise) != null ? undefined : records(store.entries, exercise).get('e1rm')), [store.entries, exercise]);
  // The heaviest working set ever: a weight far above it is more likely a typo than a jump.
  // A lift swapped in with no history of its own is checked against the one it replaces.
  const heaviest = useMemo(() => {
    const top = (n: string) => store.entries.filter((e) => sameExercise(e.exercise, n) && isWorking(e)).reduce((m, e) => Math.max(m, e.weight), 0);
    return top(exercise) || (swappedFrom ? top(swappedFrom) : 0);
  }, [store.entries, exercise, swappedFrom]);
  // PRs stay marked on their rows; the banner only announces one.
  const prs = useMemo(() => prSetIds(store.entries, date), [store.entries, date]);
  const from = useMemo(() => (swappedFrom ? lastSession(store.entries, swappedFrom, date) : null), [store.entries, swappedFrom, date]);
  const st = settings.get(exercise, hold);
  // The rest timer may be changed long after this render (or this card gone): it saves through the settings as they are then.
  const settingsNow = useRef(settings);
  settingsNow.current = settings;
  const target = nextTarget(store.entries, exercise, st, date, plannedSets, light);
  const sug = suggest(store.entries, exercise, st, date, plannedSets, light);
  // The target as its line says it (and the sheet's head): kind, each set's reps or sets × reps, and the load.
  const targetText = `${TARGET_LEAD[sug.kind] ?? ''}${sug.kind === 'new' ? `${sug.sets} × ${sug.reps}–${sug.repMax}${sug.unit}`
    : sug.perSet ? `${sug.perSet.join(' · ')}${sug.unit}` : `${sug.sets} × ${sug.reps}${sug.unit}${sug.kind !== 'maxed' ? '+' : ''}`}${fmtLoad(sug.weight)}`;
  const [why, setWhy] = useState(false);
  const pace = useMemo(() => paces(store.entries), [store.entries]);
  // The stepper moves by the lift's learned rung when that is finer than 5 lb, and a typed increment isn't set (item 01).
  const weightStep = useMemo(() => { const l = st.increment === 5 ? ladderOf(store.entries, exercise) : null; return l && l.step < 5 ? l.step : 5; }, [store.entries, exercise, st.increment]);
  // A new function only when the log changes, so the form can re-ask once a late set has landed.
  const suggestWhen = useCallback(() => suggestTime(store.entries, date, exercise, pace, new Date()), [store.entries, date, exercise, pace]);
  // Whole-history scans: recompute only when the log changes, not on every keystroke in the form.
  const { prior, offset } = useMemo(() => ({
    prior: priorE1rm(store.entries, exercise, date), offset: rirOffset(store.entries, exercise),
  }), [store.entries, exercise, date]);
  // The last set actually done here, not a pasted one that sorts after it.
  const latest = (xs: SetEntry[]) => xs.findLast((s) => s.loggedAt) ?? xs.at(-1);
  const working = today.filter(isWorking);
  // The sets the next one is aimed from: a test is strength, not a set to repeat (owner, 2026-10-23).
  const training = working.filter((x) => !isTest(x));
  const pulley: Flag[] = (latest(today) ?? last?.sets.find(isWorking))?.flags.includes('double_pulley') ? ['double_pulley'] : [];
  // With nothing to go on, a lift that needs gear starts empty: a prefilled 0 would log a weighted lift as bodyweight.
  // Each set has its own rep target (owner, 2026-10-19): the next working set's, while the weight is the target's.
  const aim = (i: number, weight: number | null | undefined): number | undefined =>
    sug.perSet && weight === sug.weight ? sug.perSet[Math.min(i, sug.perSet.length - 1)] : undefined;
  // Item 11 (owner, 2026-10-23): after a set, the next one, from what he just did; past the plan, an extra one. The form starts there.
  const next = nextSet(store.entries, exercise, date, sug, today);
  /** The next set as it would be with `v` just saved (the log here doesn't have it yet). */
  const nextAfter = (v: SetFormValue) => (v.flags.includes('warmup') || v.flags.includes('test') ? undefined
    : nextSet(store.entries, exercise, date, sug, [...today, { id: '', date, seq: Date.now(), exercise, setNo: 0, weight: v.weight, reps: v.reps, flags: v.flags, source: 'app', loggedAt: new Date().toISOString() }]));
  const initial: Omit<SetFormValue, 'weight'> & { weight: number | null } = next ? { weight: next.weight, reps: next.reps, flags: pulley }
    : target ? { weight: target.weight, reps: aim(0, target.weight) ?? target.reps, flags: pulley }
    : { weight: hold || gearOf(exercise) === 'no equipment' ? 0 : null, reps: st.repMin, flags: [] };

  async function addSet(v: SetFormValue): Promise<boolean> {
    setPr(null);
    ach.clear();
    // What was suggested rides along with every set, so suggested and done can be compared later.
    const { at, ...rest } = v;
    // In a light week a working set is marked light (item 06): stopped short on purpose, so nothing reads it as his best.
    if (light && !rest.flags.includes('warmup') && !rest.flags.includes('light')) rest.flags = [...rest.flags, 'light'];
    // A time for a late set is on the day being logged to.
    const e = await store.add({ date, exercise, ...rest, gym, ...(at !== undefined && { at: at ? new Date(`${date}T${at}:00`) : null }), target: { weight: sug.weight, reps: aim(training.length, sug.weight) ?? sug.reps, sets: sug.sets } });
    if (!e) return false;
    // A set done just now starts the rest; one entered for an earlier time or day doesn't. Inside a superset with a lift still to
    // go in the round, a short switch instead, and that lift's card comes up.
    if (at === undefined && date === realToday) {
      // What the rest leads to: this lift's next set while its plan has one, else the plan's next lift (domain/upNext).
      const after = [...store.entries.filter((x) => x.id !== e.id), e];
      const label = upNext({ exercise, entries: after, date, left, round: roundAfter?.(after, e.id), on: onLiftAfter?.(after),
        planned: plannedOf ?? ((x) => (sameExercise(x, exercise) ? plannedSets : null)) });
      const switchTo = switchAfter?.(after, e.id);
      // The rest for this set: the lift's base (his setting, his knee once his sets show it, else research) and its effort
      // (domain/timing restFor). The knee reads the log as it was before this set (the core as of the days before is cached
      // for that array) and the day's sets so far with this one.
      const full = restFor(e, { kept: st.rest, knee: kneeAfter(store.entries, e, restDelta) });
      // ±30 s on the timer moves the lift's base rest by as much, from now on; a warm-up's rest moves nothing.
      const keep = full.why.warmup ? undefined : (chosen: number) => {
        const s = settingsNow.current;
        void s.save({ ...s.get(exercise, hold), rest: Math.min(600, Math.max(30, full.why.base + chosen - full.seconds)) });
      };
      // `from`: a rest held back by the Finish bar runs from this set, should Keep going start it.
      const begin = (from?: number) => {
        if (switchTo) {
          startRest(switchTo.seconds, switchTo.to.toLowerCase(), `Switch to ${switchTo.to}`, { seconds: full.seconds, card: exercise.toLowerCase(), label, why: full.parts }, keep, switchTo.parts, from);
          onSwitch?.(switchTo.to);
        } else startRest(full.seconds, exercise.toLowerCase(), label, undefined, keep, full.parts, from);
      };
      // The plan's last planned set (owner, 2026-10-20): no rest, and no switch inside a superset either; Finish or Keep going.
      if (completesPlan?.(after) && onPlanDone) { const t = Date.now(); onPlanDone(() => begin(t)); } else begin();
    }
    // The same rule as the PR badge; a set that broke several records names the best one.
    setPr(prToast(store.entries, e));
    ach.saved(store.entries, e, realToday);
    return true;
  }

  // Sharp pain on this lift today (over 5/10, past the acceptable zone: item 08, a): stop it for today; the plan's lifts left
  // that don't load that region are offered.
  const sharp = useMemo(() => { const p = painToday(store.entries, exercise, date); return p?.zone === 3 ? p : null; }, [store.entries, exercise, date]);
  // What sharp pain today does to next time, as the next target will say it: lighter, more help, or a rep fewer a set (item 14).
  const eased = useMemo(() => {
    const t = sharp ? nextTarget(store.entries, exercise, st, addDays(date, 1), plannedSets) : null;
    return t?.kind !== 'ease' ? null : t.easeBy === 'help' ? ' Next time starts with a step more help.' : t.easeBy === 'reps' ? ' Next time starts a rep down on each set.' : ' Next time starts a step lighter.';
  }, [sharp, store.entries, exercise, st, date, plannedSets]);
  const away = sharp ? left.filter((ex) => !sameExercise(ex, exercise) && !loadsRegion(ex, sharp.region)) : [];
  const complete = plannedSets != null && plannedSets > 0 && working.length >= plannedSets;
  // The plan sent you here: open a folded card, but a card that isn't finished has nothing to open, so don't pin it open.
  const [usedReq, setUsedReq] = useState<object | null>(null);
  const folded = shut ?? complete;
  // Open: a finished card stays open; one not finished goes back to automatic, so its last set folds it.
  const unfold = () => setShut(complete ? false : null);
  if (openReq && openReq !== usedReq) { setUsedReq(openReq); if (folded) unfold(); }
  // Finished while on screen: this card is where you are, so it offers what's left.
  const wasFolded = useRef(folded);
  const [justDone, setJustDone] = useState(false);
  // Finished, not folded by hand: this card offers what's left of the plan.
  useLayoutEffect(() => { if (folded && !wasFolded.current && shut === null) setJustDone(true); wasFolded.current = folded; }, [folded, shut]);
  // A growing list of sets pushes Add set down: once a new set has rendered, bring it back above the tab bar if it went
  // under. Not when that set finished the lift: the card has folded and there is nothing to reach.
  const box = useRef<HTMLElement>(null);
  const count = useRef(today.length);
  useEffect(() => {
    const grew = today.length > count.current;
    count.current = today.length;
    if (!grew || folded || editing) return;
    const b = box.current?.querySelector<HTMLElement>('.set-form button[type=submit]');
    const bar = document.querySelector('nav.tabs')?.getBoundingClientRect().top ?? innerHeight;
    if (b && b.getBoundingClientRect().bottom > bar) b.scrollIntoView({ block: 'nearest' });
  }, [today.length, folded, editing]);

  if (folded) {
    const top = working.length ? working.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a)) : null;
    const count = complete ? `${working.length}/${plannedSets} sets ✓` : plannedSets ? `${working.length}/${plannedSets} sets` : working.length ? plural(working.length, 'set') : 'Not started';
    // The lift he's on first among what's left (owner, 2026-10-22: the plan's next was offered first, mid-way through his curls).
    const on = justDone ? onLiftAfter?.(store.entries) : undefined;
    const offer = on ? [...left.filter((x) => sameExercise(x, on)), ...left.filter((x) => !sameExercise(x, on))] : left;
    return (
      <section className="card folded" data-card={exercise.toLowerCase()} onClickCapture={onTouch}>
        <FoldLine name={exercise} done={complete} count={count} pr={today.some((x) => prs.has(x.id))} best={top ? fmtSet(top) : null} onClick={unfold} />
        {pr && <p role="status" className="pr">{pr}</p>}
        <AchLines us={ach.lines} onOpen={openAch} />
        {justDone && onGo && left.length > 0 && (
          <div className="chips left-row" role="group" aria-label="Left to do">
            <span className="chip-label">Left</span>
            {offer.map((ex) => <button key={ex} type="button" className="chip" onClick={() => onGo(ex)}>{ex}</button>)}
          </div>
        )}
      </section>
    );
  }

  return (
    <section ref={box} className="card" data-card={exercise.toLowerCase()} onClickCapture={onTouch}>
      <header className="card-head">
        <button className="link" onClick={() => onOpen(exercise)}>{exercise}</button>
        {/* Every open card folds from its head (owner, 2026-10-19: a card could only be closed by finishing it). */}
        <button type="button" className="mini icon card-fold" aria-expanded="true" aria-label={`Fold ${exercise}`} onClick={() => { setEditing(null); setShut(true); }}>
          <Icon name="chev-down" size={22} sw={2} />
        </button>
        {best?.set && <span className="muted">Best {fmtSet(best.set)} · e1RM {fmtWeight(Math.round(best.value))} lb</span>}
      </header>
      {supersetWith && supersetWith.length > 0 && (
        <p className="superset-line"><Icon name="switch" size={16} sw={2} /><span>Superset with {andList(supersetWith)}</span>
          {onNotSuperset && <button type="button" className="mini" onClick={onNotSuperset}>Not a superset</button>}</p>
      )}
      {aside}
      {last && <p className="muted card-last">Last ({fmtDay(last.date, realToday)}): {last.sets.map((s, i) => <Fragment key={s.id}>{i > 0 && ' · '}<span className="nw">{fmtSet(s)}</span></Fragment>)}</p>}
      {swappedFrom && <p className="muted card-last">For {swappedFrom}{from && <> · last {from.sets.map((s, i) => <Fragment key={s.id}>{i > 0 && ' · '}<span className="nw">{fmtSet(s)}</span></Fragment>)}</>}</p>}
      {(target || sug.kind === 'new') && (
        <p className="target" aria-label="Target">
          {/* The "?" stands where the target's glyph was, as on the rest bar: why this target, line by line (WhyWeight). */}
          <button type="button" className="why-btn" aria-label="Why this weight" aria-haspopup="dialog" onClick={() => setWhy(true)}><Icon name="help" size={22} /></button>
          <span>{targetText}{fmtPerSide(sug.weight ?? 0, exercise, plates) && <span className="target-warm muted">{fmtPerSide(sug.weight ?? 0, exercise, plates)}</span>}{sug.warmups.length > 0 && <span className="target-warm muted">warm-up {fmtRamp(sug)}</span>}{sug.why && <span className="target-warm muted target-why">{sug.why}</span>}</span>
        </p>
      )}
      {why && <WhyWeightSheet exercise={exercise} target={targetText} s={sug} today={realToday} onClose={() => setWhy(false)} />}
      <ol className="sets" aria-label={`Sets for ${exercise}`}>
        {today.map((s, i) => (
          <li key={s.id}>
            <button className={editing?.id === s.id ? 'set-row editing' : 'set-row'} aria-current={editing?.id === s.id ? 'true' : undefined} onClick={() => setEditing(s)}>
              <SetRowContent s={s} no={i + 1} estRir={estimateRir(s, today, prior, offset)} pr={prs.has(s.id)} />
            </button>
          </li>
        ))}
      </ol>
      {next && !editing && (
        <p className="next-set" aria-label={next.extra ? 'Extra set' : 'Next set'}>
          <span className="next-set-label">{next.extra ? 'Extra set' : 'Next set'}</span> {next.reps}{sug.unit}{fmtLoad(next.weight)}
          <span className="target-warm muted">{next.why}</span>
        </p>
      )}
      {gone && <p className="undo-note" role="status">Set {gone.no} deleted. <button className="mini" onClick={async () => { if (await store.restore(gone.set)) setGone(null); }}>Undo</button></p>}
      {pr && <p role="status" className="pr">{pr}</p>}
      <AchLines us={ach.lines} onOpen={openAch} />
      {sharp && !editing && (
        <div className="pain-stop" role="status">
          <p><b>Sharp pain: stop {exercise} for today.</b>{eased}</p>
          {onGo && away.length > 0 && (
            <div className="chips left-row" role="group" aria-label={`Left without your ${sharp.region}`}>
              <span className="chip-label">Left</span>
              {away.map((ex) => <button key={ex} type="button" className="chip" onClick={() => onGo(ex)}>{ex}</button>)}
            </div>
          )}
        </div>
      )}
      {editing ? (
        <div ref={editBox} className="edit-box">
        <p className="edit-title">Editing set {today.findIndex((x) => x.id === editing.id) + 1}</p>
        <SetForm key={editing.id} exercise={exercise} plates={plates} hold={hold} initial={editing} submitLabel="Save" tagPrefs={settings.tags} onTagPrefs={settings.saveTags}
          onCancel={() => setEditing(null)}
          onDelete={async () => {
            const no = today.findIndex((x) => x.id === editing.id) + 1; // the number on the row, not the entry order
            const set = editing;
            if (await store.remove(set.id)) { setEditing(null); setGone({ set, no }); }
          }}
          when={{
            suggest: () => (editing.loggedAt ? hhmm(new Date(editing.loggedAt)) : null),
            always: true,
            max: date === localDate(new Date()) ? () => hhmm(new Date()) : undefined,
          }}
          onSubmit={async (v) => {
            const { at, ...rest } = v;
            const next: SetEntry = { ...editing, ...rest };
            const was = editing.loggedAt ? hhmm(new Date(editing.loggedAt)) : null;
            // Only a changed time is rewritten: re-saving 18:02 would drop the seconds and move the set.
            if (at !== undefined && (at || null) !== was) {
              next.enteredAt = editing.enteredAt ?? editing.loggedAt ?? new Date().toISOString();
              if (at) { const d = new Date(`${date}T${at}:00`); next.loggedAt = d.toISOString(); next.seq = d.getTime(); }
              else delete next.loggedAt;
            }
            // Saved: the editor closes, and a finished lift opened to fix a set folds again (owner, 2026-10-19).
            const ok = await store.update(next); if (ok) { setEditing(null); setShut(null); } return ok;
          }} />
        </div>
      ) : (
        <SetForm key="new" exercise={exercise} plates={plates} hold={hold} initial={initial} submitLabel={who ? `Add set · ${who}` : 'Add set'} onSubmit={addSet} keepDraft day={date} heaviest={heaviest} weightStep={weightStep}
          nextReps={(v) => nextAfter(v)?.reps}
          tagPrefs={settings.tags} onTagPrefs={settings.saveTags}
          when={{ suggest: suggestWhen, always: date < realToday, max: date === localDate(new Date()) ? () => hhmm(new Date()) : undefined }} />
      )}
    </section>
  );
}
