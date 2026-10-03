import { useEffect, useRef } from 'react';
import type { PeopleStore } from '../state/usePeople';

const initials = (name: string) => name.trim().split(/\s+/).map((w) => [...w][0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

/** One tap to switch who's training. Shown only once there's more than one profile. */
export function ProfileBar({ people }: { people: PeopleStore }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const activeId = people.active?.id;
  // With the bar scrolling sideways, a switch to a far chip must not leave it off-screen.
  useEffect(() => { activeRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }); }, [activeId, people.people.length]);
  if (people.people.length < 2) return null;
  return (
    <div className="profile-bar chips" role="group" aria-label="Who’s training">
      {people.people.map((p) => (
        <button key={p.id} ref={p.id === activeId ? activeRef : undefined} className="chip person" aria-pressed={p.id === activeId} onClick={() => { if (p.id !== people.active?.id) void people.switchTo(p.id); }}>
          <span className="initials" aria-hidden="true">{initials(p.name)}</span><span className="pname">{p.name}</span>
        </button>
      ))}
    </div>
  );
}
