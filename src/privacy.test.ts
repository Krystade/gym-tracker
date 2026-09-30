import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { violations } from './privacy';

describe('privacy guard', () => {
  it('flags personal-data paths and allows samples', () => {
    expect(violations(['data/x.json', 'log.csv', 'me.JPG', 'Workout Log.xlsx', 'gym-backup-1.json', 'originals/notes.md', 'notes-2026.txt', '2026 notes.txt', 'workout-journal.txt', 'my gym notes.md'])).toHaveLength(10);
    expect(violations(['e2e/fixtures/log.sample.txt', 'docs/superpowers/plans/2026-09-29-phase-1-log-and-history.md'])).toEqual([]);
    expect(violations(['public/robots.txt'])).toEqual([]);
    expect(violations(['e2e/fixtures/history.sample.csv', 'public/pwa-192x192.png', 'src/domain/csv.ts'])).toEqual([]);
  });

  it('no tracked file looks like personal data', () => {
    const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(violations(tracked)).toEqual([]);
  });
});
