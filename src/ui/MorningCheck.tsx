import { useState } from 'react';
import { answered, morningAsks, type MorningAsk } from '../domain/morning';
import type { SetsStore } from '../state/useSets';
import type { Morning } from '../domain/types';
import { Input } from './Field';

// The next-morning question (item 08, round 20), on Today the day after pain: one tap, a note if he likes, or "Not now" (stored as
// skipped: unknown, which changes nothing). The 11:00 push lands here. Optional, never required.

const CHOICES: [Exclude<Morning, 'skipped'>, string][] = [['settled', 'Settled'], ['sore', 'Still sore'], ['worse', 'Worse']];
const SAID: Record<Exclude<Morning, 'skipped'>, string> = { settled: 'settled', sore: 'still sore', worse: 'worse' };
const what = (r: string) => (r === 'other' ? 'the pain' : `your ${r}`);
const list = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

export function MorningCheck({ store, today }: { store: SetsStore; today: string }) {
  const asks = morningAsks(store.entries, today);
  // Answered here just now: kept on screen to take a note, until Done.
  const [done, setDone] = useState<{ ask: MorningAsk; morning: Exclude<Morning, 'skipped'> } | null>(null);
  const [note, setNote] = useState('');
  const save = async (ask: MorningAsk, m: Morning, text?: string) => {
    for (const e of answered(store.entries, ask.date, ask.region, m, text)) if (!(await store.update(e))) return false;
    return true;
  };
  if (!asks.length && !done) return null;
  return (
    <>
      {done && (
        <div className="target-suggest morning-check" role="group" aria-label="Morning check">
          <p><b>Saved: {what(done.ask.region)} {done.morning === 'settled' ? 'settled' : `is ${SAID[done.morning]}`}.</b></p>
          <label className="muted small morning-note">A note, if you like
            <Input value={note} maxLength={200} placeholder="e.g. stiff on waking, fine by noon" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="target-suggest-actions">
            <button type="button" className="primary" onClick={async () => { if (!note.trim() || await save(done.ask, done.morning, note)) { setDone(null); setNote(''); } }}>Done</button>
          </div>
        </div>
      )}
      {asks.map((ask) => (
        <div key={ask.region} className="target-suggest morning-check" role="group" aria-label="Morning check">
          <p><b>How’s {what(ask.region)} this morning?</b></p>
          <p className="muted small">After {list(ask.lifts)} yesterday. It decides whether {ask.lifts.length > 1 ? 'they hold' : 'it holds'} or {ask.lifts.length > 1 ? 'ease' : 'eases'} next time.</p>
          <div className="target-suggest-actions morning-answers">
            {CHOICES.map(([m, label]) => <button key={m} type="button" onClick={async () => { if (await save(ask, m)) setDone({ ask, morning: m }); }}>{label}</button>)}
          </div>
          <button type="button" className="quiet-btn morning-skip" onClick={() => void save(ask, 'skipped')}>Not now</button>
        </div>
      ))}
    </>
  );
}
