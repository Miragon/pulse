import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jsonErrorPosition } from './json-position.js';

describe('jsonErrorPosition', () => {
  it.each([
    ['{}', undefined],
    [' [true, false, null, -1.5e3, "a\\\\u00e9\\\\n"] ', undefined],
    ['{"a": sk_live}', { line: 1, column: 7 }],
    ['{\n "a": 1,\n}', { line: 3, column: 1 }],
    ['[1,2', { line: 1, column: 5 }],
    ['', { line: 1, column: 1 }],
    ['{"a":1} x', { line: 1, column: 9 }],
    ['"\\u12"', { line: 1, column: 1 }],
    ['[1,]', { line: 1, column: 4 }],
    ['{"a" 1}', { line: 1, column: 6 }],
    ['01', { line: 1, column: 2 }],
    ['{"a":"line\nbreak"}', { line: 1, column: 6 }],
  ])('finds the error in %j', (text, position) => {
    expect(jsonErrorPosition(text)).toEqual(position);
  });

  it('gives no position for nesting deeper than the call stack', () => {
    expect(jsonErrorPosition(`${'['.repeat(200_000)}x`)).toBeUndefined();
  });

  it('agrees with JSON.parse about validity', () => {
    const text = fc.oneof(
      fc.json(),
      fc.json().map((json) => json.slice(0, -1)),
      fc.string({
        unit: fc.constantFrom('{', '}', '[', ']', ',', ':', '"', '1', 'a', ' ', 'true'),
      }),
    );
    fc.assert(
      fc.property(text, (candidate) => {
        let valid = true;
        try {
          JSON.parse(candidate);
        } catch {
          valid = false;
        }
        expect(jsonErrorPosition(candidate) === undefined).toBe(valid);
      }),
    );
  });
});
