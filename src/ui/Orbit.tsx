import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { readFriendWindow, type Friend, type FriendWindow } from '../cloud/friends';
import { addDays, weekStart } from '../domain/analytics';
import { fmtWeek, KIND_LABEL, KINDS, lastTraining, orbitDays, statusLength, STATUS_MAX, weekNumbers, type Day, type Kind } from '../domain/orbit';
import type { SetEntry } from '../domain/types';
import type { StatusStore } from '../state/useStatus';
import { ChartTable } from './charts/ChartTable';

// Every friend on one screen: a line each across the days, coloured by what they trained. Cycle data never comes here:
// friends' rows read only their months and status phrase, and your own row only your log.

const SPAN = 56; // eight weeks back, today included
const SHOWN = 14; // days across a phone
const MAX_OFF = SPAN - SHOWN;
const STALE_MS = 5 * 60_000;
const LINE_H = 20;
const colour = (k: Kind | undefined) => (k ? `var(--orbit-${k})` : 'var(--orbit-other)');
const KEY_SEEN = 'gym-tracker:orbit-key';

/** Friends' windows for this session: read again on a pull-down, or when Orbit opens more than 5 minutes later. */
const cache = new Map<string, { at: number; win: FriendWindow }>();

type Load = { win?: FriendWindow; error?: string };
interface Row { id: string; name: string; label: string; status: string; days: Day[]; sets: SetEntry[]; me: boolean; friend?: Friend; error?: string; loading?: boolean }

export function Orbit({ uid, friends, entries, today, status, onOpenFriend, onOpenMine, onInvite }: {
  uid: string; friends: Friend[] | null; entries: SetEntry[]; today: string; status: StatusStore;
  onOpenFriend: (f: Friend) => void; onOpenMine: () => void; onInvite: () => void;
}) {
  const from = addDays(today, -(SPAN - 1));
  const [loads, setLoads] = useState<Record<string, Load>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force: boolean) => {
    if (!friends?.length) return;
    const now = Date.now(), key = (f: Friend) => `${uid}|${f.uid}|${from}|${today}`;
    const need = friends.filter((f) => { const c = cache.get(key(f)); return force || !c || now - c.at > STALE_MS; });
    setLoads(Object.fromEntries(friends.flatMap((f) => { const c = cache.get(key(f)); return c ? [[f.uid, { win: c.win }]] : []; })));
    if (!need.length) return;
    setBusy(true);
    try {
      const c = await loadCloud();
      await Promise.all(need.map(async (f) => {
        try {
          const win = await readFriendWindow(c, f.uid, from, today);
          cache.set(key(f), { at: Date.now(), win });
          setLoads((l) => ({ ...l, [f.uid]: { win } }));
        } catch (e) {
          setLoads((l) => ({ ...l, [f.uid]: { error: (e as { code?: string }).code === 'permission-denied' ? 'You can’t see their log any more.' : cloudError(e) } }));
        }
      }));
    } catch (e) {
      const error = cloudError(e);
      setLoads((l) => ({ ...l, ...Object.fromEntries(need.map((f) => [f.uid, { error }])) }));
    } finally { setBusy(false); }
  }, [friends, uid, from, today]);
  useEffect(() => { void load(false); }, [load]);

  const rows = useMemo((): Row[] => {
    const mine = entries.filter((e) => e.date >= from && e.date <= today);
    const me: Row = { id: 'me', name: 'You', label: 'You', status: status.status, days: orbitDays(mine, from, today), sets: mine, me: true };
    const theirs = (friends ?? []).map((f): Row => {
      const l = loads[f.uid], sets = l?.win?.sets ?? [];
      return { id: f.uid, name: `@${f.name}`, label: `@${f.name}`, status: l?.win?.status ?? '', days: orbitDays(sets, from, today), sets, me: false, friend: f, error: l?.error, loading: !l };
    });
    const last = (r: Row) => lastTraining(r.days)?.date ?? '';
    theirs.sort((a, b) => (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : a.name.localeCompare(b.name)));
    return [me, ...theirs];
  }, [entries, friends, loads, status.status, from, today]);

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

  // Pull down at the top of the page to read friends again.
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | null>(null);

  const week = weekStart(today);
  const recent = addDays(today, -(SHOWN - 1));
  const table = rows.map((r): [string, string] => {
    const trained = visible(r.days).filter((d) => d.training);
    return [r.label, r.error ? 'Couldn’t load' : trained.length ? trained.map((d) => `${dayName(d.date)} ${d.kinds.length ? d.kinds.map((k) => KIND_LABEL[k]).join(' and ') : 'Training'}`).join(', ') : 'Rest'];
  });
  const first = visible(rows[0].days)[0]?.date ?? from, lastShown = visible(rows[0].days).at(-1)?.date ?? today;

  return (
    <section className="orbit" aria-label="Orbit"
      onTouchStart={(e) => { pullStart.current = window.scrollY <= 0 ? e.touches[0].clientY : null; }}
      onTouchMove={(e) => { if (pullStart.current != null && !drag.current?.on) setPull(Math.max(0, e.touches[0].clientY - pullStart.current)); }}
      onTouchEnd={() => { if (pull > 70) void load(true); pullStart.current = null; setPull(0); }}>
      {pull > 0 && <p className="orbit-pull muted small" aria-hidden="true">{pull > 70 ? 'Release to refresh' : 'Pull to refresh'}</p>}
      <div className="orbit-top">
        <h2>Orbit</h2>
        {shown > 0 && <button className="chip orbit-today" onClick={() => setOff(0)}>Today</button>}
        <button className="mini" disabled={busy || !friends?.length} onClick={() => void load(true)}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      <OrbitKey />
      <div ref={box} className="orbit-rows" style={{ touchAction: 'pan-y' }} tabIndex={0} aria-label={`Days ${first} to ${lastShown}. Arrow keys move a week.`}
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
        <svg className="orbit-days" width={width} height={32} aria-hidden="true">
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
        <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute' }}>
          <filter id="orbit-glow" x="-50%" y="-150%" width="200%" height="400%"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </svg>
        <ul className="orbit-list">
          {rows.map((r) => {
            const latest = lastTraining(r.days);
            const quiet = !r.loading && !r.error && !r.days.some((d) => d.training && d.date >= recent);
            const open = () => (r.friend ? onOpenFriend(r.friend) : onOpenMine());
            return (
              <li key={r.id} className={`orbit-row${quiet ? ' quiet' : ''}`} style={{ '--k': colour(latest?.kinds[0]) } as CSSProperties} data-testid={r.me ? 'orbit-me' : `orbit-${r.friend!.name}`}>
                <div className="orbit-head">
                  <button className="link orbit-name" onClick={open}>{r.label}</button>
                  {r.me ? <StatusEdit status={status} /> : r.status && <span className="orbit-bubble">{r.status}</span>}
                </div>
                <svg className="orbit-line" width={width} height={LINE_H} aria-hidden="true" onClick={open}>
                  <line x1={0} x2={width} y1={LINE_H / 2} y2={LINE_H / 2} className="orbit-rest" />
                  {r.days.map((d, i) => {
                    const x = (i - (SPAN - SHOWN) + off) * col;
                    if (!d.training || x < -col || x > width) return null;
                    const [a, b] = d.kinds, y = LINE_H / 2 - 5, w = Math.max(2, col - 4);
                    return (
                      <g key={d.date} data-date={d.date} data-kind={d.kinds.join('+') || 'other'} filter="url(#orbit-glow)">
                        {b ? (<>
                          <rect x={x + 2} y={y} width={w} height={4} rx={2} fill={colour(a)} />
                          <rect x={x + 2} y={y + 6} width={w} height={4} rx={2} fill={colour(b)} />
                        </>) : <rect x={x + 2} y={y} width={w} height={10} rx={3} fill={colour(a)} />}
                      </g>
                    );
                  })}
                  {(() => { const x = (SPAN - 1 - (SPAN - SHOWN) + off) * col + col / 2; return x <= width ? <circle className="orbit-now" cx={x} cy={LINE_H / 2} r={3} /> : null; })()}
                </svg>
                <p className="orbit-week muted small">
                  {r.error ? <span className="warn">{r.error}</span> : r.loading ? 'Loading…' : quiet ? 'No sessions in 2 weeks' : fmtWeek(weekNumbers(r.sets, week))}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
      {friends && !friends.length && <p className="muted small">No friends here yet. Invite one and their line shows up under yours.</p>}
      <ChartTable caption={`What each person trained, ${dayName(first)} to ${dayName(lastShown)}`} head={['Who', 'Days trained']} rows={table} />
      {friends && friends.length < 3 && (<>
        <button className="primary orbit-fab" onClick={onInvite}>Invite a friend</button>
      </>)}
    </section>
  );
}

const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** The colour key: open on the first visit, folded after. */
function OrbitKey() {
  const [first] = useState(() => { try { return !localStorage.getItem(KEY_SEEN); } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(KEY_SEEN, '1'); } catch { /* not kept */ } }, []);
  return (
    <details className="orbit-key" open={first}>
      <summary>Colour key</summary>
      <ul>
        {KINDS.map((k) => <li key={k}><span className="orbit-dot" style={{ background: colour(k) }} />{KIND_LABEL[k]}</li>)}
        <li><span className="orbit-dot" style={{ background: colour(undefined) }} />Other lifts</li>
        <li><span className="orbit-dot rest" />Rest</li>
      </ul>
    </details>
  );
}

/** Your own phrase: tap it to change it. Empty shows only a quiet "+ Status"; nothing ever asks for one. */
function StatusEdit({ status }: { status: StatusStore }) {
  const [text, setText] = useState<string | null>(null);
  if (text == null) {
    return status.status
      ? <button className="orbit-tap" aria-label={`Your status: ${status.status}. Change it`} onClick={() => setText(status.status)}><span className="orbit-bubble">{status.status}</span></button>
      : <button className="orbit-tap" onClick={() => setText('')}><span className="orbit-bubble add">+ Status</span></button>;
  }
  const n = statusLength(text), over = n > STATUS_MAX;
  return (
    <form className="orbit-status" onSubmit={(e) => { e.preventDefault(); if (!over) void status.save(text).then(() => setText(null)); }}>
      <input aria-label="Your status" value={text} autoFocus placeholder="Deload week" enterKeyHint="done"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setText(null); }} />
      <span className={`small ${over ? 'err' : 'muted'}`} aria-live="polite">{n}/{STATUS_MAX}</span>
      <button type="submit" className="mini primary" disabled={over}>Save</button>
      <button type="button" className="mini" onClick={() => void status.save('').then(() => setText(null))}>Clear</button>
    </form>
  );
}
