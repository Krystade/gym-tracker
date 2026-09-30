import type { SetEntry } from '../domain/types';
import { fmtSet } from '../domain/format';

export function SetRowContent({ s, estRir }: { s: SetEntry; estRir: number | null }) {
  return (
    <>
      <span className="set-no">{s.setNo}</span>
      <span>{fmtSet(s)}</span>
      {s.rir != null ? <span className="tag">RIR {s.rir}</span>
        : estRir != null && <span className="tag est" title="Estimated">~{estRir} RIR</span>}
      {s.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f === 'pain' && s.painRegion ? `pain · ${s.painRegion}${s.painSeverity === 3 ? ' · sharp' : ''}` : f.replace('_', ' ')}</span>)}
      {s.note && <span className="note">{s.note}</span>}
    </>
  );
}
