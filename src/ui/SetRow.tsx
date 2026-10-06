import type { Flag, SetEntry } from '../domain/types';
import { fmtSet } from '../domain/format';

const TAG: Partial<Record<Flag, string>> = { warmup: 'warm-up', double_pulley: '2× pulley' };
const HOW_BAD = { 1: 'mild', 2: 'moderate', 3: 'sharp' } as const;

/** `no`: the set's place in the session as done; setNo is part of its id and keeps entry order. */
export function SetRowContent({ s, estRir, no = s.setNo }: { s: SetEntry; estRir: number | null; no?: number }) {
  return (
    <>
      <span className="set-no">{no}</span>
      <span>{fmtSet(s)}</span>
      {s.rir != null ? <span className="tag">RIR {s.rir}</span>
        : estRir != null && <span className="tag est" title="Estimated">~{estRir} RIR</span>}
      {s.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f === 'pain' && s.painRegion ? `pain · ${s.painRegion}${s.painSeverity ? ` · ${HOW_BAD[s.painSeverity]}` : ''}` : TAG[f] ?? f}</span>)}
      {s.note && <span className="note">{s.note}</span>}
    </>
  );
}
