import { Icon } from './icons';

/**
 * A folded card's line (owner, 2026-10-22: "two collapsed exercises look differently"): one layout for every state, name length
 * and PR. The status glyph on the left (a tick done, a ring not), the name on the first line with all its width, under it the
 * count and the PR chip, the best set at its right; the chevron at the right edge, centred down the line.
 */
export function FoldLine({ name, done, count, pr, best, onClick }: { name: string; done: boolean; count: string; pr: boolean; best: string | null; onClick: () => void }) {
  return (
    <button className="fold-line" aria-expanded="false" aria-label={`Show ${name}`} onClick={onClick}>
      <span className={done ? 'fold-check' : 'fold-check todo'} aria-hidden="true">{done && <Icon name="check" size={16} sw={2.5} />}</span>
      <b className="fold-name">{name}</b>
      <span className="fold-meta">
        <span className={done ? 'ok' : 'muted'}>{count}</span>
        {pr && <span className="tag pr-tag">PR</span>}
        {best && <span className="muted nw fold-best">{best}</span>}
      </span>
      <Icon name="chev-right" size={18} className="fold-chev" />
    </button>
  );
}
