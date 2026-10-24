import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type PatchOperation, applyPatch } from './patches.js';

const doc = () => ({
  paths: { '/a/{id}': { get: { tags: ['A'] } }, 'x~y': 1 },
  list: [1, 2, 3],
  nested: { value: null as unknown, flag: false },
});

describe('applyPatch', () => {
  it('adds and replaces object members', () => {
    const result = applyPatch(doc(), [
      { op: 'add', path: '/nested/added', value: { a: [1] } },
      { op: 'replace', path: '/nested/flag', value: true },
      { op: 'add', path: '/nested/value', value: 'overwritten by add' },
    ]);
    expect(result.nested).toEqual({ value: 'overwritten by add', flag: true, added: { a: [1] } });
  });

  it('decodes ~1 to / and ~0 to ~ in pointer segments', () => {
    const result = applyPatch(doc(), [
      { op: 'replace', path: '/paths/~1a~1{id}/get/tags/0', value: 'B' },
      { op: 'replace', path: '/paths/x~0y', value: 2 },
    ]);
    expect(result.paths['/a/{id}'].get.tags).toEqual(['B']);
    expect(result.paths['x~y']).toBe(2);
  });

  it('decodes ~01 to ~1, not to /', () => {
    const result = applyPatch({ '~1': 'tilde-one', '/': 'slash' }, [
      { op: 'replace', path: '/~01', value: 'changed' },
    ]);
    expect(result).toEqual({ '~1': 'changed', '/': 'slash' });
  });

  it('inserts into arrays at an index and appends with -', () => {
    const result = applyPatch(doc(), [
      { op: 'add', path: '/list/0', value: 0 },
      { op: 'add', path: '/list/2', value: 1.5 },
      { op: 'add', path: '/list/-', value: 4 },
      { op: 'add', path: '/list/6', value: 5 },
    ]);
    expect(result.list).toEqual([0, 1, 1.5, 2, 3, 4, 5]);
  });

  it('replaces and removes array elements', () => {
    const result = applyPatch(doc(), [
      { op: 'replace', path: '/list/1', value: 20 },
      { op: 'remove', path: '/list/0' },
    ]);
    expect(result.list).toEqual([20, 3]);
  });

  it('removes object members', () => {
    const result = applyPatch(doc(), [{ op: 'remove', path: '/nested/flag' }]);
    expect(result.nested).toEqual({ value: null });
    expect(result.nested).not.toHaveProperty('flag');
  });

  it('replaces and removes members whose value is null or false', () => {
    const result = applyPatch(doc(), [
      { op: 'replace', path: '/nested/value', value: 1 },
      { op: 'remove', path: '/nested/flag' },
    ]);
    expect(result.nested).toEqual({ value: 1 });
  });

  it('passes a test with an equal value, also with a different key order', () => {
    const patch: PatchOperation[] = [
      { op: 'test', path: '/nested', value: { flag: false, value: null } },
      { op: 'test', path: '/list', value: [1, 2, 3] },
      { op: 'test', path: '/list/2', value: 3 },
    ];
    expect(applyPatch(doc(), patch)).toEqual(doc());
  });

  it.each([
    [{ op: 'test', path: '/list/0', value: 2 }],
    [{ op: 'test', path: '/list', value: [1, 2] }],
    [{ op: 'test', path: '/nested/missing', value: null }],
    [{ op: 'test', path: '/nested/value', value: 'null' }],
    [{ op: 'test', path: '/list/01', value: 2 }],
  ] as const)('fails the test %j', (operation) => {
    expect(() => applyPatch(doc(), [operation])).toThrow(
      new Error(`JSON patch test failed at ${operation.path}`),
    );
  });

  it.each([
    [{ op: 'replace', path: '/nested/missing', value: 1 }],
    [{ op: 'remove', path: '/nested/missing' }],
    [{ op: 'replace', path: '/missing/a', value: 1 }],
    [{ op: 'add', path: '/missing/a', value: 1 }],
    [{ op: 'add', path: '/nested/flag/a', value: 1 }],
    [{ op: 'add', path: '/list/0/a', value: 1 }],
    [{ op: 'remove', path: '/list/3' }],
    [{ op: 'remove', path: '/list/-1' }],
    [{ op: 'replace', path: '/list/01', value: 1 }],
    [{ op: 'replace', path: '/list/-', value: 1 }],
    [{ op: 'add', path: '/list/4', value: 1 }],
    [{ op: 'add', path: '/list/x', value: 1 }],
    [{ op: 'add', path: '/list/1.5', value: 1 }],
    [{ op: 'remove', path: '/nested/toString' }],
    [{ op: 'replace', path: '/paths/constructor', value: 1 }],
  ] as const)('fails when the path does not exist: %j', (operation) => {
    expect(() => applyPatch(doc(), [operation])).toThrow(
      new Error(`JSON patch path not found: ${operation.path}`),
    );
  });

  it('fails on paths into null values', () => {
    expect(() => applyPatch(null, [{ op: 'add', path: '/a', value: 1 }])).toThrow(
      new Error('JSON patch path not found: /a'),
    );
    expect(() => applyPatch({ a: null }, [{ op: 'add', path: '/a/b/c', value: 1 }])).toThrow(
      new Error('JSON patch path not found: /a/b/c'),
    );
  });

  it('accepts multi-digit array indexes', () => {
    const list = Array.from({ length: 12 }, (_, index) => index);
    const result = applyPatch({ list }, [
      { op: 'replace', path: '/list/10', value: 'ten' },
      { op: 'add', path: '/list/12', value: 'end' },
    ]);
    expect(result.list.slice(9)).toEqual([9, 'ten', 11, 'end']);
  });

  it('does not treat array properties such as length as members', () => {
    expect(() => applyPatch(doc(), [{ op: 'replace', path: '/list/length', value: 1 }])).toThrow(
      new Error('JSON patch path not found: /list/length'),
    );
  });

  it('fails on paths into primitive documents', () => {
    expect(() => applyPatch(5, [{ op: 'add', path: '/a/b', value: 1 }])).toThrow(
      new Error('JSON patch path not found: /a/b'),
    );
    expect(() => applyPatch('text', [{ op: 'add', path: '/a', value: 1 }])).toThrow(
      new Error('JSON patch path not found: /a'),
    );
  });

  it('rejects pointers that do not start with a slash', () => {
    expect(() => applyPatch(doc(), [{ op: 'remove', path: 'list/0' }])).toThrow(
      new Error('Invalid JSON pointer "list/0"'),
    );
    expect(() => applyPatch(doc(), [{ op: 'test', path: '', value: {} }])).toThrow(
      new Error('Invalid JSON pointer ""'),
    );
  });

  it('rejects unsupported operations instead of corrupting the document', () => {
    const move = { op: 'move', from: '/list', path: '/other' } as unknown as PatchOperation;
    expect(() => applyPatch(doc(), [move])).toThrow(
      new Error('Unsupported JSON patch operation "move" at /other'),
    );
  });

  it.each(['add', 'replace', 'test'] as const)('requires a value for %s', (op) => {
    expect(() => applyPatch(doc(), [{ op, path: '/nested/flag' }])).toThrow(
      new Error(`JSON patch "${op}" at /nested/flag needs a value`),
    );
  });

  it('accepts null and false as values', () => {
    const result = applyPatch(doc(), [
      { op: 'test', path: '/nested/value', value: null },
      { op: 'replace', path: '/nested/flag', value: null },
      { op: 'add', path: '/nested/other', value: false },
    ]);
    expect(result.nested).toEqual({ value: null, flag: null, other: false });
  });

  it('adds __proto__ as an own property without touching the prototype', () => {
    const result = applyPatch<Record<string, unknown>>({}, [
      { op: 'add', path: '/__proto__', value: { polluted: true } },
    ]);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not modify the input document or the patch values', () => {
    const input = doc();
    const value = { deep: [1] };
    const result = applyPatch(input, [
      { op: 'add', path: '/nested/added', value },
      { op: 'remove', path: '/list/0' },
    ]);
    expect(input).toEqual(doc());
    (result.nested as unknown as { added: { deep: number[] } }).added.deep.push(2);
    expect(value).toEqual({ deep: [1] });
  });

  it('applies operations in order', () => {
    const result = applyPatch(doc(), [
      { op: 'add', path: '/nested/x', value: 1 },
      { op: 'test', path: '/nested/x', value: 1 },
      { op: 'replace', path: '/nested/x', value: 2 },
      { op: 'remove', path: '/nested/x' },
    ]);
    expect(result).toEqual(doc());
  });

  it('returns an equal copy for an empty patch', () => {
    const json = fc.jsonValue();
    fc.assert(
      fc.property(json, (value) => {
        const result = applyPatch(value, []);
        expect(result).toEqual(value);
        if (typeof value === 'object' && value !== null) expect(result).not.toBe(value);
      }),
    );
  });

  it('adds then removes a member as identity', () => {
    const key = fc.string().filter((text) => text !== '__proto__');
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.integer()),
        key,
        fc.jsonValue(),
        (object, name, value) => {
          fc.pre(!Object.hasOwn(object, name));
          const pointer = `/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
          const added = applyPatch(object, [{ op: 'add', path: pointer, value }]);
          expect(applyPatch(added, [{ op: 'test', path: pointer, value }])).toEqual(added);
          expect(applyPatch(added, [{ op: 'remove', path: pointer }])).toEqual(object);
        },
      ),
    );
  });
});
