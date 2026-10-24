import { describe, expect, it } from 'vitest';
import type { Catalog, OperationSpec, ParamSpec } from '../../src/catalog/types.js';
import { buildCatalog } from './build-catalog.js';
import { readPatchedSpec } from './files.js';
import { SPEC_URL } from './render.js';
import { SUMMARY_OVERRIDES, assertUniqueSummaries, summarize } from './summaries.js';

const pathParam = (name: string): ParamSpec => ({
  name,
  in: 'path',
  flag: name,
  type: 'string',
  required: true,
  description: '',
});

function operation(group: string, name: string, path: string, summary = 'Upstream'): OperationSpec {
  const params = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => pathParam(match[1] ?? ''));
  return {
    operationId: `${group}-${name}`,
    group,
    name,
    aliases: [],
    method: 'GET',
    path,
    summary,
    description: '',
    deprecated: false,
    effect: 'read',
    engineScoped: true,
    params,
    responses: [],
  };
}

const summaries = (operations: OperationSpec[], overrides = {}) =>
  summarize(operations, overrides).map((entry) => entry.summary);

describe('summarize', () => {
  it('builds summaries for the standard command names from the group noun', () => {
    expect(
      summaries([
        operation('process-instance', 'list', '/process-instance'),
        operation('process-instance', 'count', '/process-instance/count'),
        operation('process-instance', 'query', '/process-instance'),
        operation('process-instance', 'query-count', '/process-instance/count'),
        operation('process-instance', 'get', '/process-instance/{id}'),
        operation('process-instance', 'delete', '/process-instance/{id}'),
        operation('process-instance', 'update', '/process-instance/{id}'),
        operation('task-attachment', 'create', '/task/{id}/attachment/create'),
        operation('task-attachment', 'add', '/task/{id}/attachment/create'),
        operation('task-attachment', 'get', '/task/{id}/attachment/{attachmentId}'),
        operation('batch', 'list', '/batch'),
        operation('incident', 'get', '/incident/{id}'),
        operation('user', 'delete', '/user/{id}'),
      ]),
    ).toEqual([
      'List process instances',
      'Count process instances',
      'List process instances (filters in the JSON body)',
      'Count process instances (filters in the JSON body)',
      'Get a process instance by id',
      'Delete a process instance by id',
      'Update a process instance by id',
      'Create a task attachment',
      'Add a task attachment',
      'Get a task attachment',
      'List batches',
      'Get an incident by id',
      'Delete a user by id',
    ]);
  });

  it('keeps the upstream summary of get, delete and update without path parameters', () => {
    expect(summaries([operation('version', 'get', '/version', 'Get Rest API version')])).toEqual([
      'Get Rest API version',
    ]);
  });

  it('prefers overrides over the rules and the upstream summary', () => {
    const list = operation('task', 'list', '/task');
    expect(summaries([list], { [list.operationId]: 'Find tasks' })).toEqual(['Find tasks']);
  });

  it('appends the path variant to summaries shared within a group', () => {
    expect(
      summaries([
        operation('process-definition', 'xml', '/process-definition/key/{key}/xml', 'Get XML'),
        operation('process-definition', 'xml-by-id', '/process-definition/{id}/xml', 'Get XML'),
        operation(
          'process-definition',
          'xml-by-key-and-tenant-id',
          '/process-definition/key/{key}/tenant-id/{tenant-id}/xml',
          'Get XML',
        ),
        operation('decision-definition', 'xml', '/decision-definition/key/{key}/xml', 'Get XML'),
      ]),
    ).toEqual(['Get XML (by key)', 'Get XML (by id)', 'Get XML (by key and tenant id)', 'Get XML']);
  });

  it('leaves shared summaries without a path variant alone (assertUniqueSummaries reports them)', () => {
    const shared = [
      operation('thing', 'a', '/thing/a', 'Same'),
      operation('thing', 'b', '/thing/b', 'Same'),
    ];
    const result = summarize(shared, {});
    expect(result.map((entry) => entry.summary)).toEqual(['Same', 'Same']);
    expect(() => {
      assertUniqueSummaries(result);
    }).toThrow(new Error('Commands of group thing share the summary "Same"'));
  });

  it('rejects overrides for unknown operations', () => {
    expect(() => summarize([operation('task', 'list', '/task')], { gone: 'x' })).toThrow(
      new Error('Summary overrides for unknown operations: gone'),
    );
  });
});

let cachedCatalog: Catalog | undefined;

function realCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(readPatchedSpec(), SPEC_URL);
  return cachedCatalog;
}

describe('summaries of the generated catalog', () => {
  it('are unique within every group', () => {
    expect(() => {
      assertUniqueSummaries(realCatalog().operations);
    }).not.toThrow();
  });

  it('are sentences of at least two words that name what they do', () => {
    const generic = realCatalog().operations.filter(
      (entry) =>
        !/^[A-Z]\S*( \S+)+$/.test(entry.summary) || /^Get (List|Count)?$/.test(entry.summary),
    );
    expect(generic.map((entry) => `${entry.group} ${entry.name}: ${entry.summary}`)).toEqual([]);
  });

  it('fix the wrong upstream summaries', () => {
    const summary = (group: string, name: string) =>
      realCatalog().operations.find((entry) => entry.group === group && entry.name === name)
        ?.summary;
    expect(summary('tenant', 'delete-group-membership')).toBe('Remove a group from a tenant');
    expect(summary('process-definition', 'update-suspension-state-by-key')).toBe(
      'Activate or suspend all versions of a process definition (by key)',
    );
    expect(summary('signal', 'throw')).toBe('Throw a signal');
    expect(summary('external-task', 'lock')).toBe('Lock an external task');
    expect(summary('process-instance', 'list')).toBe('List process instances');
    expect(summary('process-instance', 'query')).toBe(
      'List process instances (filters in the JSON body)',
    );
  });

  it('use overrides for existing operations only', () => {
    const ids = new Set(realCatalog().operations.map((entry) => entry.operationId));
    expect(Object.keys(SUMMARY_OVERRIDES).filter((id) => !ids.has(id))).toEqual([]);
  });
});
