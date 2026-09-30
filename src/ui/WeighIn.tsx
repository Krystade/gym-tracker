import { useState } from 'react';
import type { BodyStore } from '../state/useBody';
import { fmtWeight } from '../domain/format';
import { trend } from '../domain/body';

export function WeighIn({ body, date }: { body: BodyStore; date: string }) {
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

  return (
    <div className="weigh" role="group" aria-label="Weigh-in">
      {todays != null && !editing ? (<>
        <span>Weighed <b>{fmtWeight(todays)} lb</b></span>
        <button type="button" onClick={() => { setV(String(todays)); setEditing(true); }}>Edit</button>
      </>) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input aria-label="Weigh-in (lb)" inputMode="decimal" placeholder={last ? `Weigh-in (trend ${last.trend.toFixed(1)})` : 'Weigh-in, lb'}
            value={v} onChange={(e) => setV(e.target.value.replace(',', '.'))} />
          <button type="submit" className="primary" disabled={!valid}>Save weight</button>
        </form>
      )}
    </div>
  );
}
