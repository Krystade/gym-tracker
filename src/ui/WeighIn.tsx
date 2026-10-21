import { useState } from 'react';
import type { BodyStore } from '../state/useBody';
import { fmtWeight } from '../domain/format';
import { trend } from '../domain/body';
import { Input } from './Field';

/**
 * The day's weigh-in. `row`: today's, a row inside Ready under Energy (IA A1, owner 2026-10-21), labelled like it; else a past
 * day's, a card of its own.
 */
export function WeighIn({ body, date, row = false }: { body: BodyStore; date: string; row?: boolean }) {
  const todays = body.days.find((d) => d.date === date)?.weight;
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const last = trend(body.days.filter((d) => d.date < date)).at(-1);
  const n = Number(v);
  const valid = v.trim() !== '' && Number.isFinite(n) && n >= 50 && n <= 700;

  async function save() {
    if (!valid) return;
    if (await body.save({ date, weight: Math.round(n * 10) / 10 })) { setEditing(false); setV(''); }
  }

  const hint = row ? (last ? `lb · trend ${last.trend.toFixed(1)}` : 'lb') : last ? `Weigh-in (trend ${last.trend.toFixed(1)})` : 'Weigh-in, lb';
  return (
    <div className={row ? 'weigh-row' : 'weigh'} role="group" aria-label="Weigh-in">
      {row && <span className="chip-label">Weight</span>}
      {todays != null && !editing ? (<>
        <span className="weigh-val">{row ? <b>{fmtWeight(todays)} lb</b> : <>Weighed <b>{fmtWeight(todays)} lb</b></>}</span>
        <button type="button" className="quiet-btn" onClick={() => { setV(String(todays)); setEditing(true); }}>Edit</button>
      </>) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Input aria-label="Weigh-in (lb)" inputMode="decimal" placeholder={hint}
            value={v} onChange={(e) => setV(e.target.value.replace(',', '.'))} />
          <button type="submit" className="primary" aria-label="Save weight" disabled={!valid}>{row ? 'Save' : 'Save weight'}</button>
        </form>
      )}
    </div>
  );
}
