import { describe, expect, it } from 'vitest';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import { buildQuery, splitArgs } from './params.js';

const catalog = loadCatalog();

function op(operationId: string): OperationSpec {
  const operation = findByOperationId(catalog, operationId);
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`);
  return operation;
}

function caught(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

describe('splitArgs', () => {
  it('takes path arguments in path order', () => {
    expect(splitArgs(op('setProcessInstanceVariable'), ['pi-1', 'amount'])).toEqual({
      pathArgs: ['pi-1', 'amount'],
      files: [],
    });
  });

  it('accepts operations without path params', () => {
    expect(splitArgs(op('getProcessInstances'), [])).toEqual({ pathArgs: [], files: [] });
  });

  it('lists every missing argument with its CLI name', () => {
    const error = caught(() => splitArgs(op('setProcessInstanceVariable'), []));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('Missing argument(s): <id> <var-name>');
    expect(error.details.hint).toBe(
      'Run "operate process-instance set-variable --help" for the usage.',
    );
    expect(caught(() => splitArgs(op('setProcessInstanceVariable'), ['pi-1'])).message).toBe(
      'Missing argument(s): <var-name>',
    );
  });

  it('rejects extra arguments for operations without resource files', () => {
    const error = caught(() => splitArgs(op('getProcessInstance'), ['a', 'b', 'c']));
    expect(error.message).toBe('Unexpected argument(s): b c');
    expect(error.details.hint).toBe('Run "operate process-instance get --help" for the usage.');
  });

  it('rejects extra arguments for multipart operations without resources', () => {
    expect(() =>
      splitArgs(op('setProcessInstanceVariableBinary'), ['pi', 'var', 'file.bin']),
    ).toThrow('Unexpected argument(s): file.bin');
  });

  it('returns the remaining arguments as resource files', () => {
    expect(splitArgs(op('createDeployment'), ['a.bpmn', 'b.dmn'])).toEqual({
      pathArgs: [],
      files: ['a.bpmn', 'b.dmn'],
    });
  });

  it('validates enum path params', () => {
    expect(splitArgs(op('getMetrics'), ['process-instances']).pathArgs).toEqual([
      'process-instances',
    ]);
    const error = caught(() => splitArgs(op('getMetrics'), ['nope']));
    expect(error.message).toMatch(
      /^<metrics-name> expects one of activity-instance-start, activity-instance-end, .*, got "nope"$/,
    );
  });
});

describe('buildQuery', () => {
  it('is empty without flags', () => {
    expect(buildQuery(op('getProcessInstances'), {})).toEqual({});
  });

  it('keys values by wire name and types them', () => {
    expect(
      buildQuery(op('getProcessInstances'), {
        'business-key': 'order-1',
        'max-results': '10',
        'first-result': '0',
        suspended: true,
        'with-incident': false,
        'sort-by': 'instanceId',
        'sort-order': 'desc',
      }),
    ).toEqual({
      businessKey: 'order-1',
      maxResults: '10',
      firstResult: '0',
      suspended: 'true',
      withIncident: 'false',
      sortBy: 'instanceId',
      sortOrder: 'desc',
    });
  });

  it('normalizes integers', () => {
    expect(buildQuery(op('getProcessInstances'), { 'max-results': '007' })).toEqual({
      maxResults: '7',
    });
  });

  it('normalizes date-times', () => {
    expect(buildQuery(op('getMetrics'), { 'start-date': '2024-05-01T10:00+02:00' })).toEqual({
      startDate: '2024-05-01T10:00:00.000+0200',
    });
  });

  it('sends presence flags whose name starts with no- as true', () => {
    expect(buildQuery(op('getJobs'), { 'no-retries-left': true })).toEqual({
      noRetriesLeft: 'true',
    });
  });

  it('ignores flags that are not query params', () => {
    expect(buildQuery(op('getProcessInstance'), { id: 'x', other: 'y' })).toEqual({});
  });

  it('rejects invalid values with the flag name', () => {
    expect(
      caught(() => buildQuery(op('getProcessInstances'), { 'max-results': 'ten' })).message,
    ).toBe('--max-results expects an integer, got "ten"');
    expect(
      caught(() => buildQuery(op('getProcessInstances'), { 'sort-order': 'up' })).message,
    ).toBe('--sort-order expects one of asc, desc, got "up"');
  });

  it('requires required query params', () => {
    const error = caught(() =>
      buildQuery(op('isUserAuthorized'), { 'permission-name': 'READ', 'resource-name': 'x' }),
    );
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe('Missing required option --resource-type');
    expect(error.details.hint).toBe('Run "operate authorization check --help" for the usage.');
    expect(
      buildQuery(op('isUserAuthorized'), {
        'permission-name': 'READ',
        'resource-name': 'x',
        'resource-type': '0',
      }),
    ).toEqual({ permissionName: 'READ', resourceName: 'x', resourceType: '0' });
  });
});
