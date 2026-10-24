import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  closeNames,
  compact,
  editDistance,
  isRecord,
  mapLimit,
  mergeHeaders,
  parseJson,
  stringifyJson,
} from './util.js';

describe('compact', () => {
  it('drops undefined properties and keeps every other value', () => {
    const result = compact({ a: 1, b: undefined, c: null, d: '', e: 0, f: false });
    expect(result).toEqual({ a: 1, c: null, d: '', e: 0, f: false });
    expect(Object.keys(result)).toEqual(['a', 'c', 'd', 'e', 'f']);
  });

  it('returns a new object and leaves the input alone', () => {
    const input = { a: 1, b: undefined };
    const result = compact(input);
    expect(result).not.toBe(input);
    expect(input).toEqual({ a: 1, b: undefined });
    expect('b' in input).toBe(true);
  });

  it('never keeps an undefined value', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.option(fc.integer(), { nil: undefined })),
        (dict) => {
          const result = compact(dict);
          expect(Object.values(result)).not.toContain(undefined);
          const kept = Object.entries(dict).filter(([, value]) => value !== undefined);
          expect(Object.keys(result).length).toBe(kept.length);
        },
      ),
    );
  });
});

describe('isRecord', () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [new Error('x'), true],
    [[], false],
    [null, false],
    [undefined, false],
    ['text', false],
    [1, false],
  ])('isRecord(%o) is %s', (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});

describe('mergeHeaders', () => {
  it('lets later sources win regardless of the name case', () => {
    expect(
      mergeHeaders(
        { Accept: 'application/json', authorization: 'Basic a' },
        { Authorization: 'Bearer b' },
      ),
    ).toEqual({ Accept: 'application/json', Authorization: 'Bearer b' });
  });

  it('places a replaced header at the position of its latest occurrence', () => {
    const merged = mergeHeaders({ A: '1', B: '2' }, { a: '3' });
    expect(Object.entries(merged)).toEqual([
      ['B', '2'],
      ['a', '3'],
    ]);
  });

  it('deduplicates names within one source', () => {
    expect(mergeHeaders({ 'X-A': '1', 'x-a': '2' })).toEqual({ 'x-a': '2' });
  });

  it('returns an empty object without sources', () => {
    expect(mergeHeaders()).toEqual({});
  });

  it('does not modify its inputs', () => {
    const first = { A: '1' };
    const second = { a: '2' };
    mergeHeaders(first, second);
    expect(first).toEqual({ A: '1' });
    expect(second).toEqual({ a: '2' });
  });

  it('keeps exactly one entry per case-insensitive name, with the last value', () => {
    const name = fc.constantFrom('Accept', 'accept', 'ACCEPT', 'X-Tenant', 'x-tenant', 'Cookie');
    const headers = fc.dictionary(name, fc.string());
    fc.assert(
      fc.property(fc.array(headers, { maxLength: 4 }), (sources) => {
        const merged = mergeHeaders(...sources);
        const lowered = Object.keys(merged).map((key) => key.toLowerCase());
        expect(new Set(lowered).size).toBe(lowered.length);
        const expected = new Map<string, string>();
        for (const source of sources) {
          for (const [key, value] of Object.entries(source)) expected.set(key.toLowerCase(), value);
        }
        expect(
          new Map(Object.entries(merged).map(([key, value]) => [key.toLowerCase(), value])),
        ).toEqual(expected);
      }),
    );
  });
});

describe('editDistance', () => {
  it('counts inserts, deletes and substitutions', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('task', 'task')).toBe(0);
    expect(editDistance('tsk', 'task')).toBe(1);
    expect(editDistance('tasks', 'task')).toBe(1);
    expect(editDistance('tusk', 'task')).toBe(1);
    expect(editDistance('lsit', 'list')).toBe(2);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('flaw', 'lawn')).toBe(2);
  });

  it('is a metric: zero only for equal strings, symmetric, at most the longer length', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), (a, b) => {
        const distance = editDistance(a, b);
        expect(distance === 0).toBe(a === b);
        expect(editDistance(b, a)).toBe(distance);
        expect(distance).toBeGreaterThanOrEqual(Math.abs(a.length - b.length));
        expect(distance).toBeLessThanOrEqual(Math.max(a.length, b.length));
      }),
    );
  });
});

describe('closeNames', () => {
  it('keeps names at most 2 edits away, closest first, case-insensitive', () => {
    expect(closeNames('TSK', ['job', 'task', 'tasks', 'tusk'])).toEqual(['task', 'tusk', 'tasks']);
    expect(closeNames('task', ['Task', 'tasks'])).toEqual(['Task', 'tasks']);
  });

  it('drops names that share too little with the word', () => {
    // 2 edits, but only one of three characters left
    expect(closeNames('foo', ['job', 'fob'])).toEqual(['fob']);
    // 2 edits of 5 characters: 60 % unchanged
    expect(closeNames('abcde', ['abxye'])).toEqual(['abxye']);
    expect(closeNames('abc', ['abxyz'])).toEqual([]);
    expect(closeNames('', ['a', ''])).toEqual([]);
  });

  it('returns each name once and at most five', () => {
    expect(closeNames('ab', ['ab', 'ab', 'abc'])).toEqual(['ab', 'abc']);
    expect(closeNames('aaaa', ['aaab', 'aaac', 'aaad', 'aaae', 'aaaf', 'aaag'])).toEqual([
      'aaab',
      'aaac',
      'aaad',
      'aaae',
      'aaaf',
    ]);
  });
});

describe('parseJson and stringifyJson', () => {
  it('keeps integers beyond 2^53 digit for digit', () => {
    const text =
      '{"long":9223372036854775807,"negative":-9007199254740993,"small":42,"double":1.5}';
    const value = parseJson(text);
    expect(value).toEqual({
      long: 9223372036854775807n,
      negative: -9007199254740993n,
      small: 42,
      double: 1.5,
    });
    expect(stringifyJson(value)).toBe(text);
  });

  it('parses exponents and decimals as plain numbers', () => {
    expect(parseJson('[1e21, 0.1, -2.5e-3, 9007199254740991]')).toEqual([
      1e21, 0.1, -2.5e-3, 9007199254740991,
    ]);
  });

  it('indents like JSON.stringify and returns undefined for undefined', () => {
    expect(stringifyJson({ a: [1n, 2] }, 2)).toBe(JSON.stringify({ a: [1, 2] }, null, 2));
    expect(stringifyJson(undefined)).toBeUndefined();
  });

  it('throws like JSON.parse on invalid JSON', () => {
    expect(() => parseJson('{')).toThrow(SyntaxError);
  });

  it('round-trips every JSON value and integer', () => {
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }),
        (value, big) => {
          const text = JSON.stringify({ value, big: 0 }).replace(/0\}$/, `${big}}`);
          expect(stringifyJson(parseJson(text))).toBe(text);
        },
      ),
    );
  });
});

describe('mapLimit', () => {
  it('keeps the order of the items and runs at most `limit` calls at a time', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([5, 1, 4, 2, 3], 2, async (item, index) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, item));
      running -= 1;
      return `${index}:${item}`;
    });
    expect(results).toEqual(['0:5', '1:1', '2:4', '3:2', '4:3']);
    expect(peak).toBe(2);
  });

  it('resolves to an empty list without calls for no items', async () => {
    expect(await mapLimit([], 8, () => Promise.reject(new Error('never')))).toEqual([]);
  });

  it('starts no item after the first failure', async () => {
    const started: number[] = [];
    const items = Array.from({ length: 20 }, (_, index) => index);
    await expect(
      mapLimit(items, 3, async (item) => {
        started.push(item);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (item === 1) throw new Error('boom');
        return item;
      }),
    ).rejects.toThrow('boom');
    // let the calls that were running finish
    await new Promise((resolve) => setTimeout(resolve, 20));
    // the three first calls run in parallel; at most the two others pull one more each
    expect(started.length).toBeLessThanOrEqual(5);
    expect(started).not.toContain(19);
  });

  it('rejects with the first failure', async () => {
    await expect(
      mapLimit([1, 2, 3], 8, (item) =>
        item === 2 ? Promise.reject(new Error('two')) : Promise.resolve(item),
      ),
    ).rejects.toThrow('two');
  });

  it('maps every item exactly once for any limit (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer()),
        fc.integer({ min: 1, max: 10 }),
        async (items, limit) => {
          const results = await mapLimit(items, limit, (item) => Promise.resolve(item * 2));
          expect(results).toEqual(items.map((item) => item * 2));
        },
      ),
    );
  });
});
