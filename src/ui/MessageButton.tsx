import type { FriendNews } from '../cloud/friends';
import { shortAgo } from '../domain/messages';

/** A friend's message button: 44px, with a dot while they have unread pings or messages. */
export function MessageButton({ name, unread, onClick }: { name: string; unread: number; onClick: () => void }) {
  return (
    <button className="mini msg-button" aria-label={`Message @${name}${unread ? `, ${unread} unread` : ''}`} onClick={onClick}>
      <span aria-hidden="true">💬</span>{unread > 0 && <span className="unread-dot" aria-hidden="true" />}
    </button>
  );
}

/** Their newest item and how long ago ("💪 · 2h"), or nothing. */
export function Latest({ news, uid }: { news: FriendNews | null | undefined; uid: string }) {
  const l = news?.latest[uid];
  // The words give way to an ellipsis; the age always shows.
  return l ? <span className="msg-latest"><span className="msg-text">{l.text}</span><span className="msg-ago"> · {shortAgo(l.at, Date.now())}</span></span> : null;
}
