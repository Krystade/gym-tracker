import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { readFriend, type Friend, type FriendData, type FriendNews } from '../cloud/friends';
import { addDays, weekStart } from '../domain/analytics';
import { latestSession, sessionLabel } from '../domain/crew';
import { friendPrs, goalWeek, liveSince, ringSets, progressRows, sessionCard, usualSession, weekStreak, type Card } from '../domain/feed';
import type { PresetKey } from '../domain/messages';
import type { SetEntry } from '../domain/types';
import { useMinute } from '../state/clock';
import { crewRange, peekFriendCache, refreshSummaries, refreshWindow, staleSummaries, staleWindow, useFriendCache } from '../state/friendCache';
import { featured, TIERS, unlocksOf } from '../domain/achievements';
import { AchChip } from './AchievementsSheet';
import type { GymsStore } from '../state/useGyms';
import { clock, kindsFromCard, ReactButton, subText, topText, useReactions } from './Feed';
import { Screens, type FriendTab } from './FriendView';
import { Icon, initials } from './icons';
import { FriendName, FriendTagEditor } from './FriendName';
import { VerifyToggle } from './DisplayNameCard';
import { kindColour, Ring } from './Ring';
import { FriendStats } from './StatsScreen';

// A friend's page inside Friends (round 18): who they are this week, what they're doing now, how you've each come on against your
// own start, and their Stats as tiles (owner, 2026-10-20). All of it from the line Friends already keeps (state/friendCache):
// opening it reads nothing more. Their whole log is read only for History, Lifts or Stats, when asked for. The 8-week board and
// Recent PRs went (IA A7, owner 2026-10-21): their Calendar and PRs tiles say both.

const REACTIONS: PresetKey[] = ['strong', 'fire', 'clap', 'eyes'];

export function FriendPage({ uid, friend, entries, today, gyms, news, onBack, onMessage, backLabel = 'Friends' }: {
  uid: string; friend: Friend; /** Yours, for "You and @them". */ entries: SetEntry[]; today: string; gyms: GymsStore; news: FriendNews | null;
  onBack: () => void; onMessage?: () => void; /** Where Back goes: Friends, or Compare when opened from it. */ backLabel?: string;
}) {
  const [deep, setDeep] = useState<FriendTab | null>(null);
  const [whole, setWhole] = useState<{ data?: FriendData; error?: string } | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);
  const go = (t: FriendTab | null) => {
    setDeep(t); setExercise(null); window.scrollTo(0, 0);
    if (t && !whole) {
      setWhole({});
      void loadCloud().then((c) => readFriend(c, friend.uid)).then((data) => setWhole({ data }),
        (e) => setWhole({ error: (e as { code?: string }).code === 'permission-denied' ? `You can’t see @${friend.name}’s log any more.` : cloudError(e) }));
    }
  };
  if (deep) {
    return (<>
      <div className="fp-top">
        <button className="quiet-btn fp-back" onClick={() => (exercise ? setExercise(null) : go(null))}><Icon name="chev-left" size={24} />{exercise ? deep[0].toUpperCase() + deep.slice(1) : `@${friend.name}`}</button>
      </div>
      {whole?.error ? <p role="alert" className="warn">{whole.error}</p>
        : !whole?.data ? <p className="muted">Loading @{friend.name}’s log…</p>
        : <Screens name={friend.name} data={whole.data} tab={deep} exercise={exercise} today={today} gyms={gyms} onOpen={(n) => { setExercise(n); window.scrollTo(0, 0); }} onExerciseBack={() => setExercise(null)} />}
    </>);
  }
  return <Profile uid={uid} friend={friend} entries={entries} today={today} news={news} onBack={onBack} onMessage={onMessage} onDeep={go} backLabel={backLabel} />;
}

function Profile({ uid, friend, entries, today, news, onBack, onMessage, onDeep, backLabel }: {
  uid: string; friend: Friend; entries: SetEntry[]; today: string; news: FriendNews | null; onBack: () => void; onMessage?: () => void; onDeep: (t: FriendTab) => void; backLabel: string;
}) {
  const { from } = crewRange(today);
  const minute = useMinute();
  const cache = useFriendCache(uid);
  const w = cache?.windows[friend.uid];
  // Their achievements, from their Compare summary: one read when it's over 5 minutes old (the same read and cache as Compare).
  const sum = cache?.summaries?.[friend.uid]?.doc;
  const ach = useMemo(() => (sum?.ach ? unlocksOf(sum.ach) : undefined), [sum]);
  useEffect(() => {
    if (!staleSummaries(peekFriendCache(uid), [friend.uid], Date.now()).length) return;
    void loadCloud().then((c) => refreshSummaries(c, uid, [friend.uid])).catch(() => {});
  }, [uid, friend.uid]);
  // The newest silver and up in the last 7 days, beside their week (owner Q6); the higher tier of a day's.
  const newest = useMemo(() => featured(ach ?? []).filter((u) => u.date > addDays(today, -7)).sort((a, b) => b.date.localeCompare(a.date) || TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier))[0], [ach, today]);
  const [error, setError] = useState<string | null>(null);
  // Their line as Friends keeps it, read again only when stale (the same rule, and the same read, as the list).
  useEffect(() => {
    if (!staleWindow(w, from, today, Date.now())) return;
    void loadCloud().then((c) => refreshWindow(c, uid, friend.uid, from, today)).catch((e) => {
      if (!w) setError((e as { code?: string }).code === 'permission-denied' ? `You can’t see @${friend.name}’s log any more.` : cloudError(e));
    });
  }, [uid, friend, from, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // Their sets in the 8 weeks and their PR ids: new only when their line is read again, so their Stats tiles work out once a read.
  const line = useMemo(() => (w ? { sets: w.win.sets.filter((e) => e.date >= from && e.date <= today), prs: friendPrs(w.win), goal: w.win.goal ?? 2 } : null), [w, from, today]);
  const v = useMemo(() => {
    if (!line) return null;
    const now = Date.now();
    const { sets, prs, goal } = line;
    const day = sets.filter((e) => e.date === today);
    const last = latestSession(sets);
    return {
      sets, prs, day, live: liveSince(day, now), week: goalWeek(sets, today, goal), streak: weekStreak(sets, today, goal, 8),
      prsWeek: sets.filter((e) => prs.has(e.id) && e.date >= weekStart(today)).length,
      card: last ? sessionCard(sets, last.date, prs, now) : null, shared: progressRows(entries, sets, addDays(today, -55), today),
      ring: ringSets(day), usual: usualSession(sets, today),
    };
  }, [line, today, entries, minute]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = useReactions(uid);
  const unread = news?.unread[friend.uid] ?? 0;
  const now = Date.now();
  const status = w?.win.status ?? '';
  return (
    <section className="fp" aria-label={`@${friend.name}`}>
      <div className="fp-top"><button className="quiet-btn fp-back" onClick={onBack}><Icon name="chev-left" size={24} />{backLabel}</button></div>
      <div className="fp-hero">
        <span className={`fp-ring${v?.live != null ? ' pulse' : ''}`}>
          {v && <Ring segs={v.ring} total={v.usual} size={92} width={4.5} draw merge />}
          <span className="avatar" aria-hidden="true">{initials(friend.dn || friend.name)}</span>
        </span>
        {v?.live != null && <span className="fd-live fp-live">LIVE</span>}
        <h1><FriendName me={uid} friend={friend} /></h1>
        {status && <p className="fp-status">{status}</p>}
        {v && (
          <ul className="fp-chips" aria-label="This week">
            {v.streak.current > 0 && <li><Icon name="flame" size={16} sw={2} className="fp-flame" />{v.streak.current}{v.streak.whole ? '+' : ''}-week streak</li>}
            <li className={v.week.met ? 'met' : undefined}>{v.week.met && <Icon name="trophy" size={15} sw={2} />}{v.week.sessions} of {v.week.goal} this week</li>
            {v.prsWeek > 0 && <li><span className="fd-pr">PR</span>{v.prsWeek} this week</li>}
          </ul>
        )}
        {newest && <p className="fp-ach"><AchChip u={newest} /></p>}
      </div>
      <div className="fp-actions" role="group" aria-label={`React to @${friend.name}`}>
        {REACTIONS.map((k) => <ReactButton key={k} k={k} name={friend.name} burst={r.burst?.uid === friend.uid && r.burst.k === k} sent={false} disabled={!!r.sending} onClick={() => void r.react(friend, k)} />)}
        {onMessage && (
          <button className="fp-chat" aria-label={`Message @${friend.name}${unread ? `, ${unread} unread` : ''}`} onClick={onMessage}>
            <Icon name="message" size={20} />Chat{unread > 0 && <span className="unread-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
          </button>
        )}
      </div>
      <p className="fp-said" role="status">{r.sendError?.uid === friend.uid ? <span className="warn">{r.sendError.text}</span> : r.burst?.uid === friend.uid ? <span className="fd-sentmsg"><b>Sent</b> · just now</span> : null}</p>

      {error ? <p role="alert" className="warn">{error}</p> : !v ? <p className="muted">Loading…</p> : (<>
        {v.card && <SessionBox c={v.card} today={today} now={now} />}
        <Shared name={friend.name} rows={v.shared} />
        <FriendStats who={friend.name} entries={line!.sets} goal={line!.goal} prs={line!.prs} today={today} ach={ach} />
      </>)}
      {/* Their whole log, where the tiles above are 8 weeks: said so, or "Stats" reads as the tiles again (IA A7). */}
      <div className="fp-links" role="group" aria-labelledby="fp-whole">
        <span id="fp-whole" className="fp-links-k">Whole log</span>
        {(['history', 'lifts', 'stats'] as const).map((t) => <button key={t} onClick={() => onDeep(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      <div className="fp-tag"><FriendTagEditor me={uid} friend={friend} /><VerifyToggle me={uid} uid={friend.uid} name={friend.name} /></div>
    </section>
  );
}

/** Their session today (live: "Now"), else their last one in the 8 weeks. */
function SessionBox({ c, today, now }: { c: Card; today: string; now: number }) {
  const timed = !Number.isNaN(c.start);
  const when = c.live ? 'Now' : c.date === today ? 'Today' : `Last session · ${sessionLabel(c.date, today)}`;
  const meta = [timed ? (c.live ? `since ${clock(c.start)}` : clock(c.start)) : '', c.minutes ? `${c.minutes} min` : '', `${c.sets} set${c.sets === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  const mins = c.live && !Number.isNaN(c.end) ? Math.max(0, Math.round((now - c.end) / 60_000)) : null;
  return (
    <article className={`fd-card fp-session${c.live ? ' live' : ''}`} aria-label={`${when}, ${kindsFromCard(c)}`}>
      <div className="fp-session-head">
        <div>
          <h2>{when} · {kindsFromCard(c)}</h2>
          <p className="fd-meta">{meta}</p>
          {mins != null && <p className="fd-meta fp-lastset">last set {mins ? `${mins} min ago` : 'just now'}</p>}
        </div>
        {c.live && <span className="fd-live">LIVE</span>}
      </div>
      <ul className="fd-lifts">
        {c.lifts.map((l) => (
          <li key={l.key}>
            <span className="fd-ln"><span className="fd-kdot" style={{ background: kindColour(l.kind) }} aria-hidden="true" /><span className="fd-lname">{l.exercise}</span>{l.now && <span className="fd-now">now</span>}</span>
            <span className="fd-top">{l.pr && <span className="fd-pr">PR</span>}{topText(l)}<span className="fd-n">{subText(l)}</span></span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * The comparison, always on their page (no tap to Stats): their lifts, the ones you both do first, each one's e1RM change against
 * their own start, never one's load against the other's. Yours too new to say, or not a lift of yours: a dash.
 */
function Shared({ name, rows }: { name: string; rows: { lift: string; me: number | null; them: number }[] }) {
  const max = Math.max(5, ...rows.flatMap((r) => [Math.abs(r.me ?? 0), Math.abs(r.them)]));
  const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x) < 10 ? Math.abs(x).toFixed(1).replace(/\.0$/, '') : Math.round(Math.abs(x))}%`;
  const bar = (x: number | null, who: string, cls: string) => (
    <div className={`fp-bar ${cls}`} aria-label={`${who} ${x == null ? 'no change yet' : pct(x)}`} role="img">
      <i><b style={{ '--w': `${(Math.max(0, x ?? 0) / max) * 100}%` } as CSSProperties} /></i><span>{x == null ? '–' : pct(x)}</span>
    </div>
  );
  return (
    <section className="card fp-shared" aria-label={`You and @${name}`}>
      <h2>You and @{name} <span>e1RM change, 8 weeks</span></h2>
      <p className="fp-legend"><span><i className="me" />You</span><span><i />@{name}</span><span className="fp-own">each from their own start</span></p>
      {!rows.length && <p className="muted small fp-none">No change to show yet: a lift needs two sessions two weeks apart.</p>}
      {rows.map((r) => (
        <div key={r.lift} className="fp-vs">
          <span className="fp-vs-l">{r.lift}</span>
          <div className="fp-bars">{bar(r.me, 'You', 'me')}{bar(r.them, `@${name}`, '')}</div>
        </div>
      ))}
    </section>
  );
}
