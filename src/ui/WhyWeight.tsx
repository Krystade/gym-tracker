import type { Evidence, TargetPart } from '../domain/progression';
import type { Suggestion } from '../domain/suggest';
import { fmtDay } from '../domain/format';
import { StatsSheet } from './StatsSheet';

// "Why this weight" (owner, 2026-10-22): the "?" on a lift card's target opens this sheet, which lays the target out line by line,
// each line one input the decision path used (progression Target.parts, suggest's sets), with where it comes from: (a) research
// and its citation, (b) learned from his log and how, (c) a neutral default. Liftosaur's "Why is the weight adjusted?" and
// openGym's "each target explains why" do the same with fixed rules; these lines are what his own log taught it.

const TAG: Record<Evidence['ev'], string> = { a: 'Research', b: 'Learned', c: 'Default' };
const source = (e: Evidence) => (e.ev === 'a' ? e.cite : e.ev === 'b' ? e.method : e.note);

export function WhyWeightLines({ parts, today }: { parts: TargetPart[]; today: string }) {
  return (
    <ol className="why-lines" aria-label="What this target comes from">
      {parts.map((p, i) => (
        <li key={`${p.key}-${i}`} data-input={p.key}>
          <div className="why-top"><b>{p.what}</b>{p.date && <span className="muted">{fmtDay(p.date, today)}</span>}</div>
          <p className="why-value">{p.value}</p>
          <p className="why-ev"><span className={`why-tag ev-${p.evidence.ev}`}>{p.evidence.ev} · {TAG[p.evidence.ev]}</span> {source(p.evidence)}</p>
        </li>
      ))}
    </ol>
  );
}

/** The sheet: the target as the card says it, the reason in a sentence, then its lines. */
export function WhyWeightSheet({ exercise, target, s, today, onClose }: { exercise: string; target: string; s: Suggestion; today: string; onClose: () => void }) {
  return (
    <StatsSheet title="Why this weight" onClose={onClose}>
      <p className="why-target"><span className="muted">{exercise}</span><b>{target}</b></p>
      <p className="why-reason muted">{s.reason}</p>
      <WhyWeightLines parts={s.parts} today={today} />
    </StatsSheet>
  );
}
