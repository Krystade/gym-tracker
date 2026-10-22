import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNED, cleanDisplayName, displayLength, displayNameError, displayOf, MAX_DISPLAY, MAX_DISPLAY_UNITS, NAME_GAP_MS, nextNameAt } from './displayName';

describe('cleanDisplayName', () => {
  it('trims, folds runs of space and line breaks into one space, and composes accents (NFC)', () => {
    expect(cleanDisplayName('  Jack   S. \n')).toBe('Jack S.');
    expect(cleanDisplayName('Ana\tGarcía\r\nR.')).toBe('Ana García R.');
    expect(cleanDisplayName('José')).toBe('José');
    expect(cleanDisplayName('José').length).toBe(4);
    expect(cleanDisplayName('Mara\u00a0R.\u3000')).toBe('Mara R.');
    expect(cleanDisplayName('   ')).toBe('');
  });
  it('drops what nobody can see: zero-width spaces, direction marks and overrides, isolates, the byte-order mark, soft hyphens', () => {
    expect(cleanDisplayName('Ma\u200bra')).toBe('Mara');
    expect(cleanDisplayName('\u202eMara\u202c')).toBe('Mara');
    expect(cleanDisplayName('\u2066Mara\u2069\u200e')).toBe('Mara');
    expect(cleanDisplayName('\ufeffMa\u00adra\u2060')).toBe('Mara');
    // Joiners stay: they build the emoji.
    expect(cleanDisplayName('Mara 🏋️‍♀️')).toBe('Mara 🏋️‍♀️');
  });
});

describe('displayNameError', () => {
  it('takes ordinary names, accents, other scripts and emoji', () => {
    for (const n of ['Jack S.', 'J', 'Ünal Ç.', 'Ana García', '李小龙', 'میر‌آبادی', 'Sam (gym)', 'Mara 🏋️‍♀️', 'Desmond', 'Modern Mike', 'Ownership', 'x'.repeat(MAX_DISPLAY)]) {
      expect(displayNameError(n), n).toBeNull();
    }
    expect(displayNameError('')).toBeNull(); // none
  });
  it('counts characters as a person does: a joined emoji is one; and never past 60 UTF-16 units', () => {
    expect(displayLength('🏋️‍♀️')).toBe(1);
    expect(displayLength('👨‍👩‍👧')).toBe(1);
    expect(displayLength('Jack 💪')).toBe(6);
    expect(displayNameError('x'.repeat(MAX_DISPLAY + 1))).toMatch(/^Too long/);
    expect(displayNameError('💪'.repeat(MAX_DISPLAY))).toBeNull(); // 30 characters, 60 units
    expect(displayNameError('🏋️‍♀️'.repeat(11))).toMatch(/^Too long/); // 11 characters, 66 units
    expect('🏋️‍♀️'.repeat(11).length).toBeGreaterThan(MAX_DISPLAY_UNITS);
  });
  it('refuses an @, a ✓ or anything drawn like one, and links', () => {
    expect(displayNameError('Jack @jack')).toMatch(/^No @/);
    for (const c of ['✓', '✔', '✔️', '☑', '☑️', '✅', '🗸', '√', '🔵', '®', '™']) expect(displayNameError(`Jack ${c}`), c).toMatch(/^No ✓/);
    for (const l of ['https://x', 'see http://evil.example', 'www.example.com', 'WWW.X']) expect(displayNameError(l), l).toBe('No links.');
  });
  it('refuses words the app itself would use, as whole words in any case, plural too', () => {
    for (const n of ['Admin', 'admin jack', 'The Mods', 'mod', 'Official Jack', 'OWNER', 'Support', 'Staff', 'Verified', 'Gym Tracker', 'gymtracker team', 'Moderators']) {
      expect(displayNameError(n), n).toMatch(/^Not a word the app/);
    }
  });
  it('refuses what the rules would, should one get past cleaning', () => {
    for (const n of ['Mara\u202e', 'Ma\u200bra', 'a\u0000b', 'a\u0085b', 'a\u2028b']) expect(displayNameError(n), JSON.stringify(n)).toBe('One of those characters can’t be used.');
  });
});

describe('displayOf: a profile’s display name as shown', () => {
  it('none for the old shape, the username itself, or no field', () => {
    expect(displayOf('jack', 'jack')).toBeNull();
    expect(displayOf('jack', undefined)).toBeNull();
    expect(displayOf('jack', 7)).toBeNull();
  });
  it('the name when it’s clean and allowed; none when it isn’t (written round the app)', () => {
    expect(displayOf('jack', 'Jack S.')).toBe('Jack S.');
    expect(displayOf('jack', ' Jack')).toBeNull();
    expect(displayOf('jack', 'Admin')).toBeNull();
    expect(displayOf('jack', 'Jack ✓')).toBeNull();
    expect(displayOf('jack', 'x'.repeat(31))).toBeNull();
  });
});

describe('nextNameAt', () => {
  it('once a day: the next change is a day after the last, or now', () => {
    const t = Date.UTC(2026, 9, 22, 12);
    expect(nextNameAt(undefined, t)).toBeNull();
    expect(nextNameAt(t - NAME_GAP_MS - 1, t)).toBeNull();
    expect(nextNameAt(t - 3600_000, t)).toBe(t - 3600_000 + NAME_GAP_MS);
  });
});

// firestore.rules dnOk and BANNED are one list kept in two languages: every code point either both refuse or both allow.
describe('the rules and the app refuse the same characters', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const fn = rules.slice(rules.indexOf('function dnOk(s)'), rules.indexOf('function plainName'));
  it('dnOk’s class, read from the rules, matches BANNED at every code point', () => {
    const m = fn.match(/s\.matches\('\[\^(.*?)\]\+'\)/);
    expect(m, 'dnOk’s character class').not.toBeNull();
    const cls = m![1].replace(/\\\\x\{([0-9a-f]+)\}/gi, (_x, h: string) => `\\u{${h}}`);
    const rulesBan = new RegExp(`[${cls}]`, 'u');
    const differ: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if (rulesBan.test(c) !== BANNED.test(c)) differ.push(cp.toString(16));
    }
    expect(differ).toEqual([]);
    expect(rulesBan.test('@') && rulesBan.test('\u202e') && !rulesBan.test('a') && !rulesBan.test('‍')).toBe(true); // it reads as meant
  });
  it('the same length and link checks', () => {
    expect(fn).toContain(`s.size() <= ${MAX_DISPLAY_UNITS}`);
    expect(fn).toContain(`!s.matches('(?is).*(://|www[.]).*')`);
  });
});
