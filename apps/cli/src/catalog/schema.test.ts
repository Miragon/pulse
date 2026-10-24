import { describe, expect, it } from 'vitest';
import {
  type Schemas,
  additionalPropertiesOf,
  deref,
  expandSchema,
  itemsOf,
  objectProperties,
  refName,
  requiredProperties,
  schemaType,
} from './schema.js';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const SCHEMAS: Schemas = {
  Alias: ref('AliasOfAlias'),
  AliasOfAlias: ref('Base'),
  Base: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' }, name: { type: 'string', description: 'base' } },
  },
  Derived: {
    allOf: [ref('Base'), { required: ['extra', 'id'], properties: { extra: { type: 'integer' } } }],
    required: ['name'],
    properties: { name: { type: 'string', description: 'derived' } },
  },
  Node: {
    type: 'object',
    properties: {
      value: { type: 'string' },
      next: ref('Node'),
      children: { type: 'array', items: ref('Node') },
    },
  },
  SelfAllOf: {
    allOf: [ref('SelfAllOf'), { properties: { a: { type: 'string' } } }],
    required: ['a'],
  },
  PingA: ref('PingB'),
  PingB: ref('PingA'),
  Map: { type: 'object', additionalProperties: ref('Base') },
  Open: { type: 'object', additionalProperties: true },
  List: { type: 'array', items: ref('Base') },
};

describe('refName', () => {
  it('returns the last segment of a $ref', () => {
    expect(refName(ref('Base'))).toBe('Base');
    expect(refName({ $ref: 'Plain' })).toBe('Plain');
  });

  it('returns undefined without a string $ref', () => {
    expect(refName({ type: 'string' })).toBeUndefined();
    expect(refName({ $ref: 1 })).toBeUndefined();
  });
});

describe('deref', () => {
  it('returns schemas without $ref unchanged', () => {
    const schema = { type: 'string' };
    expect(deref(schema, SCHEMAS)).toBe(schema);
  });

  it('follows chains of references', () => {
    expect(deref(ref('Alias'), SCHEMAS)).toBe(SCHEMAS.Base);
  });

  it('resolves unknown references to an empty schema', () => {
    expect(deref(ref('Missing'), SCHEMAS)).toEqual({});
    expect(deref(ref('Base'), {})).toEqual({});
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not resolve the inherited member %s',
    (name) => {
      expect(deref(ref(name), SCHEMAS)).toStrictEqual({});
      expect(expandSchema(ref(name), SCHEMAS, 2)).toStrictEqual({ title: name });
    },
  );

  it('resolves a schema whose value is undefined to an empty schema', () => {
    const holey = { Hole: undefined } as unknown as Schemas;
    expect(deref(ref('Hole'), holey)).toStrictEqual({});
  });

  it('follows at most 32 references', () => {
    const chain = (length: number): Schemas =>
      Object.fromEntries(
        Array.from({ length: length + 1 }, (_, index) => [
          `S${index}`,
          index === length ? { type: 'string' } : ref(`S${index + 1}`),
        ]),
      );
    // the reference passed in plus 31 aliases are 32 references
    expect(deref(ref('S0'), chain(31))).toEqual({ type: 'string' });
    expect(deref(ref('S0'), chain(32))).toEqual(ref('S32'));
  });

  it('stops on reference cycles after 32 steps', () => {
    // 32 steps from PingA alternate PingB, PingA, ... and end on the alias stored under PingB
    expect(deref(ref('PingA'), SCHEMAS)).toBe(SCHEMAS.PingB);
    expect(deref(ref('PingB'), SCHEMAS)).toBe(SCHEMAS.PingA);
  });
});

describe('objectProperties', () => {
  it('returns the properties of a referenced schema', () => {
    expect(Object.keys(objectProperties(ref('Alias'), SCHEMAS))).toEqual(['id', 'name']);
  });

  it('merges allOf parts and lets own properties win', () => {
    const properties = objectProperties(ref('Derived'), SCHEMAS);
    expect(properties).toEqual({
      id: { type: 'string' },
      name: { type: 'string', description: 'derived' },
      extra: { type: 'integer' },
    });
  });

  it('ignores properties that are not schemas and allOf parts that are not objects', () => {
    const schema = {
      allOf: [null, 'x', { properties: { a: { type: 'string' } } }],
      properties: { b: 'not a schema', c: [1], d: { type: 'boolean' } },
    };
    expect(objectProperties(schema, SCHEMAS)).toStrictEqual({
      a: { type: 'string' },
      d: { type: 'boolean' },
    });
  });

  it('returns nothing for schemas without properties', () => {
    expect(objectProperties({ type: 'string' }, SCHEMAS)).toEqual({});
    expect(objectProperties({ properties: 'x' }, SCHEMAS)).toEqual({});
    expect(objectProperties(ref('Missing'), SCHEMAS)).toEqual({});
  });

  it('terminates on cyclic allOf references', () => {
    expect(objectProperties(ref('SelfAllOf'), SCHEMAS)).toEqual({ a: { type: 'string' } });
  });

  it('merges the same base reached twice', () => {
    const diamond = { allOf: [ref('Base'), ref('Alias')] };
    expect(Object.keys(objectProperties(diamond, SCHEMAS))).toEqual(['id', 'name']);
  });
});

describe('requiredProperties', () => {
  it('merges required lists across allOf without duplicates', () => {
    expect(requiredProperties(ref('Derived'), SCHEMAS)).toEqual(['id', 'extra', 'name']);
  });

  it('returns an empty list without required properties', () => {
    expect(requiredProperties({ type: 'object' }, SCHEMAS)).toEqual([]);
    expect(requiredProperties({ required: 'id' }, SCHEMAS)).toEqual([]);
  });

  it('converts entries to strings', () => {
    expect(requiredProperties({ required: [1, 'a'] }, SCHEMAS)).toEqual(['1', 'a']);
  });

  it('terminates on cyclic allOf references', () => {
    expect(requiredProperties(ref('SelfAllOf'), SCHEMAS)).toEqual(['a']);
  });
});

describe('schemaType', () => {
  it.each([
    [{ type: 'string' }, 'string'],
    [{ type: 'array', items: {} }, 'array'],
    [ref('Alias'), 'object'],
    [{ allOf: [] }, 'object'],
    [{ properties: {} }, 'object'],
    [{}, undefined],
    [{ type: 1 }, undefined],
    [{ additionalProperties: true }, undefined],
    [ref('Missing'), undefined],
  ])('schemaType(%j) is %s', (schema, type) => {
    expect(schemaType(schema, SCHEMAS)).toBe(type);
  });
});

describe('itemsOf', () => {
  it('returns the item schema of an array', () => {
    expect(itemsOf(ref('List'), SCHEMAS)).toEqual(ref('Base'));
  });

  it('returns undefined without object items', () => {
    expect(itemsOf({ type: 'array' }, SCHEMAS)).toBeUndefined();
    expect(itemsOf({ type: 'array', items: [{ type: 'string' }] }, SCHEMAS)).toBeUndefined();
  });
});

describe('additionalPropertiesOf', () => {
  it('returns schemas, booleans or undefined', () => {
    expect(additionalPropertiesOf(ref('Map'), SCHEMAS)).toEqual(ref('Base'));
    expect(additionalPropertiesOf(ref('Open'), SCHEMAS)).toBe(true);
    expect(additionalPropertiesOf({ additionalProperties: false }, SCHEMAS)).toBe(false);
    expect(additionalPropertiesOf({ type: 'object' }, SCHEMAS)).toBeUndefined();
    expect(additionalPropertiesOf({ additionalProperties: 'x' }, SCHEMAS)).toBeUndefined();
  });
});

describe('expandSchema', () => {
  it('inlines references with their name as title', () => {
    expect(expandSchema(ref('Base'), SCHEMAS, 1)).toEqual({ title: 'Base', ...SCHEMAS.Base });
  });

  it('keeps references beyond the depth limit', () => {
    expect(expandSchema(ref('Base'), SCHEMAS, 0)).toEqual({ $ref: 'Base' });
    expect(expandSchema(ref('Base'), SCHEMAS, -1)).toEqual({ $ref: 'Base' });
  });

  it('expands a cyclic schema only up to the depth limit', () => {
    const expanded = expandSchema(ref('Node'), SCHEMAS, 2) as Record<string, unknown>;
    expect(expanded).toEqual({
      title: 'Node',
      type: 'object',
      properties: {
        value: { type: 'string' },
        next: {
          title: 'Node',
          type: 'object',
          properties: {
            value: { type: 'string' },
            next: { $ref: 'Node' },
            children: { type: 'array', items: { $ref: 'Node' } },
          },
        },
        children: {
          type: 'array',
          items: {
            title: 'Node',
            type: 'object',
            properties: {
              value: { type: 'string' },
              next: { $ref: 'Node' },
              children: { type: 'array', items: { $ref: 'Node' } },
            },
          },
        },
      },
    });
  });

  it('terminates on reference cycles at any depth', () => {
    const json = JSON.stringify(expandSchema(ref('Node'), SCHEMAS, 5));
    expect(json.match(/"title":"Node"/g)?.length).toBeGreaterThan(5);
    expect(json).toContain('{"$ref":"Node"}');
  });

  it('expands references inside arrays and allOf', () => {
    expect(expandSchema({ allOf: [ref('Open')] }, SCHEMAS, 1)).toEqual({
      allOf: [{ title: 'Open', type: 'object', additionalProperties: true }],
    });
  });

  it('expands unknown references to their title only', () => {
    expect(expandSchema(ref('Missing'), SCHEMAS, 3)).toEqual({ title: 'Missing' });
  });

  it('returns primitives unchanged and does not modify the input', () => {
    expect(expandSchema('text', SCHEMAS, 2)).toBe('text');
    expect(expandSchema(null, SCHEMAS, 2)).toBeNull();
    expect(expandSchema(3, SCHEMAS, 2)).toBe(3);
    const input = { properties: { a: ref('Base') } };
    const copy = structuredClone(input);
    expandSchema(input, SCHEMAS, 2);
    expect(input).toEqual(copy);
  });
});
