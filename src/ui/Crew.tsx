import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import type { Friend, FriendNews } from '../cloud/friends';
import { addDays, weekStart } from '../domain/analytics';
import { CREW_SPAN, crewRange, peekFriendCache, refreshWindow, staleWindow, useFriendCache } from '../state/friendCache';
import { fmtWeek, KIND_LABEL, KINDS, lastTraining, crewDays, statusLength, STATUS_MAX, weekNumbers, type Day, type Kind } from '../domain/crew';
import type { SetEntry } from '../domain/types';
import type { StatusStore } from '../state/useStatus';
import { ChartTable } from './charts/ChartTable';
import { Latest, MessageButton } from './MessageButton';
import { Icon, initials } from './icons';
import { Input } from './Field';

// Every friend on one screen: a line each across the days, coloured by what they trained. Cycle data never comes here:
// friends' rows read only their months and status phrase, and your own row only your log.

const SPAN = CREW_SPAN; // eight weeks back, today included
const SHOWN = 14; // days across a phone
const MAX_OFF = SPAN - SHOWN;
const LINE_H = 20;
const colour = (k: Kind | undefined) => (k ? `var(--crew-${k})` : 'var(--crew-other)');

interface Row { id: string; name: string; label: string; status: string; days: Day[]; sets: SetEntry[]; me: boolean; friend?: Friend; error?: string; loading?: boolean }

export function Crew({ uid, myName, friends, entries, today, status, news, pulled = 0, onOpenFriend, onOpenMine, onInvite, onMessage }: {
  uid: string; /** This phone's person, for your avatar. */ myName?: string; friends: Friend[] | null; entries: SetEntry[]; today: string; status: StatusStore; news?: FriendNews | null;
  /** Moves on each pull-down or Refresh: every line is read again. */ pulled?: number;
  onOpenFriend: (f: Friend) => void; onOpenMine: () => void; onInvite: () => void; /** A friend's thread: pings and messages. */ onMessage?: (f: Friend) => void;
}) {
  const { from } = crewRange(today);
  // Each friend's line as the phone kept it (state/friendCache), read again quietly when 5 minutes old or for a new day.
  // A failed read shows only where nothing was kept; a kept line stays as it was.
  const windows = useFriendCache(uid)?.windows;
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async (force: boolean) => {
    if (!friends?.length) return;
    const now = Date.now(), kept = peekFriendCache(uid)?.windows ?? {};
    const need = friends.filter((f) => force || staleWindow(kept[f.uid], from, today, now));
    if (!need.length) return;
    const fail = (f: Friend, e: unknown) => {
      if (peekFriendCache(uid)?.windows[f.uid]) return;
      setErrors((x) => ({ ...x, [f.uid]: (e as { code?: string }).code === 'permission-denied' ? 'You can’t see their log any more.' : cloudError(e) }));
    };
    try {
      const c = await loadCloud();
      await Promise.all(need.map(async (f) => {
        try {
          await refreshWindow(c, uid, f.uid, from, today);
          setErrors(({ [f.uid]: _ok, ...x }) => x);
        } catch (e) { fail(f, e); }
      }));
    } catch (e) { need.forEach((f) => fail(f, e)); }
  }, [friends, uid, from, today]);
  useEffect(() => { void load(false); }, [load]);
  const seenPull = useRef(pulled);
  useEffect(() => { if (pulled !== seenPull.current) { seenPull.current = pulled; void load(true); } }, [pulled, load]);

  const rows = useMemo((): Row[] => {
    const mine = entries.filter((e) => e.date >= from && e.date <= today);
    const me: Row = { id: 'me', name: 'You', label: 'You', status: status.status, days: crewDays(mine, from, today), sets: mine, me: true };
    const theirs = (friends ?? []).map((f): Row => {
      const w = windows?.[f.uid], sets = (w?.win.sets ?? []).filter((x) => x.date >= from && x.date <= today), error = w ? undefined : errors[f.uid];
      return { id: f.uid, name: `@${f.name}`, label: `@${f.name}`, status: w?.win.status ?? '', days: crewDays(sets, from, today), sets, me: false, friend: f, error, loading: !w && !error };
    });
    const last = (r: Row) => lastTraining(r.days)?.date ?? '';
    theirs.sort((a, b) => (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : a.name.localeCompare(b.name)));
    return [me, ...theirs];
  }, [entries, friends, windows, errors, status.status, from, today]);

  // Sideways: `off` is how many days back the window sits (0: today at the right edge). Fractional while dragging.
  const [off, setOff] = useState(0);
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setWidth(el.clientWidth);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const col = width / SHOWN;
  const drag = useRef<{ id: number; x: number; y: number; off: number; on: boolean } | null>(null);
  const dragged = useRef(false);
  const clamp = (n: number) => Math.min(MAX_OFF, Math.max(0, n));
  const shown = Math.round(off);
  const visible = (days: Day[]) => days.slice(SPAN - SHOWN - shown, SPAN - shown);

  const week = weekStart(today);
  const recent = addDays(today, -(SHOWN - 1));
  const table = rows.map((r): [string, string] => {
    const trained = visible(r.days).filter((d) => d.training);
    return [r.label, r.error ? 'Couldn’t load' : trained.length ? trained.map((d) => `${dayName(d.date)} ${d.kinds.length ? d.kinds.map((k) => KIND_LABEL[k]).join(' and ') : 'Training'}`).join(', ') : 'Rest'];
  });
  const first = visible(rows[0].days)[0]?.date ?? from, lastShown = visible(rows[0].days).at(-1)?.date ?? today;

  return (
    <section className="crew" aria-label="Crew">
      <div className="crew-top">
        <h2>Crew</h2>
        {shown > 0 && <button className="chip crew-today" onClick={() => setOff(0)}>Today</button>}
      </div>
      <CrewKey />
      <div ref={box} className="crew-rows" style={{ touchAction: 'pan-y' }} tabIndex={0} aria-label={`Days ${first} to ${lastShown}. Arrow keys move a week.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); setOff((o) => clamp(Math.round(o) + 7)); }
          if (e.key === 'ArrowRight') { e.preventDefault(); setOff((o) => clamp(Math.round(o) - 7)); }
        }}
        onWheel={(e) => { if (col && Math.abs(e.deltaX) > Math.abs(e.deltaY)) setOff((o) => clamp(o + e.deltaX / col)); }}
        onPointerDown={(e) => { drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, off, on: false }; dragged.current = false; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId || !col) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.on) {
            if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
            d.on = true; dragged.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setOff(clamp(d.off + dx / col));
        }}
        onPointerUp={() => { if (drag.current?.on) setOff((o) => Math.round(o)); drag.current = null; }}
        onPointerCancel={() => { setOff((o) => Math.round(o)); drag.current = null; }}
        onClickCapture={(e) => { if (dragged.current) { e.stopPropagation(); e.preventDefault(); dragged.current = false; } }}>
        <svg className="crew-days" width={width} height={32} aria-hidden="true">
          {rows[0].days.map((d, i) => {
            const x = (i - (SPAN - SHOWN) + off) * col;
            if (x < -col || x > width) return null;
            const now = d.date === today, mid = x + col / 2;
            return (
              <g key={d.date} className={now ? 'today' : undefined}>
                <text x={mid} y={10} textAnchor="middle">{'MTWTFSS'[(new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7]}</text>
                {now && <circle cx={mid} cy={23} r={9.5} />}
                <text x={mid} y={27} textAnchor="middle" className="date">{Number(d.date.slice(8))}</text>
              </g>
            );
          })}
        </svg>
        <ul className="crew-list">
          {rows.map((r) => {
            const latest = lastTraining(r.days);
            const quiet = !r.loading && !r.error && !r.days.some((d) => d.training && d.date >= recent);
            const open = () => (r.friend ? onOpenFriend(r.friend) : onOpenMine());
            return (
              <li key={r.id} className={`crew-row${quiet ? ' quiet' : ''}`} style={{ '--k': colour(latest?.kinds[0]) } as CSSProperties} data-testid={r.me ? 'crew-me' : `crew-${r.friend!.name}`}>
                <div className="crew-head">
                  <span className={r.me ? 'avatar me' : 'avatar'} aria-hidden="true">{initials(r.me ? myName || 'You' : r.friend!.name)}</span>
                  <div className="crew-who">
                    <div className="crew-name-line">
                      <button className="link crew-name" onClick={open}>{r.label}</button>
                      {r.friend?.muted && <span className="crew-muted" role="img" aria-label="Muted"><Icon name="bell-off" size={15} /></span>}
                      {r.me ? <StatusEdit status={status} /> : r.status && <span className="crew-bubble">{r.status}</span>}
                    </div>
                    {r.friend && onMessage && <Latest news={news} uid={r.friend.uid} />}
                  </div>
                  {r.friend && onMessage && <MessageButton name={r.friend.name} unread={news?.unread[r.friend.uid] ?? 0} onClick={() => onMessage(r.friend!)} />}
                </div>
                <svg className="crew-line" width={width} height={LINE_H} aria-hidden="true" onClick={open}>
                  <line x1={0} x2={width} y1={LINE_H / 2} y2={LINE_H / 2} className="crew-rest" />
                  {r.days.map((d, i) => {
                    const x = (i - (SPAN - SHOWN) + off) * col;
                    if (!d.training || x < -col || x > width) return null;
                    const [a, b] = d.kinds, y = LINE_H / 2 - 5, w = Math.max(2, col - 4);
                    return (
                      <g key={d.date} data-date={d.date} data-kind={d.kinds.join('+') || 'other'}>
                        {b ? (<>
                          <rect x={x + 2} y={y} width={w} height={4} rx={2} fill={colour(a)} />
                          <rect x={x + 2} y={y + 6} width={w} height={4} rx={2} fill={colour(b)} />
                        </>) : <rect x={x + 2} y={y} width={w} height={10} rx={3} fill={colour(a)} />}
                      </g>
                    );
                  })}
                  {(() => { const x = (SPAN - 1 - (SPAN - SHOWN) + off) * col + col / 2; return x <= width ? <circle className="crew-now" cx={x} cy={LINE_H / 2} r={3} /> : null; })()}
                </svg>
                <p className="crew-week muted small">
                  {r.error ? <span className="warn">{r.error}</span> : r.loading ? 'Loading…' : quiet ? 'No sessions in 2 weeks' : fmtWeek(weekNumbers(r.sets, week))}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
      {friends && !friends.length && <p className="muted small">No friends here yet. Invite one and their line shows up under yours.</p>}
      {/* In the page, under the lines, while you have fewer than three friends: floating, it covered what scrolled under it. */}
      {friends && friends.length < 3 && <button className="crew-invite" onClick={onInvite}><Icon name="person-plus" size={20} />Invite a friend</button>}
      <ChartTable caption={`What each person trained, ${dayName(first)} to ${dayName(lastShown)}`} head={['Who', 'Days trained']} rows={table} />
    </section>
  );
}

const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** The colour key, always in view: a dot and a word for each kind. */
function CrewKey() {
  return (
    <ul className="crew-key" aria-label="Colour key">
      {KINDS.map((k) => <li key={k}><span className="crew-dot" style={{ background: colour(k) }} />{KIND_LABEL[k]}</li>)}
      <li><span className="crew-dot" style={{ background: colour(undefined) }} />Other lifts</li>
      <li><span className="crew-dot rest" />Rest</li>
    </ul>
  );
}

/** Your own phrase: tap it to change it. Empty shows only a quiet pencil and "Status"; nothing ever asks for one. */
function StatusEdit({ status }: { status: StatusStore }) {
  const [text, setText] = useState<string | null>(null);
  if (text == null) {
    return status.status
      ? <button className="crew-tap" aria-label={`Your status: ${status.status}. Change it`} onClick={() => setText(status.status)}><span className="crew-bubble">{status.status}</span><Icon name="pencil" size={16} /></button>
      : <button className="crew-tap" onClick={() => setText('')}><Icon name="pencil" size={16} /><span className="crew-bubble add">Status</span></button>;
  }
  const n = statusLength(text), over = n > STATUS_MAX;
  return (
    <form className="crew-status" onSubmit={(e) => { e.preventDefault(); if (!over) void status.save(text).then(() => setText(null)); }}>
      <Input aria-label="Your status" value={text} autoFocus placeholder="Deload week" enterKeyHint="done"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setText(null); }} />
      <span className={`small ${over ? 'err' : 'muted'}`} aria-live="polite">{n}/{STATUS_MAX}</span>
      <button type="submit" className="mini primary" disabled={over}>Save</button>
      <button type="button" className="mini" onClick={() => void status.save('').then(() => setText(null))}>Clear</button>
    </form>
  );
}
