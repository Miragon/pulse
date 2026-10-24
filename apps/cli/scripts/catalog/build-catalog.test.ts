import { describe, expect, it } from 'vitest';
import type { Catalog, OperationSpec } from '../../src/catalog/types.js';
import { assertUniqueNames, assignNames, buildCatalog, stripExamples } from './build-catalog.js';
import { readPatchedSpec } from './files.js';
import { GROUP_DESCRIPTIONS } from './groups.js';
import type { OpenApiDocument } from './openapi.js';
import type { UnnamedOperation } from './operations.js';
import { NAME_OVERRIDES } from './overrides.js';
import { PRESETS } from './presets.js';
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

function unnamed(operationId: string, tag: string): UnnamedOperation {
  return {
    operationId,
    tag,
    method: 'GET',
    path: `/${operationId}`,
    summary: operationId,
    description: '',
    deprecated: false,
    effect: 'read',
    engineScoped: true,
    params: [],
    responses: [],
  };
}

function named(group: string, name: string, aliases: string[] = []): OperationSpec {
  const { tag: _tag, ...rest } = unnamed(name, group);
  return { ...rest, group, name, aliases };
}

describe('assignNames', () => {
  it('derives short names and keeps the kebab operationId as alias', () => {
    const [operation] = assignNames([unnamed('getProcessInstances', 'Process Instance')], {}, {});
    expect(operation).toMatchObject({
      operationId: 'getProcessInstances',
      group: 'process-instance',
      name: 'list',
      aliases: ['get-process-instances'],
    });
    expect(operation).not.toHaveProperty('tag');
  });

  it('uses the kebab operationId when no rule applies, without alias', () => {
    const [operation] = assignNames([unnamed('getRestAPIVersion', 'Version')], {}, {});
    expect(operation).toMatchObject({
      group: 'version',
      name: 'get-rest-api-version',
      aliases: [],
    });
  });

  it('prefers overrides', () => {
    const [operation] = assignNames(
      [unnamed('getRestAPIVersion', 'Version')],
      { getRestAPIVersion: 'get' },
      {},
    );
    expect(operation).toMatchObject({ name: 'get', aliases: ['get-rest-api-version'] });
  });

  it('falls back to the full names when short names clash in a group', () => {
    const operations = assignNames(
      [unnamed('getTask', 'Task'), unnamed('getTaskX', 'Task'), unnamed('getThing', 'Thing')],
      { getTaskX: 'get' },
      {},
    );
    expect(operations.map((operation) => [operation.name, operation.aliases])).toEqual([
      ['get-task', []],
      ['get-task-x', []],
      ['get', ['get-thing']],
    ]);
  });

  it('allows the same short name in different groups', () => {
    const operations = assignNames([unnamed('getTask', 'Task'), unnamed('getJob', 'Job')], {}, {});
    expect(operations.map((operation) => `${operation.group} ${operation.name}`)).toEqual([
      'task get',
      'job get',
    ]);
  });

  it('rejects overrides for unknown operations', () => {
    expect(() =>
      assignNames([unnamed('getTask', 'Task')], { getTask: 'x', gone: 'y', old: 'z' }, {}),
    ).toThrow(new Error('Name overrides for unknown operations: gone, old'));
  });

  it('adds extra aliases after the kebab operationId', () => {
    const [operation] = assignNames(
      [unnamed('putTaskVariable', 'Task Variable')],
      { putTaskVariable: 'put' },
      { putTaskVariable: ['set'] },
    );
    expect(operation).toMatchObject({ name: 'put', aliases: ['put-task-variable', 'set'] });
  });

  it('rejects extra aliases for unknown operations', () => {
    expect(() => assignNames([unnamed('getTask', 'Task')], {}, { gone: ['x'] })).toThrow(
      new Error('Extra aliases for unknown operations: gone'),
    );
  });

  it('uses the extra aliases of the real catalog', () => {
    const names = (group: string, name: string) =>
      realCatalog().operations.find((op) => op.group === group && op.name === name)?.aliases;
    expect(names('task-variable', 'put')).toContain('set');
    expect(names('task-local-variable', 'put')).toContain('set');
    expect(names('execution', 'put-local-variable')).toContain('set-local-variable');
  });
});

describe('assertUniqueNames', () => {
  it('accepts distinct names and aliases', () => {
    expect(() => {
      assertUniqueNames([named('task', 'list', ['get-tasks']), named('job', 'list', ['get-jobs'])]);
    }).not.toThrow();
  });

  it('rejects a name used twice in a group', () => {
    const first = { ...named('task', 'list'), operationId: 'a' };
    const second = { ...named('task', 'list'), operationId: 'b' };
    expect(() => {
      assertUniqueNames([first, second]);
    }).toThrow(new Error('Command name clash "task list": a and b'));
  });

  it('rejects an alias that equals another command name', () => {
    const first = { ...named('task', 'list'), operationId: 'a' };
    const second = { ...named('task', 'query', ['list']), operationId: 'b' };
    expect(() => {
      assertUniqueNames([first, second]);
    }).toThrow(new Error('Command name clash "task list": a and b'));
  });
});

describe('stripExamples', () => {
  it('removes example and examples at every level', () => {
    const input = {
      example: 1,
      properties: {
        a: { type: 'string', example: 'x', examples: ['y'] },
        b: { items: [{ example: true, type: 'integer' }] },
      },
      exampleValue: 'kept',
      list: [null, 'text', 3],
    };
    expect(stripExamples(input)).toEqual({
      properties: { a: { type: 'string' }, b: { items: [{ type: 'integer' }] } },
      exampleValue: 'kept',
      list: [null, 'text', 3],
    });
  });

  it('keeps properties that are named example or examples', () => {
    const input = {
      type: 'object',
      example: { example: 'x' },
      properties: {
        example: { type: 'string', example: 'drop me' },
        examples: { type: 'array', examples: [['drop me']] },
        properties: { type: 'object', example: {}, properties: { example: { example: 1 } } },
      },
    };
    expect(stripExamples(input)).toStrictEqual({
      type: 'object',
      properties: {
        example: { type: 'string' },
        examples: { type: 'array' },
        properties: { type: 'object', properties: { example: {} } },
      },
    });
  });

  it('strips examples from nested schemas outside properties maps', () => {
    const input = {
      type: 'array',
      items: { type: 'string', example: 'x', properties: { example: { example: 1 } } },
      additionalProperties: { examples: [1], type: 'integer' },
    };
    expect(stripExamples(input)).toStrictEqual({
      type: 'array',
      items: { type: 'string', properties: { example: {} } },
      additionalProperties: { type: 'integer' },
    });
  });

  it('strips examples inside arrays of schemas', () => {
    expect(stripExamples([{ example: 1, type: 'string' }, [{ examples: [] }]])).toStrictEqual([
      { type: 'string' },
      [{}],
    ]);
  });

  it('returns primitives unchanged and leaves the input alone', () => {
    expect(stripExamples('x')).toBe('x');
    expect(stripExamples(null)).toBeNull();
    const input = { example: 1 };
    stripExamples(input);
    expect(input).toEqual({ example: 1 });
  });
});

describe('buildCatalog', () => {
  it('records the source', () => {
    const { info } = readPatchedSpec();
    expect(realCatalog().source).toEqual({
      title: info.title,
      version: info.version,
      url: SPEC_URL,
    });
  });

  it('has 396 commands in 52 groups and 194 schemas', () => {
    expect(realCatalog().operations).toHaveLength(396);
    expect(
      realCatalog().operations.filter((operation) => operation.preset !== undefined),
    ).toHaveLength(PRESETS.length);
    expect(realCatalog().groups).toHaveLength(52);
    expect(Object.keys(realCatalog().schemas)).toHaveLength(194);
  });

  it('uses unique command names and aliases per group', () => {
    const seen = new Set<string>();
    for (const operation of realCatalog().operations) {
      for (const name of [operation.name, ...operation.aliases]) {
        const key = `${operation.group} ${name}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it('sorts operations by group and name', () => {
    const keys = realCatalog().operations.map(
      (operation) => [operation.group, operation.name] as const,
    );
    const sorted = [...keys].sort(([g1, n1], [g2, n2]) =>
      g1 === g2 ? (n1 < n2 ? -1 : 1) : g1 < g2 ? -1 : 1,
    );
    expect(keys).toEqual(sorted);
  });

  it('describes every group, sorted by tag', () => {
    const tags = realCatalog().groups.map((group) => group.tag);
    expect(tags).toEqual([...tags].sort());
    for (const group of realCatalog().groups) {
      expect(group.description).toBe(GROUP_DESCRIPTIONS[group.tag]);
      expect(realCatalog().operations.some((operation) => operation.group === group.name)).toBe(
        true,
      );
    }
  });

  it('applies every name override', () => {
    for (const [operationId, name] of Object.entries(NAME_OVERRIDES)) {
      const operation = realCatalog().operations.find(
        (candidate) => candidate.operationId === operationId && candidate.preset === undefined,
      );
      expect(operation?.name, operationId).toBe(name);
    }
  });

  it('strips examples from the schemas', () => {
    expect(JSON.stringify(realCatalog().schemas)).not.toMatch(/"examples?":/);
  });

  it('describes groups without a curated description by their tag', () => {
    const spec = readPatchedSpec();
    const extended: OpenApiDocument = {
      ...spec,
      paths: {
        ...spec.paths,
        '/brand-new': { get: { operationId: 'getBrandNew', tags: ['Brand New'] } },
      },
    };
    const groups = buildCatalog(extended, SPEC_URL).groups;
    expect(groups.find((group) => group.tag === 'Brand New')).toEqual({
      name: 'brand-new',
      tag: 'Brand New',
      description: 'Brand New operations',
    });
  });

  it('rejects commands that clash with a preset', () => {
    const spec = readPatchedSpec();
    const clashing: OpenApiDocument = {
      ...spec,
      paths: {
        ...spec.paths,
        '/process-instance/suspend-all': {
          put: { operationId: 'suspendProcessInstance', tags: ['Process Instance'] },
        },
      },
    };
    expect(() => buildCatalog(clashing, SPEC_URL)).toThrow(
      new Error(
        'Command name clash "process-instance suspend": suspendProcessInstance and updateSuspensionStateById',
      ),
    );
  });

  it('rejects bulk classifications and effect overrides for unknown operations', () => {
    const empty: OpenApiDocument = { info: { title: 't', version: '1' }, paths: {} };
    expect(() => buildCatalog(empty, SPEC_URL)).toThrow(
      /^Bulk classification for unknown operations: /,
    );
    const withoutOverride = readPatchedSpec() as {
      paths: Record<string, Record<string, unknown>>;
    };
    delete withoutOverride.paths['/condition'];
    expect(() => buildCatalog(withoutOverride as unknown as OpenApiDocument, SPEC_URL)).toThrow(
      new Error('Effect overrides for unknown operations: evaluateCondition'),
    );
  });
});
