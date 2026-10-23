import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { sendPing, type Friend, type FriendNews } from '../cloud/friends';
import { activeProfileDb } from '../db/db';
import { fmtClock, fmtMiles } from '../domain/cardio';
import { dayKinds, latestSession, sessionLabel, setsNote, statusLength, STATUS_MAX } from '../domain/crew';
import { friendPrs, goalWeek, KIND_SHORT, liveSince, ringSets, sessionCard, usualSession, type Card, type CardLift, type GoalWeek } from '../domain/feed';
import { fmtAdded } from '../domain/format';
import { PRESETS, shortAgo, type InboxDoc, type PresetKey } from '../domain/messages';
import { prIds } from '../domain/records';
import type { SetEntry } from '../domain/types';
import { useMinute } from '../state/clock';
import { crewRange, notePing, peekFriendCache, refreshSummaries, refreshWindow, staleSummaries, staleWindow, useFriendCache, useFriendTags } from '../state/friendCache';
import { featured, unlocksOf, type Unlock } from '../domain/achievements';
import { AchChip } from './AchievementsSheet';
import { togetherDay } from '../domain/together';
import { useAchSince } from '../state/useAchievements';
import { sideOf } from '../state/useTogether';
import { getPref, setPref } from '../state/prefs';
import type { StatusStore } from '../state/useStatus';
import { Input } from './Field';
import { Icon, initials } from './icons';
import { Latest, MessageButton } from './MessageButton';
import { Formerly, Glued, useFriendLabel, useVerified, Verified } from './FriendName';
import { kindColour, Ring } from './Ring';

// Friends, told as today's stories (round 18, direction A "Feed"): a ring per person filling with today's sets, a card per
// session today with its top sets, PRs and one-tap reactions (the pings that already exist), and the rest of the week below.
// Everything comes from the lines Crew already reads (state/friendCache): no read of its own beyond them. Nobody is ranked
// by what they lift: the rings run by each one's week against their own goal, the cards by when they trained.

const REACTIONS: PresetKey[] = ['strong', 'fire', 'clap'];
const BURST = 7; // emoji that rise from a reaction
const SHOWN_LIFTS = 3;

interface Person {
  id: string; me: boolean; friend?: Friend; label: string; /** Whose initials the avatar shows. */ handle: string; status: string;
  /** The app's owner verified them: the ✓ after their name. */ verified?: boolean;
  /** What leads their name: your tag, else their display name (none: the @username alone). */ lead?: string;
  loading: boolean; error?: string;
  card: Card | null; live: number | null; week: GoalWeek | null; usual: number; today: ReturnType<typeof ringSets>;
  last: { date: string; kinds: string; sets: number } | null;
  /** A friend's achievements reached today, silver and up (their Compare summary; owner Q6). */ ach?: Unlock[];
  /** You trained together today (domain/together), as only you see it: "You and @ana at Iron Den, 6:10–7:05 PM". */ together?: string;
}

export const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayStart = (now: number) => new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
const kindsLabel = (sets: SetEntry[]) => dayKinds(sets).kinds.map((k) => KIND_SHORT[k]).join(' + ') || 'Training';
/** How far into their own goal this week: what the rings are ordered by. */
const goalShare = (p: Person) => (p.week ? Math.min(1, p.week.sessions / Math.max(1, p.week.goal)) : -1);

export function Feed({ uid, myName, friends, entries, goal, today, status, news, pulled = 0, onOpenFriend, onOpenMine, onInvite, onMessage, onCompare }: {
  uid: string; /** This phone's person, for your avatar. */ myName?: string; friends: Friend[] | null; entries: SetEntry[];
  /** Your sessions-a-week goal. */ goal: number; today: string; status: StatusStore; news?: FriendNews | null;
  /** Moves on each pull-down or Refresh: every line is read again. */ pulled?: number;
  onOpenFriend: (f: Friend) => void; onOpenMine: () => void; onInvite: () => void; /** A friend's thread: pings and messages. */ onMessage?: (f: Friend) => void;
  /** Compare: everyone side by side (ui/ComparePage). */ onCompare?: () => void;
}) {
  const { from } = crewRange(today);
  const minute = useMinute(); // "live" ends 20 minutes after a set, and ages move on, with no read
  const cache = useFriendCache(uid);
  const windows = cache?.windows;
  const since = useAchSince();
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Your private tag beside their @username ("Sam (gym) · @sam_k"), as the names round keeps it.
  const label = useFriendLabel(uid);
  const verified = useVerified(uid);
  const tags = useFriendTags(uid);

  // Each friend's line as the phone kept it, read again quietly when 5 minutes old or for a new day. A failed read shows only
  // where nothing was kept; a kept line stays as it was.
  const load = useCallback(async (force: boolean) => {
    if (!friends?.length) return;
    const now = Date.now(), kept = peekFriendCache(uid)?.windows ?? {};
    // Their Compare summaries, for today's achievement chips: one read each when over 5 minutes old (the cache Compare keeps).
    const sums = force ? friends.map((f) => f.uid) : staleSummaries(peekFriendCache(uid), friends.map((f) => f.uid), now);
    if (sums.length) void loadCloud().then((c) => refreshSummaries(c, uid, sums)).catch(() => {});
    const need = friends.filter((f) => force || staleWindow(kept[f.uid], from, today, now));
    if (!need.length) return;
    const fail = (f: Friend, e: unknown) => {
      if (peekFriendCache(uid)?.windows[f.uid]) return;
      setErrors((x) => ({ ...x, [f.uid]: (e as { code?: string }).code === 'permission-denied' ? 'You can’t see their log any more.' : cloudError(e) }));
    };
    try {
      const c = await loadCloud();
      await Promise.all(need.map(async (f) => {
        try { await refreshWindow(c, uid, f.uid, from, today); setErrors(({ [f.uid]: _ok, ...x }) => x); } catch (e) { fail(f, e); }
      }));
    } catch (e) { need.forEach((f) => fail(f, e)); }
  }, [friends, uid, from, today]);
  useEffect(() => { void load(false); }, [load]);
  const seenPull = useRef(pulled);
  useEffect(() => { if (pulled !== seenPull.current) { seenPull.current = pulled; void load(true); } }, [pulled, load]);

  // Your own PRs are true PRs, from your whole log; a friend's are what their phone wrote, else best in what was read.
  const myPrs = useMemo(() => prIds(entries), [entries]);
  const people = useMemo((): Person[] => {
    const now = Date.now();
    const build = (base: Omit<Person, 'card' | 'live' | 'week' | 'usual' | 'today' | 'last'>, sets: SetEntry[], prs: Set<string>, g: number | null): Person => {
      const last = latestSession(sets);
      const day = sets.filter((e) => e.date === today);
      return {
        ...base, card: sessionCard(sets, today, prs, now), live: liveSince(day, now), week: g ? goalWeek(sets, today, g) : null,
        usual: usualSession(sets, today), today: ringSets(day),
        last: last ? { date: last.date, kinds: kindsLabel(sets.filter((e) => e.date === last.date)), sets: sets.filter((e) => e.date === last.date && !e.flags.includes('warmup') && !e.cardio).length } : null,
      };
    };
    const mine = entries.filter((e) => e.date >= from && e.date <= today);
    const me = build({ id: 'me', me: true, label: 'You', handle: myName || 'You', status: status.status, loading: false }, mine, myPrs, goal);
    const theirs = (friends ?? []).map((f) => {
      const w = windows?.[f.uid], error = w ? undefined : errors[f.uid];
      const sets = (w?.win.sets ?? []).filter((x) => x.date >= from && x.date <= today);
      const sum = cache?.summaries?.[f.uid]?.doc;
      const ach = sum?.ach ? featured(unlocksOf(sum.ach)).filter((u) => u.date === today) : undefined;
      const met = w ? togetherDay(entries, since, sideOf(f.uid, w, cache?.summaries?.[f.uid]), today) : null;
      const together = met ? `You and @${f.name} at ${met.gym}, ${clock(met.from)}–${clock(met.to)}` : undefined;
      return { ...build({ id: f.uid, me: false, friend: f, label: label(f.uid, f.name, f.dn), lead: tags[f.uid] || f.dn, handle: f.dn || f.name, verified: verified[f.uid] != null, status: w?.win.status ?? '', loading: !w && !error, error },
        sets, w ? friendPrs(w.win) : new Set(), w?.win.goal ?? null), ...(ach?.length && { ach }), ...(together && { together }) };
    });
    return [me, ...theirs];
    // `minute`: live and today's cards move on with the clock.
  }, [entries, friends, windows, cache?.summaries, errors, status.status, from, today, goal, myName, myPrs, minute, label, verified, tags, since]); // eslint-disable-line react-hooks/exhaustive-deps

  const rail = [people[0], ...people.slice(1).sort((a, b) => goalShare(b) - goalShare(a) || a.label.localeCompare(b.label))];
  const trained = people.filter((p) => p.card);
  const cards = [...trained].sort((a, b) => (b.live ?? 0) - (a.live ?? 0) || (Number.isNaN(b.card!.end) ? -1 : Number.isNaN(a.card!.end) ? 1 : b.card!.end - a.card!.end));
  const earlier = people.slice(1).filter((p) => !p.card)
    .sort((a, b) => goalShare(b) - goalShare(a) || (b.last?.date ?? '').localeCompare(a.last?.date ?? '') || a.label.localeCompare(b.label));
  const liveCount = people.filter((p) => p.live != null).length;

  // The rings draw in on the first look of the day only (a pref on this phone), never on every visit.
  const [owner] = useState(activeProfileDb);
  const [draw] = useState(() => getPref<string>(owner, 'feed:drawn') !== today);
  useEffect(() => { setPref(owner, 'feed:drawn', today); }, [owner, today]);

  const { sending, burst, sendError, react } = useReactions(uid);

  // What you sent each friend today, and what each sent you: from the threads and inbox kept, no read.
  const start = dayStart(Date.now());
  const sentToday = (f: string): InboxDoc | null => (cache?.threads[f]?.mine ?? []).filter((d) => d.kind === 'p' && d.at >= start).sort((a, b) => b.at - a.at)[0] ?? null;
  const names = new Map((friends ?? []).map((f) => [f.uid, f.name]));
  const gotToday = (cache?.inbox?.items ?? []).filter((d) => d.kind === 'p' && d.at >= start && names.has(d.from)).sort((a, b) => a.at - b.at);

  const now = Date.now();
  const open = (p: Person) => (p.friend ? onOpenFriend(p.friend) : onOpenMine());
  return (
    <section className="crew feed" aria-label="Crew">
      <p className="fd-dateline">
        <b>{trained.length} of {people.length}</b> trained today{liveCount > 0 && <> · <span className="fd-livetxt">{liveCount} training now</span></>}
      </p>
      <StatusEdit status={status} />
      <ul className={`fd-rail${rail.some((p) => p.live != null) ? ' has-live' : ''}`} aria-label="Everyone today">
        {rail.map((p, j) => <RailPerson key={p.id} p={p} draw={draw} delay={j * 70} onOpen={() => open(p)} />)}
      </ul>
      {onCompare && !!friends?.length && (
        <button className="fd-compare" onClick={onCompare}>
          <Icon name="trophy" size={22} />
          <span><b>Compare</b><span>Everyone against their own start: strength, goal, streak</span></span>
          <Icon name="chev-right" size={20} />
        </button>
      )}

      {cards.length > 0 && <div className="fd-sec"><h2>Today</h2><span>{new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>}
      {cards.map((p) => (
        <SessionCard key={p.id} p={p} now={now} news={news} onOpen={() => open(p)} onMessage={p.friend && onMessage ? () => onMessage(p.friend!) : undefined}
          sending={sending} burst={burst?.uid === p.id ? burst.k : null} error={sendError?.uid === p.id ? sendError.text : null}
          sent={p.friend ? sentToday(p.friend.uid) : null} got={p.me ? gotToday.map((d) => ({ e: d.e, name: names.get(d.from)!, id: d.id })) : []}
          onReact={(k) => p.friend && void react(p.friend, k)} />
      ))}

      {earlier.length > 0 && <div className="fd-sec"><h2>{cards.length ? 'Earlier' : 'This week'}</h2><span>no session today</span></div>}
      {earlier.length > 0 && (
        <ul className="fd-list">
          {earlier.map((p) => <EarlierRow key={p.id} p={p} today={today} news={news} onOpen={() => open(p)} onMessage={onMessage && p.friend ? () => onMessage(p.friend!) : undefined} />)}
        </ul>
      )}
      {friends && !friends.length && <p className="muted small fd-empty">No friends here yet. Invite one and their ring shows up next to yours.</p>}
      {/* In the page, while you have fewer than three friends: floating, it covered what scrolled under it. */}
      {friends && friends.length < 3 && <button className="crew-invite" onClick={onInvite}><Icon name="person-plus" size={20} />Invite a friend</button>}
    </section>
  );
}

/** A person in the rail: their ring for today, a LIVE pill under it (never over the avatar), their name and week against their goal. */
function RailPerson({ p, draw, delay, onOpen }: { p: Person; draw: boolean; delay: number; onOpen: () => void }) {
  const idle = !p.today.length;
  const wk = p.week;
  const words = [p.label, p.live != null ? 'training now' : p.card ? 'trained today' : 'not today', wk ? `${wk.sessions} of ${wk.goal} this week${wk.met ? ', goal met' : ''}` : ''].filter(Boolean).join(', ');
  return (
    <li className="fd-who" style={{ '--d': delay } as CSSProperties}>
      <button className="fd-who-btn" aria-label={words} onClick={onOpen} data-testid={`ring-${p.me ? 'me' : p.friend!.name}`}>
        <span className={`fd-ringwrap${idle ? ' idle' : ''}${p.live != null ? ' pulse' : ''}`}>
          {idle ? <svg className="ring" width="62" height="62" viewBox="0 0 62 62" aria-hidden="true"><circle cx="31" cy="31" r="29.25" fill="none" stroke="var(--fill-2)" strokeWidth="2" strokeDasharray="3 5" /></svg>
            : <Ring segs={p.today} total={p.usual} size={62} width={4} draw={draw} merge />}
          <span className={p.me ? 'avatar me' : 'avatar'} aria-hidden="true">{initials(p.handle)}</span>
          {wk?.met && <span className="fd-corner gold" aria-hidden="true"><Icon name="trophy" size={13} sw={2.2} /></span>}
          {!wk?.met && p.card && <span className="fd-corner done" aria-hidden="true"><Icon name="check" size={14} sw={2.4} /></span>}
        </span>
        <span className="fd-live-slot" aria-hidden="true">{p.live != null && <span className="fd-live">LIVE</span>}</span>
        <span className={`fd-nm${idle ? ' dim' : ''}`} aria-hidden="true">{p.label}</span>
        {wk ? (<>
          <span className={`fd-wk${wk.met ? ' met' : ''}`} aria-hidden="true">{Array.from({ length: Math.min(7, Math.max(wk.goal, wk.sessions)) }, (_, k) => <i key={k} className={k < wk.sessions ? 'on' : ''} />)}</span>
          <span className="fd-wkl" aria-hidden="true">{wk.sessions} of {wk.goal}</span>
        </>) : <span className="fd-wkl" aria-hidden="true">{p.loading ? '…' : ''}</span>}
      </button>
    </li>
  );
}

/**
 * A name on a card or row: the label ("Sam K. · @sam_k"), with the ✓ after the lead when the owner verified them, drawn only (the
 * name is a button: tapped, it opens their page, where the ✓ says what it means).
 */
function Named({ p }: { p: Person }) {
  if (!p.friend || !p.verified) return <>{p.label}</>;
  const mark = <Verified name={p.friend.name} tap={false} />;
  return p.lead ? <><Glued text={p.lead} after={mark} /> · @{p.friend.name}</> : <Glued text={`@${p.friend.name}`} after={mark} />;
}

export const topText = (l: CardLift) => (l.seconds != null ? fmtClock(l.seconds) : `${fmtAdded(l.weight)} × ${l.reps ?? '?'}${l.hold ? 's' : ''}`);
/** Beside the top set: "best of 3 sets" unless every set was it ("all 3 sets"), so one 55 × 10 never reads as three. */
export const subText = (l: CardLift) => (l.seconds != null ? (l.miles != null ? `${fmtMiles(l.miles)} mi` : '') : setsNote(l));

/** One person's session today: who, when, the kinds as a bar, each lift's top set, and reactions (yours to send, or theirs to you). */
function SessionCard({ p, now, news, onOpen, onMessage, sending, burst, error, sent, got, onReact }: {
  p: Person; now: number; news?: FriendNews | null; onOpen: () => void; onMessage?: () => void;
  sending: string | null; burst: PresetKey | null; error: string | null; sent: InboxDoc | null; got: { e?: string; name: string; id: string }[];
  onReact: (k: PresetKey) => void;
}) {
  const c = p.card!;
  const [all, setAll] = useState(false);
  // A set landing on a live card: a lift new since the first look slides in, the count ticks. Each stays marked a few seconds
  // (the moment is 420 ms), so the renders that follow don't cut it short.
  const seen = useRef<{ lifts: Map<string, number>; sets: number; setsAt: number } | null>(null);
  const t = Date.now();
  if (!seen.current) seen.current = { lifts: new Map(c.lifts.map((l) => [l.key, 0])), sets: c.sets, setsAt: 0 };
  for (const l of c.lifts) if (!seen.current.lifts.has(l.key)) seen.current.lifts.set(l.key, t);
  if (seen.current.sets !== c.sets) seen.current = { ...seen.current, sets: c.sets, setsAt: t };
  const fresh = (at: number | undefined) => !!at && t - at < 5000;
  const shown = all || c.lifts.length <= SHOWN_LIFTS ? c.lifts : c.live ? c.lifts.slice(-SHOWN_LIFTS) : c.lifts.slice(0, SHOWN_LIFTS);
  const hidden = c.lifts.length - shown.length;
  const total = Object.values(c.kinds).reduce((a, b) => a + (b ?? 0), 0);
  const kinds = kindsFromCard(c);
  const when = Number.isNaN(c.start) ? '' : c.live ? `since ${clock(c.start)}` : clock(c.start);
  const meta = [kinds, when, c.sets ? `${c.sets} set${c.sets === 1 ? '' : 's'}` : '', c.minutes ? `${c.minutes} min` : '', p.me && c.prs ? `${c.prs} PR${c.prs === 1 ? '' : 's'}` : ''].filter(Boolean);
  const unread = p.friend ? news?.unread[p.friend.uid] ?? 0 : 0;
  return (
    <article className={`fd-card${c.live ? ' live' : ''}`} data-testid={p.me ? 'crew-me' : `crew-${p.friend!.name}`} aria-label={`${p.label}, ${c.live ? 'training now' : 'today'}`}>
      <div className="fd-card-head">
        <span className={`${p.me ? 'avatar me' : 'avatar'}${c.live ? ' pulse' : ''}`} aria-hidden="true">{initials(p.handle)}</span>
        <div className="fd-who-text">
          <div className="fd-name-line">
            <button className="link fd-name" onClick={onOpen}><Named p={p} /></button>
            {p.friend && <Formerly friend={p.friend} />}
            {p.friend?.muted && <span className="crew-muted" role="img" aria-label="Muted"><Icon name="bell-off" size={15} /></span>}
            {p.status && !p.me && <span className="fd-status">{p.status}</span>}
          </div>
          <div className="fd-meta">{meta.map((m, i) => <span key={i}>{i > 0 && ' · '}{m === `${c.sets} set${c.sets === 1 ? '' : 's'}` && fresh(seen.current!.setsAt) ? <span className="fd-tick" key={c.sets}>{m}</span> : m}</span>)}</div>
        </div>
        {c.live ? <span className="fd-live">LIVE</span> : !Number.isNaN(c.end) && <span className="fd-ago">{shortAgo(c.end, now)}</span>}
      </div>
      {total > 0 && <div className="fd-split" aria-hidden="true">{Object.entries(c.kinds).map(([k, n]) => <i key={k} style={{ flex: n, background: kindColour(k as never) }} />)}</div>}
      {p.week?.metToday && <span className="fd-goalrib"><Icon name="trophy" size={16} sw={2} />Weekly goal hit · {p.week.sessions} of {p.week.goal}</span>}
      {p.together && <span className="fd-together"><Icon name="friends" size={16} sw={2} />Trained together · {p.together}</span>}
      {p.ach && <ul className="ach-chips" aria-label="Achievements today">{p.ach.map((u) => <li key={`${u.id}:${u.lift ?? ''}`}><AchChip u={u} /></li>)}</ul>}
      <ul className="fd-lifts">
        {shown.map((l) => (
          <li key={l.key} className={fresh(seen.current!.lifts.get(l.key)) ? 'new' : undefined}>
            <span className="fd-ln"><span className="fd-kdot" style={{ background: kindColour(l.kind) }} aria-hidden="true" /><span className="fd-lname">{l.exercise}</span>{l.now && <span className="fd-now">now</span>}</span>
            <span className="fd-top">{l.pr && <span className="fd-pr">PR</span>}{topText(l)}<span className="fd-n">{subText(l)}</span></span>
          </li>
        ))}
        {hidden > 0 && <li className="fd-more-row"><button className="fd-more" aria-expanded={false} onClick={() => setAll(true)}>+{hidden} more lift{hidden === 1 ? '' : 's'}</button></li>}
      </ul>
      {p.friend ? (
        <div className="fd-react" role="group" aria-label={`React to @${p.friend.name}`}>
          {REACTIONS.map((k) => <ReactButton key={k} k={k} name={p.friend!.name} burst={burst === k} sent={sent?.e === k} disabled={!!sending} onClick={() => onReact(k)} />)}
          <span className="fd-said" role="status">
            {error ? <span className="warn">{error}</span>
              : burst ? <span className="fd-sentmsg"><b>Sent {PRESETS[burst].emoji}</b> · just now</span>
              : unread > 0 ? <Latest news={news} uid={p.friend.uid} />
              : sent ? <><b>You sent {PRESETS[sent.e as PresetKey]?.emoji ?? 'a ping'}</b> · {clock(sent.at)}</>
              : news?.latest[p.friend.uid] ? <Latest news={news} uid={p.friend.uid} /> : 'React'}
          </span>
          {onMessage && <MessageButton name={p.friend.name} unread={unread} onClick={onMessage} />}
        </div>
      ) : got.length > 0 && (
        <p className="fd-got">
          <span className="sr-only">Reactions today: </span>
          {got.slice(-4).map((g) => {
            const p = g.e && g.e in PRESETS ? PRESETS[g.e as PresetKey] : null;
            return <span key={g.id}><span className="e" role="img" aria-label={p ? p.copy : 'A ping'}>{p ? p.emoji : '·'}</span> @{g.name}</span>;
          })}
        </p>
      )}
    </article>
  );
}
/** The day's kinds in words, from the card's own count: the top kind, and a second within 20% of it (domain/crew dayKinds). */
export function kindsFromCard(c: Card): string {
  const ranked = (Object.entries(c.kinds) as [keyof typeof KIND_SHORT, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'Training';
  const [[top, n], next] = ranked;
  return next && next[1] >= n * 0.8 ? `${KIND_SHORT[top]} + ${KIND_SHORT[next[0]]}` : KIND_SHORT[top];
}

// Where each of a reaction's seven emoji ends up, and how it turns: fixed, so every burst is the same shape.
const PARTICLE = ([
  { '--i': 0, '--dx': '-34px', '--dy': '-78px', '--r': '-18deg' }, { '--i': 1, '--dx': '-8px', '--dy': '-104px', '--r': '8deg', '--s': 1.2 },
  { '--i': 2, '--dx': '22px', '--dy': '-86px', '--r': '20deg' }, { '--i': 3, '--dx': '44px', '--dy': '-58px', '--r': '30deg', '--s': 0.8 },
  { '--i': 4, '--dx': '-48px', '--dy': '-48px', '--r': '-30deg', '--s': 0.8 }, { '--i': 5, '--dx': '6px', '--dy': '-60px', '--r': '-6deg', '--s': 0.9 },
  { '--i': 6, '--dx': '-22px', '--dy': '-120px', '--r': '12deg', '--s': 0.7 },
] as Record<string, string | number>[]) as CSSProperties[];

/** Reactions: one at a time; the button that sent one bursts (social.css), and what sent it says so. Each is a ping (sendPing). */
export function useReactions(uid: string) {
  const [sending, setSending] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ uid: string; k: PresetKey; at: number } | null>(null);
  const [sendError, setSendError] = useState<{ uid: string; text: string } | null>(null);
  const react = async (f: Friend, k: PresetKey) => {
    if (sending) return;
    setSending(f.uid); setSendError(null);
    const t0 = Date.now();
    try {
      const id = await sendPing(await loadCloud(), uid, f.uid, k);
      setBurst({ uid: f.uid, k, at: Date.now() });
      await notePing(uid, f.uid, { id, from: uid, kind: 'p', e: k, at: Date.now() });
    } catch (e) {
      setSendError({ uid: f.uid, text: (e as { plain?: boolean }).plain ? (e as Error).message : 'Couldn’t send.' });
    } finally { setTimeout(() => setSending(null), Math.max(0, 2000 - (Date.now() - t0))); } // the rules want 2 s between sends
  };
  useEffect(() => { if (!burst) return; const t = setTimeout(() => setBurst(null), 1000); return () => clearTimeout(t); }, [burst]);

  return { sending, burst, sendError, react };
}

/** One reaction button, with its burst of emoji while `burst`. */
export function ReactButton({ k, name, burst, sent, disabled, onClick }: { k: PresetKey; name: string; burst: boolean; sent: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className={`fd-rbtn${burst ? ' fire' : ''}${sent ? ' sent' : ''}`} aria-label={`Send ${PRESETS[k].emoji} ${PRESETS[k].copy} to @${name}`} disabled={disabled} onClick={onClick}>
      <span aria-hidden="true">{PRESETS[k].emoji}</span>
      {burst && <span className="fd-particles" aria-hidden="true">{Array.from({ length: BURST }, (_, i) => <span key={i} style={PARTICLE[i]}>{PRESETS[k].emoji}</span>)}</span>}
    </button>
  );
}

/** A friend with no session today: their last one, and their week against their own goal. */
function EarlierRow({ p, today, news, onOpen, onMessage }: { p: Person; today: string; news?: FriendNews | null; onOpen: () => void; onMessage?: () => void }) {
  const f = p.friend!;
  const gone = p.last ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${p.last.date}T12:00:00Z`)) / 864e5) : null;
  const line = p.error ? <span className="warn">{p.error}</span>
    : p.loading ? 'Loading…'
    : !p.last ? 'No sessions in 8 weeks'
    : gone! >= 7 ? `${gone} days since a session`
    : `${sessionLabel(p.last.date, today)} · ${p.last.kinds}${p.last.sets ? ` · ${p.last.sets} sets` : ''}`;
  return (
    <li className="fd-row" data-testid={`crew-${f.name}`}>
      <span className={`avatar${gone != null && gone >= 7 ? ' faded' : ''}`} aria-hidden="true">{initials(p.handle)}</span>
      <div className="fd-who-text">
        <div className="fd-name-line">
          <button className="link fd-name" onClick={onOpen}><Named p={p} /></button>
          <Formerly friend={f} />
          {f.muted && <span className="crew-muted" role="img" aria-label="Muted"><Icon name="bell-off" size={15} /></span>}
          {p.status && <span className="fd-status">{p.status}</span>}
        </div>
        <p className="fd-meta">{line}{p.week && !p.error && <> · {p.week.sessions} of {p.week.goal} this week</>}</p>
        {onMessage && <Latest news={news} uid={f.uid} />}
      </div>
      {onMessage && <MessageButton name={f.name} unread={news?.unread[f.uid] ?? 0} onClick={onMessage} />}
    </li>
  );
}

/** Your own phrase: tap it to change it. Empty shows only a quiet pencil and "Status"; nothing ever asks for one. */
function StatusEdit({ status }: { status: StatusStore }) {
  const [text, setText] = useState<string | null>(null);
  if (text == null) {
    return (
      <div className="fd-mystatus" data-testid="my-status">
        {status.status
          ? <button className="crew-tap" aria-label={`Your status: ${status.status}. Change it`} onClick={() => setText(status.status)}><span className="crew-bubble">{status.status}</span><Icon name="pencil" size={16} /></button>
          : <button className="crew-tap" onClick={() => setText('')}><Icon name="pencil" size={16} /><span className="crew-bubble add">Status</span></button>}
      </div>
    );
  }
  const n = statusLength(text), over = n > STATUS_MAX;
  return (
    <form className="crew-status" data-testid="my-status" onSubmit={(e) => { e.preventDefault(); if (!over) void status.save(text).then(() => setText(null)); }}>
      <Input aria-label="Your status" value={text} autoFocus placeholder="Deload week" enterKeyHint="done"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setText(null); }} />
      <span className={`small ${over ? 'err' : 'muted'}`} aria-live="polite">{n}/{STATUS_MAX}</span>
      <button type="submit" className="mini primary" disabled={over}>Save</button>
      <button type="button" className="mini" onClick={() => void status.save('').then(() => setText(null))}>Clear</button>
    </form>
  );
}
