import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lastString, listValues, occurrences, scalarFlag } from './command-values.js';

describe('lastString', () => {
  it('returns strings unchanged', () => {
    expect(lastString('a,b')).toBe('a,b');
    expect(lastString('')).toBe('');
  });

  it('returns the last occurrence of repeated values', () => {
    expect(lastString(['a', 'b', 'c'])).toBe('c');
    expect(lastString([])).toBe('');
  });

  it('stringifies booleans', () => {
    expect(lastString(true)).toBe('true');
    expect(lastString(false)).toBe('false');
  });
});

describe('listValues', () => {
  it('splits every occurrence on commas', () => {
    expect(listValues(['a,b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(listValues('a,b')).toEqual(['a', 'b']);
  });

  it('trims items and drops empty ones', () => {
    expect(listValues([' a , b ', ',', '', 'c,'])).toEqual(['a', 'b', 'c']);
    expect(listValues('')).toEqual([]);
  });

  it('stringifies booleans', () => {
    expect(listValues(true)).toEqual(['true']);
  });

  it('equals splitting the joined occurrences', () => {
    const item = fc.stringMatching(/^[a-z0-9-]{1,6}$/);
    fc.assert(
      fc.property(
        fc.array(fc.array(item, { minLength: 1, maxLength: 4 }), { maxLength: 4 }),
        (groups) => {
          expect(listValues(groups.map((group) => group.join(',')))).toEqual(groups.flat());
        },
      ),
    );
  });
});

describe('occurrences', () => {
  it('keeps occurrences unsplit', () => {
    expect(occurrences(['a=1,2', 'b=3'])).toEqual(['a=1,2', 'b=3']);
    expect(occurrences('a=1,2')).toEqual(['a=1,2']);
    expect(occurrences(false)).toEqual(['false']);
  });

  it('returns a copy', () => {
    const values = ['a=1'];
    expect(occurrences(values)).not.toBe(values);
  });
});

describe('scalarFlag', () => {
  it('takes booleans of boolean specs as they are', () => {
    expect(scalarFlag({ type: 'boolean' }, true, '--x')).toBe(true);
    expect(scalarFlag({ type: 'boolean' }, false, '--x')).toBe(false);
  });

  it('parses strings of boolean specs', () => {
    expect(scalarFlag({ type: 'boolean' }, 'false', '--x')).toBe(false);
    expect(scalarFlag({ type: 'boolean' }, ['true', 'false'], '--x')).toBe(false);
  });

  it('converts the last occurrence of other specs', () => {
    expect(scalarFlag({ type: 'integer' }, ['1', '2'], '--n')).toBe(2);
    expect(scalarFlag({ type: 'string' }, 'x', '--s')).toBe('x');
  });

  it('converts booleans given for non-boolean specs as text', () => {
    expect(scalarFlag({ type: 'string' }, true, '--s')).toBe('true');
    expect(() => scalarFlag({ type: 'integer' }, true, '--n')).toThrow(
      '--n expects an integer, got "true"',
    );
  });
});
