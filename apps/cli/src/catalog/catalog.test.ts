import { describe, expect, it } from 'vitest';
import {
  findByOperationId,
  findOperationByPath,
  findGroup,
  findOperation,
  loadCatalog,
  operationsInGroup,
} from './catalog.js';
import type { Catalog, OperationSpec } from './types.js';

const catalog = loadCatalog();

describe('loadCatalog', () => {
  it('returns the generated catalog', () => {
    expect(catalog.operations).toHaveLength(396);
    expect(catalog.groups).toHaveLength(52);
    expect(Object.keys(catalog.schemas)).toHaveLength(194);
    expect(catalog.source.url).toBe(
      'https://raw.githubusercontent.com/operaton/operaton-mcp/refs/heads/main/resources/operaton-rest-api.json',
    );
  });

  it('returns the same object on every call', () => {
    expect(loadCatalog()).toBe(catalog);
  });
});

describe('findGroup', () => {
  it('finds a group by its kebab name', () => {
    expect(findGroup(catalog, 'process-instance')).toEqual({
      name: 'process-instance',
      tag: 'Process Instance',
      description:
        'Query, modify, suspend and delete running process instances and their variables',
    });
  });

  it('does not match tags or other spellings', () => {
    expect(findGroup(catalog, 'Process Instance')).toBeUndefined();
    expect(findGroup(catalog, 'process-instances')).toBeUndefined();
    expect(findGroup(catalog, '')).toBeUndefined();
  });
});

describe('operationsInGroup', () => {
  it('returns all operations of the group and nothing else', () => {
    const operations = operationsInGroup(catalog, 'incident');
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every((operation) => operation.group === 'incident')).toBe(true);
    const total = catalog.groups.reduce(
      (sum, group) => sum + operationsInGroup(catalog, group.name).length,
      0,
    );
    expect(total).toBe(catalog.operations.length);
  });

  it('returns an empty list for an unknown group', () => {
    expect(operationsInGroup(catalog, 'nope')).toEqual([]);
  });
});

describe('findOperation', () => {
  it('finds an operation by command name', () => {
    const operation = findOperation(catalog, 'process-instance', 'list');
    expect(operation?.operationId).toBe('getProcessInstances');
    expect(operation?.method).toBe('GET');
    expect(operation?.path).toBe('/process-instance');
  });

  it('finds an operation by alias', () => {
    expect(findOperation(catalog, 'process-instance', 'get-process-instances')?.name).toBe('list');
    expect(
      findOperation(catalog, 'process-definition', 'start-process-instance-by-key')?.name,
    ).toBe('start');
  });

  it('finds presets by name', () => {
    const suspend = findOperation(catalog, 'process-instance', 'suspend');
    expect(suspend?.operationId).toBe('updateSuspensionStateById');
    expect(suspend?.preset).toEqual({ suspended: true });
    expect(findOperation(catalog, 'process-instance', 'activate')?.preset).toEqual({
      suspended: false,
    });
  });

  it('requires the group to match', () => {
    expect(findOperation(catalog, 'task', 'get-process-instances')).toBeUndefined();
    expect(findOperation(catalog, 'nope', 'list')).toBeUndefined();
  });

  it('is case-sensitive for command names', () => {
    expect(findOperation(catalog, 'process-instance', 'List')).toBeUndefined();
  });
});

describe('findByOperationId', () => {
  it('finds an operation regardless of case', () => {
    for (const id of ['getProcessInstances', 'getprocessinstances', 'GETPROCESSINSTANCES']) {
      expect(findByOperationId(catalog, id)?.name).toBe('list');
    }
  });

  it('returns the base operation rather than a preset', () => {
    const operation = findByOperationId(catalog, 'updateSuspensionStateById');
    expect(operation?.name).toBe('update-suspension-state-by-id');
    expect(operation?.preset).toBeUndefined();
  });

  it('falls back to a preset when only presets match', () => {
    const preset = { ...catalog.operations[0], preset: { a: 1 } } as OperationSpec;
    const synthetic: Catalog = { ...catalog, operations: [preset] };
    expect(findByOperationId(synthetic, preset.operationId)).toBe(preset);
  });

  it('returns undefined for unknown ids', () => {
    expect(findByOperationId(catalog, 'nope')).toBeUndefined();
    expect(findByOperationId(catalog, '')).toBeUndefined();
  });

  it('finds every operation of the catalog', () => {
    for (const operation of catalog.operations) {
      expect(findByOperationId(catalog, operation.operationId)?.operationId).toBe(
        operation.operationId,
      );
    }
  });
});

describe('findOperationByPath', () => {
  it('finds the most specific catalog operation for method and path', () => {
    expect(findOperationByPath(catalog, 'GET', '/process-definition/count')?.name).toBe('count');
    expect(findOperationByPath(catalog, 'GET', '/process-definition/p1')?.name).toBe('get');
    expect(findOperationByPath(catalog, 'POST', '/process-definition/count')).toBeUndefined();
    expect(findOperationByPath(catalog, 'GET', '/process-definition/')).toBeUndefined();
    expect(findOperationByPath(catalog, 'GET', '/nothing/here')).toBeUndefined();
    expect(
      findOperationByPath(catalog, 'DELETE', '/engine/default/process-instance/p1')?.effect,
    ).toBe('delete');
    expect(findOperationByPath(catalog, 'GET', '/engine')?.operationId).toBe(
      'getProcessEngineNames',
    );
  });

  it('compares percent-decoded segments, so encoded literals still match', () => {
    expect(findOperationByPath(catalog, 'POST', '/process-instance/%64elete')?.effect).toBe('bulk');
    expect(findOperationByPath(catalog, 'GET', '/process-instance/%zz')?.name).toBe('get');
  });

  it('prefers the base operation over presets with the same method and path', () => {
    const operation = findOperationByPath(catalog, 'PUT', '/batch/b1/suspended');
    expect(operation?.preset).toBeUndefined();
    expect(operation?.path).toBe('/batch/{id}/suspended');
  });
});
