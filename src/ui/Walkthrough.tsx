import { useState } from 'react';

const KEY = 'gym-tracker:walkthrough';

const CARDS: [string, string][] = [
  ['Today', 'Today is where you train. Add exercise opens a lift; each one gets its own card.'],
  ['Log a set', 'Type the weight and reps and tap Add set. The next set starts from the last one, so most sets are one tap.'],
  ['The plan', 'Program builds a plan from your priorities. Today lists what’s left; Skip or Swap any lift from its row.'],
  ['History, Lifts and Stats', 'History lists every session, Lifts shows your last and best sets, and Stats counts weekly sets per muscle against targets that fit your week.'],
  ['Your data', 'Everything stays on this phone. Export a backup on the Data tab now and then; this walkthrough is there too.'],
];

/** Whether the walkthrough still has to be shown. Storage that can't be read counts as seen, so it never nags. */
export function walkthroughPending(): boolean {
  try { return localStorage.getItem(KEY) !== 'done'; } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(KEY, 'done'); } catch { /* shown again next visit at worst */ }
}

/** A few short cards in a sheet at the bottom of the screen; Skip or Done closes it for good. */
export function Walkthrough({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const close = () => { markSeen(); onClose(); };
  const [title, body] = CARDS[i];
  const last = i === CARDS.length - 1;
  return (
    <section className="walkthrough" role="dialog" aria-label="Walkthrough">
      <p className="muted small">{i + 1} of {CARDS.length}</p>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="walk-actions">
        <button type="button" onClick={close}>Skip</button>
        <span>
          {i > 0 && <button type="button" onClick={() => setI(i - 1)}>Back</button>}
          <button type="button" className="primary" onClick={last ? close : () => setI(i + 1)}>{last ? 'Done' : 'Next'}</button>
        </span>
      </div>
    </section>
  );
}
