import { describe, expect, it } from 'vitest';
import { initials } from './icons';

describe('initials', () => {
  it('takes the first letters of the first two words of a name or username', () => {
    expect(initials('slow_oak')).toBe('SO');
    expect(initials('Sam Lee')).toBe('SL');
    expect(initials('maple.set')).toBe('MS');
    expect(initials('@iron-fern')).toBe('IF');
  });
  it('takes the first two letters of a single word, and never comes back empty', () => {
    expect(initials('ironfern')).toBe('IR');
    expect(initials('J')).toBe('J');
    expect(initials('')).toBe('?');
    expect(initials('___')).toBe('?');
  });
});
