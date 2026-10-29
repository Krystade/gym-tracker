import type { SetsStore } from '../state/useSets';
import { HistoryScreen } from './HistoryScreen';
import { LiftsScreen } from './LiftsScreen';

/** Log's two views (Gym Buddies §16.4): the day list (History) and the lift list (Lifts), as they were on their own tabs. */
export type LogView = 'days' | 'lifts';
export const isLogView = (x: unknown): x is LogView => x === 'days' || x === 'lifts';

/** History and Lifts on one tab, under a Days | Lifts switch that the caller keeps (it remembers the last view per phone). */
export function LogScreen({ view, onView, store, onOpen, focus, onFocused, onAddTo }: {
  view: LogView; onView: (v: LogView) => void; store: SetsStore; onOpen: (name: string) => void;
  focus: string | null; onFocused: () => void; onAddTo: (date: string) => void;
}) {
  const head = (
    <>
      <h1>Log</h1>
      <div className="st-range log-switch" role="group" aria-label="Show">
        {(['days', 'lifts'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => { if (v !== view) { onView(v); window.scrollTo(0, 0); } }}>{v === 'days' ? 'Days' : 'Lifts'}</button>
        ))}
      </div>
    </>
  );
  return view === 'days'
    ? <HistoryScreen store={store} onOpen={onOpen} focus={focus} onFocused={onFocused} onAddTo={onAddTo} head={head} />
    : <LiftsScreen store={store} onOpen={onOpen} head={head} />;
}
