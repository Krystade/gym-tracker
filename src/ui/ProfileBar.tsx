import type { PeopleStore } from '../state/usePeople';

const initials = (name: string) => name.trim().split(/\s+/).map((w) => [...w][0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

/** One tap to switch who's training. Shown only once there's more than one profile. */
export function ProfileBar({ people }: { people: PeopleStore }) {
  if (people.people.length < 2) return null;
  return (
    <div className="profile-bar chips" role="group" aria-label="Who’s training">
      {people.people.map((p) => (
        <button key={p.id} className="chip person" aria-pressed={p.id === people.active?.id} onClick={() => { if (p.id !== people.active?.id) void people.switchTo(p.id); }}>
          <span className="initials" aria-hidden="true">{initials(p.name)}</span>{p.name}
        </button>
      ))}
    </div>
  );
}
