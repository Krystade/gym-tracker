import { describe, expect, it } from 'vitest';
import { cleanUsername, inviteUrl, newToken, parseInvite, USERNAME } from './invite';

const T = '0123456789abcdef0123456789abcdef';
describe('invite links', () => {
  it('round-trips through the link, and takes a pasted link or bare code', () => {
    const url = inviteUrl('https://krystade.github.io/gym-tracker/#old', { uid: 'AbC123xyz', token: T });
    expect(url).toBe(`https://krystade.github.io/gym-tracker/#invite=AbC123xyz.${T}`);
    expect(parseInvite(url)).toEqual({ uid: 'AbC123xyz', token: T });
    expect(parseInvite(`  AbC123xyz.${T} `)).toEqual({ uid: 'AbC123xyz', token: T });
  });
  it('rejects anything else', () => {
    expect(parseInvite('https://krystade.github.io/gym-tracker/')).toBeNull();
    expect(parseInvite(`AbC123xyz.${T.slice(1)}`)).toBeNull();
    expect(parseInvite(`a/b.${T}`)).toBeNull();
    expect(parseInvite(`#invite=AbC123xyz.${T}extra`)).toBeNull();
  });
  it('makes a fresh 32-hex token each time', () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('usernames', () => {
  it('are lowercased, lose a leading @, and fit the rules', () => {
    expect(cleanUsername('  @Sam_99 ')).toBe('sam_99');
    expect(USERNAME.test('sam_99')).toBe(true);
    for (const bad of ['sa', 'Sam', 'sam smith', 'a'.repeat(21)]) expect(USERNAME.test(bad)).toBe(false);
  });
});
