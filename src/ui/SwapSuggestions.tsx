import type { Suggestion } from '../domain/care';

export function SwapSuggestions({ items, onPick }: { items: Suggestion[]; onPick?: (name: string) => void }) {
  if (!items.length) return null;
  return (
    <section className="card swaps" aria-labelledby="swaps-h">
      <h2 id="swaps-h">Suggested swaps</h2>
      <ul aria-label="Suggested swaps">
        {items.map((s) => {
          const body = <><b>{s.name}</b><span className="muted small">{s.why}</span></>;
          return <li key={s.name}>{onPick ? <button type="button" onClick={() => onPick(s.name)}>{body}</button> : <div>{body}</div>}</li>;
        })}
      </ul>
    </section>
  );
}
