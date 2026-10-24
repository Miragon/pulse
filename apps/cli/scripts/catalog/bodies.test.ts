import { describe, expect, it } from 'vitest';
import type { Catalog, Schema } from '../../src/catalog/types.js';
import { VARIABLE_MAP_FLAGS, jsonBody, multipartBody } from './bodies.js';
import { buildCatalog } from './build-catalog.js';
import { readPatchedSpec } from './files.js';
import type { OpenApiDocument } from './openapi.js';
import { SPEC_URL } from './render.js';

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const SPEC: OpenApiDocument = {
  info: { title: 't', version: '1' },
  paths: {},
  components: {
    schemas: {
      VariableValueDto: {
        type: 'object',
        properties: { value: {}, type: { type: 'string' }, valueInfo: { type: 'object' } },
      },
      Obj: { type: 'object', properties: { a: { type: 'string' } } },
      State: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'], description: 'The state.' },
      Start: {
        type: 'object',
        properties: {
          businessKey: { type: 'string', description: '  The business key.  ' },
          variables: { type: 'object', additionalProperties: ref('VariableValueDto') },
          count: { type: 'integer', format: 'int32' },
          ratio: { type: 'number' },
          skip: { type: 'boolean' },
          mode: { type: 'string', enum: ['A', 1] },
          ids: { type: 'array', items: { type: 'string' } },
          nums: { type: 'array', items: { type: 'integer', format: 'int64' } },
          objects: { type: 'array', items: ref('Obj') },
          arrayWithoutItems: { type: 'array' },
          nested: ref('Obj'),
          when: { type: 'string', format: 'date-time' },
          state: ref('State'),
          stateWithOwnDescription: { ...ref('State'), description: 'Own.' },
          openMap: { type: 'object', additionalProperties: true },
          objectMap: { type: 'object', additionalProperties: ref('Obj') },
          untyped: {},
          itemsWithoutType: { items: { type: 'string' } },
        },
      },
      Derived: {
        allOf: [
          ref('Base'),
          {
            type: 'object',
            properties: { processVariables: { additionalProperties: ref('VariableValueDto') } },
          },
        ],
      },
      Base: { type: 'object', properties: { messageName: { type: 'string' } } },
      Unknown: {
        type: 'object',
        properties: { secretMap: { additionalProperties: ref('VariableValueDto') } },
      },
      Upload: {
        type: 'object',
        properties: {
          data: { type: 'string', format: 'binary', description: 'The file.' },
          'deployment-name': { type: 'string' },
          'enable-duplicate-filtering': { type: 'boolean' },
          'deployment-activation-time': { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

describe('jsonBody', () => {
  /** Built inside each test, so mutation testing attributes the coverage to it. */
  const start = () => jsonBody(SPEC, ref('Start'));

  it('records the schema and its name', () => {
    const body = start();
    expect(body.kind).toBe('json');
    expect(body.schemaName).toBe('Start');
    expect(body.schema).toEqual(ref('Start'));
    expect(body.variableValue).toBe(false);
  });

  it('turns typed variable maps into variable flags', () => {
    expect(start().variableMaps).toEqual([{ name: 'variables', flag: 'var' }]);
  });

  it('exposes scalar and scalar array properties as fields', () => {
    expect(start().fields).toStrictEqual([
      { name: 'businessKey', flag: '', type: 'string', description: 'The business key.' },
      { name: 'count', flag: '', type: 'integer', format: 'int32', description: '' },
      { name: 'ratio', flag: '', type: 'number', description: '' },
      { name: 'skip', flag: '', type: 'boolean', description: '' },
      { name: 'mode', flag: '', type: 'string', enum: ['A', '1'], description: '' },
      { name: 'ids', flag: '', type: 'array', items: 'string', description: '' },
      { name: 'nums', flag: '', type: 'array', items: 'integer', description: '' },
      { name: 'when', flag: '', type: 'string', format: 'date-time', description: '' },
      {
        name: 'state',
        flag: '',
        type: 'string',
        enum: ['ACTIVE', 'SUSPENDED'],
        description: 'The state.',
      },
      {
        name: 'stateWithOwnDescription',
        flag: '',
        type: 'string',
        enum: ['ACTIVE', 'SUSPENDED'],
        description: 'Own.',
      },
    ]);
  });

  it('skips objects, object arrays, untyped values and maps of other values', () => {
    const names = start().fields.map((field) => field.name);
    for (const skipped of [
      'objects',
      'arrayWithoutItems',
      'nested',
      'openMap',
      'objectMap',
      'untyped',
      'itemsWithoutType',
    ]) {
      expect(names).not.toContain(skipped);
    }
  });

  it('collects fields and maps across allOf', () => {
    const derived = jsonBody(SPEC, ref('Derived'));
    expect(derived.fields.map((field) => field.name)).toEqual(['messageName']);
    expect(derived.variableMaps).toEqual([{ name: 'processVariables', flag: 'var' }]);
  });

  it('marks a VariableValueDto body as a single variable value', () => {
    const value = jsonBody(SPEC, ref('VariableValueDto'));
    expect(value.variableValue).toBe(true);
    expect(value.fields.map((field) => field.name)).toEqual(['type']);
  });

  it('handles inline schemas without a name', () => {
    const inline = jsonBody(SPEC, { type: 'object', properties: { a: { type: 'string' } } });
    expect(inline).not.toHaveProperty('schemaName');
    expect(inline.variableValue).toBe(false);
    expect(inline.fields).toHaveLength(1);
  });

  it('fails for variable maps without a known flag', () => {
    expect(() => jsonBody(SPEC, ref('Unknown'))).toThrow(
      new Error('No flag defined for variable map "secretMap"'),
    );
  });

  it('works for specs without components', () => {
    const bare: OpenApiDocument = { info: { title: 't', version: '1' }, paths: {} };
    expect(jsonBody(bare, ref('Start')).fields).toEqual([]);
  });
});

describe('multipartBody', () => {
  it('maps fields to string, boolean and binary parts', () => {
    expect(multipartBody(SPEC, ref('Upload'), 'setBinaryVariable')).toStrictEqual({
      kind: 'multipart',
      schemaName: 'Upload',
      fields: [
        { name: 'data', flag: '', type: 'binary', description: 'The file.' },
        { name: 'deployment-name', flag: '', type: 'string', description: '' },
        { name: 'enable-duplicate-filtering', flag: '', type: 'boolean', description: '' },
        {
          name: 'deployment-activation-time',
          flag: '',
          type: 'string',
          format: 'date-time',
          description: '',
        },
      ],
      resources: false,
    });
  });

  it('passes deployment resources as files instead of the data field', () => {
    const body = multipartBody(SPEC, ref('Upload'), 'createDeployment');
    expect(body.resources).toBe(true);
    expect(body.fields.map((field) => field.name)).toEqual([
      'deployment-name',
      'enable-duplicate-filtering',
      'deployment-activation-time',
    ]);
  });

  it('handles inline schemas without a name', () => {
    const body = multipartBody(SPEC, { properties: { file: { format: 'binary' } } }, 'x');
    expect(body).toStrictEqual({
      kind: 'multipart',
      fields: [{ name: 'file', flag: '', type: 'binary', description: '' }],
      resources: false,
    });
  });
});

let cachedCatalog: Catalog | undefined;

/**
 * The catalog built from the vendored spec. Built lazily inside the first test that needs it, never
 * at load time, so mutation testing attributes the generator code to tests.
 */
function realCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(readPatchedSpec(), SPEC_URL);
  return cachedCatalog;
}

describe('bodies in the generated catalog', () => {
  const byId = (id: string) =>
    realCatalog().operations.find((operation) => operation.operationId === id && !operation.preset);

  it('uses every variable map flag and only known ones', () => {
    const used = new Set(
      realCatalog().operations.flatMap((operation) =>
        operation.body?.kind === 'json' ? operation.body.variableMaps.map((map) => map.name) : [],
      ),
    );
    expect([...used].sort()).toEqual(Object.keys(VARIABLE_MAP_FLAGS).sort());
  });

  it('describes the process start body', () => {
    const body = byId('startProcessInstanceByKey')?.body;
    expect(body?.kind).toBe('json');
    if (body?.kind !== 'json') return;
    expect(body.schemaName).toBe('StartProcessInstanceDto');
    expect(body.variableMaps).toEqual([{ name: 'variables', flag: 'var' }]);
    expect(body.fields.map((field) => field.flag)).toContain('business-key');
  });

  it('describes message correlation with all its variable maps', () => {
    const body = byId('deliverMessage')?.body;
    expect(body?.kind === 'json' ? body.variableMaps : []).toEqual([
      { name: 'correlationKeys', flag: 'correlation-key' },
      { name: 'localCorrelationKeys', flag: 'local-correlation-key' },
      { name: 'processVariables', flag: 'var' },
      { name: 'processVariablesLocal', flag: 'local-var' },
      { name: 'processVariablesToTriggeredScope', flag: 'triggered-scope-var' },
    ]);
  });

  it('describes the deployment upload', () => {
    const body = byId('createDeployment')?.body;
    expect(body).toMatchObject({ kind: 'multipart', resources: true });
    expect(body?.fields.map((field) => field.flag)).not.toContain('data');
  });

  it('marks single variable bodies', () => {
    const body = byId('setProcessInstanceVariable')?.body;
    expect(body).toMatchObject({
      kind: 'json',
      variableValue: true,
      schemaName: 'VariableValueDto',
    });
  });
});
