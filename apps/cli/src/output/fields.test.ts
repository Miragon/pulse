import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getPath, missingFields, parseFieldList, project } from './fields.js';

const FORBIDDEN = ['__proto__', 'constructor', 'prototype'];

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Reflect.ownKeys(value))
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every leaf of `part` exists in `whole` at the same place with an equal value. */
function isSubset(part: unknown, whole: unknown): boolean {
  if (Array.isArray(part)) {
    return (
      Array.isArray(whole) &&
      part.length === whole.length &&
      part.every((item, index) => isSubset(item, whole[index]))
    );
  }
  if (isPlainObject(part)) {
    return (
      isPlainObject(whole) &&
      Object.keys(part).every((key) => Object.hasOwn(whole, key) && isSubset(part[key], whole[key]))
    );
  }
  return Object.is(part, whole);
}

/** Field paths built from keys that also occur in the generated values. */
const KEYS = ['a', 'b', 'c', 'id', '__proto__', 'constructor', ''];
const key = fc.constantFrom(...KEYS);
const field = fc.array(key, { minLength: 1, maxLength: 3 }).map((parts) => parts.join('.'));
const value = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    fc.jsonValue({ maxDepth: 0 }),
    fc.array(tie('node'), { maxLength: 3 }),
    fc.dictionary(key, tie('node'), { maxKeys: 4 }),
  ),
})).node;

describe('parseFieldList', () => {
  it('returns undefined for a missing or empty list', () => {
    expect(parseFieldList(undefined)).toBeUndefined();
    expect(parseFieldList('')).toBeUndefined();
    expect(parseFieldList(' , ,')).toBeUndefined();
  });

  it('trims, drops empty entries and removes duplicates in first-seen order', () => {
    expect(parseFieldList(' id , name,,id, a.b ')).toEqual(['id', 'name', 'a.b']);
    expect(parseFieldList('id')).toEqual(['id']);
  });

  it('drops paths with forbidden segments only when a whole segment matches', () => {
    expect(parseFieldList('__proto__,a.constructor,prototype.x,x.__proto__.y,id')).toEqual(['id']);
    expect(parseFieldList('__proto__x,constructors,a.prototypes')).toEqual([
      '__proto__x',
      'constructors',
      'a.prototypes',
    ]);
    expect(parseFieldList('constructor')).toBeUndefined();
  });

  it('never yields forbidden segments, empty, untrimmed or duplicate fields (property)', () => {
    const raw = fc
      .array(fc.oneof(fc.constantFrom(...FORBIDDEN, '.', ' ', ','), fc.string()), {
        maxLength: 10,
      })
      .map((parts) => parts.join(''));
    fc.assert(
      fc.property(raw, (text) => {
        const fields = parseFieldList(text);
        if (fields === undefined) return;
        expect(fields.length).toBeGreaterThan(0);
        expect(new Set(fields).size).toBe(fields.length);
        for (const item of fields) {
          expect(item).toBe(item.trim());
          expect(item).not.toBe('');
          expect(item).not.toContain(',');
          for (const segment of item.split('.')) expect(FORBIDDEN).not.toContain(segment);
        }
      }),
    );
  });
});

describe('getPath', () => {
  const data = { id: 'x', nested: { deep: { value: 0 }, list: [{ a: 1 }] }, empty: null };

  it('reads top-level and nested values', () => {
    expect(getPath(data, 'id')).toBe('x');
    expect(getPath(data, 'nested.deep')).toEqual({ value: 0 });
    expect(getPath(data, 'nested.deep.value')).toBe(0);
    expect(getPath(data, 'empty')).toBeNull();
  });

  it('returns undefined for missing paths, arrays, null and scalar intermediates', () => {
    expect(getPath(data, 'missing')).toBeUndefined();
    expect(getPath(data, 'nested.missing.value')).toBeUndefined();
    expect(getPath(data, 'nested.list.0')).toBeUndefined();
    expect(getPath(data, 'empty.x')).toBeUndefined();
    expect(getPath(data, 'id.length')).toBeUndefined();
    expect(getPath(null, 'id')).toBeUndefined();
    expect(getPath([{ id: 1 }], 'id')).toBeUndefined();
  });

  it('reads own properties only', () => {
    expect(getPath({}, 'toString')).toBeUndefined();
    expect(getPath({}, '__proto__')).toBeUndefined();
    expect(getPath(Object.create({ inherited: 1 }), 'inherited')).toBeUndefined();
    expect(getPath(JSON.parse('{"__proto__":{"x":1}}'), '__proto__.x')).toBe(1);
  });
});

describe('missingFields', () => {
  it('finds paths through nested lists and reports only what no element has', () => {
    const view = { waitingAt: [{ activityId: 'a' }, { kind: 'k' }], findings: [] };
    expect(
      missingFields(view, ['waitingAt.activityId', 'waitingAt.kind', 'waitingAt.nope', 'nope']),
    ).toEqual({ missing: ['waitingAt.nope', 'nope'], available: ['waitingAt', 'findings'] });
    expect(missingFields([{ a: [{ b: 1 }] }, { c: 1 }], ['a.b', 'c', 'a.c']).missing).toEqual([
      'a.c',
    ]);
    // an empty list cannot tell whether its objects would have the field
    expect(missingFields(view, ['findings.code']).missing).toEqual([]);
    expect(missingFields([], ['x'])).toEqual({ missing: [], available: [] });
  });
});

describe('project', () => {
  it('returns the value itself without fields', () => {
    const data = { a: 1 };
    expect(project(data, undefined)).toBe(data);
  });

  it('keeps only the given fields of an object, in field order', () => {
    const result = project({ id: '1', name: 'n', extra: true }, ['name', 'id', 'missing']);
    expect(result).toEqual({ name: 'n', id: '1' });
    expect(Object.keys(result as object)).toEqual(['name', 'id']);
  });

  it('keeps null values and nested paths', () => {
    expect(project({ a: null, b: { c: 1, d: 2 }, e: 3 }, ['a', 'b.c'])).toEqual({
      a: null,
      b: { c: 1 },
    });
  });

  it('merges sibling paths into one nested object', () => {
    expect(project({ b: { c: 1, d: 2, e: 3 } }, ['b.c', 'b.e'])).toEqual({ b: { c: 1, e: 3 } });
  });

  it('lets a parent field cover its children regardless of order', () => {
    const data = { a: { b: 1, c: 2 } };
    expect(project(data, ['a', 'a.b'])).toEqual({ a: { b: 1, c: 2 } });
    expect(project(data, ['a.b', 'a'])).toEqual({ a: { b: 1, c: 2 } });
    expect(project(data, ['a.b', 'ab'])).toEqual({ a: { b: 1 } });
  });

  it('projects every object of an array and keeps other items', () => {
    expect(project([{ id: 1, x: 2 }, 'text', null, [1], { x: 3 }], ['id'])).toEqual([
      { id: 1 },
      'text',
      null,
      [1],
      {},
    ]);
  });

  it('picks the rest of a path from every object of a nested list', () => {
    const view = {
      id: 'p1',
      waitingAt: [
        { activityId: 'approve', kind: 'userTask', taskId: 't1' },
        { activityId: 'charge', kind: 'externalTask', topic: 'pay' },
        'odd',
      ],
      findings: [],
      nested: { list: [{ a: { b: 1, c: 2 } }, { a: 3 }] },
    };
    expect(
      project(view, ['waitingAt.activityId', 'waitingAt.kind', 'findings.code', 'nested.list.a.b']),
    ).toEqual({
      waitingAt: [
        { activityId: 'approve', kind: 'userTask' },
        { activityId: 'charge', kind: 'externalTask' },
        'odd',
      ],
      findings: [],
      nested: { list: [{ a: { b: 1 } }, {}] },
    });
    expect(project(view, ['waitingAt', 'waitingAt.kind'])).toEqual({ waitingAt: view.waitingAt });
  });

  it('returns scalars unchanged', () => {
    expect(project('text', ['id'])).toBe('text');
    expect(project(5, ['id'])).toBe(5);
    expect(project(null, ['id'])).toBeNull();
  });

  it('does not mutate a frozen input', () => {
    const data = deepFreeze({ a: { b: { c: 1, d: 2 } }, e: [1] });
    expect(project(data, ['a', 'a.b.c', 'e', 'a.b'])).toEqual({ a: { b: { c: 1, d: 2 } }, e: [1] });
  });

  it('returns plain data whose properties can be changed and deleted', () => {
    const result = project({ id: 1, a: { b: 2 } }, ['id', 'a.b']) as {
      id?: number;
      a: { b?: number };
    };
    result.id = 5;
    result.a.b = 6;
    expect(result).toEqual({ id: 5, a: { b: 6 } });
    delete result.id;
    delete result.a.b;
    expect(result).toEqual({ a: {} });
  });

  it('copies own __proto__ keys as data without touching prototypes', () => {
    const data = JSON.parse('{"__proto__":{"polluted":true,"other":1},"id":1}') as unknown;
    const result = project(data, ['__proto__.polluted', 'id']) as Record<string, unknown>;
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(JSON.stringify(result)).toBe('{"__proto__":{"polluted":true},"id":1}');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns a subset of the input (property)', () => {
    fc.assert(
      fc.property(value, fc.array(field, { maxLength: 5 }), (input, fields) => {
        expect(isSubset(project(input, fields), input)).toBe(true);
      }),
    );
  });

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(value, fc.array(field, { maxLength: 5 }), (input, fields) => {
        const once = project(input, fields);
        expect(project(once, fields)).toEqual(once);
        expect(JSON.stringify(project(once, fields))).toBe(JSON.stringify(once));
      }),
    );
  });

  it('never mutates its input (property)', () => {
    fc.assert(
      fc.property(value, fc.array(field, { maxLength: 5 }), (input, fields) => {
        const before = JSON.stringify(input);
        project(deepFreeze(input), fields);
        expect(JSON.stringify(input)).toBe(before);
        expect(({} as Record<string, unknown>).a).toBeUndefined();
      }),
    );
  });
});
