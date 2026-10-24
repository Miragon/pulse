import { describe, expect, it } from 'vitest';
import type { BodySpec, Catalog, ParamSpec, ResponseSpec } from '../../src/catalog/types.js';
import { buildCatalog } from './build-catalog.js';
import {
  BULK_OPERATIONS,
  EFFECT_OVERRIDES,
  type EffectInput,
  classifyEffect,
  isReadOnly,
} from './effects.js';
import { readPatchedSpec } from './files.js';
import type { OpenApiDocument } from './openapi.js';
import { SPEC_URL } from './render.js';

let cachedCatalog: Catalog | undefined;

/**
 * The catalog built from the vendored spec. Built lazily inside the first test that needs it, never
 * at load time, so mutation testing attributes the generator code to tests.
 */
function realCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(readPatchedSpec(), SPEC_URL);
  return cachedCatalog;
}

function baseOperations() {
  return realCatalog().operations.filter((operation) => operation.preset === undefined);
}

function effectOf(operationId: string) {
  const operation = baseOperations().find((candidate) => candidate.operationId === operationId);
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`);
  return operation.effect;
}

const EMPTY_SPEC: OpenApiDocument = {
  info: { title: 't', version: '1' },
  paths: {},
  components: {
    schemas: {
      Selector: { type: 'object', properties: { processInstanceIds: { type: 'array' } } },
      Query: { type: 'object', properties: { processInstanceQuery: { type: 'object' } } },
      Plain: { type: 'object', properties: { name: { type: 'string' } } },
      NotSelector: {
        type: 'object',
        properties: {
          processInstanceQueryTimeout: { type: 'integer' },
          IdsHint: { type: 'string' },
        },
      },
    },
  },
};

const PATH_PARAM: ParamSpec = {
  name: 'id',
  in: 'path',
  flag: 'id',
  type: 'string',
  required: true,
  description: '',
};

function jsonBody(schemaName: string): BodySpec {
  return {
    kind: 'json',
    schemaName,
    schema: { $ref: `#/components/schemas/${schemaName}` },
    fields: [],
    variableMaps: [],
    variableValue: false,
  };
}

function input(overrides: Partial<EffectInput>): EffectInput {
  return {
    operationId: 'doSomething',
    method: 'POST',
    path: '/thing',
    params: [],
    body: undefined,
    responses: [],
    ...overrides,
  };
}

const BATCH_RESPONSE: ResponseSpec = {
  status: 200,
  kind: 'json',
  contentTypes: ['application/json'],
  description: '',
  schema: { $ref: '#/components/schemas/BatchDto' },
};

describe('isReadOnly', () => {
  it.each([
    ['GET', 'deleteSomething', '/x', true],
    ['POST', 'queryTasks', '/task', true],
    ['POST', 'postQueryGroups', '/group', true],
    ['POST', 'evaluateDecisionByKey', '/decision', true],
    ['POST', 'generateMigrationPlan', '/migration/generate', true],
    ['POST', 'validateMigrationPlan', '/migration/validate', true],
    ['POST', 'postExecuteFilterList', '/filter/{id}/list', true],
    ['POST', 'checkPassword', '/identity/password-policy', true],
    ['POST', 'verifyUser', '/identity/verify', true],
    ['POST', 'getGroupInfo', '/identity/groups', true],
    ['POST', 'somethingCount', '/thing/count', true],
    ['POST', 'createThing', '/thing/create', false],
    ['POST', 'myQueryTasks', '/task', false],
    ['POST', 'reevaluateThing', '/thing', false],
    ['POST', 'requeryTasks', '/task', false],
    ['POST', 'createCount', '/thing/counter', false],
    ['PUT', 'queryTasks', '/task/count', false],
    ['DELETE', 'queryTasks', '/task', false],
  ] as const)('%s %s %s → %s', (method, operationId, path, expected) => {
    expect(isReadOnly({ method, operationId, path })).toBe(expected);
  });
});

describe('classifyEffect', () => {
  it('classifies by method', () => {
    expect(classifyEffect(input({ method: 'GET' }), EMPTY_SPEC)).toBe('read');
    expect(classifyEffect(input({ method: 'POST' }), EMPTY_SPEC)).toBe('write');
    expect(classifyEffect(input({ method: 'PUT' }), EMPTY_SPEC)).toBe('write');
    expect(classifyEffect(input({ method: 'DELETE' }), EMPTY_SPEC)).toBe('delete');
  });

  it('applies overrides before every other rule', () => {
    const override = input({ operationId: 'clearIncidentAnnotation', method: 'DELETE' });
    expect(classifyEffect(override, EMPTY_SPEC)).toBe('write');
    const evaluate = input({ operationId: 'evaluateCondition', method: 'POST' });
    expect(classifyEffect(evaluate, EMPTY_SPEC)).toBe('write');
  });

  it('marks listed bulk operations as bulk', () => {
    expect(classifyEffect(input({ operationId: 'cleanupAsync' }), EMPTY_SPEC)).toBe('bulk');
    expect(
      classifyEffect(
        input({ operationId: 'deleteProcessDefinitionsByKey', method: 'DELETE' }),
        EMPTY_SPEC,
      ),
    ).toBe('bulk');
  });

  it('marks operations returning a batch as bulk', () => {
    expect(classifyEffect(input({ responses: [BATCH_RESPONSE] }), EMPTY_SPEC)).toBe('bulk');
    const other = { ...BATCH_RESPONSE, schema: { $ref: '#/components/schemas/Other' } };
    const plain = { ...BATCH_RESPONSE, schema: undefined } as unknown as ResponseSpec;
    expect(classifyEffect(input({ responses: [other, plain] }), EMPTY_SPEC)).toBe('write');
  });

  it('marks bodies selecting many resources by ids or query as bulk', () => {
    expect(classifyEffect(input({ body: jsonBody('Selector') }), EMPTY_SPEC)).toBe('bulk');
    expect(classifyEffect(input({ body: jsonBody('Query'), method: 'DELETE' }), EMPTY_SPEC)).toBe(
      'bulk',
    );
    expect(classifyEffect(input({ body: jsonBody('Plain') }), EMPTY_SPEC)).toBe('write');
    expect(classifyEffect(input({ body: jsonBody('NotSelector') }), EMPTY_SPEC)).toBe('write');
  });

  it('keeps the selector rule for operations with query parameters only', () => {
    const query: ParamSpec = { ...PATH_PARAM, name: 'tenantId', in: 'query', flag: 'tenant-id' };
    expect(classifyEffect(input({ body: jsonBody('Selector'), params: [query] }), EMPTY_SPEC)).toBe(
      'bulk',
    );
  });

  it('does not treat selector bodies of single-resource paths as bulk', () => {
    const single = input({ body: jsonBody('Selector'), params: [PATH_PARAM], path: '/thing/{id}' });
    expect(classifyEffect(single, EMPTY_SPEC)).toBe('write');
  });

  it('ignores multipart bodies for the selector rule', () => {
    const multipart: BodySpec = { kind: 'multipart', fields: [], resources: false };
    expect(classifyEffect(input({ body: multipart }), EMPTY_SPEC)).toBe('write');
  });

  it('copes with a spec without components', () => {
    const bare: OpenApiDocument = { info: { title: 't', version: '1' }, paths: {} };
    expect(classifyEffect(input({ body: jsonBody('Selector') }), bare)).toBe('write');
  });
});

describe('effects in the generated catalog', () => {
  it('classifies every GET operation as read', () => {
    const gets = baseOperations().filter((operation) => operation.method === 'GET');
    expect(gets.length).toBeGreaterThan(100);
    expect(gets.filter((operation) => operation.effect !== 'read')).toEqual([]);
  });

  it.each([
    'queryProcessInstances',
    'queryProcessInstancesCount',
    'queryTasks',
    'queryTasksCount',
    'queryHistoricProcessInstances',
    'evaluateDecisionByKey',
    'postExecuteFilterList',
    'generateMigrationPlan',
  ])('classifies the query/count POST %s as read', (operationId) => {
    expect(effectOf(operationId)).toBe('read');
  });

  it.each([
    ['deleteProcessInstance', 'delete'],
    ['deleteDeployment', 'delete'],
    ['resolveIncident', 'delete'],
    ['startProcessInstanceByKey', 'write'],
    ['createDeployment', 'write'],
    ['fetchAndLock', 'write'],
    ['deliverMessage', 'write'],
    ['evaluateCondition', 'write'],
    ['deleteIdentityLink', 'delete'],
    ['deleteProcessInstancesAsyncOperation', 'bulk'],
    ['setRetriesByProcess', 'bulk'],
    ['updateSuspensionStateAsyncOperation', 'bulk'],
  ] as const)('classifies %s as %s', (operationId, effect) => {
    expect(effectOf(operationId)).toBe(effect);
  });

  it.each([...BULK_OPERATIONS])(
    'classifies the listed bulk operation %s as bulk',
    (operationId) => {
      expect(effectOf(operationId)).toBe('bulk');
    },
  );

  it.each(Object.entries(EFFECT_OVERRIDES))(
    'applies the override %s → %s',
    (operationId, effect) => {
      expect(effectOf(operationId)).toBe(effect);
    },
  );

  it('marks only non-GET operations as changing state', () => {
    for (const operation of baseOperations()) {
      if (operation.effect !== 'read') expect(operation.method).not.toBe('GET');
    }
  });

  it('has the expected number of operations per effect', () => {
    const counts = Object.fromEntries(
      (['read', 'write', 'delete', 'bulk'] as const).map((effect) => [
        effect,
        realCatalog().operations.filter((operation) => operation.effect === effect).length,
      ]),
    );
    expect(counts).toEqual({ read: 235, write: 100, delete: 29, bulk: 32 });
  });

  it('classifies every command named delete as delete or bulk', () => {
    const deletes = realCatalog().operations.filter((operation) =>
      operation.name.startsWith('delete'),
    );
    expect(deletes.length).toBeGreaterThan(20);
    expect(deletes.filter((operation) => !['delete', 'bulk'].includes(operation.effect))).toEqual(
      [],
    );
  });
});
