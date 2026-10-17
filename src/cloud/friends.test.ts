import { describe, expect, it } from 'vitest';
import { readFriendWindow } from './friends';
import type { Cloud } from './firebase';

/** Firestore by path, recording every document read. */
function fakeCloud(docs: Record<string, object>) {
  const read: string[] = [];
  const F = {
    doc: (_db: unknown, path: string) => ({ path }),
    getDoc: async (r: { path: string }) => { read.push(r.path); return { exists: () => r.path in docs, data: () => docs[r.path] }; },
  };
  return { cloud: { F, db: {} } as unknown as Cloud, read };
}
const set = (date: string) => ({ id: `app|${date}|squat|1`, date, seq: 1, exercise: 'Barbell Squat', setNo: 1, weight: 100, reps: 5, flags: [], source: 'app' });

describe('readFriendWindow', () => {
  const docs = {
    'users/b/meta/index': { months: { '2026-06': 1, '2026-08': 1, '2026-09': 1, '2026-10': 1 } },
    'users/b/months/2026-06': { sets: [set('2026-06-02')] },
    'users/b/months/2026-08': { sets: [set('2026-08-20'), set('2026-08-29')] },
    'users/b/months/2026-09': { sets: [set('2026-09-10')] },
    'users/b/months/2026-10': { sets: [set('2026-10-16'), set('2026-10-18')] },
    'users/b/meta/profile': { items: { status: JSON.stringify('  leg day   🦵 '), program: JSON.stringify({ secret: 1 }) } },
  };
  it('reads only the months the window touches, and keeps only its days and the status phrase', async () => {
    const { cloud, read } = fakeCloud(docs);
    const w = await readFriendWindow(cloud, 'b', '2026-08-23', '2026-10-17');
    expect(read.filter((p) => p.includes('/months/')).sort()).toEqual(['users/b/months/2026-08', 'users/b/months/2026-09', 'users/b/months/2026-10']);
    expect(w.sets.map((s) => s.date)).toEqual(['2026-08-29', '2026-09-10', '2026-10-16']);
    expect(w).toEqual({ sets: w.sets, status: 'leg day 🦵' });
  });
  it('has no status when none was set, and a window with no months reads none', async () => {
    const { cloud, read } = fakeCloud({ 'users/b/meta/index': { months: {} } });
    expect(await readFriendWindow(cloud, 'b', '2026-08-23', '2026-10-17')).toEqual({ sets: [], status: '' });
    expect(read.some((p) => p.includes('/months/'))).toBe(false);
  });
});
