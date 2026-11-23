import { Icon } from './icons';

/**
 * A folded card's line (owner, 2026-10-22: "two collapsed exercises look differently"): one layout for every state, name length
 * and PR. The status glyph on the left (a tick done, a ring not), the name on the first line with all its width, under it the
 * count and the PR chip, the best set at its right; the chevron at the right edge, centred down the line.
 */
export function FoldLine({ name, done, count, pr, best, onClick, test = false, pts = 0 }: { name: string; done: boolean; count: string; pr: boolean; best: string | null; onClick: () => void;
  /** Today's buddy points from it (owner, 2026-11-22: the open card's pill, kept on the folded line too). */
  pts?: number;
  /** A test is due on the lift (item 05): its pill beside the name; the tap that opens the card shows the note. */
  test?: boolean }) {
  return (
    <button className="fold-line" aria-expanded="false" aria-label={`Show ${name}`} onClick={onClick}>
      <span className={done ? 'fold-check' : 'fold-check todo'} aria-hidden="true">{done && <Icon name="check" size={16} sw={2.5} />}</span>
      {/* On the name's line: the count's line has no room for it at 320px. */}
      <b className="fold-name">{name}{test && <> <span className="tag test-tag">Test due</span></>}</b>
      <span className="fold-meta">
        <span className={done ? 'ok' : 'muted'}>{count}</span>
        {pr && <span className="tag pr-tag">PR</span>}
        {pts > 0 && <span className="pts-pill">+{pts} pts</span>}
        {best && <span className="muted nw fold-best">{best}</span>}
      </span>
      <Icon name="chev-right" size={18} className="fold-chev" />
    </button>
  );
}
