import { EQUIPMENT, type Equipment, type Gym } from './equipment';

// A gym passed between people: as text to paste into a message, or copied from a friend. Only the gym, never a log.

const HEAD = 'Gym Tracker gym:';
const LINES = { equipment: 'Equipment:', exclude: 'Not here:', include: 'Also here:' } as const;
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function gymText(g: Gym): string {
  return [
    `${HEAD} ${g.name}`,
    `${LINES.equipment} ${g.equipment.join(', ')}`,
    g.exclude.length ? `${LINES.exclude} ${g.exclude.join(', ')}` : null,
    g.include.length ? `${LINES.include} ${g.include.join(', ')}` : null,
  ].filter((x) => x != null).join('\n');
}

/** Reads a copied gym out of whatever was pasted around it. Gear the app doesn't know is skipped and named. */
export function parseGymText(text: string): { gym: Omit<Gym, 'id'>; unknown: string[] } | { error: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const after = (label: string) => {
    const l = lines.find((x) => x.toLowerCase().startsWith(label.toLowerCase()));
    return l == null ? null : l.slice(label.length).trim();
  };
  const name = after(HEAD);
  if (!name) return { error: 'This doesn’t look like a copied gym.' };
  const equipment: Equipment[] = [], unknown: string[] = [];
  for (const e of list(after(LINES.equipment) ?? '')) {
    const known = EQUIPMENT.find((x) => x === e.toLowerCase());
    if (!known) unknown.push(e);
    else if (!equipment.includes(known)) equipment.push(known);
  }
  return { gym: { name, equipment, exclude: list(after(LINES.exclude) ?? ''), include: list(after(LINES.include) ?? '') }, unknown };
}

/** Someone else's gym as a new one of yours: its own id, and a name that doesn't clash with yours. */
export function copyGym(g: Omit<Gym, 'id'>, mine: Gym[]): Gym {
  const taken = new Set(mine.map((x) => x.name.toLowerCase()));
  let name = g.name, n = 2;
  while (taken.has(name.toLowerCase())) name = `${g.name} (${n++})`;
  return { id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, equipment: [...g.equipment], exclude: [...g.exclude], include: [...g.include] };
}
