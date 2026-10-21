import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { localDate } from '../domain/ids';
import { fitReminder, type ReminderFit } from '../domain/learn/remind';
import type { SetEntry } from '../domain/types';
import { zone } from '../push/activity';
import { PUSH_ON } from '../push/config';
import { disablePush, enablePush, getStatus, localState, PushError, resyncPush, sendTest, setPrefs, standalone, subscribeLocal, supported, type PushPrefs, type Status, withDefaults } from '../push/client';
import { remindTime } from '../push/payload';
import { read } from '../push/store';
import { Input } from './Field';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // chips run Monday to Sunday, like the app's weeks
const ago = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const plain = (e: unknown) => (e instanceof PushError ? (e.status === 401 ? 'Sign in again first.' : e.status === 429 ? 'Too many tries; wait a minute.' : `The notification server said ${e.status}.`)
  : (e as Error)?.name === 'NotAllowedError' ? 'Notifications weren’t allowed.' : 'No connection to the notification server. Try again when you’re online.');

/**
 * The reminder as it will go out, per day he picked (Monday first): "Mon 21:55 · Wed off · Fri 18:00", why a day is off, and
 * the days he usually trains that he didn't pick (shown only: learning never adds a day).
 */
export function reminderPlan(reminder: { days: number[]; at: string; learn?: boolean }, fit: ReminderFit | null): { line: string; notes: string[] } {
  const sched = fit?.schedule;
  const line = WEEK.filter((d) => reminder.days.includes(d)).map((d) => `${DAYS[d]} ${remindTime(reminder, sched, d) ?? 'off'}`).join(' · ');
  const notes: string[] = [];
  if (fit && reminder.learn !== false) {
    const off = (why: string) => WEEK.filter((d) => reminder.days.includes(d) && fit.days[d].why === why).map((d) => DAYS[d]);
    const rest = off('not his day'), late = off('late all day');
    if (rest.length) notes.push(`${rest.join(', ')}: off, you don’t usually train then.`);
    if (late.length) notes.push(`${late.join(', ')}: off, you’re usually still to come at midnight.`);
    const also = WEEK.filter((d) => !reminder.days.includes(d) && fit.days[d].pOff < 0.5 && fit.days[d].p > 0.5).map((d) => DAYS[d]);
    if (also.length) notes.push(`You usually train ${also.join(', ')} too; tap ${also.length > 1 ? 'them' : 'it'} above to be reminded.`);
  }
  return { line, notes };
}

/**
 * Notifications, on More › Notifications. Shows nothing at all in a build without a Worker (src/push/config.ts).
 * `signedIn`: this person is the one the account on this phone belongs to. `goal`: sessions per week, for the reminder days.
 */
function Card({ signedIn, goal, entries, onSignIn }: { signedIn: boolean; goal: number; entries: SetEntry[]; /** More › Account. */ onSignIn?: () => void }) {
  const local = useSyncExternalStore(subscribeLocal, () => JSON.stringify(localState()));
  const { device, prefs: saved, lost } = JSON.parse(local) as ReturnType<typeof localState>;
  const prefs = withDefaults(saved, goal);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [perm, setPerm] = useState(() => (supported() ? Notification.permission : 'default'));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [last, setLast] = useState<{ at: number; kind: string | null } | null>(null);
  const home = supported() && standalone();
  const learn = prefs.reminder.learn !== false;
  const fit = useMemo(() => {
    if (!prefs.kinds.remind || !learn) return null;
    try { return fitReminder(entries, localDate(new Date()), zone()); } catch { return null; }
  }, [entries, prefs.kinds.remind, learn]);
  const plan = reminderPlan(prefs.reminder, fit);
  const on = !!device && perm === 'granted';

  // Fetched ahead, so the tap's subscribe() is the first thing it waits for (iOS only prompts from a tap).
  useEffect(() => { if (home) void navigator.serviceWorker.ready.then(setReg); }, [home]);
  useEffect(() => {
    if (!on || !signedIn) return;
    void read('lastPush').then((x) => setLast(x ?? null), () => {});
    void getStatus().then(setStatus, () => {});
  }, [on, signedIn]);

  if (!home) return (
    <section className="card" aria-labelledby="notify-h">
      <h2 id="notify-h">Notifications</h2>
      <p className="muted small">{supported() || /iPhone|iPad/.test(navigator.userAgent) ? 'Notifications work from the Home Screen app: Share → Add to Home Screen, then open it from there.' : 'This browser can’t get notifications from the app.'}</p>
    </section>
  );
  if (!signedIn) return (
    <section className="card" aria-labelledby="notify-h">
      <h2 id="notify-h">Notifications</h2>
      <p className="muted small">Notifications need an account.</p>
      {onSignIn && <button className="wide" onClick={onSignIn}>Sign in</button>}
    </section>
  );

  async function act(f: () => Promise<unknown>, done?: string) {
    setBusy(true); setMsg(null);
    try { await f(); if (done) setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: plain(e) }); }
    finally { setBusy(false); setPerm(Notification.permission); }
  }
  const turnOn = () => { if (reg) void act(() => enablePush(reg, goal), 'Notifications are on.'); };
  const change = (p: PushPrefs) => setPrefs(p, (e) => setMsg({ ok: false, text: plain(e) }));
  const kind = (k: keyof PushPrefs['kinds'], label: string, hint: string) => (
    <label className="check"><input type="checkbox" checked={prefs.kinds[k]} onChange={(e) => change({ ...prefs, kinds: { ...prefs.kinds, [k]: e.target.checked } })} />
      <span>{label}<br /><span className="muted small">{hint}</span></span></label>
  );
  const me = status?.devices.find((d) => d.id === device);

  return (
    <section className="card notify" aria-labelledby="notify-h">
      <h2 id="notify-h">Notifications</h2>
      {perm === 'denied' ? <p className="muted small">Turned off in iPhone Settings → Notifications → Gym Tracker.</p>
        : !on || lost ? (<>
          <p className="muted small">{lost ? 'This phone stopped getting notifications. Turn them on again to fix it.' : 'Rest timer done on the lock screen, friend requests, a reminder on training days, and a weekly recap. You pick which.'}</p>
          <button className="primary wide" disabled={!reg || busy} onClick={turnOn}>{lost ? 'Re-enable notifications' : 'Turn on notifications'}</button>
        </>) : (<>
          {kind('rest', 'Rest timer', 'When a rest ends with the phone locked or in another app.')}
          {kind('activity', 'Friend activity', 'A friend request, a request or invite accepted, a gym sent to you.')}
          {kind('friends', 'Pings and messages', 'A friend’s 💪 or message. Mute one friend from their messages.')}
          {kind('pain', 'Morning pain check', 'At 11:00 the day after a set that hurt: has it settled? One tap; it decides whether that lift holds or eases.')}
          {kind('remind', 'Workout reminder', 'On the days below, if nothing is logged by then.')}
          {prefs.kinds.remind && (
            <div className="notify-sub">
              <div className="chips" role="group" aria-label="Reminder days">
                {WEEK.map((d) => (
                  <button key={d} type="button" className="chip" aria-pressed={prefs.reminder.days.includes(d)}
                    onClick={() => change({ ...prefs, reminder: { ...prefs.reminder, days: prefs.reminder.days.includes(d) ? prefs.reminder.days.filter((x) => x !== d) : [...prefs.reminder.days, d].sort() } })}>{DAYS[d]}</button>
                ))}
              </div>
              <div className="when"><label>Time<Input type="time" aria-label="Reminder time" value={prefs.reminder.at} onChange={(e) => e.target.value && change({ ...prefs, reminder: { ...prefs.reminder, at: e.target.value } })} /></label></div>
              <label className="check"><input type="checkbox" checked={learn} onChange={(e) => change({ ...prefs, reminder: { ...prefs.reminder, learn: e.target.checked } })} />
                <span>Fit to my training<br /><span className="muted small">Learned from your log: skips days you don’t usually train, waits while you’re usually still to come, quiet once the week’s goal is met. Never earlier than your time.</span></span></label>
              {plan.line && <p className="muted small" data-testid="reminder-plan">Reminder: {plan.line}</p>}
              {plan.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
            </div>
          )}
          {kind('recap', 'Weekly recap', 'Sessions, sets and PRs for the week.')}
          {prefs.kinds.recap && (
            <div className="notify-sub when">
              <label>Day<select aria-label="Recap day" value={prefs.recap.day} onChange={(e) => change({ ...prefs, recap: { ...prefs.recap, day: Number(e.target.value) } })}>
                {WEEK.map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
              </select></label>
              <label>Time<Input type="time" aria-label="Recap time" value={prefs.recap.at} onChange={(e) => e.target.value && change({ ...prefs, recap: { ...prefs.recap, at: e.target.value } })} /></label>
            </div>
          )}
          <button className="wide" disabled={busy} onClick={() => void act(async () => { const r = await sendTest(); if (r.status < 200 || r.status > 299) throw new PushError(r.status); void getStatus().then(setStatus, () => {}); }, 'Sent. It should show in a few seconds.')}>Send test notification</button>
          <details className="notify-diag">
            <summary>Diagnostics</summary>
            <p className="muted small">Last notification received: {last ? ago(last.at) : 'none yet'}</p>
            <p className="muted small">Last send to this phone: {me?.lastAt ? `${ago(me.lastAt)} (${me.lastStatus})` : 'none yet'}{status && !status.configured ? ' · the server has no key yet' : ''}</p>
            <p className="muted small">Declarative push: {'pushManager' in window ? 'yes' : 'no'}</p>
            <button className="wide" disabled={busy} onClick={() => void act(() => resyncPush(true), 'Checked.')}>Check subscription</button>
          </details>
          <button className="wide" disabled={busy} onClick={() => void act(disablePush, 'Notifications are off on this phone.')}>Turn off on this phone</button>
        </>)}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'ok small' : 'warn small'}>{msg.text}</p>}
    </section>
  );
}

export const NotificationsCard = PUSH_ON ? Card : () => null;
