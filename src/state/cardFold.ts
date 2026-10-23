import { useCallback, useState } from 'react';
import { useProfileId } from './profileDb';

// A card's fold as he last chose it (true folded, false open, null automatic), kept outside the card: Add exercise and Swap
// take Today's place, and a card's own state went with it, so every card folded by hand came back open (owner, 2026-10-23).
// Per profile, day and lift; on the phone for as long as the app is open (a reload starts every card automatic again).
const kept = new Map<string, boolean | null>();

export function useCardFold(date: string, exercise: string): [boolean | null, (v: boolean | null) => void] {
  const key = `${useProfileId()}|${date}|${exercise.toLowerCase()}`;
  const [, render] = useState(0);
  const set = useCallback((v: boolean | null) => {
    if (v === null) kept.delete(key); else kept.set(key, v);
    render((n) => n + 1);
  }, [key]);
  return [kept.get(key) ?? null, set];
}
