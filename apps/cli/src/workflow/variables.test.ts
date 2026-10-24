import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseJson } from '../util.js';
import { historicVariableMap, plainVariables } from './variables.js';

describe('plainVariables', () => {
  it('flattens scalar types and keeps typed values of the other types, sorted by name', () => {
    const map = parseJson(
      JSON.stringify({
        text: { type: 'String', value: 'ACME', valueInfo: {} },
        amount: { type: 'Integer', value: 250, valueInfo: {} },
        ok: { type: 'Boolean', value: true },
        small: { type: 'Short', value: 7 },
        price: { type: 'Double', value: 2.5 },
        nothing: { type: 'Null', value: null },
        due: { type: 'Date', value: '2024-05-01T10:00:00.000+0200', valueInfo: {} },
        order: {
          type: 'Object',
          value: 'rO0AB',
          valueInfo: { objectTypeName: 'com.example.Order', serializationDataFormat: 'x' },
        },
        json: { type: 'Json', value: '{"id":1}' },
      }),
    );
    expect(Object.keys(plainVariables(map))).toEqual([
      'amount',
      'due',
      'json',
      'nothing',
      'ok',
      'order',
      'price',
      'small',
      'text',
    ]);
    expect(plainVariables(map)).toEqual({
      amount: 250,
      due: { type: 'Date', value: '2024-05-01T10:00:00.000+0200' },
      json: { type: 'Json', value: '{"id":1}' },
      nothing: null,
      ok: true,
      order: {
        type: 'Object',
        value: 'rO0AB',
        valueInfo: { objectTypeName: 'com.example.Order', serializationDataFormat: 'x' },
      },
      price: 2.5,
      small: 7,
      text: 'ACME',
    });
  });

  it('keeps Long values beyond 2^53 exactly and accepts types in any case', () => {
    const map = parseJson(
      '{"big":{"type":"Long","value":9223372036854775807},"s":{"type":"string"}}',
    );
    expect(plainVariables(map)).toEqual({ big: 9223372036854775807n, s: null });
  });

  it('copes with anything that is not a variable map', () => {
    expect(plainVariables(null)).toEqual({});
    expect(plainVariables([1])).toEqual({});
    expect(plainVariables({ odd: 'raw', untyped: { value: 1 } })).toEqual({
      odd: 'raw',
      untyped: { type: '', value: 1 },
    });
  });

  it('flattens scalars and keeps the type of everything else (property)', () => {
    const scalar = fc.constantFrom('String', 'Boolean', 'Integer', 'Short', 'Long', 'Double');
    const other = fc.constantFrom('Date', 'Json', 'Xml', 'Object', 'File', 'Bytes', 'Custom');
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1 }).filter((name) => name !== '__proto__'),
          fc.record({ type: fc.oneof(scalar, other), value: fc.oneof(fc.string(), fc.integer()) }),
        ),
        (map) => {
          const plain = plainVariables(map);
          expect(Object.keys(plain).sort()).toEqual(Object.keys(map).sort());
          for (const [name, typed] of Object.entries(map)) {
            const expected = ['Date', 'Json', 'Xml', 'Object', 'File', 'Bytes', 'Custom'].includes(
              typed.type,
            )
              ? { type: typed.type, value: typed.value }
              : typed.value;
            expect(plain[name]).toEqual(expected);
          }
        },
      ),
    );
  });
});

describe('historicVariableMap', () => {
  it('keeps the process scope rows as a variable map', () => {
    const rows = [
      { name: 'amount', type: 'Integer', value: 250, valueInfo: {}, activityInstanceId: 'p1' },
      { name: 'local', type: 'String', value: 'x', activityInstanceId: 'task:1' },
      { type: 'String', value: 'nameless', activityInstanceId: 'p1' },
    ];
    expect(historicVariableMap(rows, 'p1')).toEqual({
      amount: { type: 'Integer', value: 250, valueInfo: {} },
    });
  });
});

describe('plainVariables valueInfo', () => {
  it('leaves out a missing, null or empty valueInfo entirely', () => {
    const plain = plainVariables({
      a: { type: 'Json', value: '1' },
      b: { type: 'Json', value: '1', valueInfo: null },
      c: { type: 'Json', value: '1', valueInfo: {} },
      d: { type: 'Json', value: '1', valueInfo: { x: 1 } },
      e: { type: 'Json', value: '1', valueInfo: 'raw' },
    });
    expect(
      Object.fromEntries(
        Object.entries(plain).map(([name, value]) => [name, Object.keys(value as object)]),
      ),
    ).toEqual({
      a: ['type', 'value'],
      b: ['type', 'value'],
      c: ['type', 'value'],
      d: ['type', 'value', 'valueInfo'],
      e: ['type', 'value', 'valueInfo'],
    });
  });
});
