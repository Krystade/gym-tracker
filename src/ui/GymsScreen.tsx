import { useState } from 'react';
import type { GymsStore } from '../state/useGyms';
import { canDo, EQUIPMENT_GROUPS, GEAR_VERSION, unasked, type Equipment, type Gym } from '../domain/equipment';
import { searchLifts } from '../domain/search';
import { normalizeName } from '../domain/ids';
import { sameExercise } from '../domain/stats';
import { copyGym, gymText, parseGymText } from '../domain/share';
import { cloudError, loadCloud } from '../cloud/firebase';
import { listFriends, myUsername, sendGym, type Friend } from '../cloud/friends';
import { Input, TextArea } from './Field';
import { FriendName } from './FriendName';
import { PLATE_SIZES, platesOf } from '../domain/plates';
import { fmtWeight } from '../domain/format';

const newGym = (n: number): Gym => ({ id: `g${Date.now().toString(36)}`, name: n ? `Gym ${n + 1}` : 'My gym', equipment: [], exclude: [], include: [], gearVersion: GEAR_VERSION });
const ALL_GEAR = EQUIPMENT_GROUPS.flatMap(([, items]) => items);
const without = (xs: string[], name: string) => xs.filter((x) => !sameExercise(x, name));

/** Paste a gym someone copied as text: a preview first, then it's added as one of yours. */
function AddFromText({ gyms, onDone }: { gyms: GymsStore; onDone: () => void }) {
  const [text, setText] = useState('');
  const r = text.trim() ? parseGymText(text) : null;
  return (
    <section className="card" aria-label="Add from text">
      <label className="field">Paste a copied gym<TextArea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
      {r && 'error' in r && <p className="warn small" role="status">{r.error}</p>}
      {r && 'gym' in r && <p className="muted small" role="status">{r.gym.name} · {r.gym.equipment.length} {r.gym.equipment.length === 1 ? 'piece' : 'pieces'} of gear{r.unknown.length ? `. Skipped gear this app doesn’t know: ${r.unknown.join(', ')}` : ''}</p>}
      <div className="form-actions">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" disabled={!r || 'error' in r} onClick={() => {
          if (!r || 'error' in r) return;
          const n = copyGym(r.gym, gyms.gyms);
          // Closed with the same render that shows the gym (save shows it at once): waiting for the write left the form open over
          // the new gym, and with no gym before it, a fresh empty form where the gym's page puts it.
          onDone();
          void gyms.save([...gyms.gyms, n], n.id);
        }}>Add gym</button>
      </div>
    </section>
  );
}

/** Copy the gym as text for a message, or send it to a friend in the app. Gear and lift lists only. */
function ShareGym({ gym, uid }: { gym: Gym; uid?: string | null }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shown, setShown] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(gymText(gym)); setMsg({ ok: true, text: 'Copied. Paste it in a message.' }); setShown(false); }
    catch { setShown(true); setMsg({ ok: false, text: 'Couldn’t copy. Select the text below and copy it.' }); }
  };
  const pick = async () => {
    setBusy(true); setMsg(null);
    try { const c = await loadCloud(); setFriends(await listFriends(c, uid!)); }
    catch (e) { setMsg({ ok: false, text: cloudError(e) }); }
    finally { setBusy(false); }
  };
  const send = async (f: Friend) => {
    setBusy(true); setMsg(null);
    try {
      const c = await loadCloud();
      await sendGym(c, uid!, (await myUsername(c, uid!)) ?? 'a friend', f.uid, gym);
      setFriends(null); setMsg({ ok: true, text: `Sent ${gym.name} to ${f.name}.` });
    } catch (e) { setMsg({ ok: false, text: cloudError(e) }); }
    finally { setBusy(false); }
  };
  return (
    <section className="card" aria-label="Share this gym">
      <h2>Share this gym</h2>
      <p className="muted small">Shares the gear and lift lists. Nothing from your log.</p>
      <div className="form-actions">
        <button onClick={() => void copy()}>Copy as text</button>
        {uid && <button disabled={busy} onClick={() => void pick()}>Send to a friend</button>}
      </div>
      {shown && <textarea readOnly aria-label="Gym as text" rows={5} value={gymText(gym)} onFocus={(e) => e.target.select()} />}
      {friends && (friends.length ? (
        <ul className="friend-list" aria-label="Send to">
          {friends.map((f) => <li key={f.uid}><span><FriendName me={uid} friend={f} bare /></span><button className="mini" disabled={busy} onClick={() => void send(f)}>Send</button></li>)}
        </ul>
      ) : <p className="muted small">No friends yet. Add one under Friends.</p>)}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted small' : 'warn'}>{msg.text}</p>}
    </section>
  );
}

/** Opened from More, Today's gym line, or Program; Back goes where it came from (`backLabel` names More when it's More). */
export function GymsScreen({ gyms, logged, fresh, uid, backLabel = '‹ Back', onBack }: { gyms: GymsStore; logged: string[]; fresh?: boolean; uid?: string | null; backLabel?: string; onBack?: () => void }) {
  const [pasting, setPasting] = useState(false);
  const [q, setQ] = useState('');
  // "Set up your gym" opens on an unsaved draft: backing out leaves no gym; the first edit saves it.
  const [draft, setDraft] = useState<Gym | null>(() => (fresh && !gyms.active ? newGym(gyms.gyms.length) : null));
  const g = draft ?? gyms.active;
  const update = (fn: (x: Gym) => Gym) => {
    if (!g) return;
    if (draft) { const n = fn(draft); setDraft(null); void gyms.save([...gyms.gyms, n], n.id); return; }
    void gyms.save(gyms.gyms.map((x) => (x.id === g.id ? fn(x) : x)), g.id);
  };

  const back = onBack && <button className="back" onClick={onBack}>{backLabel}</button>;
  if (!g) return (
    <>
      {back}
      <h1>Gyms</h1>
      <p className="muted">List what your gym has, and the program and swap suggestions only use lifts you can do there.</p>
      {/* A draft, like "Set up your gym": leaving before naming it or ticking gear leaves no gym behind. */}
      <button className="primary wide" onClick={() => setDraft(newGym(gyms.gyms.length))}>Add gym</button>
      {pasting ? <AddFromText gyms={gyms} onDone={() => setPasting(false)} /> : <button className="wide" onClick={() => setPasting(true)}>Add from text</button>}
    </>
  );

  const query = normalizeName(q);
  const mine = [...new Set([...logged, ...g.include])];
  const shown = (query ? searchLifts(query, mine) : mine.filter((n) => g.include.some((x) => sameExercise(x, n)) || g.exclude.some((x) => sameExercise(x, n)))).slice(0, 40);
  const listed = shown.some((n) => sameExercise(n, query));
  const toCheck = unasked(g);

  return (
    <>
      {back}
      <h1>Gyms</h1>
      {!draft && <div className="chips gym-chips" role="group" aria-label="Active gym">
        {gyms.gyms.map((x) => <button key={x.id} className={`chip${x.id === g.id ? ' primary' : ''}`} aria-pressed={x.id === g.id} onClick={() => void gyms.save(gyms.gyms, x.id)}><span className="pname">{x.name}</span></button>)}
        {/* A draft too: leaving before naming it or ticking gear leaves no second gym behind. */}
        <button className="chip" onClick={() => setDraft(newGym(gyms.gyms.length))}>+ Add gym</button>
        <button className="chip" onClick={() => setPasting(true)}>+ From text</button>
      </div>}
      {pasting && <AddFromText gyms={gyms} onDone={() => setPasting(false)} />}
      <section className="card">
        <label className="field">Gym name<Input value={g.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} /></label>
      </section>
      {/* Gear the app added after this gym was set up: neither there nor missing until he says (owner, Q5). */}
      {toCheck.length > 0 && <section className="card gear-new" aria-label="New equipment to check">
        <p><b>New equipment to check:</b> {toCheck.join(', ')}. Tick what this gym has.</p>
        <button className="mini" onClick={() => update((x) => ({ ...x, gearVersion: GEAR_VERSION }))}>Checked</button>
      </section>}
      <button className="wide" disabled={ALL_GEAR.every((e) => g.equipment.includes(e))}
        onClick={() => update((x) => ({ ...x, equipment: [...ALL_GEAR], gearVersion: GEAR_VERSION }))}>Full gym: tick all gear</button>
      {EQUIPMENT_GROUPS.map(([label, items]) => {
        const all = items.every((e) => g.equipment.includes(e));
        return (
        <fieldset key={label} className="card gear">
          <legend className="sr-only">{label}</legend>
          <b className="gear-title" aria-hidden="true">{label}</b>
          <button type="button" className="mini gear-all" aria-label={all ? `Clear ${label}` : `Tick all ${label}`}
            onClick={() => update((x) => ({ ...x, equipment: all ? x.equipment.filter((y) => !items.includes(y)) : [...x.equipment.filter((y) => !items.includes(y)), ...items] }))}>
            {all ? 'Clear' : 'Tick all'}
          </button>
          {items.map((e) => (
            <label key={e} className="check">
              <input type="checkbox" checked={g.equipment.includes(e)}
                onChange={(ev) => update((x) => ({ ...x, equipment: ev.target.checked ? [...x.equipment, e] : x.equipment.filter((y): y is Equipment => y !== e) }))} />
              {e}
            </label>
          ))}
        </fieldset>
        );
      })}
      {/* Round 28 (owner): the per-side line loads only the plates this gym has; 35s on by default. */}
      <section className="card">
        <h2>Plates</h2>
        <p className="muted small">The plates here (lb), for a bar lift’s “a side” line.</p>
        <div className="chips" role="group" aria-label="Plates here" style={{ gap: 6 }}>
          {PLATE_SIZES.map((p) => { const on = platesOf(g).includes(p); return (
            <button key={p} type="button" className="chip" aria-pressed={on} aria-label={`${fmtWeight(p)} lb plates`}
              onClick={() => update((x) => ({ ...x, plates: on ? platesOf(x).filter((y) => y !== p) : PLATE_SIZES.filter((y) => y === p || platesOf(x).includes(y)) }))}>{fmtWeight(p)}</button>); })}
        </div>
      </section>
      <section className="card">
        <h2>Exercises here</h2>
        <p className="muted small">Exclude a lift the gear can’t really do (a weak cable stack, a broken machine). Add lifts that need nothing listed above, or that aren’t in the app’s list.</p>
        <Input type="search" aria-label="Search exercises" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="gym-ex">
          {query && !listed && <li><button className="primary" onClick={() => { update((x) => ({ ...x, include: [...without(x.include, query), query], exclude: without(x.exclude, query) })); }}>I can do “{query}” here</button></li>}
          {shown.map((n) => {
            const ok = canDo(g, n);
            const excluded = g.exclude.some((x) => sameExercise(x, n));
            const included = g.include.some((x) => sameExercise(x, n));
            return (
              <li key={n}>
                <span>{n}<span className={`small ${ok ? 'muted' : 'warn'}`}> · {excluded ? 'excluded' : included ? 'added' : ok ? 'can do' : ok === false ? 'missing gear' : 'gear unknown'}</span></span>
                {excluded ? <button className="mini" onClick={() => update((x) => ({ ...x, exclude: without(x.exclude, n) }))} aria-label={`Allow ${n}`}>Allow</button>
                  : included ? <button className="mini" onClick={() => update((x) => ({ ...x, include: without(x.include, n) }))} aria-label={`Remove ${n}`}>Remove</button>
                  : ok ? <button className="mini" onClick={() => update((x) => ({ ...x, exclude: [...x.exclude, n] }))} aria-label={`Exclude ${n}`}>Exclude</button>
                  : <button className="mini" onClick={() => update((x) => ({ ...x, include: [...x.include, n] }))} aria-label={`I can do ${n} here`}>I can do it</button>}
              </li>
            );
          })}
        </ul>
      </section>
      {!draft && <ShareGym gym={g} uid={uid} />}
      {!draft && <button className="wide danger gym-delete" onClick={() => {
        if (!confirm(`Delete ${g.name}?`)) return;
        const rest = gyms.gyms.filter((x) => x.id !== g.id);
        void gyms.save(rest, rest[0]?.id);
      }}>Delete <span className="pname">{g.name}</span></button>}
    </>
  );
}
