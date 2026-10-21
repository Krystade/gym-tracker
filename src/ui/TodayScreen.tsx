import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Profile } from '../domain/profile';
import { planToRecord, quickDay } from '../domain/program';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import type { ProgramStore } from '../state/useProgram';
import { dayOrder, exerciseNames, sameExercise } from '../domain/stats';
import { fmtDay } from '../domain/format';
import { ExerciseCard } from './ExerciseCard';
import { SessionSummary } from './SessionSummary';
import { Energy } from './Energy';
import { CycleRow } from './Cycle';
import { plannedMinutes, plannedSets, suggest } from '../domain/suggest';
import { isWorking, nextTarget } from '../domain/progression';
import { activeProfileDb } from '../db/db';
import { getDraft, saveDraft } from '../state/drafts';

const CARDS = '#cards';
import { ExercisePicker } from './ExercisePicker';
import { isHoldLift, swapSuggestions } from '../domain/care';
import { dayRestDelta, inPlanOrder, leftToDo, plannedNames, TodayPlan, todayPlanFor } from './TodayPlan';
import { DELTA } from '../domain/learn/rest';
import { WeighIn } from './WeighIn';
import { closeTimers, currentRest, offerFinish, RestTimer, revertSwitch } from './RestTimer';
import { FinishCard } from './FinishCard';
import { sessionClose, showSummary } from '../domain/finish';
import { quietAfter } from '../domain/learn/session';
import { finishedOn, markFinished } from '../state/finish';
import { onMinute } from '../state/clock';
import type { BodyStore } from '../state/useBody';
import type { GymsStore } from '../state/useGyms';
import { availableSet } from '../domain/equipment';
import { PROGRAM_LIFTS } from '../domain/catalog';
import { addDays } from '../domain/analytics';
import type { ThreadWith } from './ThreadSheet';
import { TodayDigest } from './WeekDigest';
import { SuggestedToday } from './SuggestedToday';
import { ProgramUpdateCard, useProgramUpdate } from './ProgramUpdate';
import type { Program } from '../domain/program';
import { Icon } from './icons';
import type { SetEntry } from '../domain/types';
import { switchFor, type RestPart } from '../domain/timing';
import { lastSupersets, restsOf, supersets, switchesOf, timedWorking, type Superset } from '../domain/superset';
import { gapModel } from '../domain/learn/switch';
import { allNotSupersets, markNotSuperset, notSupersets } from '../state/notSuperset';
import { carryOver, rotation, type Carry, type Rotation } from '../domain/rotation';
import { applyRotation, inProgram, RotationSuggestion } from './RotationSuggestion';
import { FriendName } from './FriendName';
import { persistentPain } from '../domain/painPlan';
import { PainPrompt } from './PainPrompt';
import { MorningCheck } from './MorningCheck';
import { systemic } from '../domain/learn/deload';
import { deloadSnoozed, endLight, lightOn, snoozeDeload, startLight, tappedLight } from '../state/lightWeek';
import { DeloadPrompt, LightWeekLine } from './DeloadPrompt';

export function TodayScreen({ me, who, store, settings, programs, body, gyms, profile, date, today, carried, news, recap, onSplit, onDay, onOpen, onOpenProgram, onOpenGym, onOpenNews }: {
  /** Whose sets these are, named only when several people share the phone. */
  who?: string;
  /** The signed-in account, for your tag for whoever the news is from. */ me?: string | null;
  store: SetsStore; settings: SettingsStore; programs: ProgramStore; body: BodyStore; gyms: GymsStore; profile: Profile; date: string; today: string;
  carried?: boolean; onSplit?: () => void; onDay: (d: string) => void; onOpen: (name: string) => void; onOpenProgram: () => void; onOpenGym?: () => void;
  /** A friend's newest unread ping or message: one line, and a tap opens their thread to reply. */
  news?: { uid: string; name: string; text: string } | null; onOpenNews?: (f: ThreadWith) => void;
  /** When the weekly recap push was tapped: Today opens at the week's digest. */
  recap?: number;
}) {
  const [picking, setPicking] = useState(false);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  // A recap tap with a picker up (it takes Today's place): the picker goes, so the digest shows.
  const [recapSeen, setRecapSeen] = useState(recap);
  if (recap !== recapSeen) { setRecapSeen(recap); setPicking(false); setSwapFor(null); }
  // Cards added but not logged yet: kept per profile for the day, so leaving the tab or switching profile keeps them.
  const [owner] = useState(activeProfileDb);
  // One list per day, so opening a past day doesn't overwrite today's.
  const [extra, setExtra] = useState<string[]>(() => getDraft<string[]>(owner, `${CARDS}:${date}`, date) ?? []);
  useEffect(() => { saveDraft(owner, `${CARDS}:${date}`, date, extra); }, [owner, date, extra]);
  const logged = dayOrder(store.entries, date);
  const plan = todayPlanFor(programs, store.entries, date);
  // The day's δ for his rest knees (item 17): the timer and the plan's length use the same. A plan not saved yet is a new object
  // each render, so it's keyed by what it says.
  const planSig = plan && JSON.stringify(plan);
  const restDelta = useMemo(() => (programs.program && plan ? dayRestDelta(programs.program, plan, store.entries, (ex) => settings.get(ex).rest) : DELTA),
    [programs.program, planSig, store.entries, settings]);
  // Item 06: a light week on the day (started here, or read from the log's light sets), and, on today outside one, whether his
  // strength is down across lifts with a second signal: then a light week is offered, and rotation offers wait.
  const [deloadTaps, setDeloadTaps] = useState(0);
  const tapped = tappedLight(owner);
  const light = lightOn(owner, store.entries, date);
  const sys = useMemo(() => (date === today ? systemic(store.entries, body.days, today, tapped) : null),
    [store.entries, body.days, today, date, deloadTaps]); // `tapped` changes only with a tap, which bumps deloadTaps
  const offerDeload = sys?.verdict === 'deload' && !deloadSnoozed(owner, today);
  // `extra` is the day's card order: logging a set must not move an added card. Lifts logged elsewhere come first.
  // Planned lifts keep the plan's order, whichever was opened first.
  const cards = inPlanOrder([...logged.filter((l) => !extra.some((x) => sameExercise(l, x))), ...extra], programs.program && plan ? plannedNames(programs.program, plan) : []);
  // Record the day once a working set is logged, so rotation and adherence don't depend on tapping the plan.
  // Only today: looking back at an older day must not record it and move today's rotation.
  useEffect(() => {
    if (!programs.program || date !== today) return;
    const r = planToRecord(programs.program, programs.plans, store.entries, date);
    if (r) void programs.savePlan(r);
  }, [programs.program, programs.plans, programs.savePlan, store.entries, date, today]);
  const addCard = (n: string) => setExtra((xs) => (xs.some((x) => sameExercise(x, n)) ? xs : [...xs, n]));
  // Null = automatic: open while the day has lifts left, folded once every planned lift is done or skipped.
  const [planOpen, setPlanOpen] = useState<boolean | null>(null);
  // A new card lands at the bottom, off-screen: bring it up. The plan stays as it was; it's the list of what's next.
  // A folded (finished) card the plan sends you to opens. Each request is used once, by the render that shows its card,
  // and stays in state after: clearing it would take Today through another render for nothing.
  const [go, setGo] = useState<{ to: string; open: boolean } | null>(null);
  const used = useRef<typeof go>(null);
  const openReq = go !== used.current && go?.open ? go : null;
  const goTo = (n: string) => { addCard(n); setGo({ to: n, open: true }); };
  useEffect(() => {
    if (!go || go === used.current || picking || swapFor) return;
    used.current = go;
    document.querySelector(`[data-card="${CSS.escape(go.to.toLowerCase())}"]`)?.scrollIntoView({ block: 'start' });
  }, [go, picking, swapFor]);
  // The weight the card will suggest, worked out the same way, so the row tells you what to load before you open it.
  const loadFor = (ex: string, sets: number): number | null => {
    const st = settings.get(ex, isHoldLift(ex, store.entries));
    return nextTarget(store.entries, ex, st, date) ? suggest(store.entries, ex, st, date, sets, !!light).weight : null;
  };
  const left = programs.program && plan ? leftToDo(programs.program, plan, store.entries) : [];
  const done = !!programs.program && !!plan && left.length === 0 && store.entries.some((e) => e.date === date && isWorking(e));
  const open = planOpen ?? !done;
  const hasPlan = date >= today || programs.plans.some((p) => p.date === date) || logged.length > 0;

  // Finishing (owner, 2026-10-20; domain/finish): the session closes on Finish, or by itself once nothing has been logged for his
  // quiet time (learn/session quietAfter), never while a rest is still on the timer; a set logged after opens it again. Then, or
  // once everything planned is done, the plan turns into the day's summary. Today only (the session day, past midnight too).
  const [finishRev, setFinishRev] = useState(0);
  const fin = useMemo(() => finishedOn(owner, date), [owner, date, finishRev]);
  const isToday = date === today;
  const quiet = useMemo(() => (isToday ? quietAfter(store.entries, date)?.seconds ?? null : null), [store.entries, date, isToday]);
  const closeAt = (now: number) => sessionClose(store.entries, date, now, { quiet, tapped: fin.done, restUntil: currentRest()?.until });
  const close = closeAt(Date.now());
  // Each minute (and on coming back), whether it has closed since: only a change renders Today (a minute going by renders nothing).
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  const howNow = useRef<() => boolean>(() => false);
  howNow.current = () => isToday && closeAt(Date.now()).how !== close.how;
  useEffect(() => onMinute(() => { if (howNow.current()) recheck(); }), []);
  const worked = store.entries.some((e) => e.date === date && isWorking(e));
  const summary = isToday && showSummary(close, done, fin.more ?? null, worked);
  // Closed by itself: the Finish bar and any rest go, and the rest's lock-screen alert is called off.
  useEffect(() => { if (isToday && close.how === 'auto') closeTimers(); }, [isToday, close.how]);
  // The summary has been on screen: a session that closes by itself later doesn't wait for the next open (below).
  useEffect(() => { if (summary && !fin.seen) markFinished(owner, date, { seen: true }); }, [summary, fin.seen, owner, date]);
  // The plan's last planned set (owner: "a set timer still starts after my last one"): no rest, Finish or Keep going instead.
  const completesPlan = isToday && programs.program && plan
    ? (after: SetEntry[]) => leftToDo(programs.program!, plan, store.entries).length > 0 && leftToDo(programs.program!, plan, after).length === 0
    : undefined;
  const onPlanDone = (resume: () => void) => offerFinish({ resume, finish: () => { markFinished(owner, date, { done: Date.now() }); setFinishRev((n) => n + 1); } });
  const addMore = () => { markFinished(owner, date, { more: Date.now() }); setFinishRev((n) => n + 1); setPlanOpen(true); };
  // A session before today's that closed by itself while the app was away: its summary waits for the next open, until dismissed
  // or today's first set (a week back at most).
  const lastDay = useMemo(() => {
    if (!isToday || logged.length) return null;
    const d = store.entries.reduce((m, e) => (e.date < date && e.date >= addDays(date, -7) && e.date > m && isWorking(e) ? e.date : m), '');
    return d || null;
  }, [store.entries, date, isToday, logged.length]);
  const lastUnseen = lastDay != null && !finishedOn(owner, lastDay).seen ? lastDay : null;

  // Supersets, noticed from the day's log: lifts gone round with short switches. "Not a superset" holds for the day.
  const [notSuper, setNotSuper] = useState(() => notSupersets(owner, date));
  // His gap model (learn/switch), fitted on the days before this one: what tells a switch from a rest, and his switch's length.
  const model = useMemo(() => gapModel(store.entries, date, allNotSupersets(owner)), [store.entries, date, owner, notSuper]);
  // Last session's groups start today's from the first set, for a session with all of a group's lifts (cards or planned).
  const session = [...cards, ...(programs.program && plan ? plannedNames(programs.program, plan).filter((n) => plannedSets(programs.program, plan, n) != null) : [])].join('\n');
  const last = useMemo(() => lastSupersets(store.entries, date, model, { lifts: session.split('\n'), dismissedOn: (d) => notSupersets(owner, d) }),
    [store.entries, date, model, owner, session]);
  const groupsIn = (entries: SetEntry[]) => supersets(entries, date, model, { dismissed: notSuper, planned: (ex) => plannedSets(programs.program, plan, ex), carried: last });
  const groups = groupsIn(store.entries);
  const groupOf = (n: string) => groups.find((g) => g.live && g.lifts.some((x) => sameExercise(x, n)));
  // After the set `id`, inside a group with a lift still to go in the round: that lift, and the switch to it (timing.switchFor),
  // moved by the day's rests and this group's switches so far.
  const switchAfter = (entries: SetEntry[], id: string): { to: string; seconds: number; parts: RestPart[] } | undefined => {
    const g = groupsIn(entries).find((x) => x.after.has(id)), to = g?.after.get(id);
    const from = entries.find((e) => e.id === id);
    if (!g || !to || !from) return undefined;
    const day = timedWorking(entries, date);
    return { to, ...switchFor(model, from.exercise, to, { rests: restsOf(day), switches: switchesOf(day, g.keys, g.after) }) };
  };
  // After the set `id`, when it ended a round of a group: the group's lifts, for whichever starts the next round.
  const roundAfter = (entries: SetEntry[], id: string): readonly string[] | undefined => {
    const g = groupsIn(entries).find((x) => x.after.has(id));
    return g && g.after.get(id) === null ? g.lifts : undefined;
  };
  const dismiss = (g: Superset) => { markNotSuperset(owner, date, g.keys); setNotSuper(notSupersets(owner, date)); revertSwitch(); };
  // After a set with another lift to go in the round, that lift's card comes up, ready for its set. A new request each time,
  // so the same lift comes up again; not cleared after, which would render Today again.
  const [switchTo, setSwitchTo] = useState<{ to: string } | null>(null);
  useEffect(() => {
    if (!switchTo) return;
    const card = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(switchTo.to.toLowerCase())}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'start' });
    card.querySelector<HTMLElement>('.card-head .link')?.focus({ preventScroll: true });
    // Its form stays clear of the timer's bar.
    const form = card.querySelector<HTMLElement>('.set-form'), bar = document.querySelector('.rest-timer');
    if (form && bar && form.getBoundingClientRect().bottom > bar.getBoundingClientRect().top) form.scrollIntoView({ block: 'nearest' });
  }, [switchTo]);

  // A card folding shrinks the page; near the bottom the browser then clamps the scroll and the page jumps. The screen
  // keeps the tallest height it has had, letting the extra go once it is below the viewport, where losing it moves nothing.
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const shown = !picking && !(swapFor && plan);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    let floor = 0;
    const ro = new ResizeObserver(() => { if (i.offsetHeight > floor) { floor = i.offsetHeight; o.style.minHeight = `${floor}px`; } });
    ro.observe(i);
    const onScroll = () => {
      const f = Math.max(i.offsetHeight, Math.min(floor, innerHeight - o.getBoundingClientRect().top));
      if (f < floor) { floor = f; o.style.minHeight = `${floor}px`; }
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); removeEventListener('scroll', onScroll); };
  }, [shown]);

  const available = useMemo(() => (gyms.active ? availableSet(gyms.active, [...PROGRAM_LIFTS, ...exerciseNames(store.entries), ...gyms.active.include]) : undefined),
    [gyms.active, store.entries]);
  // Owner decision 2: at a 3-week block boundary, the program offers to step toward his ranges (never by itself).
  const ctx = useMemo(() => (available ? { available, include: gyms.active!.include } : {}), [available, gyms.active]);
  const [updateTaps, setUpdateTaps] = useState(0);
  const [replaced, setReplaced] = useState<Program | null>(null);
  useEffect(() => { if (!replaced) return; const t = setTimeout(() => setReplaced(null), 8000); return () => clearTimeout(t); }, [replaced]);
  const update = useProgramUpdate({ owner, program: date === today ? programs.program : null, entries: store.entries, body: body.days, profile, today, ctx, keptRest: undefined, taps: updateTaps });

  // A stalled lift's next variation, on its card: today only, for a lift in the program, before its first working set
  // (once it's started, switching would only muddle today's plan). Worked out once per lift per log change.
  const rotations = useMemo(() => new Map<string, { r: Rotation; carry: Carry | null; known: boolean } | null>(), [store.entries, today, programs.program, available, settings.get, body.days, deloadTaps]);
  const rotationOf = (n: string) => {
    const k = n.toLowerCase();
    if (!rotations.has(k)) {
      const r = rotation(store.entries, n, today, { available, include: gyms.active?.include, program: programs.program, body: body.days, light: tapped });
      rotations.set(k, r && { r, carry: carryOver(store.entries, r.from, r.to, today, settings.get(r.to)), known: store.entries.some((e) => sameExercise(e.exercise, r.to)) });
    }
    return rotations.get(k)!;
  };
  const [switched, setSwitched] = useState<{ from: string; to: string; undo: () => Promise<void> } | null>(null);
  useEffect(() => { if (!switched) return; const t = setTimeout(() => setSwitched(null), 8000); return () => clearTimeout(t); }, [switched]);
  const rotate = async (r: Rotation, carry: Carry | null) => {
    const undo = await applyRotation(r, carry, programs, settings, today, plan);
    // The new lift's card takes the old one's place.
    setExtra((xs) => (xs.some((x) => sameExercise(x, r.from)) ? xs.map((x) => (sameExercise(x, r.from) ? r.to : x)) : [...xs, r.to]));
    setGo({ to: r.to, open: true });
    setSwitched({ from: r.from, to: r.to, undo });
  };
  const undoRotate = async () => {
    if (!switched) return;
    const { from, to, undo } = switched;
    setSwitched(null);
    await undo();
    setExtra((xs) => xs.map((x) => (sameExercise(x, to) ? from : x)));
    setGo({ to: from, open: false });
  };
  const asideFor = (n: string) => {
    // Just switched: the new lift's card says so, with the undo, where you're looking.
    if (switched && sameExercise(switched.to, n)) {
      return <p className="undo-note rotate-undo" role="status"><span>Switched from {switched.from}.</span><button className="mini" onClick={() => void undoRotate()}>Undo</button></p>;
    }
    if (date !== today || store.entries.some((e) => e.date === date && sameExercise(e.exercise, n) && isWorking(e))) return null;
    // Likelier than not to hurt again (item 08): a swap for today's plan, when it's planned.
    const pain = persistentPain(store.entries, n, today);
    const planned = programs.program && plan && plannedNames(programs.program, plan).some((p) => sameExercise(p, n))
      ? Object.entries(plan.swaps).find(([, to]) => sameExercise(to, n))?.[0] ?? n : null;
    const lastPain = pain ? store.entries.reduce((d, e) => (sameExercise(e.exercise, n) && e.flags.includes('pain') && e.date > d ? e.date : d), '') : '';
    const sore = pain && <PainPrompt owner={owner} lift={n} pain={pain} lastPain={lastPain} onSwap={planned ? () => setSwapFor(planned) : undefined} />;
    const x = programs.program && inProgram(programs, n) ? rotationOf(n) : null;
    const rot = x && <RotationSuggestion owner={owner} r={x.r} carry={x.carry} known={x.known} today={today} onSwitch={() => void rotate(x.r, x.carry)} />;
    return sore || rot ? <>{sore}{rot}</> : null;
  };
  if (picking) return <ExercisePicker recent={exerciseNames(store.entries)} gym={gyms.active} onCancel={() => setPicking(false)}
    onPick={(n) => { goTo(n); setPicking(false); }} />;
  if (swapFor && plan) return <ExercisePicker recent={exerciseNames(store.entries)} gym={gyms.active} title={`Swap ${swapFor}`} suggested={swapSuggestions(swapFor, store.entries, date, 5, available)} onCancel={() => setSwapFor(null)}
    onPick={(n) => {
      void programs.savePlan({ ...plan, swaps: { ...plan.swaps, [swapFor]: n } });
      // The replaced lift's card goes with it while nothing is logged on it today (a logged lift's card stays: it's in the log).
      const replaced = plan.swaps[swapFor] ?? swapFor;
      if (!store.entries.some((e) => e.date === date && sameExercise(e.exercise, replaced))) setExtra((xs) => xs.filter((x) => !sameExercise(x, replaced)));
      goTo(n); setSwapFor(null);
    }} />;

  return (
    <div ref={outer}><div ref={inner}>
      <div className="today-head">
        <div className="day-switch" data-tour="day">
          <button className="mini" aria-label="Previous day" onClick={() => onDay(addDays(date, -1))}><Icon name="chev-left" size={28} sw={2} /></button>
          <h1>{fmtDay(date, today)}</h1>
          <button className="mini" aria-label="Next day" disabled={date >= today} onClick={() => onDay(addDays(date, 1))}><Icon name="chev-right" size={28} sw={2} /></button>
        </div>
        <button className="quiet-btn program-btn" data-tour="program" onClick={onOpenProgram}>Program</button>
      </div>
      {/* Which gym only matters once there's a choice of them. */}
      {gyms.gyms.length > 1 && gyms.active && <button className="gym-line" onClick={onOpenGym}><span>at <b className="pname">{gyms.active.name}</b></span><Icon name="chev-right" size={16} sw={2} /></button>}
      {news && onOpenNews && (
        <button className="today-news" onClick={() => onOpenNews({ uid: news.uid, name: news.name })}>
          <Icon name="message" size={22} /><span><FriendName me={me} friend={news} bare /> {news.text}</span><span className="small reply">tap to reply</span>
        </button>
      )}
      {date < today && <p className="card note-card past-day"><span>Logging to a past day</span><button className="mini" style={{ whiteSpace: 'nowrap' }} onClick={() => onDay(today)}>Back to today</button></p>}
      {carried && <p className="card note-card past-day"><span>{close.how ? `${fmtDay(today, today)}’s workout is done` : `Still logging ${fmtDay(today, today)}’s workout`}</span><button className="mini" style={{ whiteSpace: 'nowrap' }} onClick={onSplit}>Today</button></p>}
      {date === today && <MorningCheck store={store} today={today} />}
      {date === today && <TodayDigest owner={owner} entries={store.entries} profile={profile} today={today} recap={recap} />}
      <WeighIn body={body} date={date} />
      <Energy body={body} date={date} />
      <CycleRow date={date} />
      {light && <LightWeekLine to={light.to} today={today} onEnd={() => { endLight(owner, store.entries, date); snoozeDeload(owner, today); setDeloadTaps((n) => n + 1); }} />}
      {offerDeload && sys && <DeloadPrompt s={sys} onStart={() => { startLight(owner, today); setDeloadTaps((n) => n + 1); }} onLater={() => { snoozeDeload(owner, today); setDeloadTaps((n) => n + 1); }} />}
      {date === today && update && programs.program && <ProgramUpdateCard owner={owner} program={programs.program} update={update}
        onUpdate={(next) => { setReplaced(programs.program); void programs.save(next); }} onLater={() => setUpdateTaps((n) => n + 1)} />}
      {replaced && <p className="undo-note" role="status">Program updated. <button className="mini" onClick={() => { void programs.save(replaced); setReplaced(null); }}>Undo</button></p>}
      {lastUnseen && (
        <FinishCard entries={store.entries} date={lastUnseen} today={today} profile={profile} program={programs.program} plans={programs.plans} how="auto" body={body.days} settings={settings} owner={owner}
          onDismiss={() => { markFinished(owner, lastUnseen, { seen: true }); setFinishRev((n) => n + 1); }} />
      )}
      {summary && (
        <FinishCard entries={store.entries} date={date} today={today} profile={profile} program={programs.program} plans={programs.plans} how={close.how} body={body.days} settings={settings} owner={owner}
          planName={programs.program && plan ? (plan.quick != null ? 'Quick' : (programs.program.days[plan.day] ?? programs.program.days[0])?.name) : undefined} onMore={addMore} />
      )}
      {programs.program && plan && hasPlan && !summary && (
        <TodayPlan program={programs.program} plan={plan} entries={store.entries} past={date < today} open={open} onToggle={() => setPlanOpen(!open)}
          buildQuick={(fits) => quickDay(profile, store.entries, date, fits, available ? { available, include: gyms.active!.include } : {})}
          onChange={(p) => void programs.savePlan(p)} onOpen={goTo} onSwap={setSwapFor} loadFor={loadFor} rangeFor={settings.get} keptRest={(ex) => settings.get(ex).rest} restDelta={restDelta} />
      )}
      {/* No program: a quick session from what the week is behind on, once there's a history to go by. Never on a past day. */}
      {!programs.program && date === today && !summary && store.entries.some((e) => e.date < date) && (
        <SuggestedToday profile={profile} entries={store.entries} date={date} gym={gyms.active} loadFor={loadFor} onOpen={goTo} />
      )}
      {cards.length === 0 && <p className="muted">{date < today ? 'Nothing logged that day.' : 'Nothing logged yet today.'}</p>}
      {cards.map((n) => <ExerciseCard key={n.toLowerCase()} exercise={n} date={date} today={today} store={store} settings={settings} onOpen={onOpen}
        plannedSets={plannedSets(programs.program, plan, n)} plannedMinutes={plannedMinutes(programs.program, plan, n)} gym={gyms.active?.name} who={who} left={hasPlan ? left : []} onGo={goTo}
        swappedFrom={plan ? Object.entries(plan.swaps).find(([, to]) => sameExercise(to, n))?.[0] : undefined}
        openReq={openReq && sameExercise(openReq.to, n) ? openReq : null}
        supersetWith={groupOf(n)?.lifts.filter((x) => !sameExercise(x, n))} onNotSuperset={() => { const g = groupOf(n); if (g) dismiss(g); }}
        switchAfter={switchAfter} roundAfter={roundAfter} plannedOf={(ex) => plannedSets(programs.program, plan, ex)} onSwitch={(to) => setSwitchTo({ to })} aside={asideFor(n)} restDelta={restDelta} light={!!light}
        completesPlan={completesPlan} onPlanDone={onPlanDone} />)}
      {/* Below the cards, so the card you're logging on never moves down. */}
      {!summary && <SessionSummary entries={store.entries} date={date} past={date < today} />}
      <button className="wide add-exercise" data-tour="add" onClick={() => setPicking(true)}>Add exercise</button>
      <RestTimer />
    </div></div>
  );
}
