import { describe, expect, it } from 'vitest';
import type { Catalog, Schema } from '../../src/catalog/types.js';
import { buildCatalog } from './build-catalog.js';
import { readPatchedSpec } from './files.js';
import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from './openapi.js';
import { type UnnamedOperation, clean, extractOperations, responseKind } from './operations.js';
import { SPEC_URL } from './render.js';

const ref = (kind: string, name: string) => ({ $ref: `#/components/${kind}/${name}` });
const json = (schema: Schema) => ({ content: { 'application/json': { schema } } });

const TRUE_ONLY_TEXT =
  'Only include instances without tenant. Value may only be `true`, as `false` is the default behavior.';

const COMPONENTS: NonNullable<OpenApiDocument['components']> = {
  parameters: {
    Tenant: {
      name: 'tenantId',
      in: 'query',
      description: 'path level',
      schema: { type: 'string' },
    },
  },
  requestBodies: {
    Thing: json({
      type: 'object',
      properties: { name: { type: 'string' }, url: { type: 'string' } },
    }),
  },
  responses: { Ok: { description: ' OK ', ...json(ref('schemas', 'XmlDto')) } },
  schemas: {
    XmlDto: {
      type: 'object',
      properties: { id: { type: 'string' }, bpmn20Xml: { type: 'string' } },
    },
    ThreeProps: {
      type: 'object',
      properties: { id: {}, aXml: {}, other: {} },
    },
    TwoXml: { type: 'object', properties: { aXml: {}, bXml: {} } },
    NoId: { type: 'object', properties: { key: {}, aXml: {} } },
  },
};

function document(paths: Record<string, OpenApiPathItem>): OpenApiDocument {
  return { info: { title: 't', version: '1' }, paths, components: COMPONENTS };
}

function single(operation: OpenApiOperation, path = '/thing', method = 'get'): UnnamedOperation {
  const [first] = extractOperations(document({ [path]: { [method]: operation } }));
  if (first === undefined) throw new Error('no operation extracted');
  return first;
}

const SPEC = document({
  '/thing/{a}/sub/{b}': {
    parameters: [
      { name: 'b', in: 'path', required: true, schema: { type: 'string' } },
      ref('parameters', 'Tenant'),
    ],
    get: {
      operationId: 'getSub',
      tags: ['Thing', 'Other'],
      summary: ' Get a sub thing. ',
      description: 'Line 1\r\nLine 2\n',
      parameters: [
        {
          name: 'withoutTenant',
          in: 'query',
          description: TRUE_ONLY_TEXT,
          schema: { type: 'boolean' },
        },
        { name: 'a', in: 'path', required: true, schema: { type: 'string' } },
        {
          name: 'count',
          in: 'query',
          required: true,
          schema: { type: 'integer', format: 'int32' },
        },
        { name: 'state', in: 'query', schema: { type: 'string', enum: ['A', 'B', 3] } },
        { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
        {
          name: 'tenantId',
          in: 'query',
          description: 'operation level',
          schema: { type: 'string' },
        },
        { name: 'filter', in: 'query', schema: { type: 'object' } },
        {
          name: 'active',
          in: 'query',
          description: 'Only active ones.',
          schema: { type: 'boolean' },
        },
        { name: 'label', in: 'query', description: 'Value may only be `true`.' },
        { name: 'ratio', in: 'query', schema: { type: 'number' } },
        { name: 'session', in: 'cookie', schema: { type: 'string' } },
      ],
      responses: { '200': ref('responses', 'Ok'), '404': { description: 'Not found' } },
    },
    delete: {
      operationId: 'deleteSub',
      tags: ['Thing'],
      deprecated: true,
      responses: { '204': { description: 'No content' } },
    },
    options: { operationId: 'availableSubOperations', tags: ['Thing'] },
    summary: 'path item summary',
  },
  '/thing': {
    post: {
      operationId: 'createThing',
      tags: ['Thing'],
      requestBody: ref('requestBodies', 'Thing'),
      responses: { '200': json({ type: 'object' }), '201': { description: 'created' } },
    },
    put: {
      operationId: 'uploadThing',
      tags: ['Thing'],
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties: { data: { type: 'string', format: 'binary' } } },
          },
        },
      },
    },
  },
  '/engine': { get: { operationId: 'getEngines', tags: ['Engine'] } },
  '/version': { get: { operationId: 'getVersion', tags: ['Version'] } },
});

/** Extracts inside the calling test, so mutation testing attributes the coverage to it. */
const byId = (id: string) => {
  const operation = extractOperations(SPEC).find((candidate) => candidate.operationId === id);
  if (operation === undefined) throw new Error(`missing ${id}`);
  return operation;
};

describe('extractOperations', () => {
  it('fails for path item keys it does not know, such as PATCH', () => {
    const spec = document({ '/x': { patch: { operationId: 'patchX', tags: ['X'] } } });
    expect(() => extractOperations(spec)).toThrow('/x: unsupported path item key "patch"');
    const head = document({ '/y': { head: { operationId: 'headY', tags: ['Y'] } } });
    expect(() => extractOperations(head)).toThrow('/y: unsupported path item key "head"');
  });

  it('extracts GET, POST, PUT and DELETE operations in path order, never OPTIONS', () => {
    const operations = extractOperations(SPEC);
    expect(operations.map((operation) => `${operation.method} ${operation.operationId}`)).toEqual([
      'GET getSub',
      'DELETE deleteSub',
      'POST createThing',
      'PUT uploadThing',
      'GET getEngines',
      'GET getVersion',
    ]);
  });

  it('copies the basic properties and cleans texts', () => {
    const operation = byId('getSub');
    expect(operation).toMatchObject({
      operationId: 'getSub',
      tag: 'Thing',
      method: 'GET',
      path: '/thing/{a}/sub/{b}',
      summary: 'Get a sub thing.',
      description: 'Line 1\nLine 2',
      deprecated: false,
      effect: 'read',
      engineScoped: true,
    });
    expect(operation).not.toHaveProperty('body');
  });

  it('defaults summary, description and deprecated', () => {
    expect(byId('deleteSub')).toMatchObject({
      summary: 'deleteSub',
      description: '',
      deprecated: true,
      effect: 'delete',
      params: [
        { name: 'b', in: 'path', flag: 'b', type: 'string', required: true, description: '' },
        {
          name: 'tenantId',
          in: 'query',
          flag: 'tenant-id',
          type: 'string',
          required: false,
          description: 'path level',
        },
      ],
    });
  });

  it('orders path parameters by their position in the path, query parameters after them', () => {
    expect(byId('getSub').params.map((param) => `${param.in}:${param.name}`)).toEqual([
      'path:a',
      'path:b',
      'query:tenantId',
      'query:withoutTenant',
      'query:count',
      'query:state',
      'query:filter',
      'query:active',
      'query:label',
      'query:ratio',
    ]);
  });

  it('lets operation parameters replace path item parameters with the same name', () => {
    const tenant = byId('getSub').params.find((param) => param.name === 'tenantId');
    expect(tenant?.description).toBe('operation level');
  });

  it('types query parameters and keeps format and enum', () => {
    const params = Object.fromEntries(byId('getSub').params.map((param) => [param.name, param]));
    expect(params.count).toEqual({
      name: 'count',
      in: 'query',
      flag: 'count',
      type: 'integer',
      required: true,
      description: '',
      format: 'int32',
    });
    expect(params.state).toMatchObject({ type: 'string', enum: ['A', 'B', '3'] });
    expect(params.filter?.type).toBe('object');
    expect(params.ratio?.type).toBe('number');
    expect(params.label?.type).toBe('string');
  });

  it('gives the Java Integer paging and priority parameters the int32 format', () => {
    const integer = { type: 'integer' };
    const operation = single({
      operationId: 'getThings',
      tags: ['Thing'],
      parameters: [
        { name: 'firstResult', in: 'query', schema: integer },
        { name: 'maxResults', in: 'query', schema: integer },
        { name: 'priority', in: 'query', schema: integer },
        { name: 'minPriority', in: 'query', schema: integer },
        { name: 'maxPriority', in: 'query', schema: integer },
        { name: 'other', in: 'query', schema: integer },
        { name: 'maxResultsText', in: 'query', schema: { type: 'string' } },
        { name: 'interval', in: 'query', schema: { type: 'integer', format: 'int64' } },
      ],
    });
    expect(operation.params.map((param) => param.format)).toEqual([
      'int32',
      'int32',
      'int32',
      'int32',
      'int32',
      undefined,
      undefined,
      'int64',
    ]);
  });

  it('detects boolean filters that may only be true', () => {
    const params = Object.fromEntries(byId('getSub').params.map((param) => [param.name, param]));
    expect(params.withoutTenant).toMatchObject({
      type: 'boolean',
      flag: 'without-tenant',
      trueOnly: true,
    });
    expect(params.active).not.toHaveProperty('trueOnly');
    expect(params.label).not.toHaveProperty('trueOnly');
  });

  it.each([
    'Value may only be `true`, as `false` is the default behavior.',
    'value may only be true',
    'VALUE MAY ONLY BE `TRUE`',
  ])('detects trueOnly in %j', (description) => {
    const operation = single({
      operationId: 'x',
      tags: ['X'],
      parameters: [{ name: 'flag', in: 'query', description, schema: { type: 'boolean' } }],
    });
    expect(operation.params[0]?.trueOnly).toBe(true);
  });

  it('marks /engine and /version as not engine scoped', () => {
    expect(byId('getEngines').engineScoped).toBe(false);
    expect(byId('getVersion').engineScoped).toBe(false);
    expect(byId('createThing').engineScoped).toBe(true);
  });

  it('keeps only success responses and resolves response references', () => {
    expect(byId('getSub').responses).toEqual([
      {
        status: 200,
        kind: 'json',
        contentTypes: ['application/json'],
        description: 'OK',
        schema: ref('schemas', 'XmlDto'),
      },
    ]);
    expect(byId('createThing').responses).toEqual([
      {
        status: 200,
        kind: 'json',
        contentTypes: ['application/json'],
        description: '',
        schema: { type: 'object' },
      },
      { status: 201, kind: 'none', contentTypes: [], description: 'created' },
    ]);
    expect(byId('getEngines').responses).toEqual([]);
  });

  it('builds JSON and multipart bodies with flags', () => {
    expect(byId('createThing').body).toMatchObject({
      kind: 'json',
      fields: [
        { name: 'name', flag: 'name' },
        { name: 'url', flag: 'body-url' },
      ],
    });
    expect(byId('uploadThing').body).toMatchObject({
      kind: 'multipart',
      fields: [{ name: 'data', flag: 'data', type: 'binary' }],
      resources: false,
    });
  });

  it('detects XML documents worth unwrapping', () => {
    expect(byId('getSub').unwrap).toBe('bpmn20Xml');
    expect(byId('createThing')).not.toHaveProperty('unwrap');
    for (const schema of ['ThreeProps', 'TwoXml', 'NoId']) {
      const operation = single({
        operationId: 'x',
        tags: ['X'],
        responses: { '200': json(ref('schemas', schema)) },
      });
      expect(operation).not.toHaveProperty('unwrap');
    }
    const inline = single({
      operationId: 'x',
      tags: ['X'],
      responses: { '200': json({ properties: { id: {}, dmnXml: {} } }) },
    });
    expect(inline.unwrap).toBe('dmnXml');
  });

  it('fails without operationId or tag', () => {
    expect(() => single({ tags: ['X'] })).toThrow(
      new Error('GET /thing needs an operationId and a tag'),
    );
    expect(() => single({ operationId: 'x', tags: [] }, '/a', 'post')).toThrow(
      new Error('POST /a needs an operationId and a tag'),
    );
  });

  it('fails for unsupported request body content types', () => {
    const operation = {
      operationId: 'textBody',
      tags: ['X'],
      requestBody: { content: { 'text/plain': { schema: { type: 'string' } } } },
    };
    expect(() => single(operation, '/x', 'post')).toThrow(
      new Error('textBody: unsupported request body content types'),
    );
  });

  it('fails for unresolvable references', () => {
    const operation = { operationId: 'x', tags: ['X'], parameters: [ref('parameters', 'Missing')] };
    expect(() => single(operation)).toThrow(
      new Error('Unresolvable $ref: #/components/parameters/Missing'),
    );
  });
});

describe('extractOperations edge cases', () => {
  const bare = (paths: Record<string, OpenApiPathItem>): OpenApiDocument => ({
    info: { title: 't', version: '1' },
    paths,
  });

  it('works for specs without components', () => {
    const [operation] = extractOperations(
      bare({
        '/thing/{id}': {
          post: {
            operationId: 'postThing',
            tags: ['Thing'],
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
            requestBody: json({ type: 'object', properties: { a: { type: 'string' } } }),
            responses: {
              '200': json({ type: 'object', properties: { id: {}, docXml: {} } }),
            },
          },
        },
      }),
    );
    expect(operation?.params.map((param) => param.name)).toEqual(['id', 'q']);
    expect(operation?.body?.fields.map((field) => field.name)).toEqual(['a']);
    expect(operation?.unwrap).toBe('docXml');
  });

  it('orders path parameters with long names by their position in the path', () => {
    const operation = single(
      {
        operationId: 'x',
        tags: ['X'],
        parameters: [
          { name: 'second', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'first', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
      '/a/{first}/b/{second}',
    );
    expect(operation.params.map((param) => param.name)).toEqual(['first', 'second']);
  });

  it('keeps optional parameter properties absent', () => {
    const operation = single({
      operationId: 'x',
      tags: ['X'],
      parameters: [{ name: 'plain', in: 'query', schema: { type: 'string' } }],
      responses: { '204': { description: 'none' } },
    });
    expect(operation.params).toStrictEqual([
      {
        name: 'plain',
        in: 'query',
        flag: 'plain',
        type: 'string',
        required: false,
        description: '',
      },
    ]);
    expect(operation.responses).toStrictEqual([
      { status: 204, kind: 'none', contentTypes: [], description: 'none' },
    ]);
  });

  it('fails without tags', () => {
    expect(() => single({ operationId: 'x' })).toThrow(
      new Error('GET /thing needs an operationId and a tag'),
    );
  });

  it('fails for request bodies without content', () => {
    expect(() => single({ operationId: 'x', tags: ['X'], requestBody: {} }, '/x', 'post')).toThrow(
      new Error('x: unsupported request body content types'),
    );
  });

  it('unwraps the JSON response even when another success response comes first', () => {
    const operation = single({
      operationId: 'x',
      tags: ['X'],
      responses: {
        '200': { content: { 'text/plain': { schema: { type: 'string' } } } },
        '201': json(ref('schemas', 'XmlDto')),
      },
    });
    expect(operation.unwrap).toBe('bpmn20Xml');
  });
});

describe('clean', () => {
  it('normalizes line endings and trims', () => {
    expect(clean('  a\r\nb\r\n  ')).toBe('a\nb');
    expect(clean('')).toBe('');
  });
});

describe('responseKind', () => {
  it.each([
    [[], 'none'],
    [['application/json'], 'json'],
    [['application/xml', 'application/json'], 'json'],
    [['application/octet-stream'], 'binary'],
    [['image/png'], 'binary'],
    [['image/*'], 'binary'],
    [['*/*'], 'binary'],
    [['text/plain'], 'text'],
    [['text/csv', 'application/csv'], 'text'],
    [['application/xhtml+xml'], 'text'],
    [['application/hal+json'], 'text'],
  ])('%j → %s', (contentTypes, kind) => {
    expect(responseKind(contentTypes)).toBe(kind);
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

describe('operations in the generated catalog', () => {
  const find = (id: string) =>
    realCatalog().operations.find((operation) => operation.operationId === id && !operation.preset);

  it('orders path arguments by their position in the path', () => {
    for (const operation of realCatalog().operations) {
      const names = operation.params
        .filter((param) => param.in === 'path')
        .map((param) => param.name);
      const inPath = [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      expect(names).toEqual(inPath);
      const firstQuery = operation.params.findIndex((param) => param.in === 'query');
      if (firstQuery >= 0) expect(firstQuery).toBe(names.length);
    }
  });

  it('unwraps the BPMN and DMN XML responses', () => {
    expect(find('getProcessDefinitionBpmn20XmlByKey')?.unwrap).toBe('bpmn20Xml');
    expect(find('getDecisionDefinitionDmnXmlById')?.unwrap).toBe('dmnXml');
    expect(
      realCatalog().operations.filter((operation) => operation.unwrap !== undefined),
    ).toHaveLength(9);
  });

  it('detects trueOnly flags only on boolean query parameters', () => {
    const trueOnly = realCatalog().operations.flatMap((operation) =>
      operation.params.filter((param) => param.trueOnly === true),
    );
    expect(trueOnly.length).toBeGreaterThan(100);
    expect(trueOnly.every((param) => param.type === 'boolean' && param.in === 'query')).toBe(true);
    const latest = find('getProcessDefinitions')?.params.find(
      (param) => param.name === 'latestVersion',
    );
    expect(latest?.trueOnly).toBe(true);
  });

  it('classifies response kinds', () => {
    expect(find('getProcessInstances')?.responses[0]?.kind).toBe('json');
    expect(find('deleteProcessInstance')?.responses[0]?.kind).toBe('none');
    expect(find('getProcessInstanceVariableBinary')?.responses[0]?.kind).toBe('binary');
  });
});
