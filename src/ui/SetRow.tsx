import type { Flag, SetEntry } from '../domain/types';
import { fmtSet } from '../domain/format';

const TAG: Partial<Record<Flag, string>> = { warmup: 'warm-up', double_pulley: '2× pulley', light: 'light week' };
const HOW_BAD = { 1: 'mild', 2: 'moderate', 3: 'sharp' } as const;

/** `no`: the set's place in the session as done; setNo is part of its id and keeps entry order. */
export function SetRowContent({ s, estRir, no = s.setNo, pr = false }: { s: SetEntry; estRir: number | null; no?: number; pr?: boolean }) {
  return (
    <>
      <span className="set-no">{no}</span>
      <span>{fmtSet(s)}</span>
      {pr && <span className="tag pr-tag">PR</span>}
      {s.rir != null ? <span className="tag">RIR {s.rir}</span>
        : estRir != null && <span className="tag est" title="Estimated">~{estRir} RIR</span>}
      {s.flags.filter((f) => f !== 'bodyweight' && f !== 'cardio').map((f) => <span key={f} className={`tag ${f}`}>{f === 'pain' && s.painRegion ? `pain · ${s.painRegion}${s.painSeverity ? ` · ${HOW_BAD[s.painSeverity]}` : ''}` : TAG[f] ?? f}</span>)}
      {s.excluded && <span className="tag not-used" title="Kept as logged: nothing learns from it and it sets no record">not used for learning or records</span>}
      {s.tags?.map((t) => <span key={`#${t}`} className="tag own">{t}</span>)}
      {s.note && <span className="note">{s.note}</span>}
    </>
  );
}
