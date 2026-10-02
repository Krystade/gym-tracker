import type { SetEntry } from '../domain/types';
import { fmtSet } from '../domain/format';

/** `no`: the set's place in the session as done; setNo is part of its id and keeps entry order. */
export function SetRowContent({ s, estRir, no = s.setNo }: { s: SetEntry; estRir: number | null; no?: number }) {
  return (
    <>
      <span className="set-no">{no}</span>
      <span>{fmtSet(s)}</span>
      {s.rir != null ? <span className="tag">RIR {s.rir}</span>
        : estRir != null && <span className="tag est" title="Estimated">~{estRir} RIR</span>}
      {s.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f === 'pain' && s.painRegion ? `pain · ${s.painRegion}${s.painSeverity === 3 ? ' · sharp' : ''}` : f.replace('_', ' ')}</span>)}
      {s.note && <span className="note">{s.note}</span>}
    </>
  );
}
