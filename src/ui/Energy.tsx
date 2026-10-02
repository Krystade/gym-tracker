import type { BodyStore } from '../state/useBody';

/** One tap a day: how training feels going in. Kept with the day's weigh-in, for spotting what predicts a good session. */
export function Energy({ body, date }: { body: BodyStore; date: string }) {
  const cur = body.days.find((d) => d.date === date)?.energy;
  return (
    <div className="chips" role="group" aria-label="Energy">
      <span className="chip-label">Energy</span>
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button key={n} type="button" className="chip" aria-pressed={cur === n} onClick={() => { if (cur !== n) void body.save({ date, energy: n }); }}>{n}</button>
      ))}
    </div>
  );
}
