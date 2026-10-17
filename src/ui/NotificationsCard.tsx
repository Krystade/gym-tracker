import { useEffect, useState, useSyncExternalStore } from 'react';
import { PUSH_ON } from '../push/config';
import { defaultPrefs, disablePush, enablePush, getStatus, localState, PushError, resyncPush, sendTest, setPrefs, standalone, subscribeLocal, supported, type PushPrefs, type Status } from '../push/client';
import { read } from '../push/store';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // chips run Monday to Sunday, like the app's weeks
const ago = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const plain = (e: unknown) => (e instanceof PushError ? (e.status === 401 ? 'Sign in again first.' : e.status === 429 ? 'Too many tries; wait a minute.' : `The notification server said ${e.status}.`)
  : (e as Error)?.name === 'NotAllowedError' ? 'Notifications weren’t allowed.' : 'No connection to the notification server. Try again when you’re online.');

/**
 * Notifications, on the Data screen. Shows nothing at all in a build without a Worker (src/push/config.ts).
 * `signedIn`: this person is the one the account on this phone belongs to. `goal`: sessions per week, for the reminder days.
 */
function Card({ signedIn, goal }: { signedIn: boolean; goal: number }) {
  const local = useSyncExternalStore(subscribeLocal, () => JSON.stringify(localState()));
  const { device, prefs: saved, lost } = JSON.parse(local) as ReturnType<typeof localState>;
  const prefs = saved ?? defaultPrefs(goal);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [perm, setPerm] = useState(() => (supported() ? Notification.permission : 'default'));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [last, setLast] = useState<{ at: number; kind: string | null } | null>(null);
  const home = supported() && standalone();
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
      <button className="wide" onClick={() => document.getElementById('account-h')?.scrollIntoView({ block: 'start' })}>Sign in</button>
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
          <p className="muted small">{lost ? 'This phone stopped getting notifications. Turn them on again to fix it.' : 'Rest timer done on the lock screen, a reminder on training days, and a weekly recap. You pick which.'}</p>
          <button className="primary wide" disabled={!reg || busy} onClick={turnOn}>{lost ? 'Re-enable notifications' : 'Turn on notifications'}</button>
        </>) : (<>
          {kind('rest', 'Rest timer', 'When a rest ends with the phone locked or in another app.')}
          {kind('remind', 'Workout reminder', 'On the days below, if nothing is logged by then.')}
          {prefs.kinds.remind && (
            <div className="notify-sub">
              <div className="chips" role="group" aria-label="Reminder days">
                {WEEK.map((d) => (
                  <button key={d} type="button" className="chip" aria-pressed={prefs.reminder.days.includes(d)}
                    onClick={() => change({ ...prefs, reminder: { ...prefs.reminder, days: prefs.reminder.days.includes(d) ? prefs.reminder.days.filter((x) => x !== d) : [...prefs.reminder.days, d].sort() } })}>{DAYS[d]}</button>
                ))}
              </div>
              <div className="when"><label>Time<input type="time" aria-label="Reminder time" value={prefs.reminder.at} onChange={(e) => e.target.value && change({ ...prefs, reminder: { ...prefs.reminder, at: e.target.value } })} /></label></div>
            </div>
          )}
          {kind('recap', 'Weekly recap', 'Sessions, sets and PRs for the week.')}
          {prefs.kinds.recap && (
            <div className="notify-sub when">
              <label>Day<select aria-label="Recap day" value={prefs.recap.day} onChange={(e) => change({ ...prefs, recap: { ...prefs.recap, day: Number(e.target.value) } })}>
                {WEEK.map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
              </select></label>
              <label>Time<input type="time" aria-label="Recap time" value={prefs.recap.at} onChange={(e) => e.target.value && change({ ...prefs, recap: { ...prefs.recap, at: e.target.value } })} /></label>
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
